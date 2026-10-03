const fs = require('fs');
const zlib = require('zlib');
const { MAGIC_BYTES, HEADER_SIZE, HeaderOffsets, FRAME_PLAYER_SIZE } = require('@krunker-replay/shared/src/kre-format');

/**
 * .kreファイルのバイナリ書き出し
 */
class KreWriter {
  constructor(filePath, matchInfo) {
    this.filePath = filePath;
    this.matchInfo = matchInfo; // {mapId, mapName, gameMode, playerCount, clientVersion}
    this.fd = null;
    this.events = [];
    this.roster = {}; // プレイヤー名簿
    this.currentOffset = HEADER_SIZE;
  }

  initialize() {
    this.fd = fs.openSync(this.filePath, 'w');
    const headerBuffer = Buffer.alloc(HEADER_SIZE);
    
    MAGIC_BYTES.copy(headerBuffer, 0);
    // 仮のヘッダー情報を書き込む（finalizeで更新）
    headerBuffer.writeBigUInt64LE(BigInt(Date.now()), HeaderOffsets.RECORDED_AT);
    headerBuffer.writeUInt32LE(this.matchInfo.clientVersion || 0, HeaderOffsets.CLIENT_VERSION);
    headerBuffer.writeUInt32LE(this.matchInfo.mapId || 0, HeaderOffsets.MAP_ID);
    headerBuffer.write(this.matchInfo.mapName || 'Unknown', HeaderOffsets.MAP_NAME, 32, 'utf8');
    headerBuffer.writeUInt8(this.matchInfo.gameMode || 0, HeaderOffsets.GAME_MODE);
    headerBuffer.writeUInt8(this.matchInfo.playerCount || 0, HeaderOffsets.PLAYER_COUNT);
    
    fs.writeSync(this.fd, headerBuffer, 0, HEADER_SIZE, 0);
  }

  writeChunk(frames) {
    if (!this.fd) return;
    const serialized = this._serializeFrames(frames);
    const compressed = zlib.deflateSync(serialized); // zlib圧縮

    // チャンク境界を判別できるよう [長さ uint32][圧縮データ] の形で書く
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(compressed.length, 0);
    fs.writeSync(this.fd, lengthBuffer, 0, 4, this.currentOffset);
    this.currentOffset += 4;
    fs.writeSync(this.fd, compressed, 0, compressed.length, this.currentOffset);
    this.currentOffset += compressed.length;
  }

  addEventIndex(timestamp, chunkOffset) {
    this.events.push({ timestamp, chunkOffset });
  }

  setRoster(rosterMap) {
    this.roster = rosterMap;
  }

  finalize(totalFrames, durationMs) {
    if (!this.fd) return;
    
    // ヘッダーを最終値で更新 (DURATION_MS / FRAME_COUNT / SAMPLE_RATE は連続した 9 バイト)
    // ヘッダー(64バイト)を越えて最初のチャンクを壊さないよう、書く長さは必ず 9 バイトにする
    const headerBuffer = Buffer.alloc(9);
    headerBuffer.writeUInt32LE(durationMs, 0);  // DURATION_MS
    headerBuffer.writeUInt32LE(totalFrames, 4); // FRAME_COUNT
    headerBuffer.writeUInt8(50, 8);             // SAMPLE_RATE
    fs.writeSync(this.fd, headerBuffer, 0, 9, HeaderOffsets.DURATION_MS);

    // イベントインデックスとCRC32書き出しなどは簡易実装
    // ここで最後に、プレイヤー名簿(Roster)をJSONとして追記する
    const rosterJson = JSON.stringify(this.roster);
    const rosterBuffer = Buffer.from(rosterJson, 'utf8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(rosterBuffer.length, 0);
    
    // 末尾レイアウト: [RosterJSON][Roster長 uint32][MAGIC "ROST"]
    // ビューアは末尾の "ROST" から逆向きに長さ→JSONの順で読む
    fs.writeSync(this.fd, rosterBuffer, 0, rosterBuffer.length, this.currentOffset);
    this.currentOffset += rosterBuffer.length;
    fs.writeSync(this.fd, lengthBuffer, 0, 4, this.currentOffset);
    this.currentOffset += 4;
    fs.writeSync(this.fd, Buffer.from('ROST', 'utf8'), 0, 4, this.currentOffset);

    fs.closeSync(this.fd);
    this.fd = null;
  }

  _serializeFrames(frames) {
    // Parser expects (little endian):
    // timestamp(4) + pCount(1) + pCount * PLAYER_BYTES
    // player: id(1) px(4) py(4) pz(4) ry(2) rx(2) hp(1) ammo(1) flags(1) eventType(1) eventVictim(1)
    // 座標は int32 (1/100単位)。Krunkerのマップは int16 (±327) に収まらないため。
    const PLAYER_BYTES = FRAME_PLAYER_SIZE;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const toFixed = (v, scale, lo, hi) => clamp(Math.round((Number(v) || 0) * scale), lo, hi);
    const toAngle = (rad) => {
      let a = Number(rad) || 0;
      a = Math.atan2(Math.sin(a), Math.cos(a)); // [-π, π] に正規化 (×1000 が int16 に収まる)
      return Math.round(a * 1000);
    };

    let totalSize = 0;
    for (const frame of frames) {
      totalSize += 5 + (frame.players.length * PLAYER_BYTES);
    }

    const buffer = Buffer.alloc(totalSize);
    let offset = 0;

    for (const frame of frames) {
      const players = frame.players.slice(0, 255);
      buffer.writeUInt32LE(frame.timestamp || 0, offset);
      buffer.writeUInt8(players.length, offset + 4);
      offset += 5;

      for (const p of players) {
        buffer.writeUInt8(clamp(p.playerId || 0, 0, 255), offset);
        buffer.writeInt32LE(toFixed(p.pos[0], 100, -2147483648, 2147483647), offset + 1);
        buffer.writeInt32LE(toFixed(p.pos[1], 100, -2147483648, 2147483647), offset + 5);
        buffer.writeInt32LE(toFixed(p.pos[2], 100, -2147483648, 2147483647), offset + 9);
        buffer.writeInt16LE(toAngle(p.rot[0]), offset + 13);
        buffer.writeInt16LE(toAngle(p.rot[1]), offset + 15);
        buffer.writeUInt8(clamp(Math.round(p.health || 0), 0, 255), offset + 17);
        buffer.writeUInt8(clamp(Math.round(p.ammo || 0), 0, 255), offset + 18);

        let flags = 0;
        if (p.shooting) flags |= 1;
        if (p.scoping) flags |= 2;
        flags |= ((p.team || 0) & 0xF) << 4;

        buffer.writeUInt8(flags, offset + 19);
        buffer.writeUInt8(p.eventType || 0, offset + 20);
        buffer.writeUInt8(p.eventVictim || 0, offset + 21);
        offset += PLAYER_BYTES;
      }
    }
    return buffer;
  }
}

module.exports = KreWriter;

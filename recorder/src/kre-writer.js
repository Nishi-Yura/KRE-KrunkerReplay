const fs = require('fs');
const zlib = require('zlib');
const { MAGIC_BYTES, VERSION, HEADER_SIZE, HeaderOffsets } = require('@krunker-replay/shared/src/kre-format');

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
    
    // ヘッダーを最終値で更新
    const headerBuffer = Buffer.alloc(14); // DURATION_MS, FRAME_COUNT, SAMPLE_RATE, RESERVED(一部)
    headerBuffer.writeUInt32LE(durationMs, 0); // DURATION_MS (offset 54 -> wait, we shifted offsets! It's now offset 54 in HeaderOffsets, so in headerBuffer... wait.
    // Wait! HeaderOffsets.DURATION_MS is now 54. 
    // Wait, earlier the code was writing to file at offset HeaderOffsets.DURATION_MS using fs.writeSync.
    headerBuffer.writeUInt32LE(durationMs, 0); // DURATION_MS (relative offset 0)
    headerBuffer.writeUInt32LE(totalFrames, 4); // FRAME_COUNT (relative offset 4)
    headerBuffer.writeUInt8(50, 8); // SAMPLE_RATE (relative offset 8)
    
    fs.writeSync(this.fd, headerBuffer, 0, 14, HeaderOffsets.DURATION_MS);

    // イベントインデックスとCRC32書き出しなどは簡易実装
    // ここで最後に、プレイヤー名簿(Roster)をJSONとして追記する
    const rosterJson = JSON.stringify(this.roster);
    const rosterBuffer = Buffer.from(rosterJson, 'utf8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(rosterBuffer.length, 0);
    
    // Roster長(4バイト) + RosterJSON をファイル末尾に書き込む
    fs.writeSync(this.fd, lengthBuffer, 0, 4, this.currentOffset);
    this.currentOffset += 4;
    fs.writeSync(this.fd, rosterBuffer, 0, rosterBuffer.length, this.currentOffset);
    this.currentOffset += rosterBuffer.length;
    
    // [MAGIC: "ROST"] マーカーを最後に書き込み、パース時に末尾から読めるようにする
    const markerBuffer = Buffer.from("ROST", 'utf8');
    fs.writeSync(this.fd, markerBuffer, 0, 4, this.currentOffset);

    fs.closeSync(this.fd);
    this.fd = null;
  }

  _serializeFrames(frames) {
    // Parser expects:
    // timestamp(4) + pCount(1) + (pCount * 17)
    // Here, frames is an array of frame objects: { timestamp, players: [...] }
    
    // Calculate total buffer size
    let totalSize = 0;
    for (const frame of frames) {
      totalSize += 5 + (frame.players.length * 17);
    }
    
    const buffer = Buffer.alloc(totalSize);
    let offset = 0;
    
    for (const frame of frames) {
      buffer.writeUInt32LE(frame.timestamp || 0, offset); // timestamp (4)
      buffer.writeUInt8(frame.players.length, offset + 4); // pCount (1)
      offset += 5;
      
      for (const p of frame.players) {
        buffer.writeUInt8(p.playerId || 0, offset); // id (1)
        buffer.writeInt16LE(Math.floor((p.pos[0] || 0) * 100), offset + 1); // px (2)
        buffer.writeInt16LE(Math.floor((p.pos[1] || 0) * 100), offset + 3); // py (2)
        buffer.writeInt16LE(Math.floor((p.pos[2] || 0) * 100), offset + 5); // pz (2)
        buffer.writeInt16LE(Math.floor((p.rot[0] || 0) * 1000), offset + 7); // ry (2)
        buffer.writeInt16LE(Math.floor((p.rot[1] || 0) * 1000), offset + 9); // rx (2)
        buffer.writeUInt8(p.health || 0, offset + 11); // hp (1)
        buffer.writeUInt8(p.ammo || 0, offset + 12); // ammo (1)
        
        let flags = 0;
        if (p.shooting) flags |= 1;
        if (p.scoping) flags |= 2;
        flags |= (p.team & 0xF) << 4;
        
        buffer.writeUInt8(flags, offset + 13); // flags (1)
        buffer.writeUInt8(p.eventType || 0, offset + 14); // eventType (1)
        buffer.writeUInt8(p.eventVictim || 0, offset + 15); // eventVictim (1)
        buffer.writeUInt8(0, offset + 16); // padding (1 byte to make it 17)
        offset += 17;
      }
    }
    return buffer;
  }
}

module.exports = KreWriter;

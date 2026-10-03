import { State, Shared } from './State.js';
import { showToast } from './UI.js';
import { setupRealPlayers } from './Renderer_Players.js';

async function inflate(compressed) {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
}

export async function parseKRE(arrayBuffer) {
  if (arrayBuffer.byteLength < 64) return false;
  
  let endOffset = arrayBuffer.byteLength;
  let rosterMap = null;
  const view = new DataView(arrayBuffer);
  
  if (endOffset > 8) {
      const magicStr = new TextDecoder().decode(new Uint8Array(arrayBuffer, endOffset - 4, 4));
      if (magicStr === "ROST") {
          const l = view.getUint32(endOffset - 8, true);
          if (endOffset - 8 - l >= 0) {
              try {
                  const jsonStr = new TextDecoder().decode(new Uint8Array(arrayBuffer, endOffset - 8 - l, l));
                  rosterMap = JSON.parse(jsonStr);
                  endOffset = endOffset - 8 - l;
              } catch (err) {}
          }
      }
  }

  const magic = [view.getUint8(0), view.getUint8(1), view.getUint8(2)];
  if (magic[0] !== 0x4B || magic[1] !== 0x52 || magic[2] !== 0x45) return false;

  const version = view.getUint8(4);
  Shared.replayHeader.frameCount = view.getUint32(58, true); // FRAME_COUNT (offset 58)
  Shared.replayHeader.sampleRate = view.getUint8(62);        // SAMPLE_RATE (offset 62)
  Shared.replayHeader.durationMs = view.getUint32(54, true); // DURATION_MS (offset 54)
  
  const mapNameBytes = new Uint8Array(arrayBuffer, 20, 32);  // MAP_NAME (offset 20)
  Shared.currentMapName = new TextDecoder().decode(mapNameBytes).replace(/\u0000/g, '');
  
  // ヘッダー(64バイト)の後ろに [長さ uint32][zlib圧縮データ] のチャンクが連続する
  const HEADER_SIZE = 64;
  const parts = [];
  let pos = HEADER_SIZE;
  try {
      while (pos + 4 <= endOffset) {
          const len = view.getUint32(pos, true); pos += 4;
          if (len === 0 || pos + len > endOffset) break;
          parts.push(await inflate(new Uint8Array(arrayBuffer, pos, len)));
          pos += len;
      }
  } catch (e) {
      console.warn('Decompression failed', e);
  }
  const totalLength = parts.reduce((acc, c) => acc + c.length, 0);
  const decompressed = new Uint8Array(totalLength);
  let partOffset = 0;
  for (const c of parts) { decompressed.set(c, partOffset); partOffset += c.length; }

  Shared.realFrames = [];
  Shared.events = [];
  Shared.playerInfo = null;
  const dView = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
  let off = 0;
  
  try {
    while (off < decompressed.length) {
        const timestamp = dView.getUint32(off, true); off += 4;
        const pCount = dView.getUint8(off); off += 1;
        const players = [];
        for (let i = 0; i < pCount; i++) {
            const id = dView.getUint8(off); off += 1;
            const px = dView.getInt32(off, true) / 100; off += 4;
            const py = dView.getInt32(off, true) / 100; off += 4;
            const pz = dView.getInt32(off, true) / 100; off += 4;
            const ry = dView.getInt16(off, true) / 1000; off += 2;
            const rx = dView.getInt16(off, true) / 1000; off += 2;
            const hp = dView.getUint8(off); off += 1;
            const ammo = dView.getUint8(off); off += 1;
            const flags = dView.getUint8(off); off += 1;
            const eventType = dView.getUint8(off); off += 1;
            const eventVictim = dView.getUint8(off); off += 1;
            
            let pName = `Player ${id}`;
            if (rosterMap && rosterMap[id]) {
                pName = rosterMap[id];
            }
            
            players.push({
                id, name: pName, pos: [px, py, pz], rot: [ry, rx], health: hp, ammo,
                shoot: !!(flags & 1), scope: !!(flags & 2), team: (flags >> 4) & 0xF,
                eventType, eventVictim
            });
        }
        Shared.realFrames.push({ timestamp, players });
    }
  } catch (e) {
      console.warn('Frame parsing ended early:', e);
  }

  if (Shared.realFrames.length > 0) {
      const hasPlayers = Shared.realFrames.some(f => f.players.length > 0);
      if (!hasPlayers) {
          showToast('警告: KREファイルにプレイヤーが1人も存在しません', 'warning');
      } else {
          showToast('KREファイルを正常にロードしました', 'success');
      }

      State.duration = (Shared.realFrames[Shared.realFrames.length - 1].timestamp) / 1000;
      State.time = 0;
      State.mode = 'real';
      Shared.seenProjectileIds = new Set();
      setupRealPlayers();
      
      const landingModal = document.getElementById('landing-modal');
      if (landingModal) landingModal.classList.remove('active');
      return true;
  }
  showToast('エラー: 有効なフレームデータが見つかりません');
  return false;
}

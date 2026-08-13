import { State, Shared } from './State.js';
import { showToast } from './UI.js';
import { setupRealPlayers } from './Renderer_Players.js';

export async function parseKRE(arrayBuffer) {
  if (arrayBuffer.byteLength < 69) return false;
  
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
  
  const compressedLen = endOffset - 73;
  const compressed = new Uint8Array(arrayBuffer, 69, compressedLen);
  let decompressed;
  
  try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      decompressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of chunks) { decompressed.set(c, offset); offset += c.length; }
  } catch (e) {
      console.warn('Decompression failed', e);
      decompressed = compressed;
  }

  Shared.realFrames = [];
  const dView = new DataView(decompressed.buffer);
  let off = 0;
  
  try {
    while (off < decompressed.length) {
        const timestamp = dView.getUint32(off, true); off += 4;
        const pCount = dView.getUint8(off); off += 1;
        const players = [];
        for (let i = 0; i < pCount; i++) {
            const id = dView.getUint8(off); off += 1;
            const px = dView.getInt16(off, true) / 100; off += 2;
            const py = dView.getInt16(off, true) / 100; off += 2;
            const pz = dView.getInt16(off, true) / 100; off += 2;
            const ry = dView.getInt16(off, true) / 1000; off += 2;
            const rx = dView.getInt16(off, true) / 1000; off += 2;
            const hp = dView.getUint8(off); off += 1;
            const ammo = dView.getUint8(off); off += 1;
            const flags = dView.getUint8(off); off += 1;
            const eventType = dView.getUint8(off); off += 1;
            const eventVictim = dView.getUint8(off); off += 1;
            off += 1; // padding
            
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
      setupRealPlayers();
      
      const landingModal = document.getElementById('landing-modal');
      if (landingModal) landingModal.classList.remove('active');
      return true;
  }
  showToast('エラー: 有効なフレームデータが見つかりません');
  return false;
}

const fs = require('fs');
let Parser = fs.readFileSync('viewer/js/Parser.js', 'utf8');
Parser = Parser.replace(/import {.*} from '.*';/g, '');
Parser = Parser.replace(/export function/g, 'function');
Parser = Parser.replace(/export async function/g, 'async function');
Parser = Parser.replace(/if \(!data \|\| !data.length\) return false;/g, '');

let sandbox = {
  Shared: { realFrames: [], currentMapName: '', replayHeader: {} },
  State: {},
  console: console,
  showToast: () => {},
  setupRealPlayers: () => {},
  document: { getElementById: () => ({ classList: { remove: ()=>{} } }) },
  base64ToUint8Array: (base64) => {
      const b = Buffer.from(base64, 'base64');
      return new Uint8Array(b.buffer, b.byteOffset, b.length);
  },
  MessagePack: require('@msgpack/msgpack')
};

const script = 'const Shared = this.Shared; const State = this.State; const showToast = this.showToast; const setupRealPlayers = this.setupRealPlayers; const document = this.document; const base64ToUint8Array = this.base64ToUint8Array; const MessagePack = this.MessagePack; const console = this.console; ' + Parser + ';\n this.parseJSONLog = parseJSONLog;';
const vm = require('vm');
vm.runInNewContext(script, sandbox);

const data = fs.readFileSync('C:/Users/nisimoto/.gemini/antigravity/brain/aa687a0d-5589-4e74-bbd9-70ccf3990414/.user_uploaded/media_1786469581076.json', 'utf8');
const parsedData = JSON.parse(data);
console.log("Input data length:", parsedData.length);
sandbox.parseJSONLog(parsedData);
console.log('Frames:', sandbox.Shared.realFrames.length);
if (sandbox.Shared.realFrames.length > 0) {
    console.log('Frame 0 players:', sandbox.Shared.realFrames[0].players.length);
    console.log('Last frame players:', sandbox.Shared.realFrames[sandbox.Shared.realFrames.length - 1].players.length);
}

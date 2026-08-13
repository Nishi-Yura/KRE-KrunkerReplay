export const State = {
  isPlaying: true,
  speed: 1.0,
  time: 0,
  duration: 300, 
  mode: 'idle',
  cameraMode: 'free',
  targetPlayerId: 0,
  isSeeking: false,
  showScoreboard: false
};

export const keys = { w: false, a: false, s: false, d: false, e: false, q: false };

export const Shared = {
  realFrames: [],
  replayHeader: {},
  currentMapName: "Unknown",
  mapGroup: null,
  scene: null,
  camera: null,
  realMeshes: {}
};

export function hexToNum(hex) {
  if(hex.startsWith('#')) hex = hex.slice(1);
  return parseInt(hex, 16);
}

export function base64ToUint8Array(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

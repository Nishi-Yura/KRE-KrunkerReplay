import { State, keys, Shared } from './State.js';

export function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  if (type === 'success') toast.style.background = 'rgba(0, 212, 255, 0.8)';
  if (type === 'warning') toast.style.background = 'rgba(255, 153, 0, 0.8)';
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 4000);
}

// 自由視点のドラッグ回転で使う角度。カメラモード切替時に現在の向きへ同期する
let camYaw = 0;
let camPitch = 0;

function updateCamBtns() {
  const map = { free: 'cam-free', '1st': 'cam-1st', '3rd': 'cam-3rd' };
  Object.entries(map).forEach(([mode, id]) => {
    const b = document.getElementById(id);
    if (b) b.style.background = State.cameraMode === mode ? 'rgba(0, 212, 255, 0.5)' : 'rgba(0,0,0,0.5)';
  });
}

// ボタン・キー・プレイヤーカードのどこから切り替えても同じ処理を通す
export function setCameraMode(mode) {
  State.cameraMode = mode;
  if (mode === 'free' && Shared.camera) {
    Shared.camera.rotation.order = 'YXZ';
    camYaw = Shared.camera.rotation.y;
    camPitch = Shared.camera.rotation.x;
  }
  updateCamBtns();
}

function setPlaying(playing) {
  State.isPlaying = playing;
  const btn = document.getElementById('btn-play-pause');
  if (btn) btn.innerText = playing ? 'Pause' : 'Play';
}

function togglePlay() {
  setPlaying(!State.isPlaying);
  const ind = document.getElementById('play-pause-indicator');
  if (ind) {
    ind.innerText = State.isPlaying ? '▶' : '⏸';
    ind.style.animation = 'none';
    ind.offsetHeight; // reflow でアニメーションを再始動
    ind.style.animation = 'popOut 0.5s ease-out forwards';
  }
}

export function setupUI() {
  window.addEventListener('error', (e) => showToast('Error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => showToast('Error: ' + (e.reason && e.reason.message || e.reason)));

  let isDragging = false;

  document.addEventListener('mousedown', e => {
    if (e.target.tagName !== 'CANVAS') return;
    isDragging = true;
  });
  document.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('blur', () => { isDragging = false; keys.w = keys.a = keys.s = keys.d = keys.e = keys.q = keys.shift = false; });

  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('cam-free', () => setCameraMode('free'));
  bind('cam-1st', () => setCameraMode('1st'));
  bind('cam-3rd', () => setCameraMode('3rd'));
  updateCamBtns();

  // ボタンにフォーカスが残るとSpaceキーで二重に反応するため、クリック後に外す
  document.addEventListener('click', e => {
    const t = e.target;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'SELECT')) t.blur();
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging || State.cameraMode !== 'free' || !Shared.camera) return;
    camYaw -= e.movementX * 0.005;
    camPitch -= e.movementY * 0.005;
    camPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, camPitch));
    Shared.camera.rotation.set(camPitch, camYaw, 0);
  });

  const _wheelDir = new THREE.Vector3();
  document.addEventListener('wheel', e => {
    if (e.target.tagName !== 'CANVAS' || !Shared.camera) return;
    if (State.cameraMode === 'free') {
      Shared.camera.getWorldDirection(_wheelDir);
      Shared.camera.position.addScaledVector(_wheelDir, e.deltaY * -0.1);
    } else if (State.cameraMode === '3rd') {
      State.camDistance = Math.max(8, Math.min(150, State.camDistance + e.deltaY * 0.05));
    }
  }, { passive: true });

  document.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (e.code) {
      case 'Space': togglePlay(); e.preventDefault(); break;
      case 'KeyW': keys.w = true; break;
      case 'KeyA': keys.a = true; break;
      case 'KeyS': keys.s = true; break;
      case 'KeyD': keys.d = true; break;
      case 'KeyE': keys.e = true; break;
      case 'KeyQ': keys.q = true; break;
      case 'ShiftLeft': case 'ShiftRight': keys.shift = true; break;
      case 'KeyF': setCameraMode('free'); break;
      case 'Digit1': setCameraMode('1st'); break;
      case 'Digit3': setCameraMode('3rd'); break;
      case 'ArrowRight': State.time = Math.min(State.duration, State.time + 5); break;
      case 'ArrowLeft': State.time = Math.max(0, State.time - 5); break;
      case 'Tab':
        e.preventDefault();
        State.showScoreboard = true;
        break;
    }
  });

  document.addEventListener('keyup', e => {
    switch (e.code) {
      case 'KeyW': keys.w = false; break;
      case 'KeyA': keys.a = false; break;
      case 'KeyS': keys.s = false; break;
      case 'KeyD': keys.d = false; break;
      case 'KeyE': keys.e = false; break;
      case 'KeyQ': keys.q = false; break;
      case 'ShiftLeft': case 'ShiftRight': keys.shift = false; break;
      case 'Tab': e.preventDefault(); State.showScoreboard = false; break;
    }
  });

  document.getElementById('btn-help').onclick = () => document.getElementById('help-modal').classList.add('active');
  document.getElementById('close-help').onclick = () => document.getElementById('help-modal').classList.remove('active');

  const timelineBar = document.getElementById('timeline-bar');
  if (timelineBar) {
    timelineBar.addEventListener('mousedown', e => {
      State.isSeeking = true;
      updateTimelineDrag(e, timelineBar);
    });
    document.addEventListener('mousemove', e => {
      if (State.isSeeking) updateTimelineDrag(e, timelineBar);
    });
    document.addEventListener('mouseup', () => { State.isSeeking = false; });
  }

  const speedSelect = document.getElementById('speed-select');
  if (speedSelect) {
    speedSelect.addEventListener('change', e => { State.speed = parseFloat(e.target.value); });
  }
  bind('btn-play-pause', () => setPlaying(!State.isPlaying));
}

function updateTimelineDrag(e, timelineBar) {
  const rect = timelineBar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  State.time = pct * State.duration;
}

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

export function setupUI() {
  window.addEventListener('error', (e) => showToast('Error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => showToast('Error: ' + e.reason));

  let isDragging = false;
  let camYaw = 0;
  let camPitch = 0;
  
  document.addEventListener('mousedown', e => {
    if(e.target.tagName !== 'CANVAS') return;
    isDragging = true;
  });
  document.addEventListener('mouseup', () => isDragging = false);
  
  const btnFree = document.getElementById('cam-free');
  const btn1st = document.getElementById('cam-1st');
  const btn3rd = document.getElementById('cam-3rd');
  
  function updateCamBtns() {
      [btnFree, btn1st, btn3rd].forEach(b => { if(b) b.style.background = 'rgba(0,0,0,0.5)'; });
      if (State.cameraMode === 'free' && btnFree) btnFree.style.background = 'rgba(0, 212, 255, 0.5)';
      if (State.cameraMode === '1st' && btn1st) btn1st.style.background = 'rgba(0, 212, 255, 0.5)';
      if (State.cameraMode === '3rd' && btn3rd) btn3rd.style.background = 'rgba(0, 212, 255, 0.5)';
  }
  
  if (btnFree) btnFree.addEventListener('click', () => { 
      State.cameraMode = 'free'; 
      if (Shared.camera) {
          camYaw = Shared.camera.rotation.y;
          camPitch = Shared.camera.rotation.x;
      }
      updateCamBtns(); 
  });
  if (btn1st) btn1st.addEventListener('click', () => { State.cameraMode = '1st'; updateCamBtns(); });
  if (btn3rd) btn3rd.addEventListener('click', () => { State.cameraMode = '3rd'; updateCamBtns(); });
  updateCamBtns();
  
  document.addEventListener('mousemove', e => {
    if(!isDragging || State.cameraMode !== 'free') return;
    camYaw -= e.movementX * 0.005;
    camPitch -= e.movementY * 0.005;
    camPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, camPitch));
    if (Shared.camera) Shared.camera.rotation.set(camPitch, camYaw, 0);
  });
  
  document.addEventListener('wheel', e => {
    if(State.cameraMode === 'free' && Shared.camera) {
      const dir = new THREE.Vector3();
      Shared.camera.getWorldDirection(dir);
      Shared.camera.position.addScaledVector(dir, e.deltaY * -0.1);
    }
  });

  document.addEventListener('keydown', e => {
    if(document.activeElement.tagName === 'INPUT') return;
    
    if(e.code === 'Space') {
      State.isPlaying = !State.isPlaying;
      document.getElementById('btn-play-pause').innerText = State.isPlaying ? 'Pause' : 'Play';
      const ind = document.getElementById('play-pause-indicator');
      ind.innerText = State.isPlaying ? '▶' : '⏸';
      ind.style.animation = 'none';
      ind.offsetHeight; 
      ind.style.animation = 'popOut 0.5s ease-out forwards';
      e.preventDefault();
    }
    if(e.code === 'KeyW') keys.w = true;
    if(e.code === 'KeyA') keys.a = true;
    if(e.code === 'KeyS') keys.s = true;
    if(e.code === 'KeyD') keys.d = true;
    if(e.code === 'KeyE') keys.e = true;
    if(e.code === 'KeyQ') keys.q = true;
    
    if(e.code === 'ArrowRight') { State.time = Math.min(State.duration, State.time + 5); }
    if(e.code === 'ArrowLeft') { State.time = Math.max(0, State.time - 5); }
    if(e.code === 'Tab') {
      e.preventDefault();
      document.getElementById('scoreboard').classList.add('show');
    }
  });
  
  document.addEventListener('keyup', e => {
    if(e.code === 'KeyW') keys.w = false;
    if(e.code === 'KeyA') keys.a = false;
    if(e.code === 'KeyS') keys.s = false;
    if(e.code === 'KeyD') keys.d = false;
    if(e.code === 'KeyE') keys.e = false;
    if(e.code === 'KeyQ') keys.q = false;
    if(e.code === 'Tab') document.getElementById('scoreboard').classList.remove('show');
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
      if(State.isSeeking) updateTimelineDrag(e, timelineBar);
    });
    document.addEventListener('mouseup', () => {
      State.isSeeking = false;
    });
  }

  const speedSelect = document.getElementById('speed-select');
  if(speedSelect) {
      speedSelect.addEventListener('change', e => {
          State.speed = parseFloat(e.target.value);
      });
  }
  const btnPlayPause = document.getElementById('btn-play-pause');
  if(btnPlayPause) {
      btnPlayPause.addEventListener('click', () => {
          State.isPlaying = !State.isPlaying;
          btnPlayPause.innerText = State.isPlaying ? 'Pause' : 'Play';
      });
  }
  
  document.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
          e.preventDefault();
          State.showScoreboard = true;
      }
  });
  
  document.addEventListener('keyup', e => {
      if (e.key === 'Tab') {
          e.preventDefault();
          State.showScoreboard = false;
      }
  });
}

function updateTimelineDrag(e, timelineBar) {
  const rect = timelineBar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  State.time = pct * State.duration;
}



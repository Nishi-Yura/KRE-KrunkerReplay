import { State, Shared, keys } from './State.js';
import { renderer, clock } from './Renderer_Scene.js';
import { drawMinimap, updateNametags, updateKillLog, updateScoreboard, drawHitmarkers, updateDynamicHUD } from './Renderer_UI.js';
import { updateCamera } from './Renderer_Camera.js';
import { spawnTracer, spawnProjectile, updateTracers } from './Renderer_Tracers.js';

// Reusable THREE objects to avoid GC pressure in the render loop
const _targetPos = new THREE.Vector3();
const _nextPos = new THREE.Vector3();
const _qTarget = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

export function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  
  if (State.isPlaying && !State.isSeeking) {
      State.time += delta * State.speed;
      if (State.time > State.duration) State.time = 0;
  }

  const percent = (State.time / State.duration) * 100;
  const playhead = document.getElementById('playhead');
  if(playhead) playhead.style.left = (percent || 0) + '%';
  
  const m = Math.floor(State.time / 60) || 0;
  const s = Math.floor(State.time % 60 || 0).toString().padStart(2, '0');
  
  let durM = Math.floor(State.duration / 60) || 0;
  let durS = Math.floor(State.duration % 60 || 0).toString().padStart(2, '0');
  const timeDisp = document.getElementById('time-display');
  if(timeDisp) timeDisp.innerText = `${m}:${s} / ${durM}:${durS}`;

  // Find the right frame for the current time
  let currentFrame = null;
  let nextFrame = null;
  
  if (State.mode === 'real' && Shared.realFrames.length > 0) {
      const timeMs = State.time * 1000;
      let frameIdx = 0;
      for (let i = 0; i < Shared.realFrames.length; i++) {
          if (Shared.realFrames[i].timestamp > timeMs) {
              frameIdx = Math.max(0, i - 1);
              break;
          }
          frameIdx = i;
      }
      
      currentFrame = Shared.realFrames[frameIdx];
      nextFrame = frameIdx < Shared.realFrames.length - 1 ? Shared.realFrames[frameIdx + 1] : currentFrame;
  }

  if (State.mode === 'real' && currentFrame) {
      const timeMs = State.time * 1000;
      const dt = nextFrame ? (nextFrame.timestamp - currentFrame.timestamp) : 1;
      const lerpFactor = nextFrame ? Math.min(1, Math.max(0, (timeMs - currentFrame.timestamp) / dt)) : 0;
      
      Object.values(Shared.realMeshes).forEach(m => m.visible = false);
      
      currentFrame.players.forEach(p => {
          let mesh = Shared.realMeshes[p.id];
          if (!mesh) {
              const group = new THREE.Group();
              const bodyGeo = new THREE.BoxGeometry(4, 10, 4);
              let bodyColor = 0x0000ff;
              if (p.team === 1) bodyColor = 0xff8800;
              else if (p.team === 2) bodyColor = 0x00ccff;
              const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
              const body = new THREE.Mesh(bodyGeo, bodyMat);
              body.position.y = 5;
              group.add(body);
              
              const headGeo = new THREE.BoxGeometry(3, 3, 3);
              const headMat = new THREE.MeshLambertMaterial({ color: 0xffccaa });
              const head = new THREE.Mesh(headGeo, headMat);
              head.position.y = 11.5;
              group.add(head);

              group.position.set(p.pos[0], p.pos[1], p.pos[2]);
              Shared.realMeshes[p.id] = group;
              Shared.scene.add(group);
              mesh = group;
          }
          
          if (mesh) {
              if (mesh.children[0] && mesh.children[0].material) {
                  let bodyColor = 0x0000ff;
                  if (p.team === 1) bodyColor = 0xff8800;
                  else if (p.team === 2) bodyColor = 0x00ccff;
                  mesh.children[0].material.color.setHex(bodyColor);
              }

              mesh.visible = (p.health !== 0);
              if (!mesh.visible) return;
              
              _targetPos.set(p.pos[0], p.pos[1], p.pos[2]);
              let targetYaw = p.rot[0] || 0;
              
              if (nextFrame) {
                  const nextP = nextFrame.players.find(x => x.id === p.id);
                  if (nextP && nextP.health > 0) {
                      _nextPos.set(nextP.pos[0], nextP.pos[1], nextP.pos[2]);
                      if (_targetPos.distanceTo(_nextPos) < 100) { 
                          _targetPos.lerp(_nextPos, lerpFactor);
                          
                          const nextYaw = nextP.rot[0] || 0;
                          let diff = nextYaw - targetYaw;
                          while (diff < -Math.PI) diff += Math.PI * 2;
                          while (diff > Math.PI) diff -= Math.PI * 2;
                          targetYaw += diff * lerpFactor;
                      }
                  }
              }
              
              mesh.position.lerp(_targetPos, 0.5);
              
              _qTarget.setFromAxisAngle(_yAxis, targetYaw);
              mesh.quaternion.slerp(_qTarget, 0.5);
              
              if (mesh.position.distanceTo(_targetPos) > 0.1) {
                  mesh.userData.walkCycle = (mesh.userData.walkCycle || 0) + delta * 15;
              }
              
              // Spawn tracers based on shoot flag from k-packet
              if (State.isPlaying && p.shoot && !mesh.userData.lastShoot) {
                  spawnTracer(mesh, p);
              }
              mesh.userData.lastShoot = p.shoot;
          }
      });
      
      // Also spawn tracers from l-packet projectiles
      if (State.isPlaying && currentFrame.projectiles && !currentFrame._tracersSpawned) {
          currentFrame._tracersSpawned = true;
          currentFrame.projectiles.forEach(proj => {
              spawnProjectile(proj);
          });
      }
      
      updateTracers();
  }

  // Camera update AFTER player positions are set (fixes 1-frame lag jitter)
  updateCamera(delta, currentFrame);

  updateNametags(currentFrame);
  updateKillLog(currentFrame);
  updateScoreboard();
  drawHitmarkers();
  updateDynamicHUD(currentFrame);

  drawMinimap();
  renderer.render(Shared.scene, Shared.camera);
}

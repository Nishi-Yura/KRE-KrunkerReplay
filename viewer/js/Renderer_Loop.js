import { State, Shared, keys } from './State.js';
import { renderer, clock } from './Renderer_Scene.js';
import { drawMinimap, updateNametags, updateKillLog, updateScoreboard, drawHitmarkers, updateDynamicHUD } from './Renderer_UI.js';
import { updateCamera } from './Renderer_Camera.js';
import { spawnProjectile, updateTracers } from './Renderer_Tracers.js';

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
  
  updateCamera(delta, currentFrame);

  if (State.mode === 'real' && currentFrame) {
      const timeMs = State.time * 1000;
      const lerpFactor = nextFrame ? (timeMs - currentFrame.timestamp) / (nextFrame.timestamp - currentFrame.timestamp) : 0;
      
      Object.values(Shared.realMeshes).forEach(m => m.visible = false);
      
      currentFrame.players.forEach(p => {
          let mesh = Shared.realMeshes[p.id];
          if (!mesh) {
              // Create missing player mesh dynamically
              const group = new THREE.Group();
              const bodyGeo = new THREE.BoxGeometry(4, 10, 4);
              let bodyColor = 0x0000ff; // Default blue
              if (p.team === 1) bodyColor = 0xff8800; // Orange
              else if (p.team === 2) bodyColor = 0x00ccff; // Light Blue
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
              
              let targetPos = new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]);
              let targetYaw = p.rot[1] || 0;
              
              if (nextFrame) {
                  const nextP = nextFrame.players.find(x => x.id === p.id);
                  if (nextP && nextP.health > 0) {
                      const nextPos = new THREE.Vector3(nextP.pos[0], nextP.pos[1], nextP.pos[2]);
                      if (targetPos.distanceTo(nextPos) < 100) { 
                          targetPos.lerp(nextPos, lerpFactor);
                          
                          const nextYaw = nextP.rot[1] || 0;
                          let diff = nextYaw - targetYaw;
                          while (diff < -Math.PI) diff += Math.PI * 2;
                          while (diff > Math.PI) diff -= Math.PI * 2;
                          targetYaw += diff * lerpFactor;
                      }
                  }
              }
              
              mesh.position.lerp(targetPos, 0.5);
              
              const qTarget = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
              mesh.quaternion.slerp(qTarget, 0.5);
              
              if (mesh.position.distanceTo(targetPos) > 0.1) {
                  mesh.userData.walkCycle = (mesh.userData.walkCycle || 0) + delta * 15;
              }
              
          }
      });
      
      if (State.isPlaying && currentFrame.projectiles && !currentFrame._tracersSpawned) {
          currentFrame._tracersSpawned = true;
          currentFrame.projectiles.forEach(proj => {
              spawnProjectile(proj);
          });
      }
      
      updateTracers();
  }

  updateNametags(currentFrame);
  updateKillLog(currentFrame);
  updateScoreboard();
  drawHitmarkers();
  updateDynamicHUD(currentFrame);

  drawMinimap();
  renderer.render(Shared.scene, Shared.camera);
}

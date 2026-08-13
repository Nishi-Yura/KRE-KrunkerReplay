import { State, Shared, keys } from './State.js';
import { KRUNKER_CLASSES } from './Constants.js';

export function updateCamera(delta, currentFrame) {
    if (State.cameraMode === 'free') {
        const moveSpeed = 100 * delta; 
        const dir = new THREE.Vector3();
        Shared.camera.getWorldDirection(dir);
        dir.y = 0; 
        dir.normalize();
        
        const right = new THREE.Vector3().crossVectors(dir, Shared.camera.up).normalize();
        
        if (keys.w) Shared.camera.position.addScaledVector(dir, moveSpeed);
        if (keys.s) Shared.camera.position.addScaledVector(dir, -moveSpeed);
        if (keys.a) Shared.camera.position.addScaledVector(right, -moveSpeed);
        if (keys.d) Shared.camera.position.addScaledVector(right, moveSpeed);
        if (keys.e) Shared.camera.position.y += moveSpeed;
        if (keys.q) Shared.camera.position.y -= moveSpeed;
    }
    
    let classHud = document.getElementById('class-hud');

    if((State.cameraMode === '1st' || State.cameraMode === '3rd') && State.mode === 'real') {
        const target = Shared.realMeshes[State.targetPlayerId];
        if(target && target.visible !== false) {
            if(State.cameraMode === '1st') {
                Shared.camera.position.copy(target.position);
                Shared.camera.position.y += 6; 
                Shared.camera.rotation.copy(target.rotation);
            } else {
                // Position camera BEHIND the player
                Shared.camera.position.x = target.position.x + Math.sin(target.rotation.y) * 30;
                Shared.camera.position.z = target.position.z + Math.cos(target.rotation.y) * 30;
                Shared.camera.position.y = target.position.y + 15;
                Shared.camera.lookAt(target.position);
            }
            
            // Update HUD
            if (classHud && currentFrame) {
                const pData = currentFrame.players.find(p => p.id === State.targetPlayerId);
                if (pData) {
                    const className = KRUNKER_CLASSES[pData.classId] || `Class ${pData.classId}`;
                    classHud.style.display = 'block';
                    classHud.innerHTML = `Spectating: <span style="color:#00ff88">${pData.name || `Player ${pData.id}`}</span><br><span style="font-size:12px; opacity:0.8">${className}</span>`;
                }
            }
        } else {
            if (classHud) classHud.style.display = 'none';
        }
    } else {
        if (classHud) classHud.style.display = 'none';
    }
}

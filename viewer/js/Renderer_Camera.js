import { State, Shared, keys } from './State.js';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const EYE_HEIGHT = 11.5; // 頭ブロックの中心

export function updateCamera(delta, currentFrame) {
    const cam = Shared.camera;

    if (State.cameraMode === 'free') {
        const moveSpeed = 100 * delta * (keys.shift ? 3 : 1);
        cam.getWorldDirection(_dir);
        _dir.y = 0;
        _dir.normalize();
        _right.crossVectors(_dir, cam.up).normalize();

        if (keys.w) cam.position.addScaledVector(_dir, moveSpeed);
        if (keys.s) cam.position.addScaledVector(_dir, -moveSpeed);
        if (keys.a) cam.position.addScaledVector(_right, -moveSpeed);
        if (keys.d) cam.position.addScaledVector(_right, moveSpeed);
        if (keys.e) cam.position.y += moveSpeed;
        if (keys.q) cam.position.y -= moveSpeed;
    }

    const classHud = document.getElementById('class-hud');
    let showHud = false;

    if ((State.cameraMode === '1st' || State.cameraMode === '3rd') && State.mode === 'real') {
        const target = Shared.realMeshes[State.targetPlayerId];
        // 死亡中 (メッシュ非表示) でも最後の位置に留まって追従し続ける。HUD は HP 0 を表示する
        if (target && target.userData.hasPrev) {
            const yaw = target.rotation.y;
            const pitch = target.userData.pitch || 0;
            cam.rotation.order = 'YXZ'; // rotation.copy() で順序が壊れるのを防ぐ
            if (State.cameraMode === '1st') {
                cam.position.copy(target.position);
                cam.position.y += EYE_HEIGHT;
                cam.rotation.set(pitch, yaw, 0);
            } else {
                // プレイヤーの背後 (ホイールで距離調整)
                const dist = State.camDistance;
                cam.position.x = target.position.x + Math.sin(yaw) * dist;
                cam.position.z = target.position.z + Math.cos(yaw) * dist;
                cam.position.y = target.position.y + dist * 0.5;
                cam.lookAt(target.position.x, target.position.y + 6, target.position.z);
            }
            showHud = true;
        }
    }

    if (classHud) classHud.style.display = showHud ? 'block' : 'none';
}

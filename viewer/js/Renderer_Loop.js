import { State, Shared } from './State.js';
import { renderer, clock } from './Renderer_Scene.js';
import { drawMinimap, updateNametags, updateKillLog, updateScoreboard, drawHitmarkers, updateDynamicHUD } from './Renderer_UI.js';
import { updateCamera } from './Renderer_Camera.js';
import { spawnTracer, spawnProjectile, updateTracers, clearTracers } from './Renderer_Tracers.js';
import { createPlayerMesh, setMeshTeam } from './Renderer_Players.js';
import { upperBoundIndex } from './Utils.js';

// Reusable THREE objects to avoid GC pressure in the render loop
const _targetPos = new THREE.Vector3();
const _nextPos = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

const MAX_DELTA = 0.1;          // タブ復帰などで時間が飛ぶのを防ぐ
const SEEK_JUMP_SEC = 0.5;      // これ以上の時間変化はシーク扱い
const PROJECTILE_LOOKBACK_MS = 500;

let _lastTimeSec = 0;
let _projCursor = -1;           // 弾道を処理済みの最後のフレーム index
let _timeEl = null, _playheadEl = null;
let _lastTimeText = '', _lastPercent = -1;

function wrapAngleDiff(diff) {
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return diff;
}

function formatTime(sec) {
    const m = Math.floor(sec / 60) || 0;
    const s = Math.floor(sec % 60 || 0).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function updateTimeDisplay() {
    if (!_timeEl) _timeEl = document.getElementById('time-display');
    if (!_playheadEl) _playheadEl = document.getElementById('playhead');

    const percent = State.duration > 0 ? (State.time / State.duration) * 100 : 0;
    if (_playheadEl && Math.abs(percent - _lastPercent) > 0.01) {
        _playheadEl.style.left = percent + '%';
        _lastPercent = percent;
    }
    const text = `${formatTime(State.time)} / ${formatTime(State.duration)}`;
    if (_timeEl && text !== _lastTimeText) {
        _timeEl.innerText = text;
        _lastTimeText = text;
    }
}

export function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), MAX_DELTA);

    if (State.isPlaying && !State.isSeeking) {
        State.time += delta * State.speed;
        if (State.time > State.duration) State.time = 0;
    }

    // シーク/ループ検出
    const jumped = Math.abs(State.time - _lastTimeSec) > SEEK_JUMP_SEC;
    if (jumped || State.time < _lastTimeSec) {
        if (jumped) {
            Shared.seenProjectileIds = new Set();
            clearTracers();
        }
        if (State.time < _lastTimeSec) _projCursor = -1;
    }
    _lastTimeSec = State.time;

    updateTimeDisplay();

    let currentFrame = null;
    let frameIdx = -1;

    if (State.mode === 'real' && Shared.realFrames.length > 0) {
        const timeMs = State.time * 1000;
        frameIdx = Math.max(0, upperBoundIndex(Shared.realFrames, timeMs));
        currentFrame = Shared.realFrames[frameIdx];
        const nextFrame = frameIdx < Shared.realFrames.length - 1 ? Shared.realFrames[frameIdx + 1] : null;

        const dt = nextFrame ? (nextFrame.timestamp - currentFrame.timestamp) : 0;
        const lerpFactor = dt > 0 ? Math.min(1, Math.max(0, (timeMs - currentFrame.timestamp) / dt)) : 0;

        for (const id in Shared.realMeshes) Shared.realMeshes[id].visible = false;

        currentFrame.players.forEach(p => {
            let mesh = Shared.realMeshes[p.id];
            if (!mesh) {
                mesh = createPlayerMesh(p.team);
                Shared.scene.add(mesh);
                Shared.realMeshes[p.id] = mesh;
            }
            setMeshTeam(mesh, p.team);

            mesh.visible = (p.health !== 0);
            if (!mesh.visible) return;

            _targetPos.set(p.pos[0], p.pos[1], p.pos[2]);
            let targetYaw = p.rot[0] || 0;
            let targetPitch = p.rot[1] || 0;

            if (nextFrame) {
                const nextP = nextFrame.players.find(x => x.id === p.id);
                if (nextP && nextP.health > 0) {
                    _nextPos.set(nextP.pos[0], nextP.pos[1], nextP.pos[2]);
                    if (_targetPos.distanceTo(_nextPos) < 100) { // テレポート(リスポーン)は補間しない
                        _targetPos.lerp(_nextPos, lerpFactor);
                        targetYaw += wrapAngleDiff((nextP.rot[0] || 0) - targetYaw) * lerpFactor;
                        targetPitch += ((nextP.rot[1] || 0) - targetPitch) * lerpFactor;
                    }
                }
            }

            mesh.position.copy(_targetPos);
            mesh.quaternion.setFromAxisAngle(_yAxis, targetYaw);
            mesh.userData.pitch = targetPitch;

            // シーク直後は発砲フラグの立ち上がりを拾わない
            if (State.isPlaying && !jumped && p.shoot && !mesh.userData.lastShoot) {
                spawnTracer(mesh, p);
            }
            mesh.userData.lastShoot = p.shoot;
        });

        // l-packet の弾道: 描画フレームの間に挟まれたパケットも取りこぼさないよう、
        // 前回処理したフレームの次から現在のフレームまでを順に処理する。
        // 同じ弾は複数パケットで再送されるため、id ごとに最初の1回だけ描画する。
        if (State.isPlaying) {
            if (_projCursor > frameIdx) _projCursor = frameIdx;
            const startIdx = _projCursor < 0 ? frameIdx : _projCursor + 1;
            for (let i = startIdx; i <= frameIdx; i++) {
                const f = Shared.realFrames[i];
                if (!f.projectiles || timeMs - f.timestamp > PROJECTILE_LOOKBACK_MS) continue;
                if (!Shared.seenProjectileIds) Shared.seenProjectileIds = new Set();
                f.projectiles.forEach(proj => {
                    const key = `${proj.ownerId}:${proj.id}`;
                    if (Shared.seenProjectileIds.has(key)) return;
                    Shared.seenProjectileIds.add(key);
                    spawnProjectile(proj);
                });
            }
            _projCursor = frameIdx;
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

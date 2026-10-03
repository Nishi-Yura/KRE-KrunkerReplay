import { State, Shared } from './State.js';
import { renderer, clock } from './Renderer_Scene.js';
import { drawMinimap, updateNametags, updateKillLog, updateScoreboard, drawHitmarkers, updateDynamicHUD } from './Renderer_UI.js';
import { updateCamera } from './Renderer_Camera.js';
import { spawnShot, spawnProjectile, updateTracers, clearTracers } from './Renderer_Tracers.js';
import { createPlayerMesh, setMeshTeam } from './Renderer_Players.js';
import { upperBoundIndex } from './Utils.js';

// Reusable THREE objects to avoid GC pressure in the render loop
const _targetPos = new THREE.Vector3();
const _nextPos = new THREE.Vector3();

const MAX_DELTA = 0.1;          // タブ復帰などで時間が飛ぶのを防ぐ
const SEEK_JUMP_SEC = 0.5;      // これ以上の時間変化はシーク扱い
const PROJECTILE_LOOKBACK_MS = 500;
const GAP_MS = 1000;            // これ以上フレームが空いたら途切れとみなす
const GAP_HOLD_MS = 300;        // 途切れてから消すまでの猶予

let _lastTimeSec = 0;
let _projCursor = -1;           // 弾道を処理済みの最後のフレーム index
let _lastShotMs = -1;           // 射撃 (着弾) を処理済みの時刻
const MAX_INTERP_DT = 250;      // これ以上離れたフレーム同士は滑らかな曲線補間に使わない
let _timeEl = null, _playheadEl = null;
let _lastTimeText = '', _lastPercent = -1;

function dist3(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Catmull-Rom 補間 (p1→p2 の区間を u で)。各引数は [x, y, z]
function catmullRom(out, p0, p1, p2, p3, u) {
    const u2 = u * u, u3 = u2 * u;
    const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
    out.set(f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2]));
}

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

        // フレームが大きく途切れている区間 (ラウンド間など) は、補間で滑らせず誰も出さない
        const inGap = dt > GAP_MS && (timeMs - currentFrame.timestamp) > GAP_HOLD_MS;
        const prevFrame = frameIdx > 0 ? Shared.realFrames[frameIdx - 1] : null;
        const nextFrame2 = frameIdx < Shared.realFrames.length - 2 ? Shared.realFrames[frameIdx + 2] : null;
        (inGap ? [] : currentFrame.players).forEach(p => {
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
                        // 前後のフレームも揃っていれば Catmull-Rom で曲線補間し、tick ごとの折れ (カクつき) を消す
                        const prevP = prevFrame && currentFrame.timestamp - prevFrame.timestamp < MAX_INTERP_DT
                            ? prevFrame.players.find(x => x.id === p.id) : null;
                        const next2P = nextFrame2 && nextFrame2.timestamp - nextFrame.timestamp < MAX_INTERP_DT
                            ? nextFrame2.players.find(x => x.id === p.id) : null;
                        const p0 = prevP && dist3(prevP.pos, p.pos) < 100 ? prevP.pos : null;
                        const p3 = next2P && dist3(next2P.pos, nextP.pos) < 100 ? next2P.pos : null;
                        if (p0 && p3 && dt < MAX_INTERP_DT) {
                            catmullRom(_targetPos, p0, p.pos, nextP.pos, p3, lerpFactor);
                        } else {
                            _targetPos.lerp(_nextPos, lerpFactor);
                        }
                        targetYaw += wrapAngleDiff((nextP.rot[0] || 0) - targetYaw) * lerpFactor;
                        targetPitch += ((nextP.rot[1] || 0) - targetPitch) * lerpFactor;
                    }
                }
            }

            // 歩行アニメーション: 接地して移動しているときだけ手足を振る (空中・一時停止・シーク直後は止める)
            const moved = mesh.visible && mesh.userData.hasPrev ? mesh.position.distanceTo(_targetPos) : 0;
            const onGround = p.grounded !== false;
            const walking = State.isPlaying && !jumped && onGround && moved > 0.05 && moved < 30;
            const swing = walking ? Math.min(1, moved / Math.max(delta * State.speed, 1e-3) / 60) : 0;
            if (walking) mesh.userData.walkCycle += moved * 0.35;
            const phase = Math.sin(mesh.userData.walkCycle) * 0.9 * (walking ? swing : 0);
            // 空中では脚を少し前後に開いた姿勢にする
            const airPose = onGround ? 0 : 0.5;
            mesh.userData.legs[0].rotation.x = phase + airPose;
            mesh.userData.legs[1].rotation.x = -phase - airPose * 0.6;
            mesh.userData.arms[0].rotation.x = -phase * 0.7;
            mesh.userData.arms[1].rotation.x = phase * 0.7;
            mesh.userData.hasPrev = true;

            // スライド中は体を低くする
            const targetScale = p.sliding ? 0.65 : 1;
            mesh.scale.y += (targetScale - mesh.scale.y) * Math.min(1, delta * 15);

            mesh.position.copy(_targetPos);
            // yaw は Euler で直接持つ (quaternion から rotation.y を読むと ±90° を超えたときに反転するため)
            mesh.rotation.set(0, targetYaw, 0);
            mesh.userData.yaw = targetYaw;
            mesh.userData.pitch = targetPitch;
            if (mesh.userData.headPivot) mesh.userData.headPivot.rotation.x = targetPitch;
        });

        // 射撃: 前回の時刻から今の時刻までに起きた着弾を、撃った位置から着弾点への弾道として描く
        if (State.isPlaying && !jumped && Shared.shots && Shared.shots.length) {
            if (_lastShotMs < 0 || _lastShotMs > timeMs) _lastShotMs = timeMs;
            let i = upperBoundIndex(Shared.shots, _lastShotMs) + 1;
            for (; i < Shared.shots.length && Shared.shots[i].timestamp <= timeMs; i++) {
                const shot = Shared.shots[i];
                let from = shot.from;
                if (!from) {
                    const shooter = Shared.realMeshes[shot.shooter];
                    if (!shooter || !shooter.visible) continue;
                    from = [shooter.position.x, shooter.position.y + 11 * shooter.scale.y, shooter.position.z];
                }
                let to = shot.to;
                if (!to) {
                    // 自分の命中 (4-packet) は着弾点が無いので、相手の胴を狙った線にする
                    const target = Shared.realMeshes[shot.target];
                    if (!target || !target.visible) continue;
                    to = [target.position.x, target.position.y + 6 * target.scale.y, target.position.z];
                }
                spawnShot(from, to);
            }
        }
        _lastShotMs = timeMs;

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

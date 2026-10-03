import { State, Shared } from './State.js';

const TRACER_LIFETIME_MS = 400;
const SHOT_LIFETIME_MS = 350;
const MAX_TRACERS = 300;

// Reusable geometry for tracers (avoid per-tracer allocation)
let _tracerGeo = null;
function getTracerGeo() {
    if (!_tracerGeo) {
        _tracerGeo = new THREE.CylinderGeometry(0.8, 0.8, 4, 6);
        _tracerGeo.translate(0, 2, 0);
        _tracerGeo.rotateX(Math.PI / 2);
    }
    return _tracerGeo;
}

// 長さ1の細い棒 (+Z 方向に伸びる)。弾道ごとに長さへ拡大して使う
let _beamGeo = null;
function getBeamGeo() {
    if (!_beamGeo) {
        _beamGeo = new THREE.CylinderGeometry(0.25, 0.25, 1, 5);
        _beamGeo.translate(0, 0.5, 0);
        _beamGeo.rotateX(Math.PI / 2);
    }
    return _beamGeo;
}

function addTrail(trail) {
    if (!Shared.trails) Shared.trails = [];
    // 連射で無制限に増えないよう古いものから捨てる
    while (Shared.trails.length >= MAX_TRACERS) removeTrail(Shared.trails.shift());
    Shared.scene.add(trail.mesh);
    trail.createdAt = State.time; // 実時間ではなくリプレイ時間基準 (一時停止・倍速・シークに追従)
    Shared.trails.push(trail);
}

function removeTrail(t) {
    Shared.scene.remove(t.mesh);
    if (t.mesh.material) t.mesh.material.dispose(); // ジオメトリは共有なので破棄しない
}

export function clearTracers() {
    if (!Shared.trails) { Shared.trails = []; return; }
    Shared.trails.forEach(removeTrail);
    Shared.trails = [];
}

// 撃った位置 (目の高さ) から着弾点までの弾道。9-packet / s-packet の実データなので向きも距離も正確
export function spawnShot(from, to) {
    const a = new THREE.Vector3(from[0], from[1], from[2]);
    const b = new THREE.Vector3(to[0], to[1], to[2]);
    const len = a.distanceTo(b);
    if (!(len > 0.5)) return;

    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(getBeamGeo(), mat);
    mesh.position.copy(a);
    mesh.lookAt(b);
    mesh.scale.set(1, 1, len);
    addTrail({ mesh, lifetime: SHOT_LIFETIME_MS, beam: true });
}

export function spawnProjectile(proj) {
    if (!proj || !proj.pos) return;

    const origin = new THREE.Vector3(proj.pos[0], proj.pos[1], proj.pos[2]);

    // 方向ベクトルは無いため、所有者 (なければ近くのプレイヤー) の向きを使う
    const dir = new THREE.Vector3(0, 0, -1);
    let owner = proj.ownerId !== undefined ? Shared.realMeshes[proj.ownerId] : null;
    if (!owner || !owner.visible) {
        owner = null;
        for (const mesh of Object.values(Shared.realMeshes)) {
            if (mesh && mesh.visible && origin.distanceTo(mesh.position) < 30) { owner = mesh; break; }
        }
    }
    if (owner) dir.applyQuaternion(owner.quaternion);

    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 1.0 });
    const tracerMesh = new THREE.Mesh(getTracerGeo(), tracerMat);
    tracerMesh.position.copy(origin);
    tracerMesh.lookAt(origin.clone().add(dir));

    addTrail({ mesh: tracerMesh, lifetime: TRACER_LIFETIME_MS, origin: origin.clone(), velocity: dir.multiplyScalar(800) });
}

export function updateTracers() {
    if (!Shared.trails || Shared.trails.length === 0) return;

    for (let i = Shared.trails.length - 1; i >= 0; i--) {
        const t = Shared.trails[i];
        const ageMs = (State.time - t.createdAt) * 1000;
        // ageMs < 0: 巻き戻し/ループで生成時刻より前に戻った
        if (ageMs < 0 || ageMs > t.lifetime) {
            removeTrail(t);
            Shared.trails.splice(i, 1);
            continue;
        }
        if (!t.beam) {
            const scale = ageMs / 1000;
            t.mesh.position.set(
                t.origin.x + t.velocity.x * scale,
                t.origin.y + t.velocity.y * scale,
                t.origin.z + t.velocity.z * scale
            );
        }
        t.mesh.material.opacity = (t.beam ? 0.9 : 1.0) * (1 - ageMs / t.lifetime);
    }
}

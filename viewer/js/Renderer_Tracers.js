import { State, Shared } from './State.js';

const TRACER_LIFETIME_MS = 400;
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

function addTrail(mesh, origin, dir) {
    if (!Shared.trails) Shared.trails = [];
    // 連射で無制限に増えないよう古いものから捨てる
    while (Shared.trails.length >= MAX_TRACERS) removeTrail(Shared.trails.shift());
    Shared.scene.add(mesh);
    Shared.trails.push({
        mesh,
        createdAt: State.time, // 実時間ではなくリプレイ時間基準 (一時停止・倍速・シークに追従)
        origin: origin.clone(),
        velocity: dir.multiplyScalar(800)
    });
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

export function spawnTracer(mesh, p) {
    const origin = mesh.position.clone();
    origin.y += 5;

    const dir = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(p.rot[1] || 0, p.rot[0] || 0, 0, 'YXZ');
    dir.applyEuler(euler);

    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 1.0 });
    const tracerMesh = new THREE.Mesh(getTracerGeo(), tracerMat);
    tracerMesh.position.copy(origin);
    tracerMesh.rotation.order = 'YXZ';
    tracerMesh.rotation.set(p.rot[1] || 0, p.rot[0] || 0, 0);

    addTrail(tracerMesh, origin, dir);
}

export function spawnProjectile(proj) {
    if (!proj || !proj.pos) return;

    const origin = new THREE.Vector3(proj.pos[0], proj.pos[1], proj.pos[2]);

    // l-packet に方向ベクトルは無いため、所有者 (なければ近くのプレイヤー) の向きを使う
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

    addTrail(tracerMesh, origin, dir);
}

export function updateTracers() {
    if (!Shared.trails || Shared.trails.length === 0) return;

    for (let i = Shared.trails.length - 1; i >= 0; i--) {
        const t = Shared.trails[i];
        const ageMs = (State.time - t.createdAt) * 1000;
        // ageMs < 0: 巻き戻し/ループで生成時刻より前に戻った
        if (ageMs < 0 || ageMs > TRACER_LIFETIME_MS) {
            removeTrail(t);
            Shared.trails.splice(i, 1);
        } else {
            const scale = ageMs / 1000;
            t.mesh.position.set(
                t.origin.x + t.velocity.x * scale,
                t.origin.y + t.velocity.y * scale,
                t.origin.z + t.velocity.z * scale
            );
            t.mesh.material.opacity = 1.0 - (ageMs / TRACER_LIFETIME_MS);
        }
    }
}

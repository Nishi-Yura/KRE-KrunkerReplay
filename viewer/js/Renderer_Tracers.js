import { Shared } from './State.js';

// Reusable geometry and material for tracers (avoid per-tracer allocation)
let _tracerGeo = null;
function getTracerGeo() {
    if (!_tracerGeo) {
        _tracerGeo = new THREE.CylinderGeometry(0.8, 0.8, 4, 6);
        _tracerGeo.translate(0, 2, 0);
        _tracerGeo.rotateX(Math.PI / 2);
    }
    return _tracerGeo;
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
    
    Shared.scene.add(tracerMesh);
    if (!Shared.trails) Shared.trails = [];
    Shared.trails.push({ 
        mesh: tracerMesh, 
        createdAt: Date.now(),
        origin: origin.clone(),
        velocity: dir.multiplyScalar(800)
    });
}

export function spawnProjectile(proj) {
    if (!proj || !proj.pos) return;
    
    const origin = new THREE.Vector3(proj.pos[0], proj.pos[1], proj.pos[2]);
    
    // Find owner's direction from current frame to aim tracer correctly
    // Since l-packet i+5,6,7 are NOT direction vectors (values too small ~0.01),
    // we find the nearest player mesh and use their rotation
    let dir = new THREE.Vector3(0, 0, -1); // default forward
    if (proj.ownerId !== undefined) {
        // Try to find owner mesh in any ID namespace
        for (const [id, mesh] of Object.entries(Shared.realMeshes)) {
            if (mesh && mesh.visible) {
                const dist = origin.distanceTo(mesh.position);
                if (dist < 30) { // If projectile origin is near this player, use their rotation
                    dir.set(0, 0, -1);
                    dir.applyQuaternion(mesh.quaternion);
                    break;
                }
            }
        }
    }
    
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 1.0 });
    const tracerMesh = new THREE.Mesh(getTracerGeo(), tracerMat);
    
    tracerMesh.position.copy(origin);
    const lookTarget = origin.clone().add(dir);
    tracerMesh.lookAt(lookTarget);
    
    Shared.scene.add(tracerMesh);
    if (!Shared.trails) Shared.trails = [];
    Shared.trails.push({ 
        mesh: tracerMesh, 
        createdAt: Date.now(),
        origin: origin.clone(),
        velocity: dir.multiplyScalar(800)
    });
}

export function updateTracers() {
    if (!Shared.trails) Shared.trails = [];
    const now = Date.now();
    
    for (let i = Shared.trails.length - 1; i >= 0; i--) {
        const t = Shared.trails[i];
        const age = now - t.createdAt;
        if (age > 400) {
            Shared.scene.remove(t.mesh);
            // Dispose material to prevent VRAM leak (geometry is shared)
            if (t.mesh.material) t.mesh.material.dispose();
            Shared.trails.splice(i, 1);
        } else {
            if (t.velocity) {
                const scale = age / 1000;
                t.mesh.position.set(
                    t.origin.x + t.velocity.x * scale,
                    t.origin.y + t.velocity.y * scale,
                    t.origin.z + t.velocity.z * scale
                );
            }
            t.mesh.material.opacity = 1.0 - (age / 400);
        }
    }
}

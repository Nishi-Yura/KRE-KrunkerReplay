import { Shared } from './State.js';

export function spawnTracer(mesh, p) {
    const origin = mesh.position.clone();
    origin.y += 5; // Approx gun height
    
    const dir = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(p.rot[1] || 0, p.rot[0] || 0, 0, 'YXZ');
    dir.applyEuler(euler);
    
    const tracerLength = 4;
    const tracerGeo = new THREE.CylinderGeometry(0.8, 0.8, tracerLength, 6);
    tracerGeo.translate(0, tracerLength/2, 0); 
    tracerGeo.rotateX(Math.PI / 2); 
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 1.0 });
    const tracerMesh = new THREE.Mesh(tracerGeo, tracerMat);
    
    tracerMesh.position.copy(origin);
    tracerMesh.rotation.order = 'YXZ';
    tracerMesh.rotation.set(p.rot[1] || 0, p.rot[0] || 0, 0);
    
    Shared.scene.add(tracerMesh);
    if (!Shared.trails) Shared.trails = [];
    Shared.trails.push({ 
        mesh: tracerMesh, 
        createdAt: Date.now(),
        origin: origin.clone(),
        velocity: dir.multiplyScalar(800) // 800 units per second speed
    });
}

export function spawnProjectile(proj) {
    if (!proj || !proj.pos || !proj.dirVec) return;
    
    const origin = new THREE.Vector3(proj.pos[0], proj.pos[1], proj.pos[2]);
    const dir = new THREE.Vector3(proj.dirVec[0], proj.dirVec[1], proj.dirVec[2]).normalize();
    
    const tracerLength = 4;
    const tracerGeo = new THREE.CylinderGeometry(0.8, 0.8, tracerLength, 6);
    tracerGeo.translate(0, tracerLength/2, 0); 
    tracerGeo.rotateX(Math.PI / 2); 
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 1.0 });
    const tracerMesh = new THREE.Mesh(tracerGeo, tracerMat);
    
    tracerMesh.position.copy(origin);
    
    // Rotate mesh to face direction
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
            Shared.trails.splice(i, 1);
        } else {
            if (t.velocity) {
                const travelDist = t.velocity.clone().multiplyScalar(age / 1000);
                t.mesh.position.copy(t.origin).add(travelDist);
            }
            t.mesh.material.opacity = 1.0 - (age / 400);
        }
    }
}

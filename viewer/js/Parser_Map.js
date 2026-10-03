import { Shared, hexToNum } from './State.js';
import { showToast } from './UI.js';
import { disposeObject } from './Utils.js';

function clearMapGroup() {
    while (Shared.mapGroup.children.length > 0) {
        const child = Shared.mapGroup.children[0];
        Shared.mapGroup.remove(child);
        disposeObject(child);
    }
    Shared.mapBounds = null;
}

export function parseMapJSON(jsonString) {
    let mapData;
    try { mapData = JSON.parse(jsonString); } catch (e) { return false; }
    return parseMapData(mapData);
}

// 全ボックスを1つの InstancedMesh にまとめて描画コールを1回に抑える
export function parseMapData(mapData) {
    if (!mapData || !mapData.name || (!mapData.objects && !mapData.xyz)) return false;

    Shared.currentMapName = mapData.name;
    showToast(`マップロード: ${mapData.name}`, 'success');
    clearMapGroup();

    const palette = mapData.colors || [];
    const boxes = [];

    if (Array.isArray(mapData.xyz)) {
        for (let i = 0; i + 5 < mapData.xyz.length; i += 6) {
            boxes.push({ p: mapData.xyz.slice(i, i + 3), s: mapData.xyz.slice(i + 3, i + 6), r: null, color: 0x444444 });
        }
    }
    if (Array.isArray(mapData.objects)) {
        for (const obj of mapData.objects) {
            if (!obj.s) continue; // スケール未指定のオブジェクトは巨大なゴミになるので除外
            let color = 0x666666;
            if (obj.ci !== undefined && palette[obj.ci]) color = hexToNum(palette[obj.ci]);
            boxes.push({ p: obj.p || [0, 0, 0], s: obj.s, r: obj.r || null, color });
        }
    }

    if (boxes.length > 0) {
        const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshLambertMaterial({ color: 0xffffff }),
            boxes.length
        );
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        const col = new THREE.Color();
        const min = new THREE.Vector3(Infinity, Infinity, Infinity);
        const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

        boxes.forEach((b, i) => {
            pos.set(b.p[0], b.p[1], b.p[2]);
            scl.set(b.s[0], b.s[1], b.s[2]);
            if (b.r) { e.set(b.r[0], b.r[1], b.r[2]); q.setFromEuler(e); } else { q.identity(); }
            m4.compose(pos, q, scl);
            mesh.setMatrixAt(i, m4);
            mesh.setColorAt(i, col.setHex(b.color));
            const reach = Math.max(Math.abs(b.s[0]), Math.abs(b.s[1]), Math.abs(b.s[2])) / 2;
            min.min(pos.clone().subScalar(reach));
            max.max(pos.clone().addScalar(reach));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.frustumCulled = false; // 基本ジオメトリの境界球では全体を判定できない
        Shared.mapGroup.add(mesh);
        Shared.mapBounds = { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z };
    }

    const landingModal = document.getElementById('landing-modal');
    if (landingModal) landingModal.classList.remove('active');

    return true;
}

export function parseOBJ(text) {
    showToast('3D地形(OBJ)を解析中...', 'success');
    clearMapGroup();
    
    const vertices = [];
    const positions = [];
    
    const lines = text.split('\n');
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('v ')) {
            const parts = line.split(' ');
            vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if (line.startsWith('f ')) {
            const parts = line.split(' ');
            if (parts.length >= 4) {
                const a = parseInt(parts[1].split('/')[0]) - 1;
                const b = parseInt(parts[2].split('/')[0]) - 1;
                const c = parseInt(parts[3].split('/')[0]) - 1;
                if (vertices[a] && vertices[b] && vertices[c]) {
                    positions.push(...vertices[a], ...vertices[b], ...vertices[c]);
                }
                if (parts.length >= 5) {
                    const d = parseInt(parts[4].split('/')[0]) - 1;
                    if (vertices[a] && vertices[c] && vertices[d]) {
                        positions.push(...vertices[a], ...vertices[c], ...vertices[d]);
                    }
                }
            }
        }
    }
    
    if (positions.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshLambertMaterial({ 
            color: 0x444444, side: THREE.DoubleSide, flatShading: true
        });
        const mesh = new THREE.Mesh(geometry, material);
        Shared.mapGroup.add(mesh);
        
        showToast(`地形ロード完了 (${vertices.length}頂点)`, 'success');
        const landingModal = document.getElementById('landing-modal');
        if (landingModal) landingModal.classList.remove('active');
    } else {
        showToast('エラー: OBJファイルに有効なポリゴンがありません', 'warning');
    }
}

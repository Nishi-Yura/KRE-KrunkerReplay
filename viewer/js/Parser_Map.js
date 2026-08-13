import { Shared, hexToNum } from './State.js';
import { showToast } from './UI.js';

export function parseMapJSON(jsonString) {
    let mapData;
    try { mapData = JSON.parse(jsonString); } catch(e) { return false; }
    if(!mapData.name || (!mapData.objects && !mapData.xyz)) return false;
    
    Shared.currentMapName = mapData.name;
    showToast(`マップロード: ${mapData.name}`, 'success');
    
    while(Shared.mapGroup.children.length > 0){ 
        Shared.mapGroup.remove(Shared.mapGroup.children[0]); 
    }
    
    const colors = mapData.colors || [];
    
    if (mapData.xyz) {
        for(let i = 0; i < mapData.xyz.length; i += 6) {
            const x = mapData.xyz[i], y = mapData.xyz[i+1], z = mapData.xyz[i+2];
            const sx = mapData.xyz[i+3], sy = mapData.xyz[i+4], sz = mapData.xyz[i+5];
            
            const geo = new THREE.BoxGeometry(sx, sy, sz);
            const mat = new THREE.MeshLambertMaterial({ color: 0x444444 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, y, z);
            Shared.mapGroup.add(mesh);
        }
    }
    
    if (mapData.objects) {
        mapData.objects.forEach(obj => {
            if (!obj.s) return; // Skip objects without explicit scale to prevent giant 10x10x10 garbage boxes
            
            const sx = obj.s[0];
            const sy = obj.s[1];
            const sz = obj.s[2];
            
            const geo = new THREE.BoxGeometry(sx, sy, sz);
            
            let colorHex = 0x666666;
            if(obj.ci !== undefined && colors[obj.ci]) {
                colorHex = hexToNum(colors[obj.ci]);
            }
            const mat = new THREE.MeshLambertMaterial({ color: colorHex });
            const mesh = new THREE.Mesh(geo, mat);
            
            if(obj.p) mesh.position.set(obj.p[0], obj.p[1], obj.p[2]);
            if(obj.r) mesh.rotation.set(obj.r[0], obj.r[1], obj.r[2]);
            Shared.mapGroup.add(mesh);
        });
    }
    
    const landingModal = document.getElementById('landing-modal');
    if (landingModal) landingModal.classList.remove('active');
    
    return true;
}

export function parseOBJ(text) {
    showToast('3D地形(OBJ)を解析中...', 'success');
    while(Shared.mapGroup.children.length > 0){ 
        Shared.mapGroup.remove(Shared.mapGroup.children[0]); 
    }
    
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

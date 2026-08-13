import { State, Shared } from './State.js';
import { KRUNKER_CLASSES } from './Constants.js';

export function createPlayerMesh(team = 0) {
    const group = new THREE.Group();
    
    let bodyColor = 0x0000ff; // Default blue
    if (team === 1) bodyColor = 0xff8800; // Orange
    else if (team === 2) bodyColor = 0x00ccff; // Light Blue
    const bodyGeo = new THREE.BoxGeometry(4, 10, 4);
    const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 5;
    group.add(body);
    
    const headGeo = new THREE.BoxGeometry(3, 3, 3);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 11.5;
    group.add(head);
    
    const sightGeo = new THREE.BoxGeometry(0.5, 0.5, 15);
    const sightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const sightMesh = new THREE.Mesh(sightGeo, sightMat);
    sightMesh.position.set(0, 11.5, -7.5);
    group.add(sightMesh);
    
    return group;
}

export function setupRealPlayers() {
    const listContent = document.getElementById('player-list-content');
    listContent.innerHTML = '';
    
    if (Shared.realMeshes) {
        Object.values(Shared.realMeshes).forEach(mesh => Shared.scene.remove(mesh));
    }
    Shared.realMeshes = {};
    
    const uniqueIds = new Set();
    Shared.realFrames.forEach(f => f.players.forEach(p => uniqueIds.add(p.id)));

    const players = Array.from(uniqueIds).map(id => {
        let pName = `Player ${id}`;
        let team = 0;
        let classId = -1;
        
        // Loop backwards to get the most recent valid class ID (after 0-packets arrive)
        for(let i = Shared.realFrames.length - 1; i >= 0; i--) {
            const f = Shared.realFrames[i];
            const p = f.players.find(x => x.id === id);
            if(p) {
                if(p.name && !p.name.startsWith('Player ')) pName = p.name;
                if(p.team !== undefined) team = p.team;
                if(p.classId !== undefined && p.classId !== -1) {
                    classId = p.classId;
                    break;
                }
            }
        }
        
        if (classId === -1) classId = 0; // Fallback to AK if never spawned
        
        let kills = 0;
        let deaths = 0;
        let score = 0;
        
        if (Shared.events) {
            Shared.events.forEach(e => {
                if (e.type === 'kill') {
                    if (e.killer == id) {
                        kills++;
                        score += e.headshot ? 100 : 50;
                    }
                    if (e.victim == id) {
                        deaths++;
                    }
                }
            });
        }

        return { id, pName, team, classId, kills, deaths, score };
    });
    
    Shared.playerInfo = players;
    
    // Sort by team
    players.sort((a, b) => a.team - b.team);
    
    // Setup HUD overlay for class info
    let classHud = document.getElementById('class-hud');
    if (!classHud) {
        classHud = document.createElement('div');
        classHud.id = 'class-hud';
        classHud.style.cssText = 'position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.6); color: white; padding: 10px 20px; border-radius: 8px; font-family: monospace; font-size: 16px; font-weight: bold; pointer-events: none; z-index: 100; text-align: center; border: 1px solid rgba(255,255,255,0.2); display: none;';
        document.body.appendChild(classHud);
    }
    
    players.forEach(p => {
        const mesh = createPlayerMesh(p.team);
        Shared.scene.add(mesh);
        Shared.realMeshes[p.id] = mesh;
        
        let bgColor = 'rgba(255, 255, 255, 0.1)'; // default
        if (p.team === 1) bgColor = 'rgba(255, 136, 0, 0.4)';
        else if (p.team === 2) bgColor = 'rgba(0, 204, 255, 0.4)';
        
        const className = KRUNKER_CLASSES[p.classId] || `Class ${p.classId}`;
        
        const div = document.createElement('div');
        div.className = 'player-card';
        div.dataset.id = p.id;
        div.style.backgroundColor = bgColor;
        div.style.color = '#fff';
        div.innerHTML = `
            <div style="padding: 4px 8px;">
                <div class="player-name-text" style="font-size: 13px; font-weight: bold;">${p.pName}</div>
                <div class="class-text" style="font-size: 10px; opacity: 0.8; margin-top: 2px;">${className}</div>
            </div>
        `;
        div.onclick = () => { 
            State.targetPlayerId = p.id; 
            State.cameraMode = '3rd'; 
            document.querySelectorAll('.player-card').forEach(el => el.classList.remove('active'));
            div.classList.add('active');
            
            // Show HUD
            classHud.style.display = 'block';
            classHud.innerHTML = `Spectating: <span style="color:#00ff88">${p.pName}</span><br><span style="font-size:12px; opacity:0.8">${className}</span>`;
        };
        listContent.appendChild(div);
    });
    
    if (players.length > 0) {
        State.targetPlayerId = players[0].id;
        const firstCard = listContent.querySelector('.player-card');
        if (firstCard) firstCard.classList.add('active');
    }
    
    // Create kill log container if not exists
    if (!document.getElementById('kill-log')) {
        const kl = document.createElement('div');
        kl.id = 'kill-log';
        kl.style.position = 'absolute';
        kl.style.top = '120px';
        kl.style.right = '10px';
        kl.style.width = '280px';
        kl.style.display = 'flex';
        kl.style.flexDirection = 'column';
        kl.style.gap = '3px';
        kl.style.pointerEvents = 'none';
        kl.style.zIndex = '10';
        document.body.appendChild(kl);
    }
}

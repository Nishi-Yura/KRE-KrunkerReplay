import { State, Shared } from './State.js';
import { KRUNKER_CLASSES } from './Constants.js';
import { escapeHTML } from './Utils.js';
import { setCameraMode } from './UI.js';
import { resetNametags } from './Renderer_UI.js';
import { clearTracers } from './Renderer_Tracers.js';

// ジオメトリ/マテリアルは全プレイヤーで共有し、チーム色だけ差し替える
const BODY_GEO = new THREE.BoxGeometry(4, 10, 4);
const HEAD_GEO = new THREE.BoxGeometry(3, 3, 3);
const SIGHT_GEO = new THREE.BoxGeometry(0.5, 0.5, 15);
const HEAD_MAT = new THREE.MeshLambertMaterial({ color: 0xffffff });
const SIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const TEAM_COLORS = { 0: 0x0000ff, 1: 0xff8800, 2: 0x00ccff };
const BODY_MATS = {};

function bodyMaterial(team) {
    const key = TEAM_COLORS[team] !== undefined ? team : 0;
    if (!BODY_MATS[key]) BODY_MATS[key] = new THREE.MeshLambertMaterial({ color: TEAM_COLORS[key] });
    return BODY_MATS[key];
}

export function createPlayerMesh(team = 0) {
    const group = new THREE.Group();

    const body = new THREE.Mesh(BODY_GEO, bodyMaterial(team));
    body.position.y = 5;
    group.add(body);

    const head = new THREE.Mesh(HEAD_GEO, HEAD_MAT);
    head.position.y = 11.5;
    group.add(head);

    const sightMesh = new THREE.Mesh(SIGHT_GEO, SIGHT_MAT);
    sightMesh.position.set(0, 11.5, -7.5);
    group.add(sightMesh);

    group.userData.team = team;
    return group;
}

export function setMeshTeam(mesh, team) {
    if (mesh.userData.team === team) return;
    mesh.userData.team = team;
    mesh.children[0].material = bodyMaterial(team);
}

export function setupRealPlayers() {
    const listContent = document.getElementById('player-list-content');
    listContent.innerHTML = '';
    
    if (Shared.realMeshes) {
        Object.values(Shared.realMeshes).forEach(mesh => Shared.scene.remove(mesh));
    }
    Shared.realMeshes = {};
    resetNametags();
    clearTracers();
    Shared.seenProjectileIds = new Set();
    
    const uniqueIds = new Set();
    // ミニマップ用に全フレームを通した移動範囲を一度だけ求める
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    Shared.realFrames.forEach(f => f.players.forEach(p => {
        uniqueIds.add(p.id);
        if (p.pos[0] < minX) minX = p.pos[0];
        if (p.pos[0] > maxX) maxX = p.pos[0];
        if (p.pos[2] < minZ) minZ = p.pos[2];
        if (p.pos[2] > maxZ) maxZ = p.pos[2];
    }));
    Shared.playBounds = isFinite(minX) ? { minX, maxX, minZ, maxZ } : null;

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
    
    // Merge kill/death/score back into Shared.playerInfo (already set by parser as an array)
    // If playerInfo already has the right structure, just update stats; otherwise set it.
    if (!Array.isArray(Shared.playerInfo) || Shared.playerInfo.length === 0) {
        Shared.playerInfo = players;
    } else {
        // Update kills/deaths/score on existing entries
        players.forEach(p => {
            const existing = Shared.playerInfo.find(x => x.id === p.id);
            if (existing) {
                existing.kills = p.kills;
                existing.deaths = p.deaths;
                existing.score = p.score;
            }
        });
    }
    
    // Sort by team
    players.sort((a, b) => a.team - b.team);
    
    // Setup HUD overlay for class info
    let classHud = document.getElementById('class-hud');
    if (!classHud) {
        classHud = document.createElement('div');
        classHud.id = 'class-hud';
        classHud.style.cssText = 'position: absolute; bottom: 110px; left: 50%; transform: translateX(-50%); min-width: 220px; background: rgba(0,0,0,0.6); color: white; padding: 10px 20px; border-radius: 8px; font-family: monospace; font-size: 16px; font-weight: bold; pointer-events: none; z-index: 100; text-align: center; border: 1px solid rgba(255,255,255,0.2); display: none;';
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
                <div class="player-name-text" style="font-size: 13px; font-weight: bold;">${escapeHTML(p.pName)}</div>
                <div class="class-text" style="font-size: 10px; opacity: 0.8; margin-top: 2px;">${escapeHTML(className)}</div>
            </div>
        `;
        div.onclick = () => { 
            State.targetPlayerId = p.id; 
            document.querySelectorAll('.player-card').forEach(el => el.classList.remove('active'));
            div.classList.add('active');
            // 追従視点へ切り替え (HUDの中身は updateDynamicHUD が毎フレーム更新する)
            setCameraMode(State.cameraMode === '1st' ? '1st' : '3rd');
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

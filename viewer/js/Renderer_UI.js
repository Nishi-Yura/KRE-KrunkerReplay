import { State, Shared } from './State.js';
import { KRUNKER_CLASSES } from './Constants.js';

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function updateDynamicHUD(currentFrame) {
    if (!currentFrame || !State.targetPlayerId) return;
    const p = currentFrame.players.find(x => x.id == State.targetPlayerId);
    if (!p) return;
    
    // Update center HUD
    let classHud = document.getElementById('class-hud');
    if (classHud && classHud.style.display !== 'none') {
        const className = KRUNKER_CLASSES[p.classId] || `Class ${p.classId}`;
        const pName = p.name || `Player ${p.id}`;
        classHud.innerHTML = `Spectating: <span style="color:#00ff88">${escapeHTML(pName)}</span><br><span style="font-size:12px; opacity:0.8">${escapeHTML(className)}</span>`;
    }
    
    // Also update the player list if they changed class
    const pCard = document.querySelector(`.player-card[data-id="${p.id}"]`);
    if (pCard) {
        const classDiv = pCard.querySelector('.class-text');
        if (classDiv) {
            const className = KRUNKER_CLASSES[p.classId] || `Class ${p.classId}`;
            classDiv.innerText = className;
        }
    }
}

export function drawMinimap() {
  const minimapCanvas = document.getElementById('minimap');
  if(!minimapCanvas) return;
  const ctx = minimapCanvas.getContext('2d');
  minimapCanvas.width = 200;
  minimapCanvas.height = 200;
  
  ctx.clearRect(0, 0, 200, 200);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(10, 10, 180, 180);
  
  if (State.mode !== 'real') return;
  
  const pList = Object.entries(Shared.realMeshes);
  
  // Calculate dynamic bounds from all visible meshes
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  pList.forEach(([id, mesh]) => {
    if(!mesh || mesh.visible === false) return;
    minX = Math.min(minX, mesh.position.x);
    maxX = Math.max(maxX, mesh.position.x);
    minZ = Math.min(minZ, mesh.position.z);
    maxZ = Math.max(maxZ, mesh.position.z);
  });
  const rangeX = Math.max(maxX - minX, 50);
  const rangeZ = Math.max(maxZ - minZ, 50);
  const scale = Math.min(160 / rangeX, 160 / rangeZ);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  pList.forEach(([id, mesh]) => {
    if(!mesh || mesh.visible === false) return;
    const x = 100 + (mesh.position.x - cx) * scale;
    const y = 100 + (mesh.position.z - cz) * scale;
    
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function updateNametags(currentFrame) {
    const nametagsLayer = document.getElementById('nametags-layer');
    if (!nametagsLayer) return;

    if (State.mode === 'real' && currentFrame) {
        Object.entries(Shared.realMeshes).forEach(([id, mesh]) => {
            let tagDiv = document.getElementById('nametag-' + id);
            
            const pData = currentFrame.players.find(p => p.id == id);
            if (!pData || pData.health <= 0 || !mesh.visible || (State.cameraMode === '1st' && parseInt(id) === State.targetPlayerId)) {
                if (tagDiv) tagDiv.style.display = 'none';
                return;
            }
            
            if (!tagDiv) {
                tagDiv = document.createElement('div');
                tagDiv.id = 'nametag-' + id;
                tagDiv.className = 'nametag';
                
                const pName = pData.name || `Player ${id}`;
                const hp = pData.health || 100;
                const maxHp = pData.maxHealth || 100;
                const hpPercent = (hp / maxHp) * 100;
                
                tagDiv.innerHTML = `
                    <div class="nametag-name" id="nametag-name-${id}">${escapeHTML(pName)}</div>
                    <div class="nametag-hp-bar">
                        <div class="nametag-hp-fill" id="nametag-hp-${id}" style="width: ${hpPercent}%"></div>
                    </div>
                `;
                nametagsLayer.appendChild(tagDiv);
            }
            
            tagDiv.style.display = 'block';
            tagDiv.style.backgroundColor = 'transparent';
            tagDiv.style.color = 'white';
            tagDiv.style.padding = '0';
            tagDiv.style.borderRadius = '0';
            
            let nameTagBg = 'rgba(0,0,0,0.6)';
            if (pData.team === 1) nameTagBg = 'rgba(255, 136, 0, 0.85)';
            else if (pData.team === 2) nameTagBg = 'rgba(0, 204, 255, 0.85)';
            
            const nameDiv = document.getElementById('nametag-name-' + id);
            if (nameDiv) {
                nameDiv.innerText = pData.name || `Player ${id}`;
                nameDiv.style.color = 'white';
                nameDiv.style.background = nameTagBg;
            }
            
            const hpFill = document.getElementById('nametag-hp-' + id);
            if (hpFill) {
                const hp = pData.health || 100;
                const maxHp = pData.maxHealth || 100;
                const hpPercent = (hp / maxHp) * 100;
                hpFill.style.width = Math.max(0, Math.min(100, hpPercent)) + '%';
                if (hpPercent < 30) hpFill.style.background = '#ff0000';
                else if (hpPercent < 60) hpFill.style.background = '#ffff00';
                else hpFill.style.background = '#00ff00';
            }
            
            const pos = mesh.position.clone();
            pos.y += 12; 
            pos.project(Shared.camera);
            
            if (pos.z > 1) {
                tagDiv.style.display = 'none';
                return;
            }
            
            const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-(pos.y * 0.5) + 0.5) * window.innerHeight;
            tagDiv.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
        });
    } else {
        nametagsLayer.innerHTML = '';
    }
}

export function updateKillLog(currentFrame) {
    const killLogContainer = document.getElementById('kill-log');
    if (!killLogContainer || !Shared.events || State.mode !== 'real') return;
    
    const timeMs = State.time * 1000;
    const recentKills = Shared.events.filter(e => e.type === 'kill' && timeMs >= e.timestamp && timeMs - e.timestamp < 5000);
    
    killLogContainer.innerHTML = '';
    recentKills.forEach(k => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.padding = '2px 5px';
        row.style.borderRadius = '3px';
        row.style.background = 'transparent';
        row.style.fontSize = '12px';
        row.style.fontFamily = 'monospace';
        
        let killerName = 'Unknown';
        let victimName = 'Unknown';
        let killerTeam = 0;
        let victimTeam = 0;

        if (Shared.playerInfo) {
            let kP, vP;
            if (Array.isArray(Shared.playerInfo)) {
                kP = Shared.playerInfo.find(p => p.id == k.killer);
                vP = Shared.playerInfo.find(p => p.id == k.victim);
            } else {
                const kInfo = Shared.playerInfo[String(k.killer)];
                const vInfo = Shared.playerInfo[String(k.victim)];
                if (kInfo) kP = { pName: kInfo.name, team: kInfo.team };
                if (vInfo) vP = { pName: vInfo.name, team: vInfo.team };
            }
            if (kP && kP.pName) {
                killerName = kP.pName;
                killerTeam = kP.team || 0;
            }
            if (vP && vP.pName) {
                victimName = vP.pName;
                victimTeam = vP.team || 0;
            }
        }
        
        let killerColor = '#ffffff';
        if (killerTeam === 1) killerColor = '#ff8800';
        else if (killerTeam === 2) killerColor = '#00ccff';
        
        let victimColor = '#ffffff';
        if (victimTeam === 1) victimColor = '#ff8800';
        else if (victimTeam === 2) victimColor = '#00ccff';

        const weaponIcon = k.headshot ? '💀' : '🔫';

        row.innerHTML = `
            <span style="color: ${killerColor}; font-weight: bold;">${escapeHTML(killerName)}</span>
            <span style="margin: 0 8px; font-size: 10px; color: #fff;">${weaponIcon}</span>
            <span style="color: ${victimColor}; font-weight: bold;">${escapeHTML(victimName)}</span>
        `;
        killLogContainer.appendChild(row);
    });
}

export function updateScoreboard() {
    let sb = document.getElementById('scoreboard');
    if (!sb) {
        sb = document.createElement('div');
        sb.id = 'scoreboard';
        sb.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 400px; background: rgba(0,0,0,0.85); border-radius: 8px; color: white; padding: 12px; font-family: sans-serif; display: none; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); font-size: 13px;';
        document.body.appendChild(sb);
    }
    
    if (State.showScoreboard && Shared.playerInfo) {
        sb.style.display = 'block';
        let isObjMode = false;
        if (Shared.events) {
            for (let i = 0; i < Shared.events.length; i++) {
                const e = Shared.events[i];
                if (e.timestamp > State.time * 1000) break;
                if (e.type === 'scoreboard') isObjMode = e.isObjMode;
            }
        }
        
        let html = '<h2 style="text-align:center; margin-top:0; color:#fff;">SCOREBOARD</h2>';
        html += '<table style="width:100%; border-collapse: collapse; text-align: left;">';
        html += '<tr style="border-bottom: 2px solid rgba(255,255,255,0.2);">';
        html += '<th style="padding: 8px;">Name</th>';
        html += '<th style="padding: 8px;">Score</th>';
        html += '<th style="padding: 8px;">Kills</th>';
        html += '<th style="padding: 8px;">Deaths</th>';
        if (isObjMode) html += '<th style="padding: 8px;">OBJ</th>';
        html += '<th style="padding: 8px;">K/D</th>';
        html += '</tr>';
        
        // Calculate dynamic scores based on current time
        const timeMs = State.time * 1000;
        const dynamicStats = {};
        if (Array.isArray(Shared.playerInfo)) {
            Shared.playerInfo.forEach(p => {
                dynamicStats[p.id] = { ...p, kills: 0, deaths: 0, score: 0, obj: 0 };
            });
        } else if (Shared.playerInfo && typeof Shared.playerInfo === 'object') {
            // playerInfo is a map { id: { name, team } }
            Object.entries(Shared.playerInfo).forEach(([id, info]) => {
                dynamicStats[id] = { id, pName: info.name || `Player ${id}`, team: info.team || 0, kills: 0, deaths: 0, score: 0, obj: 0 };
            });
        }
        
        if (Shared.events) {
            let latestScoreboard = null;
            // Find the latest scoreboard event before timeMs
            for (let i = 0; i < Shared.events.length; i++) {
                const e = Shared.events[i];
                if (e.timestamp > timeMs) break;
                if (e.type === 'scoreboard') latestScoreboard = e;
            }
            
            if (latestScoreboard) {
                // Apply latest scores
                for (const sid in latestScoreboard.scores) {
                    if (dynamicStats[sid]) {
                        dynamicStats[sid].score = latestScoreboard.scores[sid].score;
                        dynamicStats[sid].kills = latestScoreboard.scores[sid].kills;
                        dynamicStats[sid].deaths = latestScoreboard.scores[sid].deaths;
                        dynamicStats[sid].obj = latestScoreboard.scores[sid].obj;
                    }
                }
            } else {
                // Fallback to counting kills if no scoreboard event (for older replays or very start of game)
                Shared.events.forEach(e => {
                    if (e.timestamp <= timeMs && e.type === 'kill') {
                        if (dynamicStats[e.killer]) {
                            dynamicStats[e.killer].kills++;
                            dynamicStats[e.killer].score += e.headshot ? 100 : 50;
                        }
                        if (dynamicStats[e.victim]) {
                            dynamicStats[e.victim].deaths++;
                        }
                    }
                });
            }
        }
        
        // Sort by score
        const players = Object.values(dynamicStats).sort((a, b) => b.score - a.score);
        
        players.forEach(p => {
            let color = '#fff';
            if (p.team === 1) color = '#ff8800';
            else if (p.team === 2) color = '#00ccff';
            
            html += '<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">';
            html += `<td style="padding: 8px; color: ${color}; font-weight: bold;">${escapeHTML(p.pName)}</td>`;
            html += `<td style="padding: 8px;">${p.score}</td>`;
            html += `<td style="padding: 8px;">${p.kills}</td>`;
            html += `<td style="padding: 8px;">${p.deaths}</td>`;
            if (isObjMode) html += `<td style="padding: 8px;">${p.obj}</td>`;
            
            const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
            html += `<td style="padding: 8px; color: #aaa;">${kd}</td>`;
            html += '</tr>';
        });
        
        html += '</table>';
        sb.innerHTML = html;
        
    } else {
        sb.style.display = 'none';
    }
}

export function drawHitmarkers() {
    let hm = document.getElementById('hitmarker');
    if (!hm) {
        hm = document.createElement('div');
        hm.id = 'hitmarker';
        hm.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 20px; height: 20px; background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cline x1=\'4\' y1=\'4\' x2=\'20\' y2=\'20\'/%3E%3Cline x1=\'20\' y1=\'4\' x2=\'4\' y2=\'20\'/%3E%3C/svg%3E"); opacity: 0; transition: opacity 0.1s ease-out; pointer-events: none; z-index: 100;';
        document.body.appendChild(hm);
    }
    
    let ch = document.getElementById('crosshair');
    if (!ch) {
        ch = document.createElement('div');
        ch.id = 'crosshair';
        ch.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 6px; height: 6px; background: rgba(255,255,255,0.8); border-radius: 50%; display: none; pointer-events: none; z-index: 99;';
        document.body.appendChild(ch);
    }
    
    if (State.mode === 'real' && (State.cameraMode === '1st' || State.cameraMode === '3rd')) {
        ch.style.display = 'block';
    } else {
        ch.style.display = 'none';
    }
    
    if (State.mode === 'real' && Shared.events && (State.cameraMode === '1st' || State.cameraMode === '3rd')) {
        const timeMs = State.time * 1000;
        // Check if there's any kill/damage event by the spectated player in the last 200ms
        const recentHits = Shared.events.filter(e => 
            (e.type === 'kill' || e.type === 'damage') && 
            e.killer == State.targetPlayerId && 
            timeMs >= e.timestamp && timeMs - e.timestamp < 300
        );
        
        if (recentHits.length > 0) {
            hm.style.opacity = '1';
            const headshot = recentHits.some(e => e.headshot);
            if (headshot) {
                hm.style.filter = 'drop-shadow(0 0 4px red)';
                hm.style.stroke = 'red'; 
            } else {
                hm.style.filter = 'none';
            }
        } else {
            hm.style.opacity = '0';
        }
    } else {
        hm.style.opacity = '0';
    }
}

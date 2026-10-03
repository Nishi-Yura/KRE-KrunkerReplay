import { State, Shared } from './State.js';
import { KRUNKER_CLASSES } from './Constants.js';
import { escapeHTML, upperBoundIndex } from './Utils.js';

const TEAM_HEX = { 1: '#ff8800', 2: '#00ccff' };

// events 配列 (時刻順) から kill / scoreboard だけを抜き出して保持する。
// events が差し替わったとき (新しいリプレイ読み込み時) のみ再構築する。
let _indexedEvents = null;
let _kills = [];
let _scoreboards = [];
function indexEvents() {
    if (_indexedEvents === Shared.events) return;
    _indexedEvents = Shared.events;
    _kills = [];
    _scoreboards = [];
    (Shared.events || []).forEach(e => {
        if (e.type === 'kill') _kills.push(e);
        else if (e.type === 'scoreboard') _scoreboards.push(e);
    });
    _statsCache = null;
    _playerLookup = null;
}

function recentKills(timeMs, windowMs) {
    indexEvents();
    const end = upperBoundIndex(_kills, timeMs);
    const out = [];
    for (let i = end; i >= 0 && timeMs - _kills[i].timestamp < windowMs; i--) out.push(_kills[i]);
    return out.reverse();
}

let _playerLookup = null;
let _playerLookupSrc = null;
function playerById(id) {
    if (_playerLookupSrc !== Shared.playerInfo || !_playerLookup) {
        _playerLookupSrc = Shared.playerInfo;
        _playerLookup = new Map();
        if (Array.isArray(Shared.playerInfo)) {
            Shared.playerInfo.forEach(p => _playerLookup.set(String(p.id), p));
        } else if (Shared.playerInfo && typeof Shared.playerInfo === 'object') {
            Object.entries(Shared.playerInfo).forEach(([k, info]) => {
                _playerLookup.set(k, { id: k, pName: info.name || `Player ${k}`, team: info.team || 0 });
            });
        }
    }
    return _playerLookup.get(String(id));
}

// 指定時刻の kills/deaths/score/obj を返す。最新の scoreboard イベントを優先し、
// 無ければ kill イベントの集計を使う。結果は 100ms 単位でキャッシュする。
let _statsCache = null;
export function computeDynamicStats(timeMs) {
    indexEvents();
    const bucket = Math.floor(timeMs / 100);
    if (_statsCache && _statsCache.bucket === bucket && _statsCache.src === Shared.playerInfo) {
        return _statsCache.value;
    }

    const dynamicStats = {};
    if (Array.isArray(Shared.playerInfo)) {
        Shared.playerInfo.forEach(p => {
            dynamicStats[String(p.id)] = { ...p, kills: 0, deaths: 0, score: 0, obj: 0 };
        });
    } else if (Shared.playerInfo && typeof Shared.playerInfo === 'object') {
        Object.entries(Shared.playerInfo).forEach(([id, info]) => {
            dynamicStats[id] = { id, pName: info.name || `Player ${id}`, team: info.team || 0, kills: 0, deaths: 0, score: 0, obj: 0 };
        });
    }

    // kill イベントから集計 (POINTモードでは deaths が scoreboard に無いため)
    const killEnd = upperBoundIndex(_kills, timeMs);
    for (let i = 0; i <= killEnd; i++) {
        const e = _kills[i];
        const k = dynamicStats[String(e.killer)];
        const v = dynamicStats[String(e.victim)];
        if (k) { k.kills++; k.score += e.headshot ? 100 : 50; }
        if (v) v.deaths++;
    }

    // 公式 scoreboard があれば上書き (開始前なら最初のものを使う)
    let isObjMode = false;
    let latest = null;
    if (_scoreboards.length > 0) {
        const idx = upperBoundIndex(_scoreboards, timeMs);
        latest = _scoreboards[Math.max(0, idx)];
        isObjMode = latest.isObjMode;
    }
    if (latest) {
        for (const sid in latest.scores) {
            const key = String(sid);
            if (!dynamicStats[key]) {
                dynamicStats[key] = { id: Number(sid), pName: `Player ${sid}`, team: 0, kills: 0, deaths: 0, score: 0, obj: 0 };
            }
            const pScore = latest.scores[sid];
            if (pScore.score !== undefined) dynamicStats[key].score = pScore.score;
            if (pScore.kills !== undefined) dynamicStats[key].kills = pScore.kills;
            if (pScore.deaths !== undefined) dynamicStats[key].deaths = pScore.deaths;
            if (pScore.obj !== undefined) dynamicStats[key].obj = pScore.obj;
        }
    }

    const value = { dynamicStats, isObjMode };
    _statsCache = { bucket, src: Shared.playerInfo, value };
    return value;
}

let _lastHudHtml = '';
let _lastCardClass = new Map();
export function updateDynamicHUD(currentFrame) {
    if (!currentFrame || !State.targetPlayerId) return;
    const p = currentFrame.players.find(x => x.id == State.targetPlayerId);
    if (!p) return;

    const className = p.classId === undefined || p.classId === null ? '' : (KRUNKER_CLASSES[p.classId] || `Class ${p.classId}`);
    const classHud = document.getElementById('class-hud');
    if (classHud && classHud.style.display !== 'none') {
        const pName = p.name || `Player ${p.id}`;
        const hp = p.health || 0;
        const maxHp = p.maxHealth || 100;
        const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
        let hpColor = '#00ff88';
        if (hpPercent < 30) hpColor = '#ff3333';
        else if (hpPercent < 60) hpColor = '#ffcc00';

        const { dynamicStats } = computeDynamicStats(State.time * 1000);
        const stats = dynamicStats[String(p.id)] || { kills: 0, deaths: 0, score: 0 };
        const kd = stats.deaths === 0 ? stats.kills : (stats.kills / stats.deaths).toFixed(2);

        const html = `
            <div>Spectating: <span style="color:#00ff88">${escapeHTML(pName)}</span></div>
            <div style="font-size:12px; opacity:0.8; margin-bottom:6px;">${escapeHTML(className)}</div>
            <div style="width:100%; height:8px; background:rgba(255,255,255,0.15); border-radius:4px; overflow:hidden; margin-bottom:6px;">
                <div style="height:100%; width:${hpPercent}%; background:${hpColor};"></div>
            </div>
            <div style="font-size:11px; opacity:0.9; margin-bottom:6px;">HP ${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}</div>
            <div style="display:flex; justify-content:center; gap:12px; font-size:12px; font-family:monospace;">
                <span>Score: <b>${stats.score}</b></span>
                <span>K: <b>${stats.kills}</b></span>
                <span>D: <b>${stats.deaths}</b></span>
                <span>K/D: <b>${kd}</b></span>
            </div>
        `;
        if (html !== _lastHudHtml) {
            classHud.innerHTML = html;
            _lastHudHtml = html;
        }
    }

    // プレイヤーリストのクラス表示 (変化したときだけ更新)
    if (className && _lastCardClass.get(p.id) !== className) {
        _lastCardClass.set(p.id, className);
        const pCard = document.querySelector(`.player-card[data-id="${p.id}"] .class-text`);
        if (pCard) pCard.innerText = className;
    }
}

const MINIMAP_SIZE = 200;
let _minimapCtx = null;

export function drawMinimap() {
    const canvas = document.getElementById('minimap');
    if (!canvas) return;
    if (!_minimapCtx || canvas.width !== MINIMAP_SIZE) {
        canvas.width = MINIMAP_SIZE;   // サイズ設定はキャンバスをリセットするので一度だけ行う
        canvas.height = MINIMAP_SIZE;
        _minimapCtx = canvas.getContext('2d');
    }
    const ctx = _minimapCtx;
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(10, 10, 180, 180);

    if (State.mode !== 'real' || !Shared.playBounds) return;

    // リプレイ全体の移動範囲で固定スケールにする (プレイヤーの増減で拡縮しない)
    const b = Shared.playBounds;
    const rangeX = Math.max(b.maxX - b.minX, 50);
    const rangeZ = Math.max(b.maxZ - b.minZ, 50);
    const scale = Math.min(160 / rangeX, 160 / rangeZ);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;

    for (const id in Shared.realMeshes) {
        const mesh = Shared.realMeshes[id];
        if (!mesh || mesh.visible === false) continue;
        const x = 100 + (mesh.position.x - cx) * scale;
        const y = 100 + (mesh.position.z - cz) * scale;
        const isTarget = Number(id) === State.targetPlayerId;
        const team = mesh.userData.team;

        ctx.fillStyle = team === 1 ? '#ff8800' : team === 2 ? '#00ccff' : '#4d6bff';
        ctx.beginPath();
        ctx.arc(x, y, isTarget ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (isTarget) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // 向き (メッシュ前方は -Z を yaw 回転した方向)
        const yaw = mesh.rotation.y;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.sin(yaw) * 9, y - Math.cos(yaw) * 9);
        ctx.stroke();
    }
}

const _tags = new Map(); // id -> { div, name, fill, text, team, hp }
const _tagPos = new THREE.Vector3();

export function resetNametags() {
    _tags.clear();
    const layer = document.getElementById('nametags-layer');
    if (layer) layer.innerHTML = '';
    _lastCardClass = new Map();
    _lastHudHtml = '';
}

function createTag(id, layer) {
    const div = document.createElement('div');
    div.className = 'nametag';
    div.style.cssText = 'background: transparent; color: white; padding: 0; border-radius: 0;';
    div.innerHTML = `<div class="nametag-name"></div><div class="nametag-hp-bar"><div class="nametag-hp-fill"></div></div>`;
    layer.appendChild(div);
    const tag = {
        div,
        name: div.querySelector('.nametag-name'),
        fill: div.querySelector('.nametag-hp-fill'),
        text: null, team: null, hp: null, shown: true, transform: ''
    };
    _tags.set(id, tag);
    return tag;
}

function hideTag(tag) {
    if (tag && tag.shown) { tag.div.style.display = 'none'; tag.shown = false; }
}

export function updateNametags(currentFrame) {
    const layer = document.getElementById('nametags-layer');
    if (!layer) return;

    if (State.mode !== 'real' || !currentFrame) {
        if (_tags.size) resetNametags();
        return;
    }

    for (const id in Shared.realMeshes) {
        const mesh = Shared.realMeshes[id];
        let tag = _tags.get(id);
        const pData = currentFrame.players.find(p => p.id == id);
        if (!pData || pData.health <= 0 || !mesh.visible || (State.cameraMode === '1st' && Number(id) === State.targetPlayerId)) {
            hideTag(tag);
            continue;
        }
        if (!tag) tag = createTag(id, layer);

        _tagPos.copy(mesh.position);
        _tagPos.y += 12;
        _tagPos.project(Shared.camera);
        if (_tagPos.z > 1) { hideTag(tag); continue; }

        if (!tag.shown) { tag.div.style.display = 'block'; tag.shown = true; }

        const text = pData.name || `Player ${id}`;
        if (text !== tag.text) { tag.name.innerText = text; tag.text = text; }
        if (pData.team !== tag.team) {
            tag.name.style.background = pData.team === 1 ? 'rgba(255, 136, 0, 0.85)'
                : pData.team === 2 ? 'rgba(0, 204, 255, 0.85)' : 'rgba(0,0,0,0.6)';
            tag.team = pData.team;
        }
        const maxHp = pData.maxHealth || 100;
        const hpPercent = Math.max(0, Math.min(100, ((pData.health || 0) / maxHp) * 100));
        const hpKey = Math.round(hpPercent);
        if (hpKey !== tag.hp) {
            tag.fill.style.width = hpKey + '%';
            tag.fill.style.background = hpPercent < 30 ? '#ff0000' : hpPercent < 60 ? '#ffff00' : '#00ff00';
            tag.hp = hpKey;
        }

        const x = Math.round((_tagPos.x * 0.5 + 0.5) * window.innerWidth);
        const y = Math.round((-(_tagPos.y * 0.5) + 0.5) * window.innerHeight);
        const transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
        if (transform !== tag.transform) { tag.div.style.transform = transform; tag.transform = transform; }
    }
}

let _lastKillLogKey = null;
export function updateKillLog() {
    const killLogContainer = document.getElementById('kill-log');
    if (!killLogContainer || !Shared.events || State.mode !== 'real') return;

    const recent = recentKills(State.time * 1000, 5000);
    const key = recent.map(k => `${k.timestamp}:${k.killer}:${k.victim}`).join('|') + `#${Shared.playerInfo ? Shared.playerInfo.length : 0}`;
    if (key === _lastKillLogKey) return;
    _lastKillLogKey = key;

    killLogContainer.innerHTML = '';
    recent.forEach(k => {
        const kP = playerById(k.killer);
        const vP = playerById(k.victim);
        const killerName = (kP && kP.pName) || 'Unknown';
        const victimName = (vP && vP.pName) || 'Unknown';
        const killerColor = TEAM_HEX[kP && kP.team] || '#ffffff';
        const victimColor = TEAM_HEX[vP && vP.team] || '#ffffff';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; padding:2px 5px; border-radius:3px; background:transparent; font-size:12px; font-family:monospace;';
        row.innerHTML = `
            <span style="color: ${killerColor}; font-weight: bold;">${escapeHTML(killerName)}</span>
            <span style="margin: 0 8px; font-size: 10px; color: #fff;">${k.headshot ? '💀' : '🔫'}</span>
            <span style="color: ${victimColor}; font-weight: bold;">${escapeHTML(victimName)}</span>
        `;
        killLogContainer.appendChild(row);
    });
}

let _lastScoreboardHtml = '';
export function updateScoreboard() {
    let sb = document.getElementById('scoreboard');
    if (!sb) {
        sb = document.createElement('div');
        sb.id = 'scoreboard';
        document.body.appendChild(sb);
    }

    if (!(State.showScoreboard && Shared.playerInfo)) {
        sb.classList.remove('show');
        return;
    }
    sb.classList.add('show');

    const { dynamicStats, isObjMode } = computeDynamicStats(State.time * 1000);
    const players = Object.values(dynamicStats).sort((a, b) => b.score - a.score);

    let html = '<h2 style="text-align:center; margin-top:0; color:#fff;">SCOREBOARD</h2>';
    html += '<table style="width:100%; border-collapse: collapse; text-align: left;">';
    html += '<tr style="border-bottom: 2px solid rgba(255,255,255,0.2);">';
    html += '<th style="padding: 8px;">Name</th><th style="padding: 8px;">Score</th><th style="padding: 8px;">Kills</th><th style="padding: 8px;">Deaths</th>';
    if (isObjMode) html += '<th style="padding: 8px;">OBJ</th>';
    html += '<th style="padding: 8px;">K/D</th></tr>';

    players.forEach(p => {
        const color = TEAM_HEX[p.team] || '#fff';
        const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
        html += '<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">';
        html += `<td style="padding: 8px; color: ${color}; font-weight: bold;">${escapeHTML(p.pName)}</td>`;
        html += `<td style="padding: 8px;">${p.score}</td><td style="padding: 8px;">${p.kills}</td><td style="padding: 8px;">${p.deaths}</td>`;
        if (isObjMode) html += `<td style="padding: 8px;">${p.obj}</td>`;
        html += `<td style="padding: 8px; color: #aaa;">${kd}</td></tr>`;
    });
    html += '</table>';

    if (html !== _lastScoreboardHtml) {
        sb.innerHTML = html;
        _lastScoreboardHtml = html;
    }
}

let _hm = null, _ch = null;
export function drawHitmarkers() {
    if (!_hm) {
        _hm = document.createElement('div');
        _hm.id = 'hitmarker';
        _hm.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 20px; height: 20px; background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cline x1=\'4\' y1=\'4\' x2=\'20\' y2=\'20\'/%3E%3Cline x1=\'20\' y1=\'4\' x2=\'4\' y2=\'20\'/%3E%3C/svg%3E"); opacity: 0; transition: opacity 0.1s ease-out; pointer-events: none; z-index: 100;';
        document.body.appendChild(_hm);
        _ch = document.createElement('div');
        _ch.id = 'crosshair';
        _ch.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 6px; height: 6px; background: rgba(255,255,255,0.8); border-radius: 50%; display: none; pointer-events: none; z-index: 99;';
        document.body.appendChild(_ch);
    }

    const following = State.mode === 'real' && (State.cameraMode === '1st' || State.cameraMode === '3rd');
    _ch.style.display = following ? 'block' : 'none';

    let hit = null;
    if (following) {
        hit = recentKills(State.time * 1000, 300).filter(e => e.killer == State.targetPlayerId);
    }
    if (hit && hit.length > 0) {
        _hm.style.opacity = '1';
        _hm.style.filter = hit.some(e => e.headshot) ? 'drop-shadow(0 0 4px red)' : 'none';
    } else {
        _hm.style.opacity = '0';
    }
}

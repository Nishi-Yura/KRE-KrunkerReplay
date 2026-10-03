import { State, Shared, base64ToUint8Array } from './State.js';
import { showToast } from './UI.js';
import { setupRealPlayers } from './Renderer_Players.js';
import { parseMapData } from './Parser_Map.js';
import { decodeMulti } from '@msgpack/msgpack';

// 0-packet (プレイヤー情報) は Krunker のアップデートで1人分の長さが変わる (51 → 53 など)。
// 「[accountId(string), id(number), x, y, z, name(string), ...]」の並びが全員分きれいに揃う長さを選ぶ
function isPlaceholderName(name) {
    return name.startsWith('Guest_') || name.startsWith('Player ');
}

function detectMetaStride(pArr) {
    const candidates = [53, 51, 52, 54, 50, 55, 56, 49, 48];
    for (const s of candidates) {
        if (pArr.length === 0 || pArr.length % s !== 0) continue;
        let ok = true;
        for (let i = 0; i < pArr.length; i += s) {
            if (typeof pArr[i + 1] !== 'number' || typeof pArr[i + 5] !== 'string') { ok = false; break; }
        }
        if (ok) return s;
    }
    // 長さが割り切れない場合は、最初の2人分の位置から推定する
    for (let s = 40; s <= 70; s++) {
        if (typeof pArr[s + 1] === 'number' && typeof pArr[s] === 'string' && typeof pArr[s + 5] === 'string') return s;
    }
    return pArr.length || 53;
}

// 文字列(JSON)またはパース済み配列を受け取る。巨大ファイルの二重パースを避けるため
export function parseJSONLog(input) {
    let data = [];
    if (typeof input === 'string') {
        try {
            data = JSON.parse(input);
        } catch (e) {
            showToast('JSONのパースに失敗しました');
            return false;
        }
    } else {
        data = input;
    }

    if (!Array.isArray(data) || !data.length) return false;

    if (data[0] && data[0].version) {
        Shared.replayHeader = data.shift();
    }

    Shared.realFrames = [];
    Shared.events = [];
    Shared.seenProjectileIds = new Set();
    const playersMap = {};
    let maxTime = 0;
    let minTime = Infinity;

    // First pass: collect all timestamps to find minTime
    data.forEach(ev => {
        const t = ev[0];
        if (typeof t === 'number') {
            if (t > maxTime) maxTime = t;
            if (t < minTime) minTime = t;
        }
    });

    // Track which IDs have received 'k' packets (real position data)
    const hasKPacket = {};
    // Track last frame push time to avoid duplicate frames
    let lastFrameTime = -1;

    const clonePlayer = (p) => ({
        id: p.id, name: p.name, team: p.team,
        pos: [p.pos[0], p.pos[1], p.pos[2]],
        rot: [p.rot[0], p.rot[1]],
        health: p.health, maxHealth: p.maxHealth,
        hasSpawned: p.hasSpawned, shoot: p.shoot, aim: p.aim,
        isValid: p.isValid, classId: p.classId
    });

    const pushFrame = (t) => {
        const ts = t - minTime;
        if (ts === lastFrameTime) return; // Skip duplicate timestamps
        lastFrameTime = ts;
        const currentFramePlayers = Object.values(playersMap)
            .filter(p => p.hasSpawned)
            .map(p => clonePlayer(p));
        Shared.realFrames.push({ timestamp: ts, players: currentFramePlayers });
    };

    const processPayload = (t, payload, ev) => {
        if (!Array.isArray(payload)) return;

        const op = payload[0];

        if (op === 'kre_map_data' && payload[1]) {
            parseMapData(payload[1]);
        }
        // ===== 0-packet: Player metadata (name, team, etc.) =====
        // Structure: [accountId, playerId, posX, posY, posZ, name, level, hp, maxHp, team, ...]
        // Stride = 51 (confirmed from data analysis)
        else if (op === '0' && payload[1]) {
            const pArr = payload[1];
            if (!Array.isArray(pArr)) return;
            const stride = detectMetaStride(pArr);
            for (let i = 0; i + 9 <= pArr.length; i += stride) {
                const sid = pArr[i + 1];
                if (typeof sid !== 'number') continue;
                if (!playersMap[sid]) {
                    playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, maxHealth: 100, hasSpawned: false, shoot: false, aim: false, isValid: false };
                }
                const p = playersMap[sid];
                if (typeof pArr[i + 5] === 'string' && pArr[i + 5]) {
                    p.name = pArr[i + 5];
                    p.isValid = true; // 実名があるので有効なプレイヤー
                }
                if (typeof pArr[i + 6] === 'number') {
                    p.classId = pArr[i + 6];
                    p.isValid = true;
                }
                if (typeof pArr[i + 7] === 'number' && pArr[i + 7] > 0) p.maxHealth = pArr[i + 7];
                if (typeof pArr[i + 8] === 'number') p.health = pArr[i + 8];
                if (pArr[i + 9] === 1 || pArr[i + 9] === 2) p.team = pArr[i + 9];
            }
        }
        // ===== k-packet: Player position/state updates =====
        else if (op === 'k' && payload[1]) {
            const pArr = payload[1];
            // Auto-detect stride
            let stride = 13;
            for (const s of [14, 13, 15, 12, 11, 10, 16]) {
                if (pArr.length > 0 && pArr.length % s === 0) {
                    let valid = true;
                    for (let i = 0; i < pArr.length; i += s) {
                        if (typeof pArr[i] !== 'number' && typeof pArr[i] !== 'string') valid = false;
                        if (typeof pArr[i + 1] !== 'number') valid = false;
                        if (typeof pArr[i + 2] !== 'number') valid = false;
                    }
                    if (valid) {
                        stride = s;
                        break;
                    }
                }
            }
            for (let i = 0; i < pArr.length; i += stride) {
                const sid = pArr[i];
                if (sid === undefined) continue;
                hasKPacket[sid] = true;

                if (!playersMap[sid]) {
                    playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: false, maxHealth: 100, shoot: false, aim: false, isValid: false };
                }
                playersMap[sid].hasSpawned = true;
                playersMap[sid].pos = [pArr[i + 1], pArr[i + 2], pArr[i + 3]];
                const yaw = pArr[i + 4] * Math.PI / 180;
                const pitch = pArr[i + 5] * Math.PI / 180;
                playersMap[sid].rot = [yaw, pitch];

                // i+7 = shoot flag (0/1), i+8 = aim/scope flag (0/1)
                playersMap[sid].shoot = !!pArr[i + 7];
                playersMap[sid].aim = !!pArr[i + 8];
                // i+12 = HP (range ~19-102)
                if (stride >= 13 && pArr[i + 12] !== undefined) {
                    playersMap[sid].health = pArr[i + 12];
                }
            }
            pushFrame(t);
        }
        // ===== ai-packet: AI/other player positions =====
        else if (op === 'ai' && payload.length > 1) {
            const pArr = Array.isArray(payload[1]) ? payload[1] : payload.slice(1);
            for (let i = 0; i < pArr.length; i += 9) {
                const sid = pArr[i];
                if (sid === undefined) continue;
                // Skip players that already have k-packet data (higher quality)
                if (hasKPacket[sid]) continue;

                if (!playersMap[sid]) {
                    playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, health: 100, pos: [0, 0, 0], rot: [0, 0], hasSpawned: false, maxHealth: 100, shoot: false, aim: false };
                }
                // AI players should be spawned and visible
                playersMap[sid].hasSpawned = true;
                playersMap[sid].pos = [pArr[i + 1], pArr[i + 2], pArr[i + 3]];
                const yaw = pArr[i + 4] * Math.PI / 180;
                const pitch = pArr[i + 5] * Math.PI / 180;
                playersMap[sid].rot = [yaw, pitch];
            }
            // Always push frame for ai updates (override lastFrameTime dedup)
            lastFrameTime = -1; // Reset to force push
            pushFrame(t);
        }
        // ===== h-packet: Health update =====
        else if (op === 'h') {
            const hp = payload[1];
            let sid = payload[2];
            if (typeof hp !== 'number') return;

            if (sid === null || sid === undefined) sid = 0;

            if (!playersMap[sid]) {
                playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: false, maxHealth: 100, shoot: false, aim: false };
            }
            playersMap[sid].health = hp;
            if (hp > 0) {
                playersMap[sid].maxHealth = Math.max(playersMap[sid].maxHealth || 100, hp);
            }
            // Push frame only if player is spawned (avoid phantom frames)
            if (playersMap[sid].hasSpawned) pushFrame(t);
        }
        // ===== 3-packet: Kill event =====
        else if (op === '3' && payload.length >= 4) {
            const killer = payload[1];
            const victim = payload[3];
            // payload[5] may contain { hs: true/false } for headshot info
            const meta = (payload.length >= 6 && payload[5] && typeof payload[5] === 'object') ? payload[5] : {};
            const headshot = !!meta.hs;

            Shared.events.push({
                timestamp: t, // Keep original t, normalized at end of parser
                type: 'kill',
                victim: victim,
                killer: killer,
                headshot: headshot
            });

            // Set victim health to 0
            if (playersMap[victim]) {
                playersMap[victim].health = 0;
            }
            pushFrame(t);
        }
        // ===== 5-packet: Score/Respawn notification =====
        else if (op === '5') {
            // This indicates local player scored / respawned
            // payload: ['5', score, ?, ?, team]
        }
        // ===== 7-packet: Scoreboard update =====
        else if (op === '7' && Array.isArray(payload[1])) {
            const pArr = payload[1];
            const scores = {};
            let isObjMode = false;
            // Check heuristic for POINT mode (Hardpoint)
            for (let i = 0; i < pArr.length; i += 4) {
                if (pArr[i + 2] * 50 > pArr[i + 1]) {
                    isObjMode = true;
                    break;
                }
            }
            for (let i = 0; i < pArr.length; i += 4) {
                const sid = pArr[i];
                if (isObjMode) {
                    scores[sid] = {
                        score: pArr[i + 2],
                        obj: pArr[i + 1],
                        kills: pArr[i + 3]
                        // deaths is intentionally omitted for obj mode
                    };
                } else {
                    scores[sid] = {
                        score: pArr[i + 1],
                        kills: pArr[i + 2],
                        deaths: pArr[i + 3],
                        obj: 0
                    };
                }
            }

            Shared.events.push({
                timestamp: t,
                type: 'scoreboard',
                scores: scores,
                isObjMode: isObjMode
            });
        }
        // ===== crsp-packet: Respawn with position =====
        else if (op === 'crsp') {
            // crsp: ['crsp', ?, respawnId, posX, posY, posZ, team, ?]
            // 自分自身のリスポーンなので、復活扱いにするのはローカルプレイヤー(id 0)だけ。
            // 他プレイヤーのHPは k-packet が随時更新するため、ここで一括復活させない
            const local = playersMap[0];
            if (local && local.health <= 0) local.health = local.maxHealth || 100;
        }
        // ===== l-packet: Projectile data =====
        else if (op === 'l' && payload[1] && Array.isArray(payload[1])) {
            const pArr = payload[1];
            if (pArr.length >= 26) {
                const projs = [];
                // 1発あたりの長さは 26 (旧) / 27 (現行) のうち、割り切れる方を使う
                const stride = pArr.length % 27 === 0 ? 27 : 26;
                for (let i = 0; i + stride - 1 < pArr.length; i += stride) {
                    projs.push({
                        id: pArr[i],
                        ownerId: pArr[i + 1],
                        pos: [pArr[i + 2], pArr[i + 3], pArr[i + 4]]
                    });
                }
                const currentFramePlayers = Object.values(playersMap)
                    .filter(p => p.hasSpawned)
                    .map(p => clonePlayer(p));
                Shared.realFrames.push({ timestamp: t - minTime, players: currentFramePlayers, projectiles: projs });
            }
        }
        else if (op === 'l_parsed' && payload.length > 1) {
            const projs = payload[1];
            const currentFramePlayers = Object.values(playersMap)
                .filter(p => p.hasSpawned)
                .map(p => clonePlayer(p));
            Shared.realFrames.push({ timestamp: t - minTime, players: currentFramePlayers, projectiles: projs });
        }
        else if (op === 'kre_local') {
            if (!playersMap[0]) playersMap[0] = { id: 0, name: 'Local Player', team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: true, maxHealth: 100, shoot: false, aim: false, isValid: true };
            playersMap[0].hasSpawned = true;
            playersMap[0].pos = [payload[1], payload[2], payload[3]];
            // kre_local stores raw values from lp.targetDir/lp.pitch which are in radians already
            // but older recordings may store degrees — normalise to radians if value looks like degrees
            const rawYaw = payload[4] || 0;
            const rawPitch = payload[5] || 0;
            const yawRad = Math.abs(rawYaw) > Math.PI * 2 ? rawYaw * Math.PI / 180 : rawYaw;
            const pitchRad = Math.abs(rawPitch) > Math.PI * 2 ? rawPitch * Math.PI / 180 : rawPitch;
            playersMap[0].rot = [yawRad, pitchRad];
            playersMap[0].health = payload[6];
            playersMap[0].maxHealth = Math.max(playersMap[0].maxHealth || 100, payload[6]);
            pushFrame(t);
        }
        else if (op === 'd') {
            const sid = payload[1];
            if (playersMap[sid]) {
                playersMap[sid].health = 0;
            }
        }
    };

    data.forEach(ev => {
        const t = ev[0];
        let payload = ev[1];
        if (!payload) return;

        if (typeof payload === 'string') {
            try {
                const bytes = base64ToUint8Array(payload);
                const iter = decodeMulti(bytes);
                for (const p of iter) {
                    processPayload(t, p, ev);
                }
            } catch (e) { }
        } else {
            processPayload(t, payload, ev);
        }
    });

    if (Shared.realFrames.length > 0) {
        // BACKFILL: propagate best-known name and team to ALL frames
        const finalInfo = {};
        // First pass: collect from playersMap (has 0-packet info)
        Object.values(playersMap).forEach(p => {
            const key = String(p.id);
            if (!finalInfo[key]) finalInfo[key] = { name: null, team: null, classId: null, maxHealth: null };
            if (typeof p.name === 'string' && p.name) {
                // Prefer real names over Guest_ names
                if (!isPlaceholderName(p.name)) {
                    finalInfo[key].name = p.name;
                } else if (!finalInfo[key].name) {
                    finalInfo[key].name = p.name; // Keep Guest_ as fallback
                }
            }
            if (p.team) finalInfo[key].team = p.team;
            if (p.classId !== undefined) finalInfo[key].classId = p.classId;
            if (p.maxHealth !== undefined) finalInfo[key].maxHealth = p.maxHealth;
        });
        // Second pass: collect from frames (may have better info)
        Shared.realFrames.forEach(f => {
            f.players.forEach(p => {
                const key = String(p.id);
                if (!finalInfo[key]) finalInfo[key] = { name: null, team: null, classId: null, maxHealth: null };
                if (typeof p.name === 'string' && p.name) {
                    if (!isPlaceholderName(p.name)) {
                        finalInfo[key].name = p.name;
                    } else if (!finalInfo[key].name) {
                        finalInfo[key].name = p.name;
                    }
                }
                if (p.team) finalInfo[key].team = p.team;
                if (p.classId !== undefined && finalInfo[key].classId === null) finalInfo[key].classId = p.classId;
                if (p.maxHealth !== undefined && finalInfo[key].maxHealth === null) finalInfo[key].maxHealth = p.maxHealth;
            });
        });
        // Apply backfill to all frames and filter out players who were never valid (never received a 0-packet)
        Shared.realFrames.forEach(f => {
            f.players = f.players.filter(p => {
                const info = finalInfo[String(p.id)];
                const isLocal = (p.id === 0);
                const isValid = isLocal || (playersMap[p.id] && playersMap[p.id].isValid);
                return isValid;
            });

            f.players.forEach(p => {
                const key = String(p.id);
                const info = finalInfo[key];
                if (info) {
                    if (info.name) p.name = info.name;
                    if (info.team) p.team = info.team;
                    if (info.classId !== null && p.classId === undefined) p.classId = info.classId;
                    if (info.maxHealth !== null) p.maxHealth = info.maxHealth;
                }
            });
        });
        // Convert finalInfo map → array so setupRealPlayers and updateScoreboard share the same shape
        Shared.playerInfo = Object.entries(finalInfo).map(([id, info]) => ({
            id: Number(id),
            pName: info.name || `Player ${id}`,
            team: info.team || 0,
            kills: 0, deaths: 0, score: 0
        }));

        // Sort frames by timestamp
        Shared.realFrames.sort((a, b) => a.timestamp - b.timestamp);

        if (Shared.events) {
            Shared.events.forEach(e => e.timestamp -= minTime);
            Shared.events.sort((a, b) => a.timestamp - b.timestamp);
        }

        State.duration = (maxTime - minTime) / 1000;
        State.time = 0;
        State.mode = 'real';
        setupRealPlayers();
        showToast(`ロード完了: ${Shared.realFrames.length} フレーム / ${Object.keys(playersMap).length} プレイヤー`, 'success');
        const landingModal = document.getElementById('landing-modal');
        if (landingModal) landingModal.classList.remove('active');
        return true;
    } else {
        showToast('エラー: 座標データ(k)が見つかりません');
        return false;
    }
}
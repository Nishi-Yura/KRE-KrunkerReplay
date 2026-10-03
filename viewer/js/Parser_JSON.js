import { State, Shared, base64ToUint8Array } from './State.js';
import { showToast } from './UI.js';
import { setupRealPlayers } from './Renderer_Players.js';
import { buildEstimatedMap } from './Renderer_Estimated.js';
import { parseMapData } from './Parser_Map.js';
import { decodeMulti } from '@msgpack/msgpack';

// 0-packet (プレイヤー情報) は Krunker のアップデートで1人分の長さが変わる (51 → 53 など)。
// 「[accountId(string), id(number), x, y, z, name(string), ...]」の並びが全員分きれいに揃う長さを選ぶ
function isPlaceholderName(name) {
    return name.startsWith('Guest_') || name.startsWith('Player ');
}

// 0-packet の1人分は版や状態で長さが変わる (51 / 52 / 53 ...) うえ、同一パケット内でも混在する。
// 固定ストライドは使わず、「[accountId(str), id(int), x, y, z, name(str), classId, maxHp, hp, team]」の
// 並びに一致する位置を先頭から探して1人分とみなす
const META_MIN_LEN = 40;
function isMetaStart(a, i) {
    return typeof a[i] === 'string' && Number.isInteger(a[i + 1]) && a[i + 1] >= 0 &&
        typeof a[i + 2] === 'number' && typeof a[i + 3] === 'number' && typeof a[i + 4] === 'number' &&
        typeof a[i + 5] === 'string' &&
        typeof a[i + 6] === 'number' && typeof a[i + 7] === 'number' && typeof a[i + 8] === 'number';
}

function findMetaStarts(pArr) {
    const starts = [];
    for (let i = 0; i + 9 <= pArr.length; i++) {
        if (isMetaStart(pArr, i)) {
            starts.push(i);
            i += META_MIN_LEN - 1;
        }
    }
    return starts;
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
    // マップが取れない録画向けに、通信から拾えるマップの手がかりを集める (推定マップ用)
    const hints = { impacts: [], flags: [], spawns: [] };
    Shared.mapHints = hints;
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

    // 自分の軌跡の復元用 (l: 位置+速度, q: 視線)
    const localSamples = [];
    const localLook = [];
    let localName = null;
    let localId = null;

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
            for (const i of findMetaStarts(pArr)) {
                const sid = pArr[i + 1];
                if (typeof sid !== 'number') continue;
                if (!playersMap[sid]) {
                    playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, maxHealth: 100, hasSpawned: false, shoot: false, aim: false, isValid: false };
                }
                const p = playersMap[sid];
                if (typeof pArr[i + 2] === 'number' && typeof pArr[i + 4] === 'number' && (pArr[i + 2] || pArr[i + 3] || pArr[i + 4])) {
                    hints.spawns.push([pArr[i + 2], pArr[i + 3], pArr[i + 4]]);
                }
                if (typeof pArr[i + 5] === 'string' && pArr[i + 5]) {
                    p.name = pArr[i + 5];
                    if (localName && p.name === localName) localId = sid;
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
        // ===== 9-packet: 命中 [shooter, hitX, hitY, hitZ, ?, ?, ?, shooterX, shooterY, ?, shooterZ, ...] =====
        // 着弾点は壁・床・段差の表面上にあるので、マップ推定の点群に使う
        else if (op === '9' && !ev[2] && Array.isArray(payload[1]) && payload[1].length >= 4) {
            const a = payload[1];
            if ([1, 2, 3].every(k => typeof a[k] === 'number')) hints.impacts.push([a[1], a[2], a[3]]);
        }
        // ===== pre-packet: 弾の着弾 [?, ?, x, y, z, ?] =====
        else if (op === 'pre' && [2, 3, 4].every(k => typeof payload[k] === 'number')) {
            hints.impacts.push([payload[2], payload[3], payload[4]]);
        }
        // ===== init: 旗などの目標物の位置 =====
        else if (op === 'init') {
            for (const part of payload) {
                if (part && typeof part === 'object' && !Array.isArray(part) && Array.isArray(part.flg)) {
                    for (const f of part.flg) {
                        if (Array.isArray(f) && [1, 2, 3].every(k => typeof f[k] === 'number')) hints.flags.push([f[1], f[2], f[3]]);
                    }
                }
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
        // ===== ai-packet: ボット/ターゲット (aai で追加される別エンティティ) =====
        // ID はプレイヤーIDと別名前空間で衝突する (ai の id 0〜8 と k の id 1〜7 が重なる) ため、
        // プレイヤーとしては扱わない。混ぜると灰色の幽霊 Guest や位置の上書きが起きる
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
            // 現行プロトコル: ['3', victim, 連続キル数, killer, ...]
            // (scoreboard の kills 増加・ts のチーム得点・h の HP=0 と突き合わせて確認済み)
            const victim = payload[1];
            const killer = payload[3];
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
        // ===== l-packet: 自分自身の状態 (約1Hz) =====
        // [seq, ping, x, y, z, vy, vx, vz, yaw, ...] 速度は units/ms。k-packet には自分が含まれないので、
        // これと q-packet (自分の入力) から自分の軌跡を復元する。弾の情報ではない
        else if (op === 'l' && !ev[2] && Array.isArray(payload[1]) && payload[1].length >= 26) {
            const a = payload[1];
            if ([2, 3, 4, 5, 6, 7].every(k => typeof a[k] === 'number')) {
                localSamples.push({ t, x: a[2], y: a[3], z: a[4], vy: a[5], vx: a[6], vz: a[7], yaw: a[8] });
            }
        }
        // ===== q-packet (クライアント→サーバー): 入力。[pitch*1000, yaw*1000, ...] =====
        else if (op === 'q' && ev[2] && Array.isArray(payload[5]) && payload[5].length >= 2 &&
                 typeof payload[5][0] === 'number' && typeof payload[5][1] === 'number') {
            localLook.push({ t, pitch: payload[5][0] / 1000, yaw: payload[5][1] / 1000 });
        }
        else if (op === 'sb' && payload[1] === 'welc' && typeof payload[2] === 'string') {
            localName = payload[2];
        }
        else if (op === 'a' && typeof payload[3] === 'string' && !localName) {
            localName = payload[3];
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

    // 自分 (k-packet に出てこない) を l/q から補間して全フレームに足す
    if (localId !== null && localSamples.length && playersMap[localId] && Shared.realFrames.length) {
        const me = playersMap[localId];
        me.isValid = true;
        const samples = localSamples;
        const looks = localLook;
        const kills = (Shared.events || []).filter(e => e.type === 'kill' && e.victim === localId).map(e => e.timestamp);
        // 死亡区間: リスポーン時刻のパケットが無いので、死亡から3秒を目安にする
        const deadRanges = kills.map(tk => [tk, tk + 3000]);
        let si = 0, li = 0;
        const hermite = (p0, p1, m0, m1, u) => {
            const u2 = u * u, u3 = u2 * u;
            return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
        };
        Shared.realFrames.forEach(f => {
            const t = f.timestamp + minTime;
            while (si + 1 < samples.length && samples[si + 1].t <= t) si++;
            const s0 = samples[si], s1 = samples[si + 1];
            let pos;
            if (s1 && t >= s0.t && s1.t - s0.t <= 1500) {
                const dt = s1.t - s0.t, u = (t - s0.t) / dt;
                pos = [hermite(s0.x, s1.x, s0.vx * dt, s1.vx * dt, u),
                       hermite(s0.y, s1.y, s0.vy * dt, s1.vy * dt, u),
                       hermite(s0.z, s1.z, s0.vz * dt, s1.vz * dt, u)];
            } else {
                pos = [s0.x, s0.y, s0.z];
            }
            while (li + 1 < looks.length && looks[li + 1].t <= t) li++;
            const look = looks[li];
            const dead = deadRanges.some(r => t >= r[0] && t < r[1]);
            f.players.push({
                id: localId, name: me.name, team: me.team,
                pos, rot: [look ? look.yaw : s0.yaw, look ? look.pitch : 0],
                health: dead ? 0 : (me.maxHealth || 100), maxHealth: me.maxHealth || 100,
                hasSpawned: true, shoot: false, aim: false, isValid: true, classId: me.classId
            });
        });
    }

    if (Shared.realFrames.length > 0) {
        // BACKFILL: propagate best-known name and team to ALL frames
        const finalInfo = {};
        // First pass: collect from playersMap (has 0-packet info)
        Object.values(playersMap).forEach(p => {
            if (!p.isValid) return;
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
        buildEstimatedMap();
        showToast(`ロード完了: ${Shared.realFrames.length} フレーム / ${Object.keys(playersMap).length} プレイヤー`, 'success');
        const landingModal = document.getElementById('landing-modal');
        if (landingModal) landingModal.classList.remove('active');
        return true;
    } else {
        showToast('エラー: 座標データ(k)が見つかりません');
        return false;
    }
}
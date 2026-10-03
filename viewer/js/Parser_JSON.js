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

// 0-packet の1人分は版や状態で長さが変わる (51 / 52 / 53 ...) うえ、同一パケット内でも混在する。
// 固定ストライドは使わず、「[accountId(str), id(int), x, y, z, name(str), classId, maxHp, hp, team]」の
// 並びに一致する位置を先頭から探して1人分とみなす
const META_MIN_LEN = 40;
const SPAWN_PENDING_MS = 500;   // 0-packet の後、スポーン地点の k が届くまで待つ最大時間
const LOCAL_GAP_MS = 1500;      // 自分の l-packet がこれ以上途切れたら試合外とみなす
const LOCAL_HOLD_MS = 400;      // 途切れてから消すまでの猶予
const SPAWN_NEAR = 1.5;         // スポーン地点から動いていないとみなす距離
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

// k-packet の末尾 [tickMs=10, serverTimeMs] はサーバー時刻で 100ms ごとに揃っている。
// 一方、録画の時刻は「届いた時刻」で、k-packet は数発まとまって届いたり数百ms空いたりする
// (最大で約650msのずれ)。そのままだと動きがカクつくので、サーバー時刻から滑らかな時間軸を作る。
function kServerTime(p) {
    return Array.isArray(p) && p[0] === 'k' && typeof p[3] === 'number' && p[3] > 0 ? p[3] : null;
}

// 全パケットを展開し、再生用の時刻 t を付けて返す: [{ ev, p, t }]
//  - k: サーバー時刻を「届いた時刻 - 最小遅延」の直線に載せる (区間ごとに回帰した傾き + 下側包絡のオフセット)
//  - 他の受信パケット: 直前に届いた k の時刻 + 経過 (100ms未満)。TCP は順序を保つので、
//    k より後に届いたものはその tick 以降に起きたことになる
//  - 送信パケット (q など): クライアントの時刻のまま
function buildTimeline(data) {
    const items = [];
    data.forEach(ev => {
        const wall = ev[0];
        const raw = ev[1];
        if (!raw || typeof wall !== 'number') return;
        if (typeof raw === 'string') {
            try {
                for (const p of decodeMulti(base64ToUint8Array(raw))) items.push({ ev, p, wall, out: !!ev[2], t: wall });
            } catch (e) { /* 壊れたパケットは捨てる */ }
        } else {
            items.push({ ev, p: raw, wall, out: !!ev[2], t: wall });
        }
    });

    // k-packet をサーバー時刻が単調に増える区間に分け、区間ごとに wall = a * srv + b を求める
    const segs = [];
    let cur = null, prevSrv = null;
    items.forEach(it => {
        if (it.out) return;
        const srv = kServerTime(it.p);
        if (srv === null) return;
        if (!cur || srv < prevSrv - 500 || srv - prevSrv > 30000) { cur = { pts: [] }; segs.push(cur); }
        cur.pts.push(it);
        it.srv = srv;
        it.seg = cur;
        prevSrv = srv;
    });
    segs.forEach(seg => {
        const n = seg.pts.length;
        let a = 1;
        if (n >= 10) {
            let sx = 0, sy = 0, sxx = 0, sxy = 0;
            seg.pts.forEach(it => { sx += it.srv; sy += it.wall; sxx += it.srv * it.srv; sxy += it.srv * it.wall; });
            const den = n * sxx - sx * sx;
            if (den > 0) a = Math.min(1.01, Math.max(0.99, (n * sxy - sx * sy) / den));
        }
        let b = Infinity;
        seg.pts.forEach(it => { b = Math.min(b, it.wall - a * it.srv); });
        seg.a = a;
        seg.b = b;
    });

    let lastK = null;
    items.forEach(it => {
        if (it.out) return;
        if (it.seg) {
            it.t = it.seg.a * it.srv + it.seg.b;
            lastK = it;
        } else if (lastK) {
            it.t = lastK.t + Math.min(99, Math.max(0, it.wall - lastK.wall));
        }
    });
    return items;
}

const EYE_HEIGHT = 11;        // 立ち時の目の高さ (9-packet の値と同じ)

function wrapPi(a) {
    while (a < -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
}

// q-packet から自分の視線をフレーム単位で取り出す
function pushLocalLook(out, sendT, p) {
    const v = p[5];
    if (!Array.isArray(v) || v.length < 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number') return;
    let dts = null;
    if (typeof p[3] === 'string' && (p[4] === 1 || p[4] === 2)) {
        dts = [];
        for (let i = 0; i + p[4] <= p[3].length; i += p[4]) dts.push(Number(p[3].slice(i, i + p[4])));
    } else if (Array.isArray(p[3])) {
        dts = p[3];
    }
    const frames = [[v[0], v[1]]];
    for (let i = 2; i + 1 < v.length; i += 2) {
        if (typeof v[i] !== 'number' || typeof v[i + 1] !== 'number') break;
        const prev = frames[frames.length - 1];
        frames.push([prev[0] + v[i], prev[1] + v[i + 1]]);
    }
    // フレームの時刻: 最後のフレームが送信時刻、それより前は所要時間を遡る
    const n = frames.length;
    const ok = dts && dts.length === n && dts.every(d => Number.isFinite(d));
    let tt = sendT;
    const times = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        times[i] = tt;
        tt -= ok ? dts[i] : 7;
    }
    for (let i = 0; i < n; i++) out.push({ t: times[i], pitch: frames[i][0] / 1000, yaw: frames[i][1] / 1000 });
}

// 視線を時刻 t で補間する (yaw は ±π の折り返しを考慮)
function interpLook(looks, li, t) {
    const a = looks[li];
    if (!a) return null;
    const b = looks[li + 1];
    if (!b || t <= a.t || b.t - a.t > 200) return a;
    const u = Math.min(1, (t - a.t) / (b.t - a.t));
    return { yaw: a.yaw + wrapPi(b.yaw - a.yaw) * u, pitch: a.pitch + (b.pitch - a.pitch) * u };
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

    const timeline = buildTimeline(data);
    timeline.forEach(it => {
        if (it.t > maxTime) maxTime = it.t;
        if (it.t < minTime) minTime = it.t;
    });

    // 自分の軌跡の復元用 (l: 位置+速度, q: 視線)
    const localSamples = [];
    const localLook = [];
    const localHealth = []; // [{ t, hp }] h-packet (sid なし) / キル / リスポーン
    let localName = null;
    Shared.shots = [];      // 発砲 (着弾) イベント: { timestamp, shooter, from, to }
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
        hasSpawned: p.hasSpawned, grounded: p.grounded, sliding: p.sliding, ping: p.ping,
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
                    playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, maxHealth: 100, hasSpawned: false, isValid: false };
                }
                const p = playersMap[sid];
                // 0-packet は (再)スポーンの通知で、スポーン地点が入っている。
                // プレイヤーが実際に動き出すまでは k-packet がスポーン地点で止まった位置を送り続けるため、
                // その間は「まだ入っていない」扱いにして固まって見えないようにする
                if ([2, 3, 4].every(k => typeof pArr[i + k] === 'number')) {
                    p.awaiting = { pos: [pArr[i + 2], pArr[i + 3], pArr[i + 4]], pendingUntil: t + SPAWN_PENDING_MS, seen: false };
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
                if (typeof pArr[i + 8] === 'number') {
                    p.health = pArr[i + 8];
                    if (sid === localId) localHealth.push({ t, hp: pArr[i + 8] });
                }
                if (pArr[i + 9] === 1 || pArr[i + 9] === 2) p.team = pArr[i + 9];
            }
        }
        // ===== k-packet: Player position/state updates =====
        else if (op === 'k' && payload[1]) {
            const pArr = payload[1];
            // Auto-detect stride
            let stride = 13;
            for (const s of [13, 14, 15, 12, 11, 10, 16]) {
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
            // k-packet にはその tick で生きているプレイヤー全員が毎回入る (死亡中は抜ける)。
            // 入っていないプレイヤーを前の位置のまま残すと「生きているのに止まって見える」ので出さない
            const inTick = new Set();
            for (let i = 0; i + stride <= pArr.length; i += stride) {
                const sid = pArr[i];
                if (sid === undefined) continue;
                hasKPacket[sid] = true;
                inTick.add(sid);

                if (!playersMap[sid]) {
                    playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: false, maxHealth: 100, isValid: false };
                }
                const p = playersMap[sid];
                const aw = p.awaiting;
                if (aw) {
                    const near = Math.hypot(pArr[i + 1] - aw.pos[0], pArr[i + 2] - aw.pos[1], pArr[i + 3] - aw.pos[2]) < SPAWN_NEAR;
                    if (near) aw.seen = true;
                    if (near || (!aw.seen && t < aw.pendingUntil)) {
                        p.hasSpawned = false; // まだスポーン地点で待機中
                        continue;
                    }
                    p.awaiting = null;
                }
                p.hasSpawned = true;
                p.pos = [pArr[i + 1], pArr[i + 2], pArr[i + 3]];
                // [id, x, y, z, yaw(度), pitch(度, 上が+), ?, 接地, スライド, ?, ?, ?, ping]
                // (yaw/pitch は 9-packet の射撃方向と一致することを確認済み)
                p.rot = [pArr[i + 4] * Math.PI / 180, pArr[i + 5] * Math.PI / 180];
                p.grounded = !!pArr[i + 7];
                p.sliding = !!pArr[i + 8];
                // i+12 は HP ではなく ping (HP は h-packet / 0-packet / キルで更新する)
                if (typeof pArr[i + 12] === 'number') p.ping = pArr[i + 12];
            }
            Object.values(playersMap).forEach(p => {
                if (hasKPacket[p.id] && !inTick.has(p.id)) p.hasSpawned = false;
            });
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

            // sid なしは自分自身の HP
            if (sid === null || sid === undefined) {
                localHealth.push({ t, hp });
                sid = localId !== null ? localId : 0;
            }

            if (!playersMap[sid]) {
                playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: false, maxHealth: 100 };
            }
            playersMap[sid].health = hp;
            if (hp > 0) {
                playersMap[sid].maxHealth = Math.max(playersMap[sid].maxHealth || 100, hp);
            }
            // フレームは k-packet (tick) でだけ作る。tick の間に作ると位置が同じフレームが挟まり、補間が一瞬止まる
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

            if (victim === localId) localHealth.push({ t, hp: 0 });
            // Set victim health to 0
            if (playersMap[victim]) {
                playersMap[victim].health = 0;
            }
        }
        // ===== 9-packet: 他プレイヤーの射撃の着弾 =====
        // [shooter, hitX, hitY, hitZ, 法線?, 法線?, ?, shooterX, shooterY, 目の高さ, shooterZ, ...]
        else if (op === '9' && !ev[2] && Array.isArray(payload[1])) {
            const a = payload[1];
            if ([1, 2, 3].every(k => typeof a[k] === 'number')) {
                const from = [7, 8, 10].every(k => typeof a[k] === 'number')
                    ? [a[7], a[8] + (typeof a[9] === 'number' ? a[9] : EYE_HEIGHT), a[10]] : null;
                Shared.shots.push({ timestamp: t, shooter: a[0], from, to: [a[1], a[2], a[3]] });
            }
        }
        // ===== 4-packet: 自分の射撃が相手に当たった [target, damage, headshot, kill] =====
        // (s-packet は位置付きの効果音なので射撃には使わない)
        else if (op === '4' && !ev[2] && typeof payload[1] === 'number') {
            Shared.shots.push({ timestamp: t, shooter: localId, from: null, to: null, target: payload[1] });
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
                localSamples.push({ t, x: a[2], y: a[3], z: a[4], vy: a[5], vx: a[6], vz: a[7], yaw: a[8], grounded: a[9] === 1 });
            }
        }
        // ===== q-packet (クライアント→サーバー): 入力。[pitch*1000, yaw*1000, ...] =====
        // q[3] = 各フレームの所要ms (文字列なら q[4] 桁ずつ、配列ならそのまま)、
        // q[5] = [pitch, yaw (1/1000 rad), 以降フレームごとの差分 dPitch, dYaw ...]。送信時刻から逆算して約144Hzの視線にする
        else if (op === 'q' && ev[2]) {
            pushLocalLook(localLook, t, payload);
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
            if (!playersMap[0]) playersMap[0] = { id: 0, name: 'Local Player', team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: true, maxHealth: 100, isValid: true };
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

    timeline.forEach(it => processPayload(it.t, it.p, it.ev));

    // 自分 (k-packet に出てこない) を l/q から補間して全フレームに足す
    if (localId !== null && localSamples.length && playersMap[localId] && Shared.realFrames.length) {
        const me = playersMap[localId];
        me.isValid = true;
        const samples = localSamples;
        const looks = localLook;
        looks.sort((a, b) => a.t - b.t);
        localHealth.sort((a, b) => a.t - b.t);
        let si = 0, li = 0, hi = -1;
        const hermite = (p0, p1, m0, m1, u) => {
            const u2 = u * u, u3 = u2 * u;
            return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
        };
        Shared.realFrames.forEach(f => {
            const t = f.timestamp + minTime;
            while (si + 1 < samples.length && samples[si + 1].t <= t) si++;
            const s0 = samples[si], s1 = samples[si + 1];
            let pos;
            if (s1 && t >= s0.t && s1.t - s0.t <= LOCAL_GAP_MS) {
                const dt = s1.t - s0.t, u = (t - s0.t) / dt;
                pos = [hermite(s0.x, s1.x, s0.vx * dt, s1.vx * dt, u),
                       hermite(s0.y, s1.y, s0.vy * dt, s1.vy * dt, u),
                       hermite(s0.z, s1.z, s0.vz * dt, s1.vz * dt, u)];
            } else {
                pos = [s0.x, s0.y, s0.z];
            }
            while (li + 1 < looks.length && looks[li + 1].t <= t) li++;
            const look = interpLook(looks, li, t);
            while (hi + 1 < localHealth.length && localHealth[hi + 1].t <= t) hi++;
            // l-packet が途切れている間 (死亡・ラウンド間) は試合に居ないので、止まったまま残さず出さない
            const lastSample = !s1;
            if (t > s0.t + LOCAL_HOLD_MS && ((s1 && s1.t - s0.t > LOCAL_GAP_MS) || (lastSample && t - s0.t > LOCAL_GAP_MS))) return;
            const health = hi >= 0 ? localHealth[hi].hp : (me.maxHealth || 100);
            f.players.push({
                id: localId, name: me.name, team: me.team,
                pos, rot: [look ? look.yaw : s0.yaw, look ? look.pitch : 0],
                health, maxHealth: me.maxHealth || 100,
                hasSpawned: true, grounded: s0.grounded, sliding: false, isValid: true, classId: me.classId
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

        Shared.shots.forEach(e => e.timestamp -= minTime);
        Shared.shots.sort((a, b) => a.timestamp - b.timestamp);
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
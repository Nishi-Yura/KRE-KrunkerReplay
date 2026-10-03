import { Shared } from './State.js';
import { showToast } from './UI.js';
import { disposeObject } from './Utils.js';

// マップ本体 (ジオメトリ) は録画に含まれない (サーバー/ゲーム側が持っている) ため、
// 録画から拾える情報で「推定マップ」を作る:
//   床: 全プレイヤーの足元の高さ (セルごとの低め位置) → 歩いた範囲の床タイル
//   点: 着弾位置 (壁・床・段差の表面)、リスポーン地点、旗などの目標物

const CELL = 8;           // 床タイルの一辺
const MIN_SAMPLES = 1;    // 1回でも立っていれば床とみなす (録画が短いと点が少ないため)
const GROUNDED_DY = 0.5;  // 前フレームからの高さ変化がこれ以下なら接地とみなす
const GROUND_PERCENTILE = 0.25;

let enabled = true;
let group = null;

function updateButton() {
    const b = document.getElementById('btn-estmap');
    if (!b) return;
    const has = !!group;
    b.style.display = has ? '' : 'none';
    b.style.background = enabled ? 'rgba(0, 212, 255, 0.5)' : 'rgba(0,0,0,0.5)';
}

function applyVisibility() {
    if (group) group.visible = enabled;
    updateButton();
}

export function setEstimatedEnabled(on) {
    enabled = on;
    applyVisibility();
}

export function toggleEstimatedMap() {
    if (!group) { showToast('推定マップの元になる録画がありません', 'warning'); return; }
    setEstimatedEnabled(!enabled);
}

function clearGroup() {
    if (!group) return;
    Shared.scene.remove(group);
    disposeObject(group);
    group = null;
}

function makeInstanced(geo, color, positions, scaleFn) {
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => {
        const s = scaleFn ? scaleFn(p) : [1, 1, 1];
        m.makeScale(s[0], s[1], s[2]);
        m.setPosition(p[0], p[1], p[2]);
        mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
}

export function buildEstimatedMap() {
    clearGroup();
    // 本物のマップが読み込み済みなら推定は不要
    const hasRealMap = Shared.mapGroup && Shared.mapGroup.children.length > 0;

    // セルごとに足元の高さを集める。ジャンプ/落下中 (前フレームから高さが動いている) の点は
    // 空中なので使わず、立っている・歩いている点だけを床とみなす
    const cells = new Map();
    const frames = Shared.realFrames;
    const prevY = new Map();
    for (let fi = 0; fi < frames.length; fi++) {
        for (const p of frames[fi].players) {
            if (!p.pos) continue;
            const [x, y, z] = p.pos;
            const py = prevY.get(p.id);
            prevY.set(p.id, p.health === 0 ? undefined : y);
            if (p.health === 0 || py === undefined) continue;
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
            if (Math.abs(y - py) > GROUNDED_DY) continue;
            const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
            let c = cells.get(key);
            if (!c) { c = { cx: Math.floor(x / CELL), cz: Math.floor(z / CELL), ys: [] }; cells.set(key, c); }
            c.ys.push(y);
        }
    }

    const tiles = [];
    let minY = Infinity, maxY = -Infinity;
    cells.forEach(c => {
        if (c.ys.length < MIN_SAMPLES) return;
        c.ys.sort((a, b) => a - b);
        const y = c.ys[Math.floor((c.ys.length - 1) * GROUND_PERCENTILE)];
        tiles.push({ x: (c.cx + 0.5) * CELL, y, z: (c.cz + 0.5) * CELL });
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    });

    const hints = Shared.mapHints || { impacts: [], flags: [], spawns: [] };
    if (tiles.length === 0 && hints.impacts.length === 0) { updateButton(); return; }

    group = new THREE.Group();

    if (tiles.length > 0) {
        // 高い床は地面まで柱状に伸ばして「足場」として見せる (下端は最も低い床の少し下)
        const baseY = minY - 2;
        const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshLambertMaterial({ color: 0xffffff }),
            tiles.length
        );
        const m = new THREE.Matrix4();
        const col = new THREE.Color();
        const range = Math.max(1, maxY - minY);
        tiles.forEach((t, i) => {
            const h = Math.max(1.5, t.y - baseY);
            m.makeScale(CELL - 0.6, h, CELL - 0.6);
            m.setPosition(t.x, t.y - h / 2, t.z);
            mesh.setMatrixAt(i, m);
            // 低い所は暗い青、高い所は明るい水色
            col.setHSL(0.58, 0.45, 0.2 + 0.4 * ((t.y - minY) / range));
            mesh.setColorAt(i, col);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);
    }

    if (hints.impacts.length > 0) {
        group.add(makeInstanced(new THREE.BoxGeometry(1.2, 1.2, 1.2), 0xff9944, hints.impacts));
    }
    if (hints.spawns.length > 0) {
        // 近い地点の重複はまとめる
        const seen = new Set();
        const spawns = hints.spawns.filter(s => {
            const k = Math.round(s[0] / 4) + ',' + Math.round(s[1] / 4) + ',' + Math.round(s[2] / 4);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        group.add(makeInstanced(new THREE.BoxGeometry(3, 0.6, 3), 0x44ff88, spawns));
    }
    if (hints.flags.length > 0) {
        group.add(makeInstanced(new THREE.CylinderGeometry(0.8, 0.8, 30, 8), 0xffee44, hints.flags.map(f => [f[0], f[1] + 15, f[2]])));
    }

    Shared.scene.add(group);
    enabled = !hasRealMap;
    applyVisibility();
}

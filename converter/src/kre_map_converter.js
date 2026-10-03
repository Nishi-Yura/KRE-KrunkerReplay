#!/usr/bin/env node

/**
 * Krunker Map JSON to GLB converter
 * マップJSON (objects / xyz) のボックスを、頂点カラー付きの単一メッシュGLBに変換する
 * ビューア (viewer/js/Parser_Map.js) と同じ解釈でオブジェクトを配置する
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_COLOR = [0x66, 0x66, 0x66];
const XYZ_COLOR = [0x44, 0x44, 0x44];

// 単位キューブ(±0.5)の面: [法線, 4頂点]
const CUBE_FACES = [
    [[1, 0, 0], [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]]],
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]]
];

function parseColor(hex) {
    if (typeof hex !== 'string') return null;
    const n = parseInt(hex.replace('#', ''), 16);
    if (Number.isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** three.js の Euler 既定順序 (XYZ) の回転行列を適用する */
function rotateXYZ([x, y, z], [rx, ry, rz]) {
    const [a, b] = [Math.cos(rx), Math.sin(rx)];
    const [c, d] = [Math.cos(ry), Math.sin(ry)];
    const [e, f] = [Math.cos(rz), Math.sin(rz)];
    const ae = a * e, af = a * f, be = b * e, bf = b * f;
    const m = [
        c * e, -c * f, d,
        af + be * d, ae - bf * d, -b * c,
        bf - ae * d, be + af * d, a * c
    ];
    return [
        m[0] * x + m[1] * y + m[2] * z,
        m[3] * x + m[4] * y + m[5] * z,
        m[6] * x + m[7] * y + m[8] * z
    ];
}

/** マップデータからボックス配列を取り出す */
function collectBoxes(mapData) {
    const boxes = [];
    const colors = mapData.colors || [];

    if (Array.isArray(mapData.xyz)) {
        for (let i = 0; i + 5 < mapData.xyz.length; i += 6) {
            boxes.push({
                p: mapData.xyz.slice(i, i + 3),
                s: mapData.xyz.slice(i + 3, i + 6),
                r: [0, 0, 0],
                color: XYZ_COLOR
            });
        }
    }

    if (Array.isArray(mapData.objects)) {
        for (const obj of mapData.objects) {
            if (!obj.s) continue; // ビューアと同様、スケール未指定は無視
            boxes.push({
                p: obj.p || [0, 0, 0],
                s: obj.s,
                r: obj.r || [0, 0, 0],
                color: (obj.ci !== undefined && parseColor(colors[obj.ci])) || DEFAULT_COLOR
            });
        }
    }
    return boxes;
}

/** ボックス群を結合した頂点配列・インデックスを作る */
function buildGeometry(boxes) {
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];

    for (const box of boxes) {
        for (const [normal, verts] of CUBE_FACES) {
            const base = positions.length / 3;
            const n = rotateXYZ(normal, box.r);
            for (const v of verts) {
                const scaled = [v[0] * box.s[0], v[1] * box.s[1], v[2] * box.s[2]];
                const w = rotateXYZ(scaled, box.r);
                positions.push(w[0] + box.p[0], w[1] + box.p[1], w[2] + box.p[2]);
                normals.push(...n);
                colors.push(box.color[0] / 255, box.color[1] / 255, box.color[2] / 255);
            }
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    return { positions, normals, colors, indices };
}

function pad4(buf, fill) {
    const rem = buf.length % 4;
    return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

/** マップデータをGLBバッファに変換する */
function mapToGLB(mapData) {
    const boxes = collectBoxes(mapData);
    if (boxes.length === 0) throw new Error('変換できるオブジェクトがありません');

    const { positions, normals, colors, indices } = buildGeometry(boxes);

    const posBuf = Buffer.from(new Float32Array(positions).buffer);
    const nrmBuf = Buffer.from(new Float32Array(normals).buffer);
    const colBuf = Buffer.from(new Float32Array(colors).buffer);
    const idxBuf = pad4(Buffer.from(new Uint32Array(indices).buffer), 0);
    const bin = Buffer.concat([posBuf, nrmBuf, colBuf, idxBuf]);

    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], positions[i + k]);
            max[k] = Math.max(max[k], positions[i + k]);
        }
    }

    const vertexCount = positions.length / 3;
    const gltf = {
        asset: { version: '2.0', generator: 'kre_map_converter' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: mapData.name || 'Map', mesh: 0 }],
        meshes: [{
            name: mapData.name || 'Map',
            primitives: [{
                attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
                indices: 3,
                material: 0
            }]
        }],
        materials: [{ pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } }],
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
            { buffer: 0, byteOffset: posBuf.length, byteLength: nrmBuf.length, target: 34962 },
            { buffer: 0, byteOffset: posBuf.length + nrmBuf.length, byteLength: colBuf.length, target: 34962 },
            { buffer: 0, byteOffset: posBuf.length + nrmBuf.length + colBuf.length, byteLength: indices.length * 4, target: 34963 }
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
            { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
            { bufferView: 2, componentType: 5126, count: vertexCount, type: 'VEC3' },
            { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' }
        ]
    };

    const jsonBuf = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
    const total = 12 + 8 + jsonBuf.length + 8 + bin.length;

    const header = Buffer.alloc(12);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);

    const jsonHead = Buffer.alloc(8);
    jsonHead.writeUInt32LE(jsonBuf.length, 0);
    jsonHead.write('JSON', 4, 'ascii');

    const binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(bin.length, 0);
    binHead.write('BIN\0', 4, 'latin1');

    return { glb: Buffer.concat([header, jsonHead, jsonBuf, binHead, bin]), boxCount: boxes.length };
}

function convertFile(inputPath, outputPath) {
    const mapData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const { glb, boxCount } = mapToGLB(mapData);
    fs.writeFileSync(outputPath, glb);
    return boxCount;
}

function convertDirectory(dir) {
    if (!fs.existsSync(dir)) throw new Error(`ディレクトリが存在しません: ${dir}`);
    let ok = 0, skipped = 0;
    for (const file of fs.readdirSync(dir)) {
        if (!file.toLowerCase().endsWith('.json')) continue;
        const input = path.join(dir, file);
        const output = path.join(dir, file.replace(/\.json$/i, '.glb'));
        try {
            const count = convertFile(input, output);
            console.log(`[INFO] ${file} -> ${path.basename(output)} (${count} boxes)`);
            ok++;
        } catch (err) {
            console.warn(`[WARN] スキップ: ${file} (${err.message})`);
            skipped++;
        }
    }
    console.log(`[INFO] 完了: 成功 ${ok} / スキップ ${skipped}`);
}

function main(args) {
    if (args.includes('-d')) {
        const defaultDir = path.join(process.env.APPDATA || '', 'krunker', 'maps');
        const targetDir = args[args.indexOf('-d') + 1] || defaultDir;
        console.log(`[INFO] ディレクトリの一括変換を開始: ${targetDir}`);
        convertDirectory(targetDir);
    } else if (args.length >= 2) {
        console.log(`[INFO] 読み込み中: ${args[0]}`);
        const count = convertFile(args[0], args[1]);
        console.log(`[INFO] 変換完了: ${args[1]} (${count} boxes)`);
    } else {
        console.log('Usage: node kre_map_converter.js <input.json> <output.glb>');
        console.log('       node kre_map_converter.js -d [directory]');
    }
}

module.exports = { mapToGLB, convertFile, convertDirectory };

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        console.error(`[ERROR] 変換エラー: ${err.message}`);
        process.exit(1);
    }
}

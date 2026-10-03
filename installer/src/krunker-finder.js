/**
 * krunker-finder.js
 * Krunkerクライアント (公式 / Glorp 等のElectronクライアント) のインストールパスを自動検出する
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 指定されたディレクトリが Electron クライアントのインストールディレクトリか検証する。
 * クライアントごとに exe 名が異なる (krunker.exe / glorp.exe ...) ため、
 * 「exe が1つ以上あり、resources/app.asar または resources/app/package.json がある」ことで判定する。
 * @param {string} dir 検証するディレクトリパス
 * @returns {boolean}
 */
function validateKrunkerDir(dir) {
    return !!describeInstall(dir);
}

/**
 * @param {string} dir
 * @returns {{installDir: string, resourcesPath: string, asarPath: string, appDir: string, kind: 'asar'|'dir', exePath: string} | null}
 */
function describeInstall(dir) {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;

    // 直下に resources/ があればそのまま。無ければ Squirrel 形式 (<dir>/app-<version>/) の最新版を調べる
    const direct = describeExact(dir);
    if (direct) return direct;

    const versions = fs.readdirSync(dir)
        .filter(f => /^app-\d/i.test(f) && fs.statSync(path.join(dir, f)).isDirectory())
        .sort(compareVersionDirs);
    for (let i = versions.length - 1; i >= 0; i--) {
        const info = describeExact(path.join(dir, versions[i]));
        if (info) return info;
    }
    return null;
}

function compareVersionDirs(a, b) {
    const pa = a.replace(/^app-/i, '').split(/[.\-]/).map(n => parseInt(n, 10) || 0);
    const pb = b.replace(/^app-/i, '').split(/[.\-]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
}

function describeExact(dir) {
    const resourcesPath = path.join(dir, 'resources');
    const asarPath = path.join(resourcesPath, 'app.asar');
    const appDir = path.join(resourcesPath, 'app');

    let kind = null;
    if (fs.existsSync(asarPath)) kind = 'asar';
    else if (fs.existsSync(path.join(appDir, 'package.json'))) kind = 'dir';
    if (!kind) return null;

    const exe = fs.readdirSync(dir).find(f => /\.exe$/i.test(f) && !/^(uninstall|update|squirrel)/i.test(f));
    if (!exe) return null;

    return { installDir: dir, resourcesPath, asarPath, appDir, kind, exePath: path.join(dir, exe) };
}

/** 見つからなかったときの手がかりとして、ディレクトリ構成を2階層まで文字列にする */
function explainMissing(dir) {
    const lines = [];
    if (!dir || !fs.existsSync(dir)) return `  (ディレクトリが存在しません: ${dir})`;
    const walk = (d, depth) => {
        let entries = [];
        try { entries = fs.readdirSync(d); } catch (e) { return; }
        entries.slice(0, 40).forEach(f => {
            const full = path.join(d, f);
            const isDir = fs.statSync(full).isDirectory();
            lines.push('  '.repeat(depth + 1) + f + (isDir ? '/' : ''));
            if (isDir && depth < 1) walk(full, depth + 1);
        });
    };
    walk(dir, 0);
    return lines.join('\n');
}

/**
 * Krunkerクライアントのインストールパスを検索して返す
 * @returns {ReturnType<typeof describeInstall>}
 */
function findKrunkerPath() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const searchPaths = [
        path.join(localAppData, 'glorp'),
        path.join(localAppData, 'Programs', 'glorp'),
        path.join(localAppData, 'Programs', 'krunker'),
        path.join(localAppData, 'Programs', 'Krunker'),
        'C:\\Program Files\\krunker',
        'C:\\Program Files (x86)\\krunker'
    ];

    for (const searchPath of searchPaths) {
        const info = describeInstall(searchPath);
        if (info) return info;
    }
    return null;
}

module.exports = {
    findKrunkerPath,
    validateKrunkerDir,
    describeInstall,
    explainMissing
};

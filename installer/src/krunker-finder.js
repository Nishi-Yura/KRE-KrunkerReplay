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

    const resourcesPath = path.join(dir, 'resources');
    const asarPath = path.join(resourcesPath, 'app.asar');
    const appDir = path.join(resourcesPath, 'app');

    let kind = null;
    if (fs.existsSync(asarPath)) kind = 'asar';
    else if (fs.existsSync(path.join(appDir, 'package.json'))) kind = 'dir';
    if (!kind) return null;

    const exe = fs.readdirSync(dir).find(f => /\.exe$/i.test(f) && !/^(uninstall|update)/i.test(f));
    if (!exe) return null;

    return { installDir: dir, resourcesPath, asarPath, appDir, kind, exePath: path.join(dir, exe) };
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
    describeInstall
};

/**
 * krunker-finder.js
 * Krunkerクライアントのインストールパスを自動検出する
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 指定されたディレクトリがKrunkerのインストールディレクトリか検証する
 * @param {string} dir 検証するディレクトリパス
 * @returns {boolean}
 */
function validateKrunkerDir(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    
    // app.asarが存在するか確認
    const resourcesPath = path.join(dir, 'resources');
    const asarPath = path.join(resourcesPath, 'app.asar');
    
    // Windows環境での実行ファイル(Krunker.exe)またはapp.asarの存在を確認
    const hasExe = fs.existsSync(path.join(dir, 'Krunker.exe')) || fs.existsSync(path.join(dir, 'krunker.exe'));
    const hasAsar = fs.existsSync(asarPath);
    
    return hasExe && hasAsar;
}

/**
 * Krunkerのインストールパスを検索して返す
 * @returns {{installDir: string, asarPath: string, resourcesPath: string} | null}
 */
function findKrunkerPath() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    
    // 検索候補のパス
    const searchPaths = [
        path.join(localAppData, 'Programs', 'krunker'),
        'C:\\Program Files\\krunker',
        'C:\\Program Files (x86)\\krunker'
    ];

    for (const searchPath of searchPaths) {
        if (validateKrunkerDir(searchPath)) {
            const resourcesPath = path.join(searchPath, 'resources');
            const asarPath = path.join(resourcesPath, 'app.asar');
            return {
                installDir: searchPath,
                asarPath: asarPath,
                resourcesPath: resourcesPath
            };
        }
    }
    
    return null;
}

module.exports = {
    findKrunkerPath,
    validateKrunkerDir
};

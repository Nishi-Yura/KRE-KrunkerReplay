/**
 * kre-main-hook.js  (Electron メインプロセス用)
 *
 * クライアントの main.js の先頭から require される。やること:
 *  1. 全セッションに kre-preload.js を preload として登録する
 *  2. preload からの要求に応じて、録画スクリプト(kre-userscript.js)を渡す
 *  3. 録画データを ドキュメント/KrunkerReplays に保存する
 *
 * クライアント本体の動作は変えない。何か失敗してもゲームは起動し続けるよう、
 * 全体を try/catch で包んでいる。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TAG = '[KRE Recorder]';

function install() {
    const { app, ipcMain, session } = require('electron');
    const preloadPath = path.join(__dirname, 'kre-preload.js');
    const scriptPath = path.join(__dirname, 'kre-userscript.js');

    const saveDir = path.join(app.getPath ? safeDocuments(app) : os.homedir(), 'KrunkerReplays');

    ipcMain.on('kre-get-script', (event) => {
        try {
            event.returnValue = fs.readFileSync(scriptPath, 'utf8');
        } catch (e) {
            console.error(TAG, 'script read failed:', e.message);
            event.returnValue = '';
        }
    });

    ipcMain.handle('kre-save', async (_event, payload) => {
        const { filename, data } = payload || {};
        if (!data) throw new Error('empty payload');
        fs.mkdirSync(saveDir, { recursive: true });
        const safe = String(filename || `krunker_${Date.now()}.json`).replace(/[^a-zA-Z0-9_\-.]/g, '_');
        const filePath = path.join(saveDir, safe);
        await fs.promises.writeFile(filePath, Buffer.from(data));
        console.log(TAG, `saved ${filePath} (${(data.byteLength / 1024).toFixed(1)} KB)`);
        return { ok: true, path: filePath, size: data.byteLength };
    });

    const attach = (ses) => {
        try {
            if (!ses || ses.__kreAttached) return;
            ses.__kreAttached = true;
            // Electron 35+ は ses.registerPreloadScript、それ以前は setPreloads
            if (typeof ses.registerPreloadScript === 'function') {
                ses.registerPreloadScript({ type: 'frame', filePath: preloadPath });
            } else {
                ses.setPreloads([...ses.getPreloads(), preloadPath]);
            }
        } catch (e) {
            console.error(TAG, 'preload attach failed:', e.message);
        }
    };

    // 後から作られるセッション (partition 付き webview など) にも付ける
    app.on('session-created', attach);
    if (app.isReady()) attach(session.defaultSession);
    else app.whenReady().then(() => attach(session.defaultSession));

    console.log(TAG, 'main hook installed. save dir:', saveDir);
}

function safeDocuments(app) {
    try { return app.getPath('documents'); } catch (e) { return path.join(os.homedir(), 'Documents'); }
}

try {
    install();
} catch (e) {
    console.error(TAG, 'install failed:', e && e.message);
}

module.exports = { install };

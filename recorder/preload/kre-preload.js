/**
 * kre-preload.js  (レンダラ用 preload)
 *
 * contextIsolation が有効でもゲームのページ側 (main world) で WebSocket を
 * フックできるよう、録画スクリプトを webFrame.executeJavaScript で注入する。
 * 保存はメインプロセスへIPCで依頼する (ローカルHTTPサーバー不要)。
 *
 * sandbox 有効の preload では fs が使えないため、スクリプト本体は
 * メインプロセスから ipcRenderer.sendSync で受け取る。
 */
'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

(function () {
    // 広告などの iframe には入れない。krunker.io / browserfps.com の最上位フレームのみ
    const host = location.hostname;
    const isGamePage = window.top === window && /(^|\.)(krunker\.io|browserfps\.com)$/.test(host);
    if (!isGamePage) return;

    const api = {
        save: (filename, arrayBuffer) => ipcRenderer.invoke('kre-save', { filename, data: arrayBuffer })
    };
    try {
        contextBridge.exposeInMainWorld('kreNative', api);
    } catch (e) {
        // contextIsolation が無効な環境では exposeInMainWorld が使えない → window に直接生やす
        window.kreNative = api;
    }

    try {
        const source = ipcRenderer.sendSync('kre-get-script');
        if (source) webFrame.executeJavaScript(source);
        else console.warn('[KRE Recorder] recorder script is empty');
    } catch (e) {
        console.error('[KRE Recorder] injection failed:', e && e.message);
    }
})();

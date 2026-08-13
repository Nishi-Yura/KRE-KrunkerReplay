/**
 * kre-save-server.js
 * .kre ファイルをディスクに保存するローカルHTTPサーバー
 * localhost:9876 でPOSTリクエストを受け取ってファイルに保存する
 *
 * 起動: node kre-save-server.js
 * 終了: Ctrl+C
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT      = 9876;
const SAVE_DIR  = path.join(os.homedir(), 'Documents', 'KrunkerReplays');

// 保存ディレクトリを作成
if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    console.log(`[KRE Server] Created save directory: ${SAVE_DIR}`);
}

const server = http.createServer((req, res) => {
    // CORS ヘッダー（WebView2 / krunker.io からのリクエストを許可）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-KRE-Map, X-KRE-Version');

    // プリフライトリクエスト
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ヘルスチェック
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', saveDir: SAVE_DIR }));
        return;
    }

    // リプレイログファイルの保存
    if (req.method === 'POST' && req.url === '/save') {
        const isJson = req.headers['content-type'] === 'application/json';
        const ext = isJson ? '.json' : '.kre';
        const filename = req.headers['x-filename'] || `krunker_${Date.now()}${ext}`;
        const safeName = filename.replace(/[^a-zA-Z0-9_\-.]/g, '_'); // パスインジェクション防止
        const filePath = path.join(SAVE_DIR, safeName);

        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            fs.writeFile(filePath, buffer, (err) => {
                if (err) {
                    console.error(`[KRE Server] Save failed: ${err.message}`);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                } else {
                    const sizeKB = (buffer.length / 1024).toFixed(1);
                    console.log(`[KRE Server] Saved: ${safeName} (${sizeKB} KB) → ${filePath}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, path: filePath, size: buffer.length }));
                }
            });
        });
        req.on('error', (err) => {
            console.error(`[KRE Server] Request error: ${err.message}`);
            res.writeHead(500);
            res.end();
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('=================================================');
    console.log('  KRE Save Server - Running');
    console.log(`  Listening on: http://127.0.0.1:${PORT}`);
    console.log(`  Save directory: ${SAVE_DIR}`);
    console.log('  Keep this window open while playing Krunker!');
    console.log('  Press Ctrl+C to stop.');
    console.log('=================================================');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[KRE Server] Port ${PORT} is already in use. Server may already be running.`);
    } else {
        console.error('[KRE Server] Error:', err.message);
    }
    process.exit(1);
});

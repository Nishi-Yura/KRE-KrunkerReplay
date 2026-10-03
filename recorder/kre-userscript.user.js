// ==UserScript==
// @name         Krunker Replay Recorder (KRE)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Record 3D replays in Krunker.io via WebSocket Interception
// @author       KRE Team
// @match        *://krunker.io/*
// @match        *://*.krunker.io/*
// @match        *://browserfps.com/*
// @match        *://*.browserfps.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SAVE_SERVER = 'http://127.0.0.1:9876/save';
    const VERSION     = '2.2';

    let recording = false;
    let frames = [];
    let startTime = 0;

    // 自動録画: マップ読み込みを検知して開始し、ゲームのWebSocketが閉じたら保存する (F9で切替)
    const AUTO_MIN_PACKETS = 200; // これ未満の自動録画は保存せず破棄する
    let autoRecord = true;
    try { autoRecord = localStorage.getItem('kre_auto') !== '0'; } catch (e) {}
    let autoStarted = false;
    
    // UI Elements
    let statusDot, statusText, frameCountEl, timeEl;

    function log(...args) {
        console.log('%c[KRE Recorder]', 'color: #00ff88; font-weight: bold; background: #222; padding: 2px 4px; border-radius: 3px;', ...args);
    }

    // =====================
    // UI Initialization
    // =====================
    function initUI() {
        const container = document.createElement('div');
        container.id = 'kre-recorder-ui';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 10px 15px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.1);
            z-index: 999999;
            pointer-events: none;
            backdrop-filter: blur(4px);
            display: flex;
            flex-direction: column;
            gap: 5px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            min-width: 150px;
        `;

        // Status Row
        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 14px;';
        
        statusDot = document.createElement('div');
        statusDot.style.cssText = 'width: 10px; height: 10px; border-radius: 50%; background: #00ff88; box-shadow: 0 0 8px #00ff88;';
        
        statusText = document.createElement('span');
        statusText.innerText = 'KRE IDLE';
        statusText.style.color = '#00ff88';

        statusRow.appendChild(statusDot);
        statusRow.appendChild(statusText);

        // Stats Row
        const statsRow = document.createElement('div');
        statsRow.style.cssText = 'display: flex; justify-content: space-between; font-size: 12px; color: #ccc;';
        
        frameCountEl = document.createElement('span');
        frameCountEl.innerText = 'Packets: 0';
        
        timeEl = document.createElement('span');
        timeEl.innerText = '00:00';

        statsRow.appendChild(frameCountEl);
        statsRow.appendChild(timeEl);

        const helpRow = document.createElement('div');
        helpRow.style.cssText = 'font-size: 10px; color: #888; margin-top: 4px; text-align: center;';
        helpRow.innerText = '[F7] Start/Stop  [F8] Debug  [F9] Auto';

        container.appendChild(statusRow);
        container.appendChild(statsRow);
        container.appendChild(helpRow);
        
        document.body.appendChild(container);
        log('UI initialized');
    }

    function updateUI() {
        if (!statusDot) return;
        
        if (recording) {
            statusDot.style.background = '#ff0044';
            statusDot.style.boxShadow = '0 0 8px #ff0044';
            statusText.innerText = autoStarted ? 'RECORDING (AUTO)' : 'RECORDING';
            statusText.style.color = '#ff0044';
            
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const s = String(elapsed % 60).padStart(2, '0');
            timeEl.innerText = `${m}:${s}`;
        } else {
            statusDot.style.background = '#00ff88';
            statusDot.style.boxShadow = '0 0 8px #00ff88';
            statusText.innerText = autoRecord ? 'KRE IDLE (AUTO)' : 'KRE IDLE';
            statusText.style.color = '#00ff88';
        }
        
        frameCountEl.innerText = `Packets: ${frames.length}`;
    }

    // =====================
    // 軽量化: ArrayBuffer を Base64 文字列に変換
    // =====================
    function buf2base64(buffer) {
        let binary = '';
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const len = bytes.byteLength;
        const chunkSize = 8192;
        
        for (let i = 0; i < len; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        
        return window.btoa(binary);
    }

    // =====================
    // WebSocket Hook
    // =====================
    let recentPackets = [];
    let currentMapJSON = null; // マップデータを保持
    function setMapJSON(parsed) {
        const isNew = parsed !== currentMapJSON;
        currentMapJSON = parsed;
        if (isNew && autoRecord && !recording) startRecording(true);
    }

    try {
        function interceptMessage(e) {
            try {
                if (e.data instanceof ArrayBuffer) {
                    if (recording) {
                        // 受信時は生バイトのまま保持し、Base64化は保存時にまとめて行う (メモリ約25%減・負荷分散)
                        frames.push([Date.now(), new Uint8Array(e.data)]);
                        if (e.target) e.target._kreActive = true;
                    }
                }
            } catch(err) {}
        }

        function onSocketClose(e) {
            // 録画中にパケットを受信していたソケットが閉じたら試合終了とみなす
            if (autoRecord && autoStarted && recording && e.target && e.target._kreActive) {
                log('Game socket closed - auto stop');
                stopRecording();
            }
        }

        const origAddEventListener = window.WebSocket.prototype.addEventListener;
        window.WebSocket.prototype.addEventListener = function(type, listener, options) {
            if (type === 'message' && !this._kreHookedAdd) {
                this._kreHookedAdd = true;
                origAddEventListener.call(this, 'message', interceptMessage);
                origAddEventListener.call(this, 'close', onSocketClose);
                log('WebSocket addEventListener hooked!');
            }
            return origAddEventListener.call(this, type, listener, options);
        };

        const origOnMessageDesc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
        if (origOnMessageDesc) {
            Object.defineProperty(WebSocket.prototype, 'onmessage', {
                set: function(listener) {
                    if (!this._kreHookedOnMsg) {
                        this._kreHookedOnMsg = true;
                        origAddEventListener.call(this, 'message', interceptMessage);
                        origAddEventListener.call(this, 'close', onSocketClose);
                        log('WebSocket onmessage hooked!');
                    }
                    origOnMessageDesc.set.call(this, listener);
                },
                get: origOnMessageDesc.get
            });
        }
        
        // ローカルプレイヤーの座標（クライアントからサーバーへの送信）をキャプチャする
        const origSend = window.WebSocket.prototype.send;
        window.WebSocket.prototype.send = function(data) {
            try {
                if (recording) {
                    // 送信バッファは再利用される可能性があるのでコピーして保持する
                    if (data instanceof ArrayBuffer) {
                        frames.push([Date.now(), new Uint8Array(data.slice(0)), true]); // true = sent by client
                    } else if (ArrayBuffer.isView(data)) {
                        frames.push([Date.now(), new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), true]);
                    }
                }
            } catch(e) {}
            return origSend.call(this, data);
        };
        log('WebSocket send hooked!');
        
    } catch (err) {
        console.warn('Failed to hook WebSocket:', err);
    }

    // =====================
    // Map JSON Interceptor (Fetch & XHR)
    // =====================
    try {
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] ? args[0].url : '');
            const response = await origFetch.apply(this, args);
            try {
                if (url && (url.includes('.json') || url.includes('/maps/') || url.includes('p=map'))) {
                    const clone = response.clone();
                    const text = await clone.text();
                    if (text.includes('"xyz"') || text.includes('"objects"')) {
                        const parsed = JSON.parse(text);
                        if (parsed.name && (parsed.xyz || parsed.objects)) {
                            setMapJSON(parsed);
                            log('Intercepted map JSON via fetch: ' + parsed.name);
                        }
                    }
                }
            } catch(e) {}
            return response;
        };

        const origXhrOpen = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._kreUrl = url;
            return origXhrOpen.call(this, method, url, ...rest);
        };
        
        const origXhrSend = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
                try {
                    if (this.responseType === '' || this.responseType === 'text') {
                        const text = this.responseText;
                        if (text && (text.includes('"xyz"') || text.includes('"objects"'))) {
                            const parsed = JSON.parse(text);
                            if (parsed.name && (parsed.xyz || parsed.objects)) {
                                setMapJSON(parsed);
                                log('Intercepted map JSON via XHR: ' + parsed.name);
                            }
                        }
                    }
                } catch(e) {}
            });
            return origXhrSend.apply(this, args);
        };
        log('Network requests hooked for Map JSON');
        
        // Hook JSON.parse as a fallback for cached/indexedDB maps
        const origParse = JSON.parse;
        JSON.parse = function(text, reviver) {
            const parsed = origParse.call(this, text, reviver);
            try {
                if (parsed && typeof parsed === 'object') {
                    if (parsed.name && (parsed.xyz || parsed.objects)) {
                        setMapJSON(parsed);
                        log('Intercepted map JSON via JSON.parse: ' + parsed.name);
                    }
                }
            } catch(e) {}
            return parsed;
        };
        log('JSON.parse hooked for Map JSON');
    } catch(err) {
        console.warn('Failed to hook network requests:', err);
    }

    // =====================
    // 録画制御 (F7: 手動開始/停止, F8: デバッグ, F9: 自動録画の切替)
    // =====================
    let localPlayerInterval = null;

    function toast(text, ok = true) {
        const el = document.createElement('div');
        el.innerText = text;
        el.style.cssText = `position:fixed; top:80px; left:20px; background:${ok ? '#00ff88' : '#ff4466'}; color:#000; padding:5px 10px; border-radius:4px; z-index:999999; font-weight:bold; transition: opacity 1s;`;
        (document.body || document.documentElement).appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 1000); }, 3000);
    }

    function startRecording(auto) {
        if (recording) return;
        recording = true;
        autoStarted = !!auto;
        frames = [];
        startTime = Date.now();
        log(auto ? 'Recording started (auto)' : 'Recording started');
        updateUI();

        // ローカルプレイヤーの位置を定期的に記録
        if (localPlayerInterval) clearInterval(localPlayerInterval);
        localPlayerInterval = setInterval(() => {
            try {
                const lp = window?.i?.localPlayer;
                if (lp && lp.active) {
                    frames.push([
                        Date.now(),
                        ["kre_local", lp.x, lp.y, lp.z, lp.targetDir || 0, lp.pitch || 0, lp.health || 100]
                    ]);
                }
            } catch (err) {}
        }, 50); // 20FPS
    }

    // 巨大な文字列を作らず、フレームごとのJSON断片をBlobに繋いで送る
    function buildPayload(list) {
        const parts = ['['];
        let first = true;
        const add = (str) => { parts.push(first ? str : ',' + str); first = false; };
        if (currentMapJSON) add(JSON.stringify([startTime, ['kre_map_data', currentMapJSON]]));
        for (const f of list) {
            const entry = f[1] instanceof Uint8Array ? [f[0], buf2base64(f[1])] : [f[0], f[1]];
            if (f[2]) entry.push(true);
            add(JSON.stringify(entry));
        }
        parts.push(']');
        return new Blob(parts, { type: 'application/json' });
    }

    function stopRecording() {
        if (!recording) return;
        const wasAuto = autoStarted;
        recording = false;
        autoStarted = false;
        if (localPlayerInterval) clearInterval(localPlayerInterval);

        const list = frames;
        frames = [];
        log(`Recording stopped. Saving ${list.length} frames...`);
        updateUI();

        if (list.length === 0 || (wasAuto && list.length < AUTO_MIN_PACKETS)) {
            if (!wasAuto) alert('⚠️ 保存エラー: 記録されたパケットが0件です');
            else log('Auto recording too short - discarded');
            return;
        }
        if (currentMapJSON) log('Map data embedded in replay file.');

        fetch(SAVE_SERVER, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-KRE-Map': 'unknown',
                'X-KRE-Version': VERSION
            },
            body: buildPayload(list)
        }).then(res => {
            if (res.ok) toast(`✅ 保存完了 (${list.length} pkts)`);
            else toast('❌ サーバーエラー', false);
        }).catch(() => {
            alert('❌ 保存サーバーに接続できません。\nSTART_SAVE_SERVER.bat が起動しているか確認してください。');
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'F7') {
            if (!recording) startRecording(false); else stopRecording();
        }

        if (e.key === 'F8') {
            log('===== DEBUG =====');
            log(`Recording: ${recording}, Saved frames: ${frames.length}, Auto: ${autoRecord}`);
            alert(`F8 Debug - Check console.\nRecorded frames: ${frames.length}`);
        }

        if (e.key === 'F9') {
            autoRecord = !autoRecord;
            try { localStorage.setItem('kre_auto', autoRecord ? '1' : '0'); } catch (err) {}
            toast(`自動録画: ${autoRecord ? 'ON' : 'OFF'}`);
            updateUI();
        }
    }, true);


    // Bootstrap UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initUI();
            setInterval(updateUI, 1000);
        });
    } else {
        initUI();
        setInterval(updateUI, 1000);
    }
    
    log(`Userscript v${VERSION} loaded`);
})();

// ==UserScript==
// @name         Krunker Replay Recorder (KRE)
// @namespace    http://tampermonkey.net/
// @version      2.1
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
    const VERSION     = '2.1';

    let recording = false;
    let frames = [];
    let startTime = 0;
    
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
        helpRow.innerText = '[F7] Start/Stop   [F8] Debug';

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
            statusText.innerText = 'RECORDING';
            statusText.style.color = '#ff0044';
            
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const s = String(elapsed % 60).padStart(2, '0');
            timeEl.innerText = `${m}:${s}`;
        } else {
            statusDot.style.background = '#00ff88';
            statusDot.style.boxShadow = '0 0 8px #00ff88';
            statusText.innerText = 'KRE IDLE';
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

    try {
        function interceptMessage(e) {
            try {
                if (e.data instanceof ArrayBuffer) {
                    if (recording) {
                        // 解凍せずにBase64に変換してそのまま記録（超軽量）
                        frames.push([Date.now(), buf2base64(e.data)]);
                    }
                }
            } catch(err) {}
        }

        const origAddEventListener = window.WebSocket.prototype.addEventListener;
        window.WebSocket.prototype.addEventListener = function(type, listener, options) {
            if (type === 'message' && !this._kreHookedAdd) {
                this._kreHookedAdd = true;
                origAddEventListener.call(this, 'message', interceptMessage);
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
                    if (data instanceof ArrayBuffer) {
                        frames.push([Date.now(), buf2base64(data), true]); // true = sent by client
                    } else if (data instanceof Uint8Array) {
                        frames.push([Date.now(), buf2base64(data), true]);
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
                            currentMapJSON = parsed;
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
                                currentMapJSON = parsed;
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
                        currentMapJSON = parsed;
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
    // 録画制御 (F7/F8)
    // =====================
    let localPlayerInterval = null;

    window.addEventListener('keydown', (e) => {
        if (e.key === 'F7') {
            if (!recording) {
                recording = true;
                frames = [];
                startTime = Date.now();
                log('Recording started');
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
                    } catch(err) {}
                }, 50); // 20FPS
            } else {
                recording = false;
                if (localPlayerInterval) clearInterval(localPlayerInterval);
                
                log(`Recording stopped. Saving ${frames.length} frames...`);
                updateUI();
                
                if (frames.length === 0) {
                    alert('⚠️ 保存エラー: 記録されたパケットが0件です');
                    return;
                }
                
                // Convert frames to JSON
                // Format: array of [t, [op, ...]]
                // マップデータがあれば先頭に挿入
                if (currentMapJSON) {
                    frames.unshift([startTime, ["kre_map_data", currentMapJSON]]);
                    log('Map data embedded in replay file.');
                }
                const jsonPayload = JSON.stringify(frames);
                
                fetch(SAVE_SERVER, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-KRE-Map': 'unknown',
                        'X-KRE-Version': '2.1'
                    },
                    body: jsonPayload
                }).then(res => {
                    if(res.ok) {
                        // Success toast
                        const toast = document.createElement('div');
                        toast.innerText = `✅ 保存完了 (${frames.length} pkts)`;
                        toast.style.cssText = 'position:fixed; top:80px; left:20px; background:#00ff88; color:#000; padding:5px 10px; border-radius:4px; z-index:999999; font-weight:bold; transition: opacity 1s;';
                        document.body.appendChild(toast);
                        setTimeout(() => { toast.style.opacity = '0'; setTimeout(()=>toast.remove(), 1000); }, 3000);
                    }
                    else alert('❌ サーバーエラー');
                }).catch(err => {
                    alert('❌ 保存サーバーに接続できません。\nSTART_SAVE_SERVER.bat が起動しているか確認してください。');
                });
            }
        }
        
        if (e.key === 'F8') {
            log('===== DEBUG =====');
            log(`Recording: ${recording}, Saved frames: ${frames.length}`);
            alert(`F8 Debug - Check console.\nRecorded frames: ${frames.length}`);
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

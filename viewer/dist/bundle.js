(() => {
  // viewer/js/State.js
  var State = {
    isPlaying: true,
    speed: 1,
    time: 0,
    duration: 300,
    mode: "idle",
    cameraMode: "free",
    targetPlayerId: 0,
    isSeeking: false,
    showScoreboard: false,
    camDistance: 30
  };
  var keys = { w: false, a: false, s: false, d: false, e: false, q: false, shift: false };
  var Shared = {
    realFrames: [],
    replayHeader: {},
    currentMapName: "Unknown",
    mapGroup: null,
    scene: null,
    camera: null,
    realMeshes: {},
    events: [],
    trails: [],
    playerInfo: null
  };
  function hexToNum(hex) {
    if (hex.startsWith("#")) hex = hex.slice(1);
    return parseInt(hex, 16);
  }
  function base64ToUint8Array(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes;
  }

  // viewer/js/Renderer_Scene.js
  var renderer;
  var clock;
  function initRenderer() {
    const container = document.getElementById("canvas-container");
    Shared.scene = new THREE.Scene();
    Shared.scene.background = new THREE.Color(657935);
    Shared.mapGroup = new THREE.Group();
    Shared.scene.add(Shared.mapGroup);
    const grid = new THREE.GridHelper(500, 100, 3355443, 1118481);
    Shared.scene.add(grid);
    Shared.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5e3);
    Shared.camera.position.set(0, 50, 100);
    Shared.camera.lookAt(0, 0, 0);
    Shared.camera.rotation.order = "YXZ";
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);
    const ambientLight = new THREE.AmbientLight(16777215, 0.6);
    Shared.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(16777215, 0.8);
    dirLight.position.set(50, 100, 50);
    Shared.scene.add(dirLight);
    window.addEventListener("resize", () => {
      Shared.camera.aspect = window.innerWidth / window.innerHeight;
      Shared.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    clock = new THREE.Clock();
  }

  // viewer/js/Constants.js
  var KRUNKER_CLASSES = {
    0: "Triggerman (AK)",
    1: "Hunter (Sniper)",
    2: "Run N Gun (SMG)",
    3: "Spray N Pray (LMG)",
    4: "Vince (Shotgun)",
    5: "Detective (Revolver)",
    6: "Marksman (Semi)",
    7: "Rocketeer (RPG)",
    8: "Agent (Uzi)",
    9: "Runner (Knife)",
    10: "Bowman (Crossbow)",
    11: "Commando (FAMAS)",
    12: "Trooper (Blaster)",
    13: "Survivor / Builder",
    14: "Infectious (Zombie)",
    15: "Defuser"
  };

  // viewer/js/Utils.js
  function escapeHTML(str) {
    if (str === null || str === void 0) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function upperBoundIndex(arr, value) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (arr[mid].timestamp <= value) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }
  function disposeObject(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
      if (o.dispose && o.isInstancedMesh) o.dispose();
    });
  }

  // viewer/js/Renderer_UI.js
  var TEAM_HEX = { 1: "#ff8800", 2: "#00ccff" };
  var _indexedEvents = null;
  var _kills = [];
  var _scoreboards = [];
  function indexEvents() {
    if (_indexedEvents === Shared.events) return;
    _indexedEvents = Shared.events;
    _kills = [];
    _scoreboards = [];
    (Shared.events || []).forEach((e) => {
      if (e.type === "kill") _kills.push(e);
      else if (e.type === "scoreboard") _scoreboards.push(e);
    });
    _statsCache = null;
    _playerLookup = null;
  }
  function recentKills(timeMs, windowMs) {
    indexEvents();
    const end = upperBoundIndex(_kills, timeMs);
    const out = [];
    for (let i = end; i >= 0 && timeMs - _kills[i].timestamp < windowMs; i--) out.push(_kills[i]);
    return out.reverse();
  }
  var _playerLookup = null;
  var _playerLookupSrc = null;
  function playerById(id) {
    if (_playerLookupSrc !== Shared.playerInfo || !_playerLookup) {
      _playerLookupSrc = Shared.playerInfo;
      _playerLookup = /* @__PURE__ */ new Map();
      if (Array.isArray(Shared.playerInfo)) {
        Shared.playerInfo.forEach((p) => _playerLookup.set(String(p.id), p));
      } else if (Shared.playerInfo && typeof Shared.playerInfo === "object") {
        Object.entries(Shared.playerInfo).forEach(([k, info]) => {
          _playerLookup.set(k, { id: k, pName: info.name || `Player ${k}`, team: info.team || 0 });
        });
      }
    }
    return _playerLookup.get(String(id));
  }
  var _statsCache = null;
  function computeDynamicStats(timeMs) {
    indexEvents();
    const bucket = Math.floor(timeMs / 100);
    if (_statsCache && _statsCache.bucket === bucket && _statsCache.src === Shared.playerInfo) {
      return _statsCache.value;
    }
    const dynamicStats = {};
    if (Array.isArray(Shared.playerInfo)) {
      Shared.playerInfo.forEach((p) => {
        dynamicStats[String(p.id)] = { ...p, kills: 0, deaths: 0, score: 0, obj: 0 };
      });
    } else if (Shared.playerInfo && typeof Shared.playerInfo === "object") {
      Object.entries(Shared.playerInfo).forEach(([id, info]) => {
        dynamicStats[id] = { id, pName: info.name || `Player ${id}`, team: info.team || 0, kills: 0, deaths: 0, score: 0, obj: 0 };
      });
    }
    const killEnd = upperBoundIndex(_kills, timeMs);
    for (let i = 0; i <= killEnd; i++) {
      const e = _kills[i];
      const k = dynamicStats[String(e.killer)];
      const v = dynamicStats[String(e.victim)];
      if (k) {
        k.kills++;
        k.score += e.headshot ? 100 : 50;
      }
      if (v) v.deaths++;
    }
    let isObjMode = false;
    let latest = null;
    if (_scoreboards.length > 0) {
      const idx = upperBoundIndex(_scoreboards, timeMs);
      latest = _scoreboards[Math.max(0, idx)];
      isObjMode = latest.isObjMode;
    }
    if (latest) {
      for (const sid in latest.scores) {
        const key = String(sid);
        if (!dynamicStats[key]) {
          dynamicStats[key] = { id: Number(sid), pName: `Player ${sid}`, team: 0, kills: 0, deaths: 0, score: 0, obj: 0 };
        }
        const pScore = latest.scores[sid];
        if (pScore.score !== void 0) dynamicStats[key].score = pScore.score;
        if (pScore.kills !== void 0) dynamicStats[key].kills = pScore.kills;
        if (pScore.deaths !== void 0) dynamicStats[key].deaths = pScore.deaths;
        if (pScore.obj !== void 0) dynamicStats[key].obj = pScore.obj;
      }
    }
    const value = { dynamicStats, isObjMode };
    _statsCache = { bucket, src: Shared.playerInfo, value };
    return value;
  }
  var _lastHudHtml = "";
  var _lastCardClass = /* @__PURE__ */ new Map();
  function updateDynamicHUD(currentFrame) {
    if (!currentFrame || !State.targetPlayerId) return;
    const p = currentFrame.players.find((x) => x.id == State.targetPlayerId);
    if (!p) return;
    const className = p.classId === void 0 || p.classId === null ? "" : KRUNKER_CLASSES[p.classId] || `Class ${p.classId}`;
    const classHud = document.getElementById("class-hud");
    if (classHud && classHud.style.display !== "none") {
      const pName = p.name || `Player ${p.id}`;
      const hp = p.health || 0;
      const maxHp = p.maxHealth || 100;
      const hpPercent = Math.max(0, Math.min(100, hp / maxHp * 100));
      let hpColor = "#00ff88";
      if (hpPercent < 30) hpColor = "#ff3333";
      else if (hpPercent < 60) hpColor = "#ffcc00";
      const { dynamicStats } = computeDynamicStats(State.time * 1e3);
      const stats = dynamicStats[String(p.id)] || { kills: 0, deaths: 0, score: 0 };
      const kd = stats.deaths === 0 ? stats.kills : (stats.kills / stats.deaths).toFixed(2);
      const html = `
            <div>Spectating: <span style="color:#00ff88">${escapeHTML(pName)}</span></div>
            <div style="font-size:12px; opacity:0.8; margin-bottom:6px;">${escapeHTML(className)}</div>
            <div style="width:100%; height:8px; background:rgba(255,255,255,0.15); border-radius:4px; overflow:hidden; margin-bottom:6px;">
                <div style="height:100%; width:${hpPercent}%; background:${hpColor};"></div>
            </div>
            <div style="font-size:11px; opacity:0.9; margin-bottom:6px;">HP ${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}</div>
            <div style="display:flex; justify-content:center; gap:12px; font-size:12px; font-family:monospace;">
                <span>Score: <b>${stats.score}</b></span>
                <span>K: <b>${stats.kills}</b></span>
                <span>D: <b>${stats.deaths}</b></span>
                <span>K/D: <b>${kd}</b></span>
            </div>
        `;
      if (html !== _lastHudHtml) {
        classHud.innerHTML = html;
        _lastHudHtml = html;
      }
    }
    if (className && _lastCardClass.get(p.id) !== className) {
      _lastCardClass.set(p.id, className);
      const pCard = document.querySelector(`.player-card[data-id="${p.id}"] .class-text`);
      if (pCard) pCard.innerText = className;
    }
  }
  var MINIMAP_SIZE = 200;
  var _minimapCtx = null;
  function drawMinimap() {
    const canvas = document.getElementById("minimap");
    if (!canvas) return;
    if (!_minimapCtx || canvas.width !== MINIMAP_SIZE) {
      canvas.width = MINIMAP_SIZE;
      canvas.height = MINIMAP_SIZE;
      _minimapCtx = canvas.getContext("2d");
    }
    const ctx = _minimapCtx;
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(10, 10, 180, 180);
    if (State.mode !== "real" || !Shared.playBounds) return;
    const b = Shared.playBounds;
    const rangeX = Math.max(b.maxX - b.minX, 50);
    const rangeZ = Math.max(b.maxZ - b.minZ, 50);
    const scale = Math.min(160 / rangeX, 160 / rangeZ);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    for (const id in Shared.realMeshes) {
      const mesh = Shared.realMeshes[id];
      if (!mesh || mesh.visible === false) continue;
      const x = 100 + (mesh.position.x - cx) * scale;
      const y = 100 + (mesh.position.z - cz) * scale;
      const isTarget = Number(id) === State.targetPlayerId;
      const team = mesh.userData.team;
      ctx.fillStyle = team === 1 ? "#ff8800" : team === 2 ? "#00ccff" : "#4d6bff";
      ctx.beginPath();
      ctx.arc(x, y, isTarget ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (isTarget) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const yaw = mesh.rotation.y;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.sin(yaw) * 9, y - Math.cos(yaw) * 9);
      ctx.stroke();
    }
  }
  var _tags = /* @__PURE__ */ new Map();
  var _tagPos = new THREE.Vector3();
  function resetNametags() {
    _tags.clear();
    const layer = document.getElementById("nametags-layer");
    if (layer) layer.innerHTML = "";
    _lastCardClass = /* @__PURE__ */ new Map();
    _lastHudHtml = "";
  }
  function createTag(id, layer) {
    const div = document.createElement("div");
    div.className = "nametag";
    div.style.cssText = "background: transparent; color: white; padding: 0; border-radius: 0;";
    div.innerHTML = `<div class="nametag-name"></div><div class="nametag-hp-bar"><div class="nametag-hp-fill"></div></div>`;
    layer.appendChild(div);
    const tag = {
      div,
      name: div.querySelector(".nametag-name"),
      fill: div.querySelector(".nametag-hp-fill"),
      text: null,
      team: null,
      hp: null,
      shown: true,
      transform: ""
    };
    _tags.set(id, tag);
    return tag;
  }
  function hideTag(tag) {
    if (tag && tag.shown) {
      tag.div.style.display = "none";
      tag.shown = false;
    }
  }
  function updateNametags(currentFrame) {
    const layer = document.getElementById("nametags-layer");
    if (!layer) return;
    if (State.mode !== "real" || !currentFrame) {
      if (_tags.size) resetNametags();
      return;
    }
    for (const id in Shared.realMeshes) {
      const mesh = Shared.realMeshes[id];
      let tag = _tags.get(id);
      const pData = currentFrame.players.find((p) => p.id == id);
      if (!pData || pData.health <= 0 || !mesh.visible || State.cameraMode === "1st" && Number(id) === State.targetPlayerId) {
        hideTag(tag);
        continue;
      }
      if (!tag) tag = createTag(id, layer);
      _tagPos.copy(mesh.position);
      _tagPos.y += 12;
      _tagPos.project(Shared.camera);
      if (_tagPos.z > 1) {
        hideTag(tag);
        continue;
      }
      if (!tag.shown) {
        tag.div.style.display = "block";
        tag.shown = true;
      }
      const text = pData.name || `Player ${id}`;
      if (text !== tag.text) {
        tag.name.innerText = text;
        tag.text = text;
      }
      if (pData.team !== tag.team) {
        tag.name.style.background = pData.team === 1 ? "rgba(255, 136, 0, 0.85)" : pData.team === 2 ? "rgba(0, 204, 255, 0.85)" : "rgba(0,0,0,0.6)";
        tag.team = pData.team;
      }
      const maxHp = pData.maxHealth || 100;
      const hpPercent = Math.max(0, Math.min(100, (pData.health || 0) / maxHp * 100));
      const hpKey = Math.round(hpPercent);
      if (hpKey !== tag.hp) {
        tag.fill.style.width = hpKey + "%";
        tag.fill.style.background = hpPercent < 30 ? "#ff0000" : hpPercent < 60 ? "#ffff00" : "#00ff00";
        tag.hp = hpKey;
      }
      const x = Math.round((_tagPos.x * 0.5 + 0.5) * window.innerWidth);
      const y = Math.round((-(_tagPos.y * 0.5) + 0.5) * window.innerHeight);
      const transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      if (transform !== tag.transform) {
        tag.div.style.transform = transform;
        tag.transform = transform;
      }
    }
  }
  var _lastKillLogKey = null;
  function updateKillLog() {
    const killLogContainer = document.getElementById("kill-log");
    if (!killLogContainer || !Shared.events || State.mode !== "real") return;
    const recent = recentKills(State.time * 1e3, 5e3);
    const key = recent.map((k) => `${k.timestamp}:${k.killer}:${k.victim}`).join("|") + `#${Shared.playerInfo ? Shared.playerInfo.length : 0}`;
    if (key === _lastKillLogKey) return;
    _lastKillLogKey = key;
    killLogContainer.innerHTML = "";
    recent.forEach((k) => {
      const kP = playerById(k.killer);
      const vP = playerById(k.victim);
      const killerName = kP && kP.pName || "Unknown";
      const victimName = vP && vP.pName || "Unknown";
      const killerColor = TEAM_HEX[kP && kP.team] || "#ffffff";
      const victimColor = TEAM_HEX[vP && vP.team] || "#ffffff";
      const row = document.createElement("div");
      row.style.cssText = "display:flex; align-items:center; padding:2px 5px; border-radius:3px; background:transparent; font-size:12px; font-family:monospace;";
      row.innerHTML = `
            <span style="color: ${killerColor}; font-weight: bold;">${escapeHTML(killerName)}</span>
            <span style="margin: 0 8px; font-size: 10px; color: #fff;">${k.headshot ? "\u{1F480}" : "\u{1F52B}"}</span>
            <span style="color: ${victimColor}; font-weight: bold;">${escapeHTML(victimName)}</span>
        `;
      killLogContainer.appendChild(row);
    });
  }
  var _lastScoreboardHtml = "";
  function updateScoreboard() {
    let sb = document.getElementById("scoreboard");
    if (!sb) {
      sb = document.createElement("div");
      sb.id = "scoreboard";
      document.body.appendChild(sb);
    }
    if (!(State.showScoreboard && Shared.playerInfo)) {
      sb.classList.remove("show");
      return;
    }
    sb.classList.add("show");
    const { dynamicStats, isObjMode } = computeDynamicStats(State.time * 1e3);
    const players = Object.values(dynamicStats).sort((a, b) => b.score - a.score);
    let html = '<h2 style="text-align:center; margin-top:0; color:#fff;">SCOREBOARD</h2>';
    html += '<table style="width:100%; border-collapse: collapse; text-align: left;">';
    html += '<tr style="border-bottom: 2px solid rgba(255,255,255,0.2);">';
    html += '<th style="padding: 8px;">Name</th><th style="padding: 8px;">Score</th><th style="padding: 8px;">Kills</th><th style="padding: 8px;">Deaths</th>';
    if (isObjMode) html += '<th style="padding: 8px;">OBJ</th>';
    html += '<th style="padding: 8px;">K/D</th></tr>';
    players.forEach((p) => {
      const color = TEAM_HEX[p.team] || "#fff";
      const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
      html += '<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">';
      html += `<td style="padding: 8px; color: ${color}; font-weight: bold;">${escapeHTML(p.pName)}</td>`;
      html += `<td style="padding: 8px;">${p.score}</td><td style="padding: 8px;">${p.kills}</td><td style="padding: 8px;">${p.deaths}</td>`;
      if (isObjMode) html += `<td style="padding: 8px;">${p.obj}</td>`;
      html += `<td style="padding: 8px; color: #aaa;">${kd}</td></tr>`;
    });
    html += "</table>";
    if (html !== _lastScoreboardHtml) {
      sb.innerHTML = html;
      _lastScoreboardHtml = html;
    }
  }
  var _hm = null;
  var _ch = null;
  function drawHitmarkers() {
    if (!_hm) {
      _hm = document.createElement("div");
      _hm.id = "hitmarker";
      _hm.style.cssText = `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 20px; height: 20px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cline x1='4' y1='4' x2='20' y2='20'/%3E%3Cline x1='20' y1='4' x2='4' y2='20'/%3E%3C/svg%3E"); opacity: 0; transition: opacity 0.1s ease-out; pointer-events: none; z-index: 100;`;
      document.body.appendChild(_hm);
      _ch = document.createElement("div");
      _ch.id = "crosshair";
      _ch.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 6px; height: 6px; background: rgba(255,255,255,0.8); border-radius: 50%; display: none; pointer-events: none; z-index: 99;";
      document.body.appendChild(_ch);
    }
    const following = State.mode === "real" && (State.cameraMode === "1st" || State.cameraMode === "3rd");
    _ch.style.display = following ? "block" : "none";
    let hit = null;
    if (following) {
      hit = recentKills(State.time * 1e3, 300).filter((e) => e.killer == State.targetPlayerId);
    }
    if (hit && hit.length > 0) {
      _hm.style.opacity = "1";
      _hm.style.filter = hit.some((e) => e.headshot) ? "drop-shadow(0 0 4px red)" : "none";
    } else {
      _hm.style.opacity = "0";
    }
  }

  // viewer/js/Renderer_Camera.js
  var _dir = new THREE.Vector3();
  var _right = new THREE.Vector3();
  var EYE_HEIGHT = 11.5;
  function updateCamera(delta, currentFrame) {
    const cam = Shared.camera;
    if (State.cameraMode === "free") {
      const moveSpeed = 100 * delta * (keys.shift ? 3 : 1);
      cam.getWorldDirection(_dir);
      _dir.y = 0;
      _dir.normalize();
      _right.crossVectors(_dir, cam.up).normalize();
      if (keys.w) cam.position.addScaledVector(_dir, moveSpeed);
      if (keys.s) cam.position.addScaledVector(_dir, -moveSpeed);
      if (keys.a) cam.position.addScaledVector(_right, -moveSpeed);
      if (keys.d) cam.position.addScaledVector(_right, moveSpeed);
      if (keys.e) cam.position.y += moveSpeed;
      if (keys.q) cam.position.y -= moveSpeed;
    }
    const classHud = document.getElementById("class-hud");
    let showHud = false;
    if ((State.cameraMode === "1st" || State.cameraMode === "3rd") && State.mode === "real") {
      const target = Shared.realMeshes[State.targetPlayerId];
      if (target && target.visible !== false) {
        const yaw = target.rotation.y;
        const pitch = target.userData.pitch || 0;
        cam.rotation.order = "YXZ";
        if (State.cameraMode === "1st") {
          cam.position.copy(target.position);
          cam.position.y += EYE_HEIGHT;
          cam.rotation.set(pitch, yaw, 0);
        } else {
          const dist = State.camDistance;
          cam.position.x = target.position.x + Math.sin(yaw) * dist;
          cam.position.z = target.position.z + Math.cos(yaw) * dist;
          cam.position.y = target.position.y + dist * 0.5;
          cam.lookAt(target.position.x, target.position.y + 6, target.position.z);
        }
        showHud = true;
      }
    }
    if (classHud) classHud.style.display = showHud ? "block" : "none";
  }

  // viewer/js/Renderer_Tracers.js
  var TRACER_LIFETIME_MS = 400;
  var MAX_TRACERS = 300;
  var _tracerGeo = null;
  function getTracerGeo() {
    if (!_tracerGeo) {
      _tracerGeo = new THREE.CylinderGeometry(0.8, 0.8, 4, 6);
      _tracerGeo.translate(0, 2, 0);
      _tracerGeo.rotateX(Math.PI / 2);
    }
    return _tracerGeo;
  }
  function addTrail(mesh, origin, dir) {
    if (!Shared.trails) Shared.trails = [];
    while (Shared.trails.length >= MAX_TRACERS) removeTrail(Shared.trails.shift());
    Shared.scene.add(mesh);
    Shared.trails.push({
      mesh,
      createdAt: State.time,
      // 実時間ではなくリプレイ時間基準 (一時停止・倍速・シークに追従)
      origin: origin.clone(),
      velocity: dir.multiplyScalar(800)
    });
  }
  function removeTrail(t) {
    Shared.scene.remove(t.mesh);
    if (t.mesh.material) t.mesh.material.dispose();
  }
  function clearTracers() {
    if (!Shared.trails) {
      Shared.trails = [];
      return;
    }
    Shared.trails.forEach(removeTrail);
    Shared.trails = [];
  }
  function spawnTracer(mesh, p) {
    const origin = mesh.position.clone();
    origin.y += 5;
    const dir = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(p.rot[1] || 0, p.rot[0] || 0, 0, "YXZ");
    dir.applyEuler(euler);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 16763904, transparent: true, opacity: 1 });
    const tracerMesh = new THREE.Mesh(getTracerGeo(), tracerMat);
    tracerMesh.position.copy(origin);
    tracerMesh.rotation.order = "YXZ";
    tracerMesh.rotation.set(p.rot[1] || 0, p.rot[0] || 0, 0);
    addTrail(tracerMesh, origin, dir);
  }
  function spawnProjectile(proj) {
    if (!proj || !proj.pos) return;
    const origin = new THREE.Vector3(proj.pos[0], proj.pos[1], proj.pos[2]);
    const dir = new THREE.Vector3(0, 0, -1);
    let owner = proj.ownerId !== void 0 ? Shared.realMeshes[proj.ownerId] : null;
    if (!owner || !owner.visible) {
      owner = null;
      for (const mesh of Object.values(Shared.realMeshes)) {
        if (mesh && mesh.visible && origin.distanceTo(mesh.position) < 30) {
          owner = mesh;
          break;
        }
      }
    }
    if (owner) dir.applyQuaternion(owner.quaternion);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 16763904, transparent: true, opacity: 1 });
    const tracerMesh = new THREE.Mesh(getTracerGeo(), tracerMat);
    tracerMesh.position.copy(origin);
    tracerMesh.lookAt(origin.clone().add(dir));
    addTrail(tracerMesh, origin, dir);
  }
  function updateTracers() {
    if (!Shared.trails || Shared.trails.length === 0) return;
    for (let i = Shared.trails.length - 1; i >= 0; i--) {
      const t = Shared.trails[i];
      const ageMs = (State.time - t.createdAt) * 1e3;
      if (ageMs < 0 || ageMs > TRACER_LIFETIME_MS) {
        removeTrail(t);
        Shared.trails.splice(i, 1);
      } else {
        const scale = ageMs / 1e3;
        t.mesh.position.set(
          t.origin.x + t.velocity.x * scale,
          t.origin.y + t.velocity.y * scale,
          t.origin.z + t.velocity.z * scale
        );
        t.mesh.material.opacity = 1 - ageMs / TRACER_LIFETIME_MS;
      }
    }
  }

  // viewer/js/UI.js
  function showToast(message, type = "error") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = message;
    if (type === "success") toast.style.background = "rgba(0, 212, 255, 0.8)";
    if (type === "warning") toast.style.background = "rgba(255, 153, 0, 0.8)";
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4e3);
  }
  var camYaw = 0;
  var camPitch = 0;
  function updateCamBtns() {
    const map = { free: "cam-free", "1st": "cam-1st", "3rd": "cam-3rd" };
    Object.entries(map).forEach(([mode, id]) => {
      const b = document.getElementById(id);
      if (b) b.style.background = State.cameraMode === mode ? "rgba(0, 212, 255, 0.5)" : "rgba(0,0,0,0.5)";
    });
  }
  function setCameraMode(mode) {
    State.cameraMode = mode;
    if (mode === "free" && Shared.camera) {
      Shared.camera.rotation.order = "YXZ";
      camYaw = Shared.camera.rotation.y;
      camPitch = Shared.camera.rotation.x;
    }
    updateCamBtns();
  }
  function setPlaying(playing) {
    State.isPlaying = playing;
    const btn = document.getElementById("btn-play-pause");
    if (btn) btn.innerText = playing ? "Pause" : "Play";
  }
  function togglePlay() {
    setPlaying(!State.isPlaying);
    const ind = document.getElementById("play-pause-indicator");
    if (ind) {
      ind.innerText = State.isPlaying ? "\u25B6" : "\u23F8";
      ind.style.animation = "none";
      ind.offsetHeight;
      ind.style.animation = "popOut 0.5s ease-out forwards";
    }
  }
  function setupUI() {
    window.addEventListener("error", (e) => showToast("Error: " + e.message));
    window.addEventListener("unhandledrejection", (e) => showToast("Error: " + (e.reason && e.reason.message || e.reason)));
    let isDragging = false;
    document.addEventListener("mousedown", (e) => {
      if (e.target.tagName !== "CANVAS") return;
      isDragging = true;
    });
    document.addEventListener("mouseup", () => {
      isDragging = false;
    });
    window.addEventListener("blur", () => {
      isDragging = false;
      keys.w = keys.a = keys.s = keys.d = keys.e = keys.q = keys.shift = false;
    });
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", fn);
    };
    bind("cam-free", () => setCameraMode("free"));
    bind("cam-1st", () => setCameraMode("1st"));
    bind("cam-3rd", () => setCameraMode("3rd"));
    updateCamBtns();
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (t && (t.tagName === "BUTTON" || t.tagName === "SELECT")) t.blur();
    });
    document.addEventListener("mousemove", (e) => {
      if (!isDragging || State.cameraMode !== "free" || !Shared.camera) return;
      camYaw -= e.movementX * 5e-3;
      camPitch -= e.movementY * 5e-3;
      camPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, camPitch));
      Shared.camera.rotation.set(camPitch, camYaw, 0);
    });
    const _wheelDir = new THREE.Vector3();
    document.addEventListener("wheel", (e) => {
      if (e.target.tagName !== "CANVAS" || !Shared.camera) return;
      if (State.cameraMode === "free") {
        Shared.camera.getWorldDirection(_wheelDir);
        Shared.camera.position.addScaledVector(_wheelDir, e.deltaY * -0.1);
      } else if (State.cameraMode === "3rd") {
        State.camDistance = Math.max(8, Math.min(150, State.camDistance + e.deltaY * 0.05));
      }
    }, { passive: true });
    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.code) {
        case "Space":
          togglePlay();
          e.preventDefault();
          break;
        case "KeyW":
          keys.w = true;
          break;
        case "KeyA":
          keys.a = true;
          break;
        case "KeyS":
          keys.s = true;
          break;
        case "KeyD":
          keys.d = true;
          break;
        case "KeyE":
          keys.e = true;
          break;
        case "KeyQ":
          keys.q = true;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          keys.shift = true;
          break;
        case "KeyF":
          setCameraMode("free");
          break;
        case "Digit1":
          setCameraMode("1st");
          break;
        case "Digit3":
          setCameraMode("3rd");
          break;
        case "ArrowRight":
          State.time = Math.min(State.duration, State.time + 5);
          break;
        case "ArrowLeft":
          State.time = Math.max(0, State.time - 5);
          break;
        case "Tab":
          e.preventDefault();
          State.showScoreboard = true;
          break;
      }
    });
    document.addEventListener("keyup", (e) => {
      switch (e.code) {
        case "KeyW":
          keys.w = false;
          break;
        case "KeyA":
          keys.a = false;
          break;
        case "KeyS":
          keys.s = false;
          break;
        case "KeyD":
          keys.d = false;
          break;
        case "KeyE":
          keys.e = false;
          break;
        case "KeyQ":
          keys.q = false;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          keys.shift = false;
          break;
        case "Tab":
          e.preventDefault();
          State.showScoreboard = false;
          break;
      }
    });
    document.getElementById("btn-help").onclick = () => document.getElementById("help-modal").classList.add("active");
    document.getElementById("close-help").onclick = () => document.getElementById("help-modal").classList.remove("active");
    const timelineBar = document.getElementById("timeline-bar");
    if (timelineBar) {
      timelineBar.addEventListener("mousedown", (e) => {
        State.isSeeking = true;
        updateTimelineDrag(e, timelineBar);
      });
      document.addEventListener("mousemove", (e) => {
        if (State.isSeeking) updateTimelineDrag(e, timelineBar);
      });
      document.addEventListener("mouseup", () => {
        State.isSeeking = false;
      });
    }
    const speedSelect = document.getElementById("speed-select");
    if (speedSelect) {
      speedSelect.addEventListener("change", (e) => {
        State.speed = parseFloat(e.target.value);
      });
    }
    bind("btn-play-pause", () => setPlaying(!State.isPlaying));
  }
  function updateTimelineDrag(e, timelineBar) {
    const rect = timelineBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    State.time = pct * State.duration;
  }

  // viewer/js/Renderer_Players.js
  var BODY_GEO = new THREE.BoxGeometry(4, 10, 4);
  var HEAD_GEO = new THREE.BoxGeometry(3, 3, 3);
  var SIGHT_GEO = new THREE.BoxGeometry(0.5, 0.5, 15);
  var HEAD_MAT = new THREE.MeshLambertMaterial({ color: 16777215 });
  var SIGHT_MAT = new THREE.MeshBasicMaterial({ color: 16711680 });
  var TEAM_COLORS = { 0: 255, 1: 16746496, 2: 52479 };
  var BODY_MATS = {};
  function bodyMaterial(team) {
    const key = TEAM_COLORS[team] !== void 0 ? team : 0;
    if (!BODY_MATS[key]) BODY_MATS[key] = new THREE.MeshLambertMaterial({ color: TEAM_COLORS[key] });
    return BODY_MATS[key];
  }
  function createPlayerMesh(team = 0) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(BODY_GEO, bodyMaterial(team));
    body.position.y = 5;
    group.add(body);
    const head = new THREE.Mesh(HEAD_GEO, HEAD_MAT);
    head.position.y = 11.5;
    group.add(head);
    const sightMesh = new THREE.Mesh(SIGHT_GEO, SIGHT_MAT);
    sightMesh.position.set(0, 11.5, -7.5);
    group.add(sightMesh);
    group.userData.team = team;
    return group;
  }
  function setMeshTeam(mesh, team) {
    if (mesh.userData.team === team) return;
    mesh.userData.team = team;
    mesh.children[0].material = bodyMaterial(team);
  }
  function setupRealPlayers() {
    const listContent = document.getElementById("player-list-content");
    listContent.innerHTML = "";
    if (Shared.realMeshes) {
      Object.values(Shared.realMeshes).forEach((mesh) => Shared.scene.remove(mesh));
    }
    Shared.realMeshes = {};
    resetNametags();
    clearTracers();
    Shared.seenProjectileIds = /* @__PURE__ */ new Set();
    const uniqueIds = /* @__PURE__ */ new Set();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    Shared.realFrames.forEach((f) => f.players.forEach((p) => {
      uniqueIds.add(p.id);
      if (p.pos[0] < minX) minX = p.pos[0];
      if (p.pos[0] > maxX) maxX = p.pos[0];
      if (p.pos[2] < minZ) minZ = p.pos[2];
      if (p.pos[2] > maxZ) maxZ = p.pos[2];
    }));
    Shared.playBounds = isFinite(minX) ? { minX, maxX, minZ, maxZ } : null;
    const players = Array.from(uniqueIds).map((id) => {
      let pName = `Player ${id}`;
      let team = 0;
      let classId = -1;
      for (let i = Shared.realFrames.length - 1; i >= 0; i--) {
        const f = Shared.realFrames[i];
        const p = f.players.find((x) => x.id === id);
        if (p) {
          if (p.name && !p.name.startsWith("Player ")) pName = p.name;
          if (p.team !== void 0) team = p.team;
          if (p.classId !== void 0 && p.classId !== -1) {
            classId = p.classId;
            break;
          }
        }
      }
      if (classId === -1) classId = 0;
      let kills = 0;
      let deaths = 0;
      let score = 0;
      if (Shared.events) {
        Shared.events.forEach((e) => {
          if (e.type === "kill") {
            if (e.killer == id) {
              kills++;
              score += e.headshot ? 100 : 50;
            }
            if (e.victim == id) {
              deaths++;
            }
          }
        });
      }
      return { id, pName, team, classId, kills, deaths, score };
    });
    if (!Array.isArray(Shared.playerInfo) || Shared.playerInfo.length === 0) {
      Shared.playerInfo = players;
    } else {
      players.forEach((p) => {
        const existing = Shared.playerInfo.find((x) => x.id === p.id);
        if (existing) {
          existing.kills = p.kills;
          existing.deaths = p.deaths;
          existing.score = p.score;
        }
      });
    }
    players.sort((a, b) => a.team - b.team);
    let classHud = document.getElementById("class-hud");
    if (!classHud) {
      classHud = document.createElement("div");
      classHud.id = "class-hud";
      classHud.style.cssText = "position: absolute; bottom: 110px; left: 50%; transform: translateX(-50%); min-width: 220px; background: rgba(0,0,0,0.6); color: white; padding: 10px 20px; border-radius: 8px; font-family: monospace; font-size: 16px; font-weight: bold; pointer-events: none; z-index: 100; text-align: center; border: 1px solid rgba(255,255,255,0.2); display: none;";
      document.body.appendChild(classHud);
    }
    players.forEach((p) => {
      const mesh = createPlayerMesh(p.team);
      Shared.scene.add(mesh);
      Shared.realMeshes[p.id] = mesh;
      let bgColor = "rgba(255, 255, 255, 0.1)";
      if (p.team === 1) bgColor = "rgba(255, 136, 0, 0.4)";
      else if (p.team === 2) bgColor = "rgba(0, 204, 255, 0.4)";
      const className = KRUNKER_CLASSES[p.classId] || `Class ${p.classId}`;
      const div = document.createElement("div");
      div.className = "player-card";
      div.dataset.id = p.id;
      div.style.backgroundColor = bgColor;
      div.style.color = "#fff";
      div.innerHTML = `
            <div style="padding: 4px 8px;">
                <div class="player-name-text" style="font-size: 13px; font-weight: bold;">${escapeHTML(p.pName)}</div>
                <div class="class-text" style="font-size: 10px; opacity: 0.8; margin-top: 2px;">${escapeHTML(className)}</div>
            </div>
        `;
      div.onclick = () => {
        State.targetPlayerId = p.id;
        document.querySelectorAll(".player-card").forEach((el) => el.classList.remove("active"));
        div.classList.add("active");
        setCameraMode(State.cameraMode === "1st" ? "1st" : "3rd");
      };
      listContent.appendChild(div);
    });
    if (players.length > 0) {
      State.targetPlayerId = players[0].id;
      const firstCard = listContent.querySelector(".player-card");
      if (firstCard) firstCard.classList.add("active");
    }
    if (!document.getElementById("kill-log")) {
      const kl = document.createElement("div");
      kl.id = "kill-log";
      kl.style.position = "absolute";
      kl.style.top = "120px";
      kl.style.right = "10px";
      kl.style.width = "280px";
      kl.style.display = "flex";
      kl.style.flexDirection = "column";
      kl.style.gap = "3px";
      kl.style.pointerEvents = "none";
      kl.style.zIndex = "10";
      document.body.appendChild(kl);
    }
  }

  // viewer/js/Renderer_Loop.js
  var _targetPos = new THREE.Vector3();
  var _nextPos = new THREE.Vector3();
  var _yAxis = new THREE.Vector3(0, 1, 0);
  var MAX_DELTA = 0.1;
  var SEEK_JUMP_SEC = 0.5;
  var PROJECTILE_LOOKBACK_MS = 500;
  var _lastTimeSec = 0;
  var _projCursor = -1;
  var _timeEl = null;
  var _playheadEl = null;
  var _lastTimeText = "";
  var _lastPercent = -1;
  function wrapAngleDiff(diff) {
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return diff;
  }
  function formatTime(sec) {
    const m = Math.floor(sec / 60) || 0;
    const s = Math.floor(sec % 60 || 0).toString().padStart(2, "0");
    return `${m}:${s}`;
  }
  function updateTimeDisplay() {
    if (!_timeEl) _timeEl = document.getElementById("time-display");
    if (!_playheadEl) _playheadEl = document.getElementById("playhead");
    const percent = State.duration > 0 ? State.time / State.duration * 100 : 0;
    if (_playheadEl && Math.abs(percent - _lastPercent) > 0.01) {
      _playheadEl.style.left = percent + "%";
      _lastPercent = percent;
    }
    const text = `${formatTime(State.time)} / ${formatTime(State.duration)}`;
    if (_timeEl && text !== _lastTimeText) {
      _timeEl.innerText = text;
      _lastTimeText = text;
    }
  }
  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), MAX_DELTA);
    if (State.isPlaying && !State.isSeeking) {
      State.time += delta * State.speed;
      if (State.time > State.duration) State.time = 0;
    }
    const jumped = Math.abs(State.time - _lastTimeSec) > SEEK_JUMP_SEC;
    if (jumped || State.time < _lastTimeSec) {
      if (jumped) {
        Shared.seenProjectileIds = /* @__PURE__ */ new Set();
        clearTracers();
      }
      if (State.time < _lastTimeSec) _projCursor = -1;
    }
    _lastTimeSec = State.time;
    updateTimeDisplay();
    let currentFrame = null;
    let frameIdx = -1;
    if (State.mode === "real" && Shared.realFrames.length > 0) {
      const timeMs = State.time * 1e3;
      frameIdx = Math.max(0, upperBoundIndex(Shared.realFrames, timeMs));
      currentFrame = Shared.realFrames[frameIdx];
      const nextFrame = frameIdx < Shared.realFrames.length - 1 ? Shared.realFrames[frameIdx + 1] : null;
      const dt = nextFrame ? nextFrame.timestamp - currentFrame.timestamp : 0;
      const lerpFactor = dt > 0 ? Math.min(1, Math.max(0, (timeMs - currentFrame.timestamp) / dt)) : 0;
      for (const id in Shared.realMeshes) Shared.realMeshes[id].visible = false;
      currentFrame.players.forEach((p) => {
        let mesh = Shared.realMeshes[p.id];
        if (!mesh) {
          mesh = createPlayerMesh(p.team);
          Shared.scene.add(mesh);
          Shared.realMeshes[p.id] = mesh;
        }
        setMeshTeam(mesh, p.team);
        mesh.visible = p.health !== 0;
        if (!mesh.visible) return;
        _targetPos.set(p.pos[0], p.pos[1], p.pos[2]);
        let targetYaw = p.rot[0] || 0;
        let targetPitch = p.rot[1] || 0;
        if (nextFrame) {
          const nextP = nextFrame.players.find((x) => x.id === p.id);
          if (nextP && nextP.health > 0) {
            _nextPos.set(nextP.pos[0], nextP.pos[1], nextP.pos[2]);
            if (_targetPos.distanceTo(_nextPos) < 100) {
              _targetPos.lerp(_nextPos, lerpFactor);
              targetYaw += wrapAngleDiff((nextP.rot[0] || 0) - targetYaw) * lerpFactor;
              targetPitch += ((nextP.rot[1] || 0) - targetPitch) * lerpFactor;
            }
          }
        }
        mesh.position.copy(_targetPos);
        mesh.quaternion.setFromAxisAngle(_yAxis, targetYaw);
        mesh.userData.pitch = targetPitch;
        if (State.isPlaying && !jumped && p.shoot && !mesh.userData.lastShoot) {
          spawnTracer(mesh, p);
        }
        mesh.userData.lastShoot = p.shoot;
      });
      if (State.isPlaying) {
        if (_projCursor > frameIdx) _projCursor = frameIdx;
        const startIdx = _projCursor < 0 ? frameIdx : _projCursor + 1;
        for (let i = startIdx; i <= frameIdx; i++) {
          const f = Shared.realFrames[i];
          if (!f.projectiles || timeMs - f.timestamp > PROJECTILE_LOOKBACK_MS) continue;
          if (!Shared.seenProjectileIds) Shared.seenProjectileIds = /* @__PURE__ */ new Set();
          f.projectiles.forEach((proj) => {
            const key = `${proj.ownerId}:${proj.id}`;
            if (Shared.seenProjectileIds.has(key)) return;
            Shared.seenProjectileIds.add(key);
            spawnProjectile(proj);
          });
        }
        _projCursor = frameIdx;
      }
      updateTracers();
    }
    updateCamera(delta, currentFrame);
    updateNametags(currentFrame);
    updateKillLog(currentFrame);
    updateScoreboard();
    drawHitmarkers();
    updateDynamicHUD(currentFrame);
    drawMinimap();
    renderer.render(Shared.scene, Shared.camera);
  }

  // viewer/js/Parser_KRE.js
  async function inflate(compressed) {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
  async function parseKRE(arrayBuffer) {
    if (arrayBuffer.byteLength < 64) return false;
    let endOffset = arrayBuffer.byteLength;
    let rosterMap = null;
    const view = new DataView(arrayBuffer);
    if (endOffset > 8) {
      const magicStr = new TextDecoder().decode(new Uint8Array(arrayBuffer, endOffset - 4, 4));
      if (magicStr === "ROST") {
        const l = view.getUint32(endOffset - 8, true);
        if (endOffset - 8 - l >= 0) {
          try {
            const jsonStr = new TextDecoder().decode(new Uint8Array(arrayBuffer, endOffset - 8 - l, l));
            rosterMap = JSON.parse(jsonStr);
            endOffset = endOffset - 8 - l;
          } catch (err) {
          }
        }
      }
    }
    const magic = [view.getUint8(0), view.getUint8(1), view.getUint8(2)];
    if (magic[0] !== 75 || magic[1] !== 82 || magic[2] !== 69) return false;
    const version = view.getUint8(4);
    Shared.replayHeader.frameCount = view.getUint32(58, true);
    Shared.replayHeader.sampleRate = view.getUint8(62);
    Shared.replayHeader.durationMs = view.getUint32(54, true);
    const mapNameBytes = new Uint8Array(arrayBuffer, 20, 32);
    Shared.currentMapName = new TextDecoder().decode(mapNameBytes).replace(/\u0000/g, "");
    const HEADER_SIZE = 64;
    const parts = [];
    let pos = HEADER_SIZE;
    try {
      while (pos + 4 <= endOffset) {
        const len = view.getUint32(pos, true);
        pos += 4;
        if (len === 0 || pos + len > endOffset) break;
        parts.push(await inflate(new Uint8Array(arrayBuffer, pos, len)));
        pos += len;
      }
    } catch (e) {
      console.warn("Decompression failed", e);
    }
    const totalLength = parts.reduce((acc, c) => acc + c.length, 0);
    const decompressed = new Uint8Array(totalLength);
    let partOffset = 0;
    for (const c of parts) {
      decompressed.set(c, partOffset);
      partOffset += c.length;
    }
    Shared.realFrames = [];
    Shared.events = [];
    Shared.playerInfo = null;
    const dView = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    let off = 0;
    try {
      while (off < decompressed.length) {
        const timestamp = dView.getUint32(off, true);
        off += 4;
        const pCount = dView.getUint8(off);
        off += 1;
        const players = [];
        for (let i = 0; i < pCount; i++) {
          const id = dView.getUint8(off);
          off += 1;
          const px = dView.getInt32(off, true) / 100;
          off += 4;
          const py = dView.getInt32(off, true) / 100;
          off += 4;
          const pz = dView.getInt32(off, true) / 100;
          off += 4;
          const ry = dView.getInt16(off, true) / 1e3;
          off += 2;
          const rx = dView.getInt16(off, true) / 1e3;
          off += 2;
          const hp = dView.getUint8(off);
          off += 1;
          const ammo = dView.getUint8(off);
          off += 1;
          const flags = dView.getUint8(off);
          off += 1;
          const eventType = dView.getUint8(off);
          off += 1;
          const eventVictim = dView.getUint8(off);
          off += 1;
          let pName = `Player ${id}`;
          if (rosterMap && rosterMap[id]) {
            pName = rosterMap[id];
          }
          players.push({
            id,
            name: pName,
            pos: [px, py, pz],
            rot: [ry, rx],
            health: hp,
            ammo,
            shoot: !!(flags & 1),
            scope: !!(flags & 2),
            team: flags >> 4 & 15,
            eventType,
            eventVictim
          });
        }
        Shared.realFrames.push({ timestamp, players });
      }
    } catch (e) {
      console.warn("Frame parsing ended early:", e);
    }
    if (Shared.realFrames.length > 0) {
      const hasPlayers = Shared.realFrames.some((f) => f.players.length > 0);
      if (!hasPlayers) {
        showToast("\u8B66\u544A: KRE\u30D5\u30A1\u30A4\u30EB\u306B\u30D7\u30EC\u30A4\u30E4\u30FC\u304C1\u4EBA\u3082\u5B58\u5728\u3057\u307E\u305B\u3093", "warning");
      } else {
        showToast("KRE\u30D5\u30A1\u30A4\u30EB\u3092\u6B63\u5E38\u306B\u30ED\u30FC\u30C9\u3057\u307E\u3057\u305F", "success");
      }
      State.duration = Shared.realFrames[Shared.realFrames.length - 1].timestamp / 1e3;
      State.time = 0;
      State.mode = "real";
      Shared.seenProjectileIds = /* @__PURE__ */ new Set();
      setupRealPlayers();
      const landingModal = document.getElementById("landing-modal");
      if (landingModal) landingModal.classList.remove("active");
      return true;
    }
    showToast("\u30A8\u30E9\u30FC: \u6709\u52B9\u306A\u30D5\u30EC\u30FC\u30E0\u30C7\u30FC\u30BF\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
    return false;
  }

  // viewer/js/Parser_Map.js
  function clearMapGroup() {
    while (Shared.mapGroup.children.length > 0) {
      const child = Shared.mapGroup.children[0];
      Shared.mapGroup.remove(child);
      disposeObject(child);
    }
    Shared.mapBounds = null;
  }
  function parseMapData(mapData) {
    if (!mapData || !mapData.name || !mapData.objects && !mapData.xyz) return false;
    Shared.currentMapName = mapData.name;
    showToast(`\u30DE\u30C3\u30D7\u30ED\u30FC\u30C9: ${mapData.name}`, "success");
    clearMapGroup();
    const palette = mapData.colors || [];
    const boxes = [];
    if (Array.isArray(mapData.xyz)) {
      for (let i = 0; i + 5 < mapData.xyz.length; i += 6) {
        boxes.push({ p: mapData.xyz.slice(i, i + 3), s: mapData.xyz.slice(i + 3, i + 6), r: null, color: 4473924 });
      }
    }
    if (Array.isArray(mapData.objects)) {
      for (const obj of mapData.objects) {
        if (!obj.s) continue;
        let color = 6710886;
        if (obj.ci !== void 0 && palette[obj.ci]) color = hexToNum(palette[obj.ci]);
        boxes.push({ p: obj.p || [0, 0, 0], s: obj.s, r: obj.r || null, color });
      }
    }
    if (boxes.length > 0) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshLambertMaterial({ color: 16777215 }),
        boxes.length
      );
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      const col = new THREE.Color();
      const min = new THREE.Vector3(Infinity, Infinity, Infinity);
      const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      boxes.forEach((b, i) => {
        pos.set(b.p[0], b.p[1], b.p[2]);
        scl.set(b.s[0], b.s[1], b.s[2]);
        if (b.r) {
          e.set(b.r[0], b.r[1], b.r[2]);
          q.setFromEuler(e);
        } else {
          q.identity();
        }
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, col.setHex(b.color));
        const reach = Math.max(Math.abs(b.s[0]), Math.abs(b.s[1]), Math.abs(b.s[2])) / 2;
        min.min(pos.clone().subScalar(reach));
        max.max(pos.clone().addScalar(reach));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      Shared.mapGroup.add(mesh);
      Shared.mapBounds = { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z };
    }
    const landingModal = document.getElementById("landing-modal");
    if (landingModal) landingModal.classList.remove("active");
    return true;
  }
  function parseOBJ(text) {
    showToast("3D\u5730\u5F62(OBJ)\u3092\u89E3\u6790\u4E2D...", "success");
    clearMapGroup();
    const vertices = [];
    const positions = [];
    const lines = text.split("\n");
    for (let line of lines) {
      line = line.trim();
      if (line.startsWith("v ")) {
        const parts = line.split(" ");
        vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      } else if (line.startsWith("f ")) {
        const parts = line.split(" ");
        if (parts.length >= 4) {
          const a = parseInt(parts[1].split("/")[0]) - 1;
          const b = parseInt(parts[2].split("/")[0]) - 1;
          const c = parseInt(parts[3].split("/")[0]) - 1;
          if (vertices[a] && vertices[b] && vertices[c]) {
            positions.push(...vertices[a], ...vertices[b], ...vertices[c]);
          }
          if (parts.length >= 5) {
            const d = parseInt(parts[4].split("/")[0]) - 1;
            if (vertices[a] && vertices[c] && vertices[d]) {
              positions.push(...vertices[a], ...vertices[c], ...vertices[d]);
            }
          }
        }
      }
    }
    if (positions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshLambertMaterial({
        color: 4473924,
        side: THREE.DoubleSide,
        flatShading: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      Shared.mapGroup.add(mesh);
      showToast(`\u5730\u5F62\u30ED\u30FC\u30C9\u5B8C\u4E86 (${vertices.length}\u9802\u70B9)`, "success");
      const landingModal = document.getElementById("landing-modal");
      if (landingModal) landingModal.classList.remove("active");
    } else {
      showToast("\u30A8\u30E9\u30FC: OBJ\u30D5\u30A1\u30A4\u30EB\u306B\u6709\u52B9\u306A\u30DD\u30EA\u30B4\u30F3\u304C\u3042\u308A\u307E\u305B\u3093", "warning");
    }
  }

  // node_modules/@msgpack/msgpack/dist.esm/utils/utf8.mjs
  var sharedTextEncoder = new TextEncoder();
  var CHUNK_SIZE = 4096;
  function utf8DecodeJs(bytes, inputOffset, byteLength) {
    let offset = inputOffset;
    const end = offset + byteLength;
    const units = [];
    let result = "";
    while (offset < end) {
      const byte1 = bytes[offset++];
      if ((byte1 & 128) === 0) {
        units.push(byte1);
      } else if ((byte1 & 224) === 192) {
        const byte2 = bytes[offset++] & 63;
        units.push((byte1 & 31) << 6 | byte2);
      } else if ((byte1 & 240) === 224) {
        const byte2 = bytes[offset++] & 63;
        const byte3 = bytes[offset++] & 63;
        units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
      } else if ((byte1 & 248) === 240) {
        const byte2 = bytes[offset++] & 63;
        const byte3 = bytes[offset++] & 63;
        const byte4 = bytes[offset++] & 63;
        let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
        if (unit > 65535) {
          unit -= 65536;
          units.push(unit >>> 10 & 1023 | 55296);
          unit = 56320 | unit & 1023;
        }
        units.push(unit);
      } else {
        units.push(byte1);
      }
      if (units.length >= CHUNK_SIZE) {
        result += String.fromCharCode(...units);
        units.length = 0;
      }
    }
    if (units.length > 0) {
      result += String.fromCharCode(...units);
    }
    return result;
  }
  var sharedTextDecoder = new TextDecoder();
  var TEXT_DECODER_THRESHOLD = 200;
  function utf8DecodeTD(bytes, inputOffset, byteLength) {
    const stringBytes = bytes.subarray(inputOffset, inputOffset + byteLength);
    return sharedTextDecoder.decode(stringBytes);
  }
  function utf8Decode(bytes, inputOffset, byteLength) {
    if (byteLength > TEXT_DECODER_THRESHOLD) {
      return utf8DecodeTD(bytes, inputOffset, byteLength);
    } else {
      return utf8DecodeJs(bytes, inputOffset, byteLength);
    }
  }

  // node_modules/@msgpack/msgpack/dist.esm/ExtData.mjs
  var ExtData = class {
    type;
    data;
    constructor(type, data) {
      this.type = type;
      this.data = data;
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/DecodeError.mjs
  var DecodeError = class _DecodeError extends Error {
    constructor(message) {
      super(message);
      const proto = Object.create(_DecodeError.prototype);
      Object.setPrototypeOf(this, proto);
      Object.defineProperty(this, "name", {
        configurable: true,
        enumerable: false,
        value: _DecodeError.name
      });
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/utils/int.mjs
  var UINT32_MAX = 4294967295;
  function setInt64(view, offset, value) {
    const high = Math.floor(value / 4294967296);
    const low = value;
    view.setUint32(offset, high);
    view.setUint32(offset + 4, low);
  }
  function getInt64(view, offset) {
    const high = view.getInt32(offset);
    const low = view.getUint32(offset + 4);
    return high * 4294967296 + low;
  }
  function getUint64(view, offset) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    return high * 4294967296 + low;
  }

  // node_modules/@msgpack/msgpack/dist.esm/timestamp.mjs
  var EXT_TIMESTAMP = -1;
  var TIMESTAMP32_MAX_SEC = 4294967296 - 1;
  var TIMESTAMP64_MAX_SEC = 17179869184 - 1;
  function encodeTimeSpecToTimestamp({ sec, nsec }) {
    if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
      if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
        const rv = new Uint8Array(4);
        const view = new DataView(rv.buffer);
        view.setUint32(0, sec);
        return rv;
      } else {
        const secHigh = sec / 4294967296;
        const secLow = sec & 4294967295;
        const rv = new Uint8Array(8);
        const view = new DataView(rv.buffer);
        view.setUint32(0, nsec << 2 | secHigh & 3);
        view.setUint32(4, secLow);
        return rv;
      }
    } else {
      const rv = new Uint8Array(12);
      const view = new DataView(rv.buffer);
      view.setUint32(0, nsec);
      setInt64(view, 4, sec);
      return rv;
    }
  }
  function encodeDateToTimeSpec(date) {
    const msec = date.getTime();
    const sec = Math.floor(msec / 1e3);
    const nsec = (msec - sec * 1e3) * 1e6;
    const nsecInSec = Math.floor(nsec / 1e9);
    return {
      sec: sec + nsecInSec,
      nsec: nsec - nsecInSec * 1e9
    };
  }
  function encodeTimestampExtension(object) {
    if (object instanceof Date) {
      const timeSpec = encodeDateToTimeSpec(object);
      return encodeTimeSpecToTimestamp(timeSpec);
    } else {
      return null;
    }
  }
  function decodeTimestampToTimeSpec(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    switch (data.byteLength) {
      case 4: {
        const sec = view.getUint32(0);
        const nsec = 0;
        return { sec, nsec };
      }
      case 8: {
        const nsec30AndSecHigh2 = view.getUint32(0);
        const secLow32 = view.getUint32(4);
        const sec = (nsec30AndSecHigh2 & 3) * 4294967296 + secLow32;
        const nsec = nsec30AndSecHigh2 >>> 2;
        return { sec, nsec };
      }
      case 12: {
        const sec = getInt64(view, 4);
        const nsec = view.getUint32(0);
        return { sec, nsec };
      }
      default:
        throw new DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`);
    }
  }
  function decodeTimestampExtension(data) {
    const timeSpec = decodeTimestampToTimeSpec(data);
    return new Date(timeSpec.sec * 1e3 + timeSpec.nsec / 1e6);
  }
  var timestampExtension = {
    type: EXT_TIMESTAMP,
    encode: encodeTimestampExtension,
    decode: decodeTimestampExtension
  };

  // node_modules/@msgpack/msgpack/dist.esm/ExtensionCodec.mjs
  var ExtensionCodec = class _ExtensionCodec {
    static defaultCodec = new _ExtensionCodec();
    // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
    // this will make type errors a lot more clear
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __brand;
    // built-in extensions
    builtInEncoders = [];
    builtInDecoders = [];
    // custom extensions
    encoders = [];
    decoders = [];
    constructor() {
      this.register(timestampExtension);
    }
    register({ type, encode, decode: decode2 }) {
      if (type >= 0) {
        this.encoders[type] = encode;
        this.decoders[type] = decode2;
      } else {
        const index = -1 - type;
        this.builtInEncoders[index] = encode;
        this.builtInDecoders[index] = decode2;
      }
    }
    tryToEncode(object, context) {
      for (let i = 0; i < this.builtInEncoders.length; i++) {
        const encodeExt = this.builtInEncoders[i];
        if (encodeExt != null) {
          const data = encodeExt(object, context);
          if (data != null) {
            const type = -1 - i;
            return new ExtData(type, data);
          }
        }
      }
      for (let i = 0; i < this.encoders.length; i++) {
        const encodeExt = this.encoders[i];
        if (encodeExt != null) {
          const data = encodeExt(object, context);
          if (data != null) {
            const type = i;
            return new ExtData(type, data);
          }
        }
      }
      if (object instanceof ExtData) {
        return object;
      }
      return null;
    }
    decode(data, type, context) {
      const decodeExt = type < 0 ? this.builtInDecoders[-1 - type] : this.decoders[type];
      if (decodeExt) {
        return decodeExt(data, type, context);
      } else {
        return new ExtData(type, data);
      }
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/utils/typedArrays.mjs
  function isArrayBufferLike(buffer) {
    return buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
  }
  function ensureUint8Array(buffer) {
    if (buffer instanceof Uint8Array) {
      return buffer;
    } else if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else if (isArrayBufferLike(buffer)) {
      return new Uint8Array(buffer);
    } else {
      return Uint8Array.from(buffer);
    }
  }

  // node_modules/@msgpack/msgpack/dist.esm/utils/prettyByte.mjs
  function prettyByte(byte) {
    return `${byte < 0 ? "-" : ""}0x${Math.abs(byte).toString(16).padStart(2, "0")}`;
  }

  // node_modules/@msgpack/msgpack/dist.esm/CachedKeyDecoder.mjs
  var DEFAULT_MAX_KEY_LENGTH = 16;
  var DEFAULT_MAX_LENGTH_PER_KEY = 16;
  var CachedKeyDecoder = class {
    hit = 0;
    miss = 0;
    caches;
    maxKeyLength;
    maxLengthPerKey;
    constructor(maxKeyLength = DEFAULT_MAX_KEY_LENGTH, maxLengthPerKey = DEFAULT_MAX_LENGTH_PER_KEY) {
      this.maxKeyLength = maxKeyLength;
      this.maxLengthPerKey = maxLengthPerKey;
      this.caches = [];
      for (let i = 0; i < this.maxKeyLength; i++) {
        this.caches.push([]);
      }
    }
    canBeCached(byteLength) {
      return byteLength > 0 && byteLength <= this.maxKeyLength;
    }
    find(bytes, inputOffset, byteLength) {
      const records = this.caches[byteLength - 1];
      FIND_CHUNK: for (const record of records) {
        const recordBytes = record.bytes;
        for (let j = 0; j < byteLength; j++) {
          if (recordBytes[j] !== bytes[inputOffset + j]) {
            continue FIND_CHUNK;
          }
        }
        return record.str;
      }
      return null;
    }
    store(bytes, value) {
      const records = this.caches[bytes.length - 1];
      const record = { bytes, str: value };
      if (records.length >= this.maxLengthPerKey) {
        records[Math.random() * records.length | 0] = record;
      } else {
        records.push(record);
      }
    }
    decode(bytes, inputOffset, byteLength) {
      const cachedValue = this.find(bytes, inputOffset, byteLength);
      if (cachedValue != null) {
        this.hit++;
        return cachedValue;
      }
      this.miss++;
      const str = utf8DecodeJs(bytes, inputOffset, byteLength);
      const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
      this.store(slicedCopyOfBytes, str);
      return str;
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/Decoder.mjs
  var STATE_ARRAY = "array";
  var STATE_MAP_KEY = "map_key";
  var STATE_MAP_VALUE = "map_value";
  var mapKeyConverter = (key) => {
    if (typeof key === "string" || typeof key === "number") {
      return key;
    }
    throw new DecodeError("The type of key must be string or number but " + typeof key);
  };
  var StackPool = class {
    stack = [];
    stackHeadPosition = -1;
    get length() {
      return this.stackHeadPosition + 1;
    }
    top() {
      return this.stack[this.stackHeadPosition];
    }
    pushArrayState(size) {
      const state = this.getUninitializedStateFromPool();
      state.type = STATE_ARRAY;
      state.position = 0;
      state.size = size;
      state.array = new Array(size);
    }
    pushMapState(size) {
      const state = this.getUninitializedStateFromPool();
      state.type = STATE_MAP_KEY;
      state.readCount = 0;
      state.size = size;
      state.map = {};
    }
    getUninitializedStateFromPool() {
      this.stackHeadPosition++;
      if (this.stackHeadPosition === this.stack.length) {
        const partialState = {
          type: void 0,
          size: 0,
          array: void 0,
          position: 0,
          readCount: 0,
          map: void 0,
          key: null
        };
        this.stack.push(partialState);
      }
      return this.stack[this.stackHeadPosition];
    }
    release(state) {
      const topStackState = this.stack[this.stackHeadPosition];
      if (topStackState !== state) {
        throw new Error("Invalid stack state. Released state is not on top of the stack.");
      }
      if (state.type === STATE_ARRAY) {
        const partialState = state;
        partialState.size = 0;
        partialState.array = void 0;
        partialState.position = 0;
        partialState.type = void 0;
      }
      if (state.type === STATE_MAP_KEY || state.type === STATE_MAP_VALUE) {
        const partialState = state;
        partialState.size = 0;
        partialState.map = void 0;
        partialState.readCount = 0;
        partialState.type = void 0;
      }
      this.stackHeadPosition--;
    }
    reset() {
      this.stack.length = 0;
      this.stackHeadPosition = -1;
    }
  };
  var HEAD_BYTE_REQUIRED = -1;
  var EMPTY_VIEW = new DataView(new ArrayBuffer(0));
  var EMPTY_BYTES = new Uint8Array(EMPTY_VIEW.buffer);
  try {
    EMPTY_VIEW.getInt8(0);
  } catch (e) {
    if (!(e instanceof RangeError)) {
      throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
    }
  }
  var MORE_DATA = new RangeError("Insufficient data");
  var sharedCachedKeyDecoder = new CachedKeyDecoder();
  var Decoder = class _Decoder {
    extensionCodec;
    context;
    useBigInt64;
    rawStrings;
    maxStrLength;
    maxBinLength;
    maxArrayLength;
    maxMapLength;
    maxExtLength;
    keyDecoder;
    mapKeyConverter;
    totalPos = 0;
    pos = 0;
    view = EMPTY_VIEW;
    bytes = EMPTY_BYTES;
    headByte = HEAD_BYTE_REQUIRED;
    stack = new StackPool();
    entered = false;
    constructor(options) {
      this.extensionCodec = options?.extensionCodec ?? ExtensionCodec.defaultCodec;
      this.context = options?.context;
      this.useBigInt64 = options?.useBigInt64 ?? false;
      this.rawStrings = options?.rawStrings ?? false;
      this.maxStrLength = options?.maxStrLength ?? UINT32_MAX;
      this.maxBinLength = options?.maxBinLength ?? UINT32_MAX;
      this.maxArrayLength = options?.maxArrayLength ?? UINT32_MAX;
      this.maxMapLength = options?.maxMapLength ?? UINT32_MAX;
      this.maxExtLength = options?.maxExtLength ?? UINT32_MAX;
      this.keyDecoder = options?.keyDecoder !== void 0 ? options.keyDecoder : sharedCachedKeyDecoder;
      this.mapKeyConverter = options?.mapKeyConverter ?? mapKeyConverter;
    }
    clone() {
      return new _Decoder({
        extensionCodec: this.extensionCodec,
        context: this.context,
        useBigInt64: this.useBigInt64,
        rawStrings: this.rawStrings,
        maxStrLength: this.maxStrLength,
        maxBinLength: this.maxBinLength,
        maxArrayLength: this.maxArrayLength,
        maxMapLength: this.maxMapLength,
        maxExtLength: this.maxExtLength,
        keyDecoder: this.keyDecoder
      });
    }
    reinitializeState() {
      this.totalPos = 0;
      this.headByte = HEAD_BYTE_REQUIRED;
      this.stack.reset();
    }
    setBuffer(buffer) {
      const bytes = ensureUint8Array(buffer);
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.pos = 0;
    }
    appendBuffer(buffer) {
      if (this.headByte === HEAD_BYTE_REQUIRED && !this.hasRemaining(1)) {
        this.setBuffer(buffer);
      } else {
        const remainingData = this.bytes.subarray(this.pos);
        const newData = ensureUint8Array(buffer);
        const newBuffer = new Uint8Array(remainingData.length + newData.length);
        newBuffer.set(remainingData);
        newBuffer.set(newData, remainingData.length);
        this.setBuffer(newBuffer);
      }
    }
    hasRemaining(size) {
      return this.view.byteLength - this.pos >= size;
    }
    createExtraByteError(posToShow) {
      const { view, pos } = this;
      return new RangeError(`Extra ${view.byteLength - pos} of ${view.byteLength} byte(s) found at buffer[${posToShow}]`);
    }
    /**
     * @throws {@link DecodeError}
     * @throws {@link RangeError}
     */
    decode(buffer) {
      if (this.entered) {
        const instance = this.clone();
        return instance.decode(buffer);
      }
      try {
        this.entered = true;
        this.reinitializeState();
        this.setBuffer(buffer);
        const object = this.doDecodeSync();
        if (this.hasRemaining(1)) {
          throw this.createExtraByteError(this.pos);
        }
        return object;
      } finally {
        this.entered = false;
      }
    }
    *decodeMulti(buffer) {
      if (this.entered) {
        const instance = this.clone();
        yield* instance.decodeMulti(buffer);
        return;
      }
      try {
        this.entered = true;
        this.reinitializeState();
        this.setBuffer(buffer);
        while (this.hasRemaining(1)) {
          yield this.doDecodeSync();
        }
      } finally {
        this.entered = false;
      }
    }
    async decodeAsync(stream) {
      if (this.entered) {
        const instance = this.clone();
        return instance.decodeAsync(stream);
      }
      try {
        this.entered = true;
        let decoded = false;
        let object;
        for await (const buffer of stream) {
          if (decoded) {
            this.entered = false;
            throw this.createExtraByteError(this.totalPos);
          }
          this.appendBuffer(buffer);
          try {
            object = this.doDecodeSync();
            decoded = true;
          } catch (e) {
            if (!(e instanceof RangeError)) {
              throw e;
            }
          }
          this.totalPos += this.pos;
        }
        if (decoded) {
          if (this.hasRemaining(1)) {
            throw this.createExtraByteError(this.totalPos);
          }
          return object;
        }
        const { headByte, pos, totalPos } = this;
        throw new RangeError(`Insufficient data in parsing ${prettyByte(headByte)} at ${totalPos} (${pos} in the current buffer)`);
      } finally {
        this.entered = false;
      }
    }
    decodeArrayStream(stream) {
      return this.decodeMultiAsync(stream, true);
    }
    decodeStream(stream) {
      return this.decodeMultiAsync(stream, false);
    }
    async *decodeMultiAsync(stream, isArray) {
      if (this.entered) {
        const instance = this.clone();
        yield* instance.decodeMultiAsync(stream, isArray);
        return;
      }
      try {
        this.entered = true;
        let isArrayHeaderRequired = isArray;
        let arrayItemsLeft = -1;
        for await (const buffer of stream) {
          if (isArray && arrayItemsLeft === 0) {
            throw this.createExtraByteError(this.totalPos);
          }
          this.appendBuffer(buffer);
          if (isArrayHeaderRequired) {
            arrayItemsLeft = this.readArraySize();
            isArrayHeaderRequired = false;
            this.complete();
          }
          try {
            while (true) {
              yield this.doDecodeSync();
              if (--arrayItemsLeft === 0) {
                break;
              }
            }
          } catch (e) {
            if (!(e instanceof RangeError)) {
              throw e;
            }
          }
          this.totalPos += this.pos;
        }
      } finally {
        this.entered = false;
      }
    }
    doDecodeSync() {
      DECODE: while (true) {
        const headByte = this.readHeadByte();
        let object;
        if (headByte >= 224) {
          object = headByte - 256;
        } else if (headByte < 192) {
          if (headByte < 128) {
            object = headByte;
          } else if (headByte < 144) {
            const size = headByte - 128;
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte < 160) {
            const size = headByte - 144;
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else {
            const byteLength = headByte - 160;
            object = this.decodeString(byteLength, 0);
          }
        } else if (headByte === 192) {
          object = null;
        } else if (headByte === 194) {
          object = false;
        } else if (headByte === 195) {
          object = true;
        } else if (headByte === 202) {
          object = this.readF32();
        } else if (headByte === 203) {
          object = this.readF64();
        } else if (headByte === 204) {
          object = this.readU8();
        } else if (headByte === 205) {
          object = this.readU16();
        } else if (headByte === 206) {
          object = this.readU32();
        } else if (headByte === 207) {
          if (this.useBigInt64) {
            object = this.readU64AsBigInt();
          } else {
            object = this.readU64();
          }
        } else if (headByte === 208) {
          object = this.readI8();
        } else if (headByte === 209) {
          object = this.readI16();
        } else if (headByte === 210) {
          object = this.readI32();
        } else if (headByte === 211) {
          if (this.useBigInt64) {
            object = this.readI64AsBigInt();
          } else {
            object = this.readI64();
          }
        } else if (headByte === 217) {
          const byteLength = this.lookU8();
          object = this.decodeString(byteLength, 1);
        } else if (headByte === 218) {
          const byteLength = this.lookU16();
          object = this.decodeString(byteLength, 2);
        } else if (headByte === 219) {
          const byteLength = this.lookU32();
          object = this.decodeString(byteLength, 4);
        } else if (headByte === 220) {
          const size = this.readU16();
          if (size !== 0) {
            this.pushArrayState(size);
            this.complete();
            continue DECODE;
          } else {
            object = [];
          }
        } else if (headByte === 221) {
          const size = this.readU32();
          if (size !== 0) {
            this.pushArrayState(size);
            this.complete();
            continue DECODE;
          } else {
            object = [];
          }
        } else if (headByte === 222) {
          const size = this.readU16();
          if (size !== 0) {
            this.pushMapState(size);
            this.complete();
            continue DECODE;
          } else {
            object = {};
          }
        } else if (headByte === 223) {
          const size = this.readU32();
          if (size !== 0) {
            this.pushMapState(size);
            this.complete();
            continue DECODE;
          } else {
            object = {};
          }
        } else if (headByte === 196) {
          const size = this.lookU8();
          object = this.decodeBinary(size, 1);
        } else if (headByte === 197) {
          const size = this.lookU16();
          object = this.decodeBinary(size, 2);
        } else if (headByte === 198) {
          const size = this.lookU32();
          object = this.decodeBinary(size, 4);
        } else if (headByte === 212) {
          object = this.decodeExtension(1, 0);
        } else if (headByte === 213) {
          object = this.decodeExtension(2, 0);
        } else if (headByte === 214) {
          object = this.decodeExtension(4, 0);
        } else if (headByte === 215) {
          object = this.decodeExtension(8, 0);
        } else if (headByte === 216) {
          object = this.decodeExtension(16, 0);
        } else if (headByte === 199) {
          const size = this.lookU8();
          object = this.decodeExtension(size, 1);
        } else if (headByte === 200) {
          const size = this.lookU16();
          object = this.decodeExtension(size, 2);
        } else if (headByte === 201) {
          const size = this.lookU32();
          object = this.decodeExtension(size, 4);
        } else {
          throw new DecodeError(`Unrecognized type byte: ${prettyByte(headByte)}`);
        }
        this.complete();
        const stack = this.stack;
        while (stack.length > 0) {
          const state = stack.top();
          if (state.type === STATE_ARRAY) {
            state.array[state.position] = object;
            state.position++;
            if (state.position === state.size) {
              object = state.array;
              stack.release(state);
            } else {
              continue DECODE;
            }
          } else if (state.type === STATE_MAP_KEY) {
            if (object === "__proto__") {
              throw new DecodeError("The key __proto__ is not allowed");
            }
            state.key = this.mapKeyConverter(object);
            state.type = STATE_MAP_VALUE;
            continue DECODE;
          } else {
            state.map[state.key] = object;
            state.readCount++;
            if (state.readCount === state.size) {
              object = state.map;
              stack.release(state);
            } else {
              state.key = null;
              state.type = STATE_MAP_KEY;
              continue DECODE;
            }
          }
        }
        return object;
      }
    }
    readHeadByte() {
      if (this.headByte === HEAD_BYTE_REQUIRED) {
        this.headByte = this.readU8();
      }
      return this.headByte;
    }
    complete() {
      this.headByte = HEAD_BYTE_REQUIRED;
    }
    readArraySize() {
      const headByte = this.readHeadByte();
      switch (headByte) {
        case 220:
          return this.readU16();
        case 221:
          return this.readU32();
        default: {
          if (headByte < 160) {
            return headByte - 144;
          } else {
            throw new DecodeError(`Unrecognized array type byte: ${prettyByte(headByte)}`);
          }
        }
      }
    }
    pushMapState(size) {
      if (size > this.maxMapLength) {
        throw new DecodeError(`Max length exceeded: map length (${size}) > maxMapLengthLength (${this.maxMapLength})`);
      }
      this.stack.pushMapState(size);
    }
    pushArrayState(size) {
      if (size > this.maxArrayLength) {
        throw new DecodeError(`Max length exceeded: array length (${size}) > maxArrayLength (${this.maxArrayLength})`);
      }
      this.stack.pushArrayState(size);
    }
    decodeString(byteLength, headerOffset) {
      if (!this.rawStrings || this.stateIsMapKey()) {
        return this.decodeUtf8String(byteLength, headerOffset);
      }
      return this.decodeBinary(byteLength, headerOffset);
    }
    /**
     * @throws {@link RangeError}
     */
    decodeUtf8String(byteLength, headerOffset) {
      if (byteLength > this.maxStrLength) {
        throw new DecodeError(`Max length exceeded: UTF-8 byte length (${byteLength}) > maxStrLength (${this.maxStrLength})`);
      }
      if (this.bytes.byteLength < this.pos + headerOffset + byteLength) {
        throw MORE_DATA;
      }
      const offset = this.pos + headerOffset;
      let object;
      if (this.stateIsMapKey() && this.keyDecoder?.canBeCached(byteLength)) {
        object = this.keyDecoder.decode(this.bytes, offset, byteLength);
      } else {
        object = utf8Decode(this.bytes, offset, byteLength);
      }
      this.pos += headerOffset + byteLength;
      return object;
    }
    stateIsMapKey() {
      if (this.stack.length > 0) {
        const state = this.stack.top();
        return state.type === STATE_MAP_KEY;
      }
      return false;
    }
    /**
     * @throws {@link RangeError}
     */
    decodeBinary(byteLength, headOffset) {
      if (byteLength > this.maxBinLength) {
        throw new DecodeError(`Max length exceeded: bin length (${byteLength}) > maxBinLength (${this.maxBinLength})`);
      }
      if (!this.hasRemaining(byteLength + headOffset)) {
        throw MORE_DATA;
      }
      const offset = this.pos + headOffset;
      const object = this.bytes.subarray(offset, offset + byteLength);
      this.pos += headOffset + byteLength;
      return object;
    }
    decodeExtension(size, headOffset) {
      if (size > this.maxExtLength) {
        throw new DecodeError(`Max length exceeded: ext length (${size}) > maxExtLength (${this.maxExtLength})`);
      }
      const extType = this.view.getInt8(this.pos + headOffset);
      const data = this.decodeBinary(
        size,
        headOffset + 1
        /* extType */
      );
      return this.extensionCodec.decode(data, extType, this.context);
    }
    lookU8() {
      return this.view.getUint8(this.pos);
    }
    lookU16() {
      return this.view.getUint16(this.pos);
    }
    lookU32() {
      return this.view.getUint32(this.pos);
    }
    readU8() {
      const value = this.view.getUint8(this.pos);
      this.pos++;
      return value;
    }
    readI8() {
      const value = this.view.getInt8(this.pos);
      this.pos++;
      return value;
    }
    readU16() {
      const value = this.view.getUint16(this.pos);
      this.pos += 2;
      return value;
    }
    readI16() {
      const value = this.view.getInt16(this.pos);
      this.pos += 2;
      return value;
    }
    readU32() {
      const value = this.view.getUint32(this.pos);
      this.pos += 4;
      return value;
    }
    readI32() {
      const value = this.view.getInt32(this.pos);
      this.pos += 4;
      return value;
    }
    readU64() {
      const value = getUint64(this.view, this.pos);
      this.pos += 8;
      return value;
    }
    readI64() {
      const value = getInt64(this.view, this.pos);
      this.pos += 8;
      return value;
    }
    readU64AsBigInt() {
      const value = this.view.getBigUint64(this.pos);
      this.pos += 8;
      return value;
    }
    readI64AsBigInt() {
      const value = this.view.getBigInt64(this.pos);
      this.pos += 8;
      return value;
    }
    readF32() {
      const value = this.view.getFloat32(this.pos);
      this.pos += 4;
      return value;
    }
    readF64() {
      const value = this.view.getFloat64(this.pos);
      this.pos += 8;
      return value;
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/decode.mjs
  function decodeMulti(buffer, options) {
    const decoder = new Decoder(options);
    return decoder.decodeMulti(buffer);
  }

  // viewer/js/Parser_JSON.js
  function parseJSONLog(input) {
    let data = [];
    if (typeof input === "string") {
      try {
        data = JSON.parse(input);
      } catch (e) {
        showToast("JSON\u306E\u30D1\u30FC\u30B9\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
        return false;
      }
    } else {
      data = input;
    }
    if (!Array.isArray(data) || !data.length) return false;
    if (data[0] && data[0].version) {
      Shared.replayHeader = data.shift();
    }
    Shared.realFrames = [];
    Shared.events = [];
    Shared.seenProjectileIds = /* @__PURE__ */ new Set();
    const playersMap = {};
    let maxTime = 0;
    let minTime = Infinity;
    data.forEach((ev) => {
      const t = ev[0];
      if (typeof t === "number") {
        if (t > maxTime) maxTime = t;
        if (t < minTime) minTime = t;
      }
    });
    const hasKPacket = {};
    let lastFrameTime = -1;
    const clonePlayer = (p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      pos: [p.pos[0], p.pos[1], p.pos[2]],
      rot: [p.rot[0], p.rot[1]],
      health: p.health,
      maxHealth: p.maxHealth,
      hasSpawned: p.hasSpawned,
      shoot: p.shoot,
      aim: p.aim,
      isValid: p.isValid,
      classId: p.classId
    });
    const pushFrame = (t) => {
      const ts = t - minTime;
      if (ts === lastFrameTime) return;
      lastFrameTime = ts;
      const currentFramePlayers = Object.values(playersMap).filter((p) => p.hasSpawned).map((p) => clonePlayer(p));
      Shared.realFrames.push({ timestamp: ts, players: currentFramePlayers });
    };
    const processPayload = (t, payload, ev) => {
      if (!Array.isArray(payload)) return;
      const op = payload[0];
      if (op === "kre_map_data" && payload[1]) {
        parseMapData(payload[1]);
      } else if (op === "0" && payload[1]) {
        const pArr = payload[1];
        const stride = 51;
        for (let i = 0; i + 9 <= pArr.length; i += stride) {
          const sid = pArr[i + 1];
          if (sid === void 0) continue;
          if (!playersMap[sid]) {
            playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, maxHealth: 100, hasSpawned: false, shoot: false, aim: false, isValid: false };
          }
          if (pArr[i + 5]) {
            playersMap[sid].name = pArr[i + 5];
            playersMap[sid].isValid = true;
          }
          if (pArr[i + 6] !== void 0 && pArr[i + 6] !== null) {
            playersMap[sid].classId = pArr[i + 6];
            playersMap[sid].isValid = true;
          }
          if (pArr[i + 7]) playersMap[sid].maxHealth = pArr[i + 7];
          if (pArr[i + 8] !== void 0) playersMap[sid].health = pArr[i + 8];
          if (pArr[i + 9] !== void 0) playersMap[sid].team = pArr[i + 9];
        }
      } else if (op === "k" && payload[1]) {
        const pArr = payload[1];
        let stride = 13;
        for (const s of [14, 13, 15, 12, 11, 10, 16]) {
          if (pArr.length > 0 && pArr.length % s === 0) {
            let valid = true;
            for (let i = 0; i < pArr.length; i += s) {
              if (typeof pArr[i] !== "number" && typeof pArr[i] !== "string") valid = false;
              if (typeof pArr[i + 1] !== "number") valid = false;
              if (typeof pArr[i + 2] !== "number") valid = false;
            }
            if (valid) {
              stride = s;
              break;
            }
          }
        }
        for (let i = 0; i < pArr.length; i += stride) {
          const sid = pArr[i];
          if (sid === void 0) continue;
          hasKPacket[sid] = true;
          if (!playersMap[sid]) {
            playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: false, maxHealth: 100, shoot: false, aim: false, isValid: false };
          }
          playersMap[sid].hasSpawned = true;
          playersMap[sid].pos = [pArr[i + 1], pArr[i + 2], pArr[i + 3]];
          const yaw = pArr[i + 4] * Math.PI / 180;
          const pitch = pArr[i + 5] * Math.PI / 180;
          playersMap[sid].rot = [yaw, pitch];
          playersMap[sid].shoot = !!pArr[i + 7];
          playersMap[sid].aim = !!pArr[i + 8];
          if (stride >= 13 && pArr[i + 12] !== void 0) {
            playersMap[sid].health = pArr[i + 12];
          }
        }
        pushFrame(t);
      } else if (op === "ai" && payload.length > 1) {
        const pArr = Array.isArray(payload[1]) ? payload[1] : payload.slice(1);
        for (let i = 0; i < pArr.length; i += 9) {
          const sid = pArr[i];
          if (sid === void 0) continue;
          if (hasKPacket[sid]) continue;
          if (!playersMap[sid]) {
            playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, health: 100, pos: [0, 0, 0], rot: [0, 0], hasSpawned: false, maxHealth: 100, shoot: false, aim: false };
          }
          playersMap[sid].hasSpawned = true;
          playersMap[sid].pos = [pArr[i + 1], pArr[i + 2], pArr[i + 3]];
          const yaw = pArr[i + 4] * Math.PI / 180;
          const pitch = pArr[i + 5] * Math.PI / 180;
          playersMap[sid].rot = [yaw, pitch];
        }
        lastFrameTime = -1;
        pushFrame(t);
      } else if (op === "h") {
        const hp = payload[1];
        let sid = payload[2];
        if (typeof hp !== "number") return;
        if (sid === null || sid === void 0) sid = 0;
        if (!playersMap[sid]) {
          playersMap[sid] = { id: sid, name: `Guest_${sid}`, team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: false, maxHealth: 100, shoot: false, aim: false };
        }
        playersMap[sid].health = hp;
        if (hp > 0) {
          playersMap[sid].maxHealth = Math.max(playersMap[sid].maxHealth || 100, hp);
        }
        if (playersMap[sid].hasSpawned) pushFrame(t);
      } else if (op === "3" && payload.length >= 4) {
        const killer = payload[1];
        const victim = payload[3];
        const meta = payload.length >= 6 && payload[5] && typeof payload[5] === "object" ? payload[5] : {};
        const headshot = !!meta.hs;
        Shared.events.push({
          timestamp: t,
          // Keep original t, normalized at end of parser
          type: "kill",
          victim,
          killer,
          headshot
        });
        if (playersMap[victim]) {
          playersMap[victim].health = 0;
        }
        pushFrame(t);
      } else if (op === "5") {
      } else if (op === "7" && Array.isArray(payload[1])) {
        const pArr = payload[1];
        const scores = {};
        let isObjMode = false;
        for (let i = 0; i < pArr.length; i += 4) {
          if (pArr[i + 2] * 50 > pArr[i + 1]) {
            isObjMode = true;
            break;
          }
        }
        for (let i = 0; i < pArr.length; i += 4) {
          const sid = pArr[i];
          if (isObjMode) {
            scores[sid] = {
              score: pArr[i + 2],
              obj: pArr[i + 1],
              kills: pArr[i + 3]
              // deaths is intentionally omitted for obj mode
            };
          } else {
            scores[sid] = {
              score: pArr[i + 1],
              kills: pArr[i + 2],
              deaths: pArr[i + 3],
              obj: 0
            };
          }
        }
        Shared.events.push({
          timestamp: t,
          type: "scoreboard",
          scores,
          isObjMode
        });
      } else if (op === "crsp") {
        Object.values(playersMap).forEach((p) => {
          if (p.health <= 0) {
            p.health = 100;
          }
        });
      } else if (op === "l" && payload[1] && Array.isArray(payload[1])) {
        const pArr = payload[1];
        if (pArr.length >= 26) {
          const projs = [];
          const stride = 26;
          for (let i = 0; i + 25 < pArr.length; i += stride) {
            projs.push({
              id: pArr[i],
              ownerId: pArr[i + 1],
              pos: [pArr[i + 2], pArr[i + 3], pArr[i + 4]]
            });
          }
          const currentFramePlayers = Object.values(playersMap).filter((p) => p.hasSpawned).map((p) => clonePlayer(p));
          Shared.realFrames.push({ timestamp: t - minTime, players: currentFramePlayers, projectiles: projs });
        }
      } else if (op === "l_parsed" && payload.length > 1) {
        const projs = payload[1];
        const currentFramePlayers = Object.values(playersMap).filter((p) => p.hasSpawned).map((p) => clonePlayer(p));
        Shared.realFrames.push({ timestamp: t - minTime, players: currentFramePlayers, projectiles: projs });
      } else if (ev && ev[2] === true && op === "en") {
        const pData = payload[1];
        if (Array.isArray(pData) && pData.length >= 7) {
          if (!playersMap[0]) playersMap[0] = { id: 0, name: "Local Player", team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: true, maxHealth: 100, shoot: false, aim: false, isValid: true };
          playersMap[0].hasSpawned = true;
          let px = pData[4];
          let py = pData[5];
          let pz = pData[6];
          if (typeof px === "number" && typeof py === "number" && typeof pz === "number") {
            playersMap[0].pos = [px, py, pz];
            let pitch = pData[1];
            let yaw = pData[2];
            if (typeof pitch === "number" && typeof yaw === "number") playersMap[0].rot = [yaw, pitch];
            playersMap[0].health = playersMap[0].health || 100;
            playersMap[0].maxHealth = Math.max(playersMap[0].maxHealth || 100, playersMap[0].health);
            pushFrame(t);
          }
        }
      } else if (op === "kre_local") {
        if (!playersMap[0]) playersMap[0] = { id: 0, name: "Local Player", team: 0, pos: [0, 0, 0], rot: [0, 0], health: 100, hasSpawned: true, maxHealth: 100, shoot: false, aim: false, isValid: true };
        playersMap[0].hasSpawned = true;
        playersMap[0].pos = [payload[1], payload[2], payload[3]];
        const rawYaw = payload[4] || 0;
        const rawPitch = payload[5] || 0;
        const yawRad = Math.abs(rawYaw) > Math.PI * 2 ? rawYaw * Math.PI / 180 : rawYaw;
        const pitchRad = Math.abs(rawPitch) > Math.PI * 2 ? rawPitch * Math.PI / 180 : rawPitch;
        playersMap[0].rot = [yawRad, pitchRad];
        playersMap[0].health = payload[6];
        playersMap[0].maxHealth = Math.max(playersMap[0].maxHealth || 100, payload[6]);
        pushFrame(t);
      } else if (op === "d") {
        const sid = payload[1];
        if (playersMap[sid]) {
          playersMap[sid].health = 0;
        }
      }
    };
    data.forEach((ev) => {
      const t = ev[0];
      let payload = ev[1];
      if (!payload) return;
      if (typeof payload === "string") {
        try {
          const bytes = base64ToUint8Array(payload);
          const iter = decodeMulti(bytes);
          for (const p of iter) {
            processPayload(t, p, ev);
          }
        } catch (e) {
        }
      } else {
        processPayload(t, payload, ev);
      }
    });
    if (Shared.realFrames.length > 0) {
      const finalInfo = {};
      Object.values(playersMap).forEach((p) => {
        const key = String(p.id);
        if (!finalInfo[key]) finalInfo[key] = { name: null, team: null, classId: null, maxHealth: null };
        if (p.name) {
          if (!p.name.startsWith("Guest_") && !p.name.startsWith("Player ")) {
            finalInfo[key].name = p.name;
          } else if (!finalInfo[key].name) {
            finalInfo[key].name = p.name;
          }
        }
        if (p.team) finalInfo[key].team = p.team;
        if (p.classId !== void 0) finalInfo[key].classId = p.classId;
        if (p.maxHealth !== void 0) finalInfo[key].maxHealth = p.maxHealth;
      });
      Shared.realFrames.forEach((f) => {
        f.players.forEach((p) => {
          const key = String(p.id);
          if (!finalInfo[key]) finalInfo[key] = { name: null, team: null, classId: null, maxHealth: null };
          if (p.name) {
            if (!p.name.startsWith("Guest_") && !p.name.startsWith("Player ")) {
              finalInfo[key].name = p.name;
            } else if (!finalInfo[key].name) {
              finalInfo[key].name = p.name;
            }
          }
          if (p.team) finalInfo[key].team = p.team;
          if (p.classId !== void 0 && finalInfo[key].classId === null) finalInfo[key].classId = p.classId;
          if (p.maxHealth !== void 0 && finalInfo[key].maxHealth === null) finalInfo[key].maxHealth = p.maxHealth;
        });
      });
      Shared.realFrames.forEach((f) => {
        f.players = f.players.filter((p) => {
          const info = finalInfo[String(p.id)];
          const isLocal = p.id === 0;
          const isValid = isLocal || playersMap[p.id] && playersMap[p.id].isValid;
          return isValid;
        });
        f.players.forEach((p) => {
          const key = String(p.id);
          const info = finalInfo[key];
          if (info) {
            if (info.name) p.name = info.name;
            if (info.team) p.team = info.team;
            if (info.classId !== null && p.classId === void 0) p.classId = info.classId;
            if (info.maxHealth !== null) p.maxHealth = info.maxHealth;
          }
        });
      });
      Shared.playerInfo = Object.entries(finalInfo).map(([id, info]) => ({
        id: Number(id),
        pName: info.name || `Player ${id}`,
        team: info.team || 0,
        kills: 0,
        deaths: 0,
        score: 0
      }));
      Shared.realFrames.sort((a, b) => a.timestamp - b.timestamp);
      if (Shared.events) {
        Shared.events.forEach((e) => e.timestamp -= minTime);
        Shared.events.sort((a, b) => a.timestamp - b.timestamp);
      }
      State.duration = (maxTime - minTime) / 1e3;
      State.time = 0;
      State.mode = "real";
      setupRealPlayers();
      showToast(`\u30ED\u30FC\u30C9\u5B8C\u4E86: ${Shared.realFrames.length} \u30D5\u30EC\u30FC\u30E0 / ${Object.keys(playersMap).length} \u30D7\u30EC\u30A4\u30E4\u30FC`, "success");
      const landingModal = document.getElementById("landing-modal");
      if (landingModal) landingModal.classList.remove("active");
      return true;
    } else {
      showToast("\u30A8\u30E9\u30FC: \u5EA7\u6A19\u30C7\u30FC\u30BF(k)\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
      return false;
    }
  }

  // viewer/js/DragDrop.js
  async function loadFile(file) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".obj")) {
        parseOBJ(await file.text());
      } else if (name.endsWith(".json") || name.endsWith(".kre_log")) {
        const parsed = JSON.parse(await file.text());
        if (Array.isArray(parsed)) {
          parseJSONLog(parsed);
        } else if (parsed && typeof parsed === "object") {
          if (!parseMapData(parsed)) showToast("\u30DE\u30C3\u30D7JSON\u3068\u3057\u3066\u8A8D\u8B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
        } else {
          showToast("\u4E0D\u660E\u306AJSON\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u3067\u3059");
        }
      } else {
        const ok = await parseKRE(await file.arrayBuffer());
        if (!ok) showToast("KRE\u30D5\u30A1\u30A4\u30EB\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
      }
    } catch (e) {
      showToast("\u30D5\u30A1\u30A4\u30EB\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F: " + e.message);
    }
  }
  function setupDragAndDrop() {
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      document.addEventListener(eventName, (e) => e.preventDefault(), false);
    });
    const dropOverlay = document.getElementById("drop-overlay");
    const landingBox = document.getElementById("landing-box");
    const setDragging = (on) => {
      dropOverlay.style.display = on ? "flex" : "none";
      if (landingBox) landingBox.classList.toggle("dragover", on);
    };
    document.addEventListener("dragenter", () => setDragging(true));
    document.addEventListener("dragover", () => setDragging(true));
    document.addEventListener("dragleave", (e) => {
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) setDragging(false);
    });
    document.addEventListener("drop", (e) => {
      setDragging(false);
      if (e.dataTransfer.files.length > 0) loadFile(e.dataTransfer.files[0]);
    });
    const input = document.getElementById("file-input");
    if (input) {
      input.addEventListener("change", () => {
        if (input.files.length > 0) loadFile(input.files[0]);
        input.value = "";
      });
    }
    document.querySelectorAll("[data-open-file]").forEach((btn) => {
      btn.addEventListener("click", () => input && input.click());
    });
  }

  // viewer/js/main.js
  function init() {
    initRenderer();
    setupUI();
    setupDragAndDrop();
    animate();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

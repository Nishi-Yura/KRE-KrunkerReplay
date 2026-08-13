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
    showScoreboard: false
  };
  var keys = { w: false, a: false, s: false, d: false, e: false, q: false };
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
    Shared.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1e3);
    Shared.camera.position.set(0, 50, 100);
    Shared.camera.lookAt(0, 0, 0);
    Shared.camera.rotation.order = "YXZ";
    renderer = new THREE.WebGLRenderer({ antialias: true });
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

  // viewer/js/Renderer_UI.js
  function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function updateDynamicHUD(currentFrame) {
    if (!currentFrame || !State.targetPlayerId) return;
    const p = currentFrame.players.find((x) => x.id == State.targetPlayerId);
    if (!p) return;
    let classHud = document.getElementById("class-hud");
    if (classHud && classHud.style.display !== "none") {
      const className = KRUNKER_CLASSES[p.classId] || `Class ${p.classId}`;
      const pName = p.name || `Player ${p.id}`;
      classHud.innerHTML = `Spectating: <span style="color:#00ff88">${escapeHTML(pName)}</span><br><span style="font-size:12px; opacity:0.8">${escapeHTML(className)}</span>`;
    }
    const pCard = document.querySelector(`.player-card[data-id="${p.id}"]`);
    if (pCard) {
      const classDiv = pCard.querySelector(".class-text");
      if (classDiv) {
        const className = KRUNKER_CLASSES[p.classId] || `Class ${p.classId}`;
        classDiv.innerText = className;
      }
    }
  }
  function drawMinimap() {
    const minimapCanvas = document.getElementById("minimap");
    if (!minimapCanvas) return;
    const ctx = minimapCanvas.getContext("2d");
    minimapCanvas.width = 200;
    minimapCanvas.height = 200;
    ctx.clearRect(0, 0, 200, 200);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(10, 10, 180, 180);
    if (State.mode !== "real") return;
    const pList = Object.entries(Shared.realMeshes);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    pList.forEach(([id, mesh]) => {
      if (!mesh || mesh.visible === false) return;
      minX = Math.min(minX, mesh.position.x);
      maxX = Math.max(maxX, mesh.position.x);
      minZ = Math.min(minZ, mesh.position.z);
      maxZ = Math.max(maxZ, mesh.position.z);
    });
    const rangeX = Math.max(maxX - minX, 50);
    const rangeZ = Math.max(maxZ - minZ, 50);
    const scale = Math.min(160 / rangeX, 160 / rangeZ);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    pList.forEach(([id, mesh]) => {
      if (!mesh || mesh.visible === false) return;
      const x = 100 + (mesh.position.x - cx) * scale;
      const y = 100 + (mesh.position.z - cz) * scale;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  function updateNametags(currentFrame) {
    const nametagsLayer = document.getElementById("nametags-layer");
    if (!nametagsLayer) return;
    if (State.mode === "real" && currentFrame) {
      Object.entries(Shared.realMeshes).forEach(([id, mesh]) => {
        let tagDiv = document.getElementById("nametag-" + id);
        const pData = currentFrame.players.find((p) => p.id == id);
        if (!pData || pData.health <= 0 || !mesh.visible || State.cameraMode === "1st" && parseInt(id) === State.targetPlayerId) {
          if (tagDiv) tagDiv.style.display = "none";
          return;
        }
        if (!tagDiv) {
          tagDiv = document.createElement("div");
          tagDiv.id = "nametag-" + id;
          tagDiv.className = "nametag";
          const pName = pData.name || `Player ${id}`;
          const hp = pData.health || 100;
          const maxHp = pData.maxHealth || 100;
          const hpPercent = hp / maxHp * 100;
          tagDiv.innerHTML = `
                    <div class="nametag-name" id="nametag-name-${id}">${escapeHTML(pName)}</div>
                    <div class="nametag-hp-bar">
                        <div class="nametag-hp-fill" id="nametag-hp-${id}" style="width: ${hpPercent}%"></div>
                    </div>
                `;
          nametagsLayer.appendChild(tagDiv);
        }
        tagDiv.style.display = "block";
        tagDiv.style.backgroundColor = "transparent";
        tagDiv.style.color = "white";
        tagDiv.style.padding = "0";
        tagDiv.style.borderRadius = "0";
        let nameTagBg = "rgba(0,0,0,0.6)";
        if (pData.team === 1) nameTagBg = "rgba(255, 136, 0, 0.85)";
        else if (pData.team === 2) nameTagBg = "rgba(0, 204, 255, 0.85)";
        const nameDiv = document.getElementById("nametag-name-" + id);
        if (nameDiv) {
          nameDiv.innerText = pData.name || `Player ${id}`;
          nameDiv.style.color = "white";
          nameDiv.style.background = nameTagBg;
        }
        const hpFill = document.getElementById("nametag-hp-" + id);
        if (hpFill) {
          const hp = pData.health || 100;
          const maxHp = pData.maxHealth || 100;
          const hpPercent = hp / maxHp * 100;
          hpFill.style.width = Math.max(0, Math.min(100, hpPercent)) + "%";
          if (hpPercent < 30) hpFill.style.background = "#ff0000";
          else if (hpPercent < 60) hpFill.style.background = "#ffff00";
          else hpFill.style.background = "#00ff00";
        }
        const pos = mesh.position.clone();
        pos.y += 12;
        pos.project(Shared.camera);
        if (pos.z > 1) {
          tagDiv.style.display = "none";
          return;
        }
        const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-(pos.y * 0.5) + 0.5) * window.innerHeight;
        tagDiv.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      });
    } else {
      nametagsLayer.innerHTML = "";
    }
  }
  function updateKillLog(currentFrame) {
    const killLogContainer = document.getElementById("kill-log");
    if (!killLogContainer || !Shared.events || State.mode !== "real") return;
    const timeMs = State.time * 1e3;
    const recentKills = Shared.events.filter((e) => e.type === "kill" && timeMs >= e.timestamp && timeMs - e.timestamp < 5e3);
    killLogContainer.innerHTML = "";
    recentKills.forEach((k) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.padding = "2px 5px";
      row.style.borderRadius = "3px";
      row.style.background = "transparent";
      row.style.fontSize = "12px";
      row.style.fontFamily = "monospace";
      let killerName = "Unknown";
      let victimName = "Unknown";
      let killerTeam = 0;
      let victimTeam = 0;
      if (Shared.playerInfo) {
        let kP, vP;
        if (Array.isArray(Shared.playerInfo)) {
          kP = Shared.playerInfo.find((p) => p.id == k.killer);
          vP = Shared.playerInfo.find((p) => p.id == k.victim);
        } else {
          const kInfo = Shared.playerInfo[String(k.killer)];
          const vInfo = Shared.playerInfo[String(k.victim)];
          if (kInfo) kP = { pName: kInfo.name, team: kInfo.team };
          if (vInfo) vP = { pName: vInfo.name, team: vInfo.team };
        }
        if (kP && kP.pName) {
          killerName = kP.pName;
          killerTeam = kP.team || 0;
        }
        if (vP && vP.pName) {
          victimName = vP.pName;
          victimTeam = vP.team || 0;
        }
      }
      let killerColor = "#ffffff";
      if (killerTeam === 1) killerColor = "#ff8800";
      else if (killerTeam === 2) killerColor = "#00ccff";
      let victimColor = "#ffffff";
      if (victimTeam === 1) victimColor = "#ff8800";
      else if (victimTeam === 2) victimColor = "#00ccff";
      const weaponIcon = k.headshot ? "\u{1F480}" : "\u{1F52B}";
      row.innerHTML = `
            <span style="color: ${killerColor}; font-weight: bold;">${escapeHTML(killerName)}</span>
            <span style="margin: 0 8px; font-size: 10px; color: #fff;">${weaponIcon}</span>
            <span style="color: ${victimColor}; font-weight: bold;">${escapeHTML(victimName)}</span>
        `;
      killLogContainer.appendChild(row);
    });
  }
  function updateScoreboard() {
    let sb = document.getElementById("scoreboard");
    if (!sb) {
      sb = document.createElement("div");
      sb.id = "scoreboard";
      sb.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 400px; background: rgba(0,0,0,0.85); border-radius: 8px; color: white; padding: 12px; font-family: sans-serif; display: none; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); font-size: 13px;";
      document.body.appendChild(sb);
    }
    if (State.showScoreboard && Shared.playerInfo) {
      sb.style.display = "block";
      let isObjMode = false;
      if (Shared.events) {
        for (let i = 0; i < Shared.events.length; i++) {
          const e = Shared.events[i];
          if (e.timestamp > State.time * 1e3) break;
          if (e.type === "scoreboard") isObjMode = e.isObjMode;
        }
      }
      let html = '<h2 style="text-align:center; margin-top:0; color:#fff;">SCOREBOARD</h2>';
      html += '<table style="width:100%; border-collapse: collapse; text-align: left;">';
      html += '<tr style="border-bottom: 2px solid rgba(255,255,255,0.2);">';
      html += '<th style="padding: 8px;">Name</th>';
      html += '<th style="padding: 8px;">Score</th>';
      html += '<th style="padding: 8px;">Kills</th>';
      html += '<th style="padding: 8px;">Deaths</th>';
      if (isObjMode) html += '<th style="padding: 8px;">OBJ</th>';
      html += '<th style="padding: 8px;">K/D</th>';
      html += "</tr>";
      const timeMs = State.time * 1e3;
      const dynamicStats = {};
      if (Array.isArray(Shared.playerInfo)) {
        Shared.playerInfo.forEach((p) => {
          dynamicStats[p.id] = { ...p, kills: 0, deaths: 0, score: 0, obj: 0 };
        });
      } else if (Shared.playerInfo && typeof Shared.playerInfo === "object") {
        Object.entries(Shared.playerInfo).forEach(([id, info]) => {
          dynamicStats[id] = { id, pName: info.name || `Player ${id}`, team: info.team || 0, kills: 0, deaths: 0, score: 0, obj: 0 };
        });
      }
      if (Shared.events) {
        let latestScoreboard = null;
        for (let i = 0; i < Shared.events.length; i++) {
          const e = Shared.events[i];
          if (e.timestamp > timeMs) break;
          if (e.type === "scoreboard") latestScoreboard = e;
        }
        if (latestScoreboard) {
          for (const sid in latestScoreboard.scores) {
            if (dynamicStats[sid]) {
              dynamicStats[sid].score = latestScoreboard.scores[sid].score;
              dynamicStats[sid].kills = latestScoreboard.scores[sid].kills;
              dynamicStats[sid].deaths = latestScoreboard.scores[sid].deaths;
              dynamicStats[sid].obj = latestScoreboard.scores[sid].obj;
            }
          }
        } else {
          Shared.events.forEach((e) => {
            if (e.timestamp <= timeMs && e.type === "kill") {
              if (dynamicStats[e.killer]) {
                dynamicStats[e.killer].kills++;
                dynamicStats[e.killer].score += e.headshot ? 100 : 50;
              }
              if (dynamicStats[e.victim]) {
                dynamicStats[e.victim].deaths++;
              }
            }
          });
        }
      }
      const players = Object.values(dynamicStats).sort((a, b) => b.score - a.score);
      players.forEach((p) => {
        let color = "#fff";
        if (p.team === 1) color = "#ff8800";
        else if (p.team === 2) color = "#00ccff";
        html += '<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">';
        html += `<td style="padding: 8px; color: ${color}; font-weight: bold;">${escapeHTML(p.pName)}</td>`;
        html += `<td style="padding: 8px;">${p.score}</td>`;
        html += `<td style="padding: 8px;">${p.kills}</td>`;
        html += `<td style="padding: 8px;">${p.deaths}</td>`;
        if (isObjMode) html += `<td style="padding: 8px;">${p.obj}</td>`;
        const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
        html += `<td style="padding: 8px; color: #aaa;">${kd}</td>`;
        html += "</tr>";
      });
      html += "</table>";
      sb.innerHTML = html;
    } else {
      sb.style.display = "none";
    }
  }
  function drawHitmarkers() {
    let hm = document.getElementById("hitmarker");
    if (!hm) {
      hm = document.createElement("div");
      hm.id = "hitmarker";
      hm.style.cssText = `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 20px; height: 20px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cline x1='4' y1='4' x2='20' y2='20'/%3E%3Cline x1='20' y1='4' x2='4' y2='20'/%3E%3C/svg%3E"); opacity: 0; transition: opacity 0.1s ease-out; pointer-events: none; z-index: 100;`;
      document.body.appendChild(hm);
    }
    let ch = document.getElementById("crosshair");
    if (!ch) {
      ch = document.createElement("div");
      ch.id = "crosshair";
      ch.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 6px; height: 6px; background: rgba(255,255,255,0.8); border-radius: 50%; display: none; pointer-events: none; z-index: 99;";
      document.body.appendChild(ch);
    }
    if (State.mode === "real" && (State.cameraMode === "1st" || State.cameraMode === "3rd")) {
      ch.style.display = "block";
    } else {
      ch.style.display = "none";
    }
    if (State.mode === "real" && Shared.events && (State.cameraMode === "1st" || State.cameraMode === "3rd")) {
      const timeMs = State.time * 1e3;
      const recentHits = Shared.events.filter(
        (e) => (e.type === "kill" || e.type === "damage") && e.killer == State.targetPlayerId && timeMs >= e.timestamp && timeMs - e.timestamp < 300
      );
      if (recentHits.length > 0) {
        hm.style.opacity = "1";
        const headshot = recentHits.some((e) => e.headshot);
        if (headshot) {
          hm.style.filter = "drop-shadow(0 0 4px red)";
          hm.style.stroke = "red";
        } else {
          hm.style.filter = "none";
        }
      } else {
        hm.style.opacity = "0";
      }
    } else {
      hm.style.opacity = "0";
    }
  }

  // viewer/js/Renderer_Camera.js
  function updateCamera(delta, currentFrame) {
    if (State.cameraMode === "free") {
      const moveSpeed = 100 * delta;
      const dir = new THREE.Vector3();
      Shared.camera.getWorldDirection(dir);
      dir.y = 0;
      dir.normalize();
      const right = new THREE.Vector3().crossVectors(dir, Shared.camera.up).normalize();
      if (keys.w) Shared.camera.position.addScaledVector(dir, moveSpeed);
      if (keys.s) Shared.camera.position.addScaledVector(dir, -moveSpeed);
      if (keys.a) Shared.camera.position.addScaledVector(right, -moveSpeed);
      if (keys.d) Shared.camera.position.addScaledVector(right, moveSpeed);
      if (keys.e) Shared.camera.position.y += moveSpeed;
      if (keys.q) Shared.camera.position.y -= moveSpeed;
    }
    let classHud = document.getElementById("class-hud");
    if ((State.cameraMode === "1st" || State.cameraMode === "3rd") && State.mode === "real") {
      const target = Shared.realMeshes[State.targetPlayerId];
      if (target && target.visible !== false) {
        if (State.cameraMode === "1st") {
          Shared.camera.position.copy(target.position);
          Shared.camera.position.y += 6;
          Shared.camera.rotation.copy(target.rotation);
        } else {
          Shared.camera.position.x = target.position.x + Math.sin(target.rotation.y) * 30;
          Shared.camera.position.z = target.position.z + Math.cos(target.rotation.y) * 30;
          Shared.camera.position.y = target.position.y + 15;
          Shared.camera.lookAt(target.position);
        }
        if (classHud && currentFrame) {
          const pData = currentFrame.players.find((p) => p.id === State.targetPlayerId);
          if (pData) {
            const className = KRUNKER_CLASSES[pData.classId] || `Class ${pData.classId}`;
            classHud.style.display = "block";
            classHud.innerHTML = `Spectating: <span style="color:#00ff88">${pData.name || `Player ${pData.id}`}</span><br><span style="font-size:12px; opacity:0.8">${className}</span>`;
          }
        }
      } else {
        if (classHud) classHud.style.display = "none";
      }
    } else {
      if (classHud) classHud.style.display = "none";
    }
  }

  // viewer/js/Renderer_Tracers.js
  var _tracerGeo = null;
  function getTracerGeo() {
    if (!_tracerGeo) {
      _tracerGeo = new THREE.CylinderGeometry(0.8, 0.8, 4, 6);
      _tracerGeo.translate(0, 2, 0);
      _tracerGeo.rotateX(Math.PI / 2);
    }
    return _tracerGeo;
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
    Shared.scene.add(tracerMesh);
    if (!Shared.trails) Shared.trails = [];
    Shared.trails.push({
      mesh: tracerMesh,
      createdAt: Date.now(),
      origin: origin.clone(),
      velocity: dir.multiplyScalar(800)
    });
  }
  function spawnProjectile(proj) {
    if (!proj || !proj.pos) return;
    const origin = new THREE.Vector3(proj.pos[0], proj.pos[1], proj.pos[2]);
    let dir = new THREE.Vector3(0, 0, -1);
    if (proj.ownerId !== void 0) {
      for (const [id, mesh] of Object.entries(Shared.realMeshes)) {
        if (mesh && mesh.visible) {
          const dist = origin.distanceTo(mesh.position);
          if (dist < 30) {
            dir.set(0, 0, -1);
            dir.applyQuaternion(mesh.quaternion);
            break;
          }
        }
      }
    }
    const tracerMat = new THREE.MeshBasicMaterial({ color: 16763904, transparent: true, opacity: 1 });
    const tracerMesh = new THREE.Mesh(getTracerGeo(), tracerMat);
    tracerMesh.position.copy(origin);
    const lookTarget = origin.clone().add(dir);
    tracerMesh.lookAt(lookTarget);
    Shared.scene.add(tracerMesh);
    if (!Shared.trails) Shared.trails = [];
    Shared.trails.push({
      mesh: tracerMesh,
      createdAt: Date.now(),
      origin: origin.clone(),
      velocity: dir.multiplyScalar(800)
    });
  }
  function updateTracers() {
    if (!Shared.trails) Shared.trails = [];
    const now = Date.now();
    for (let i = Shared.trails.length - 1; i >= 0; i--) {
      const t = Shared.trails[i];
      const age = now - t.createdAt;
      if (age > 400) {
        Shared.scene.remove(t.mesh);
        if (t.mesh.material) t.mesh.material.dispose();
        Shared.trails.splice(i, 1);
      } else {
        if (t.velocity) {
          const scale = age / 1e3;
          t.mesh.position.set(
            t.origin.x + t.velocity.x * scale,
            t.origin.y + t.velocity.y * scale,
            t.origin.z + t.velocity.z * scale
          );
        }
        t.mesh.material.opacity = 1 - age / 400;
      }
    }
  }

  // viewer/js/Renderer_Loop.js
  var _targetPos = new THREE.Vector3();
  var _nextPos = new THREE.Vector3();
  var _qTarget = new THREE.Quaternion();
  var _yAxis = new THREE.Vector3(0, 1, 0);
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (State.isPlaying && !State.isSeeking) {
      State.time += delta * State.speed;
      if (State.time > State.duration) State.time = 0;
    }
    const percent = State.time / State.duration * 100;
    const playhead = document.getElementById("playhead");
    if (playhead) playhead.style.left = (percent || 0) + "%";
    const m = Math.floor(State.time / 60) || 0;
    const s = Math.floor(State.time % 60 || 0).toString().padStart(2, "0");
    let durM = Math.floor(State.duration / 60) || 0;
    let durS = Math.floor(State.duration % 60 || 0).toString().padStart(2, "0");
    const timeDisp = document.getElementById("time-display");
    if (timeDisp) timeDisp.innerText = `${m}:${s} / ${durM}:${durS}`;
    let currentFrame = null;
    let nextFrame = null;
    if (State.mode === "real" && Shared.realFrames.length > 0) {
      const timeMs = State.time * 1e3;
      let frameIdx = 0;
      for (let i = 0; i < Shared.realFrames.length; i++) {
        if (Shared.realFrames[i].timestamp > timeMs) {
          frameIdx = Math.max(0, i - 1);
          break;
        }
        frameIdx = i;
      }
      currentFrame = Shared.realFrames[frameIdx];
      nextFrame = frameIdx < Shared.realFrames.length - 1 ? Shared.realFrames[frameIdx + 1] : currentFrame;
    }
    if (State.mode === "real" && currentFrame) {
      const timeMs = State.time * 1e3;
      const dt = nextFrame ? nextFrame.timestamp - currentFrame.timestamp : 1;
      const lerpFactor = nextFrame ? Math.min(1, Math.max(0, (timeMs - currentFrame.timestamp) / dt)) : 0;
      Object.values(Shared.realMeshes).forEach((m2) => m2.visible = false);
      currentFrame.players.forEach((p) => {
        let mesh = Shared.realMeshes[p.id];
        if (!mesh) {
          const group = new THREE.Group();
          const bodyGeo = new THREE.BoxGeometry(4, 10, 4);
          let bodyColor = 255;
          if (p.team === 1) bodyColor = 16746496;
          else if (p.team === 2) bodyColor = 52479;
          const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
          const body = new THREE.Mesh(bodyGeo, bodyMat);
          body.position.y = 5;
          group.add(body);
          const headGeo = new THREE.BoxGeometry(3, 3, 3);
          const headMat = new THREE.MeshLambertMaterial({ color: 16764074 });
          const head = new THREE.Mesh(headGeo, headMat);
          head.position.y = 11.5;
          group.add(head);
          group.position.set(p.pos[0], p.pos[1], p.pos[2]);
          Shared.realMeshes[p.id] = group;
          Shared.scene.add(group);
          mesh = group;
        }
        if (mesh) {
          if (mesh.children[0] && mesh.children[0].material) {
            let bodyColor = 255;
            if (p.team === 1) bodyColor = 16746496;
            else if (p.team === 2) bodyColor = 52479;
            mesh.children[0].material.color.setHex(bodyColor);
          }
          mesh.visible = p.health !== 0;
          if (!mesh.visible) return;
          _targetPos.set(p.pos[0], p.pos[1], p.pos[2]);
          let targetYaw = p.rot[0] || 0;
          if (nextFrame) {
            const nextP = nextFrame.players.find((x) => x.id === p.id);
            if (nextP && nextP.health > 0) {
              _nextPos.set(nextP.pos[0], nextP.pos[1], nextP.pos[2]);
              if (_targetPos.distanceTo(_nextPos) < 100) {
                _targetPos.lerp(_nextPos, lerpFactor);
                const nextYaw = nextP.rot[0] || 0;
                let diff = nextYaw - targetYaw;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                targetYaw += diff * lerpFactor;
              }
            }
          }
          mesh.position.lerp(_targetPos, 0.5);
          _qTarget.setFromAxisAngle(_yAxis, targetYaw);
          mesh.quaternion.slerp(_qTarget, 0.5);
          if (mesh.position.distanceTo(_targetPos) > 0.1) {
            mesh.userData.walkCycle = (mesh.userData.walkCycle || 0) + delta * 15;
          }
          if (State.isPlaying && p.shoot && !mesh.userData.lastShoot) {
            spawnTracer(mesh, p);
          }
          mesh.userData.lastShoot = p.shoot;
        }
      });
      if (State.isPlaying && currentFrame.projectiles && !currentFrame._tracersSpawned) {
        currentFrame._tracersSpawned = true;
        currentFrame.projectiles.forEach((proj) => {
          spawnProjectile(proj);
        });
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
  function setupUI() {
    window.addEventListener("error", (e) => showToast("Error: " + e.message));
    window.addEventListener("unhandledrejection", (e) => showToast("Error: " + e.reason));
    let isDragging = false;
    let camYaw = 0;
    let camPitch = 0;
    document.addEventListener("mousedown", (e) => {
      if (e.target.tagName !== "CANVAS") return;
      isDragging = true;
    });
    document.addEventListener("mouseup", () => isDragging = false);
    const btnFree = document.getElementById("cam-free");
    const btn1st = document.getElementById("cam-1st");
    const btn3rd = document.getElementById("cam-3rd");
    function updateCamBtns() {
      [btnFree, btn1st, btn3rd].forEach((b) => {
        if (b) b.style.background = "rgba(0,0,0,0.5)";
      });
      if (State.cameraMode === "free" && btnFree) btnFree.style.background = "rgba(0, 212, 255, 0.5)";
      if (State.cameraMode === "1st" && btn1st) btn1st.style.background = "rgba(0, 212, 255, 0.5)";
      if (State.cameraMode === "3rd" && btn3rd) btn3rd.style.background = "rgba(0, 212, 255, 0.5)";
    }
    if (btnFree) btnFree.addEventListener("click", () => {
      State.cameraMode = "free";
      if (Shared.camera) {
        camYaw = Shared.camera.rotation.y;
        camPitch = Shared.camera.rotation.x;
      }
      updateCamBtns();
    });
    if (btn1st) btn1st.addEventListener("click", () => {
      State.cameraMode = "1st";
      updateCamBtns();
    });
    if (btn3rd) btn3rd.addEventListener("click", () => {
      State.cameraMode = "3rd";
      updateCamBtns();
    });
    updateCamBtns();
    document.addEventListener("mousemove", (e) => {
      if (!isDragging || State.cameraMode !== "free") return;
      camYaw -= e.movementX * 5e-3;
      camPitch -= e.movementY * 5e-3;
      camPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, camPitch));
      if (Shared.camera) Shared.camera.rotation.set(camPitch, camYaw, 0);
    });
    document.addEventListener("wheel", (e) => {
      if (State.cameraMode === "free" && Shared.camera) {
        const dir = new THREE.Vector3();
        Shared.camera.getWorldDirection(dir);
        Shared.camera.position.addScaledVector(dir, e.deltaY * -0.1);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (document.activeElement.tagName === "INPUT") return;
      if (e.code === "Space") {
        State.isPlaying = !State.isPlaying;
        document.getElementById("btn-play-pause").innerText = State.isPlaying ? "Pause" : "Play";
        const ind = document.getElementById("play-pause-indicator");
        ind.innerText = State.isPlaying ? "\u25B6" : "\u23F8";
        ind.style.animation = "none";
        ind.offsetHeight;
        ind.style.animation = "popOut 0.5s ease-out forwards";
        e.preventDefault();
      }
      if (e.code === "KeyW") keys.w = true;
      if (e.code === "KeyA") keys.a = true;
      if (e.code === "KeyS") keys.s = true;
      if (e.code === "KeyD") keys.d = true;
      if (e.code === "KeyE") keys.e = true;
      if (e.code === "KeyQ") keys.q = true;
      if (e.code === "ArrowRight") {
        State.time = Math.min(State.duration, State.time + 5);
      }
      if (e.code === "ArrowLeft") {
        State.time = Math.max(0, State.time - 5);
      }
      if (e.code === "Tab") {
        e.preventDefault();
        document.getElementById("scoreboard").classList.add("show");
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.code === "KeyW") keys.w = false;
      if (e.code === "KeyA") keys.a = false;
      if (e.code === "KeyS") keys.s = false;
      if (e.code === "KeyD") keys.d = false;
      if (e.code === "KeyE") keys.e = false;
      if (e.code === "KeyQ") keys.q = false;
      if (e.code === "Tab") document.getElementById("scoreboard").classList.remove("show");
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
    const btnPlayPause = document.getElementById("btn-play-pause");
    if (btnPlayPause) {
      btnPlayPause.addEventListener("click", () => {
        State.isPlaying = !State.isPlaying;
        btnPlayPause.innerText = State.isPlaying ? "Pause" : "Play";
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        State.showScoreboard = true;
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        State.showScoreboard = false;
      }
    });
  }
  function updateTimelineDrag(e, timelineBar) {
    const rect = timelineBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    State.time = pct * State.duration;
  }

  // viewer/js/Renderer_Players.js
  function createPlayerMesh(team = 0) {
    const group = new THREE.Group();
    let bodyColor = 255;
    if (team === 1) bodyColor = 16746496;
    else if (team === 2) bodyColor = 52479;
    const bodyGeo = new THREE.BoxGeometry(4, 10, 4);
    const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 5;
    group.add(body);
    const headGeo = new THREE.BoxGeometry(3, 3, 3);
    const headMat = new THREE.MeshLambertMaterial({ color: 16777215 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 11.5;
    group.add(head);
    const sightGeo = new THREE.BoxGeometry(0.5, 0.5, 15);
    const sightMat = new THREE.MeshBasicMaterial({ color: 16711680 });
    const sightMesh = new THREE.Mesh(sightGeo, sightMat);
    sightMesh.position.set(0, 11.5, -7.5);
    group.add(sightMesh);
    return group;
  }
  function setupRealPlayers() {
    const listContent = document.getElementById("player-list-content");
    listContent.innerHTML = "";
    if (Shared.realMeshes) {
      Object.values(Shared.realMeshes).forEach((mesh) => Shared.scene.remove(mesh));
    }
    Shared.realMeshes = {};
    const uniqueIds = /* @__PURE__ */ new Set();
    Shared.realFrames.forEach((f) => f.players.forEach((p) => uniqueIds.add(p.id)));
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
    Shared.playerInfo = players;
    players.sort((a, b) => a.team - b.team);
    let classHud = document.getElementById("class-hud");
    if (!classHud) {
      classHud = document.createElement("div");
      classHud.id = "class-hud";
      classHud.style.cssText = "position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.6); color: white; padding: 10px 20px; border-radius: 8px; font-family: monospace; font-size: 16px; font-weight: bold; pointer-events: none; z-index: 100; text-align: center; border: 1px solid rgba(255,255,255,0.2); display: none;";
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
                <div class="player-name-text" style="font-size: 13px; font-weight: bold;">${p.pName}</div>
                <div class="class-text" style="font-size: 10px; opacity: 0.8; margin-top: 2px;">${className}</div>
            </div>
        `;
      div.onclick = () => {
        State.targetPlayerId = p.id;
        State.cameraMode = "3rd";
        document.querySelectorAll(".player-card").forEach((el) => el.classList.remove("active"));
        div.classList.add("active");
        classHud.style.display = "block";
        classHud.innerHTML = `Spectating: <span style="color:#00ff88">${p.pName}</span><br><span style="font-size:12px; opacity:0.8">${className}</span>`;
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

  // viewer/js/Parser_KRE.js
  async function parseKRE(arrayBuffer) {
    if (arrayBuffer.byteLength < 69) return false;
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
    const compressedLen = endOffset - 73;
    const compressed = new Uint8Array(arrayBuffer, 69, compressedLen);
    let decompressed;
    try {
      const ds = new DecompressionStream("deflate");
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      decompressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        decompressed.set(c, offset);
        offset += c.length;
      }
    } catch (e) {
      console.warn("Decompression failed", e);
      decompressed = compressed;
    }
    Shared.realFrames = [];
    const dView = new DataView(decompressed.buffer);
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
          const px = dView.getInt16(off, true) / 100;
          off += 2;
          const py = dView.getInt16(off, true) / 100;
          off += 2;
          const pz = dView.getInt16(off, true) / 100;
          off += 2;
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
      setupRealPlayers();
      const landingModal = document.getElementById("landing-modal");
      if (landingModal) landingModal.classList.remove("active");
      return true;
    }
    showToast("\u30A8\u30E9\u30FC: \u6709\u52B9\u306A\u30D5\u30EC\u30FC\u30E0\u30C7\u30FC\u30BF\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
    return false;
  }

  // viewer/js/Parser_Map.js
  function parseMapJSON(jsonString) {
    let mapData;
    try {
      mapData = JSON.parse(jsonString);
    } catch (e) {
      return false;
    }
    if (!mapData.name || !mapData.objects && !mapData.xyz) return false;
    Shared.currentMapName = mapData.name;
    showToast(`\u30DE\u30C3\u30D7\u30ED\u30FC\u30C9: ${mapData.name}`, "success");
    while (Shared.mapGroup.children.length > 0) {
      Shared.mapGroup.remove(Shared.mapGroup.children[0]);
    }
    const colors = mapData.colors || [];
    if (mapData.xyz) {
      for (let i = 0; i < mapData.xyz.length; i += 6) {
        const x = mapData.xyz[i], y = mapData.xyz[i + 1], z = mapData.xyz[i + 2];
        const sx = mapData.xyz[i + 3], sy = mapData.xyz[i + 4], sz = mapData.xyz[i + 5];
        const geo = new THREE.BoxGeometry(sx, sy, sz);
        const mat = new THREE.MeshLambertMaterial({ color: 4473924 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        Shared.mapGroup.add(mesh);
      }
    }
    if (mapData.objects) {
      mapData.objects.forEach((obj) => {
        if (!obj.s) return;
        const sx = obj.s[0];
        const sy = obj.s[1];
        const sz = obj.s[2];
        const geo = new THREE.BoxGeometry(sx, sy, sz);
        let colorHex = 6710886;
        if (obj.ci !== void 0 && colors[obj.ci]) {
          colorHex = hexToNum(colors[obj.ci]);
        }
        const mat = new THREE.MeshLambertMaterial({ color: colorHex });
        const mesh = new THREE.Mesh(geo, mat);
        if (obj.p) mesh.position.set(obj.p[0], obj.p[1], obj.p[2]);
        if (obj.r) mesh.rotation.set(obj.r[0], obj.r[1], obj.r[2]);
        Shared.mapGroup.add(mesh);
      });
    }
    const landingModal = document.getElementById("landing-modal");
    if (landingModal) landingModal.classList.remove("active");
    return true;
  }
  function parseOBJ(text) {
    showToast("3D\u5730\u5F62(OBJ)\u3092\u89E3\u6790\u4E2D...", "success");
    while (Shared.mapGroup.children.length > 0) {
      Shared.mapGroup.remove(Shared.mapGroup.children[0]);
    }
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

  // viewer/js/Parser_JSON.js
  function parseJSONLog(jsonString) {
    let data = [];
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      showToast("JSON\u306E\u30D1\u30FC\u30B9\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
      return false;
    }
    if (!data || !data.length) return false;
    if (data[0] && data[0].version) {
      Shared.replayHeader = data.shift();
    }
    Shared.realFrames = [];
    Shared.events = [];
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
        parseMapJSON(JSON.stringify(payload[1]));
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
              score: pArr[i + 1],
              obj: pArr[i + 2],
              kills: pArr[i + 3],
              deaths: 0
              // Hardpoint doesn't send deaths
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
        playersMap[0].rot = [payload[4], payload[5]];
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
          const iter = MessagePack.decodeMulti(bytes);
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
        if (!finalInfo[key]) finalInfo[key] = { name: null, team: null };
        if (p.name) {
          if (!p.name.startsWith("Guest_") && !p.name.startsWith("Player ")) {
            finalInfo[key].name = p.name;
          } else if (!finalInfo[key].name) {
            finalInfo[key].name = p.name;
          }
        }
        if (p.team) finalInfo[key].team = p.team;
      });
      Shared.realFrames.forEach((f) => {
        f.players.forEach((p) => {
          const key = String(p.id);
          if (!finalInfo[key]) finalInfo[key] = { name: null, team: null };
          if (p.name) {
            if (!p.name.startsWith("Guest_") && !p.name.startsWith("Player ")) {
              finalInfo[key].name = p.name;
            } else if (!finalInfo[key].name) {
              finalInfo[key].name = p.name;
            }
          }
          if (p.team) finalInfo[key].team = p.team;
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
          }
        });
      });
      Shared.playerInfo = finalInfo;
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
  function setupDragAndDrop() {
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      document.addEventListener(eventName, (e) => e.preventDefault(), false);
    });
    const dropOverlay = document.getElementById("drop-overlay");
    const landingBox = document.getElementById("landing-box");
    document.addEventListener("dragenter", (e) => {
      dropOverlay.style.display = "flex";
      if (landingBox) landingBox.classList.add("dragover");
    });
    document.addEventListener("dragover", (e) => {
      dropOverlay.style.display = "flex";
      if (landingBox) landingBox.classList.add("dragover");
    });
    document.addEventListener("dragleave", (e) => {
      if (e.clientX === 0 || e.clientY === 0) {
        dropOverlay.style.display = "none";
        if (landingBox) landingBox.classList.remove("dragover");
      }
    });
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      dropOverlay.style.display = "none";
      if (landingBox) landingBox.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const reader = new FileReader();
        if (file.name.endsWith(".json") || file.name.endsWith(".kre_log")) {
          reader.onload = (evt) => {
            try {
              const text = evt.target.result;
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed)) {
                parseJSONLog(text);
              } else if (parsed && typeof parsed === "object") {
                parseMapJSON(text);
              } else {
                showToast("\u4E0D\u660E\u306AJSON\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u3067\u3059");
              }
            } catch (e2) {
              showToast("JSON\u306E\u89E3\u6790\u306B\u5931\u6557\u3057\u307E\u3057\u305F: " + e2.message);
            }
          };
          reader.readAsText(file);
        } else if (file.name.endsWith(".obj")) {
          reader.onload = (evt) => {
            try {
              parseOBJ(evt.target.result);
            } catch (e2) {
              showToast("OBJ\u306E\u89E3\u6790\u306B\u5931\u6557\u3057\u307E\u3057\u305F: " + e2.message);
            }
          };
          reader.readAsText(file);
        } else {
          reader.onload = async (evt) => {
            const success = await parseKRE(evt.target.result);
            if (!success) {
              console.warn("Failed to parse KRE");
              showToast("KRE\u30D5\u30A1\u30A4\u30EB\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
            }
          };
          reader.readAsArrayBuffer(file);
        }
      }
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

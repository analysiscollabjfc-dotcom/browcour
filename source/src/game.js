// ============================================================================
// game: input, camera feel, checkpoint routes, HUD, adaptive resolution and the main loop
// ============================================================================
const body = document.body;
const cfg = { sens: 1, fov: 78 };
try { Object.assign(cfg, JSON.parse(localStorage.browcourCfg || '{}')); } catch {}
const saveCfg = () => keep('browcourCfg', JSON.stringify(cfg));

// ---------------------------------------------------------------- input
const inp = { f: 0, s: 0, c: 0, g: 0, jq: 0, dq: 0, yaw: 0.5, pitch: 0.5 };
inp.yaw = 0; inp.pitch = 0;
const keys = new Uint8Array(8); // 0 W, 1 S, 2 A, 3 D, 4 crouch, 5 grapple key, 6 grapple mouse
const KM = { KeyW: 0, ArrowUp: 0, KeyS: 1, ArrowDown: 1, KeyA: 2, ArrowLeft: 2, KeyD: 3, ArrowRight: 3, ShiftLeft: 4, ShiftRight: 4, KeyC: 4, KeyE: 5 };
let locked = false, playing = false, showStats = false;
addEventListener('keydown', (e) => {
  if (!locked) return;
  const k = KM[e.code];
  if (k !== undefined) { keys[k] = 1; e.preventDefault(); return; }
  if (e.repeat) return;
  if (e.code === 'Space') { inp.jq = 1; e.preventDefault(); }
  else if (e.code === 'KeyF' || e.code === 'KeyQ') inp.dq = 1;
  else if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyM') setMute(muted ? 0 : 1);
  else if (e.code === 'KeyV') { sg.on = sg.on ? 0 : 1; msg(sg.on ? 'She\'s back' : 'Singer hidden', 1); }
  else if (e.code === 'KeyH') { showStats = !showStats; $('st').hidden = !showStats; }
  else if (e.code === 'Digit0' || e.code === 'Backspace') freeRoam();
  else if (e.code >= 'Digit1' && e.code <= 'Digit5') startRoute(+e.code[5] - 1, true);
});
addEventListener('keyup', (e) => { const k = KM[e.code]; if (k !== undefined) keys[k] = 0; });
addEventListener('blur', () => keys.fill(0));
canvas.addEventListener('mousedown', (e) => {
  if (!locked) { if (playing) lock(); return; }
  if (e.button === 0) keys[6] = 1; else if (e.button === 2) inp.dq = 1;
});
addEventListener('mouseup', (e) => { if (e.button === 0) keys[6] = 0; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (!locked) return;
  const k = 0.0022 * cfg.sens;
  inp.yaw -= e.movementX * k;
  inp.pitch = clamp(inp.pitch - e.movementY * k, -1.55, 1.55);
});
const lock = () => { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()); };
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  body.classList.toggle('m', !locked);
  if (!locked) { keys.fill(0); refreshMenu(); }
});

// ---------------------------------------------------------------- routes: 5 seeded checkpoint runs through the city
const NR = 5, NCP = 9, CPS = new Float64Array(NR * NCP * 3), SCR = new Float32Array(MAXB * BF);
for (let r = 0; r < NR; r++) {
  let cx = round(cos(r * 1.9) * 2), cz = round(sin(r * 1.9) * 2), ang = r * 1.2566 + 0.4;
  for (let i = 0; i < NCP; i++) {
    genChunk(cx, cz, SCR, 0);
    const k = (r * NCP + i) * 3; CPS[k] = GT[0]; CPS[k + 1] = GT[1] + 1; CPS[k + 2] = GT[2];
    const h = ihash(r, i, 99); ang += (h - 0.5) * 1.5;
    const st = h > 0.6 ? 3 : 2;
    let dx = round(cos(ang) * st), dz = round(sin(ang) * st);
    if (!dx && !dz) dx = 1;
    cx += dx; cz += dz;
  }
}
let best = [];
try { best = JSON.parse(localStorage.browcourBest || '[]'); } catch {}
let route = -1, cpi = 0, rtime = 0, freeze = 0, startCd = 0;
const fmt = (t) => { const m = floor(t / 60), s = t - m * 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const cp = (r, i) => (r * NCP + i) * 3;
const yawTo = (dx, dz) => atan2(-dx, -dz);
function beam(i, x, y, z, b) { const o = i * BF; BEAM[o] = x - 0.9; BEAM[o + 1] = y - 1; BEAM[o + 2] = z - 0.9; BEAM[o + 3] = M_BEAM + b; BEAM[o + 4] = 1.8; BEAM[o + 5] = 400; BEAM[o + 6] = 1.8; BEAM[o + 7] = 0; }
function setBeams() {
  nBeam = 0;
  if (route >= 0) {
    for (let i = cpi; i < min(cpi + 2, NCP); i++) { const k = cp(route, i); beam(nBeam++, CPS[k], CPS[k + 1], CPS[k + 2], i === cpi ? 0.99 : 0.3); }
  } else {
    for (let r = 0; r < NR; r++) { const k = cp(r, 0); beam(nBeam++, CPS[k], CPS[k + 1], CPS[k + 2], 0.45); }
  }
  Q.writeBuffer(beamBuf, 0, BEAM, 0, nBeam * BF);
}
function placeAt(r, i) {
  const k = cp(r, i), n = cp(r, min(i + 1, NCP - 1));
  teleport(CPS[k], CPS[k + 1] - 1 + 0.01, CPS[k + 2]);
  inp.yaw = yawTo(CPS[n] - CPS[k], CPS[n + 2] - CPS[k + 2]); inp.pitch = -0.08;
  stream(pos[0], pos[2]);
}
function startRoute(r, tp) {
  route = r; cpi = 1; rtime = 0;
  if (tp) { placeAt(r, 0); freeze = 1.5; } else { freeze = 0; msg('Route ' + (r + 1) + ' — go!', 1.2); }
  setBeams();
}
function freeRoam() { if (route >= 0) msg('Free run', 1); route = -1; startCd = 2; setBeams(); }
let safeX = 0, safeY = 0, safeZ = 0, safeYaw = 0, safeT = 0;
function restart() {
  if (route >= 0) startRoute(route, true);
  else respawn();
}
function respawn() {
  if (route >= 0 && cpi > 0) placeAt(route, cpi - 1);
  else { teleport(safeX, safeY, safeZ); inp.yaw = safeYaw; }
  flash = 1;
}

// ---------------------------------------------------------------- HUD
const hSpd = $('v'), hBar = $('vb'), hTm = $('tm'), hCp = $('cp'), hMsg = $('msg'), hXh = $('xh'), hSt = $('st');
let msgT = 0, flash = 0, hudT = 0;
function msg(t, d) { hMsg.textContent = t; hMsg.style.opacity = 1; msgT = d; }
function refreshMenu() {
  let h = '';
  for (let r = 0; r < NR; r++) h += `<button data-r="${r}"><b>${r + 1}</b> Route ${r + 1}<span>${best[r] ? fmt(best[r]) : '—'}</span></button>`;
  $('rl').innerHTML = h;
  for (const b of $('rl').children) b.onclick = () => { startRoute(+b.dataset.r, true); go(); };
  for (const b of $('ql').children) b.classList.toggle('on', +b.dataset.q === LV);
}
function go() { playing = true; audioInit(); lock(); $('run').textContent = 'Resume'; }
$('run').onclick = go;
for (const b of $('ql').children) b.onclick = () => { keep('browcour', b.dataset.q); location.reload(); };
const songIn = $('song');
const useSong = async (f) => { if (f && await singerSong(f)) msg('She sings ' + f.name.replace(/\.[^.]+$/, ''), 2); };
songIn.onchange = () => useSong(songIn.files[0]);
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); useSong(e.dataTransfer.files[0]); });
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });
const sens = $('sens'), fovI = $('fov');
sens.value = cfg.sens; fovI.value = cfg.fov;
sens.oninput = () => { cfg.sens = +sens.value; saveCfg(); };
fovI.oninput = () => { cfg.fov = +fovI.value; saveCfg(); };

// ---------------------------------------------------------------- camera feel
const VM = new Float32Array(16), PM = new Float32Array(16), CB = new Float32Array(9);
const camS = { fov: 78.5, roll: 0.5, dip: 0.5, eye: 1.5, bob: 0.5, phase: 0.5, lines: 0.5, shake: 0.5 };
for (const k in camS) camS[k] = 0;
camS.fov = cfg.fov; camS.eye = HT - 0.15;

// ---------------------------------------------------------------- start: spawn on the tallest roof of chunk (0, 0)
genChunk(0, 0, SCR, 0);
teleport(GT[0], GT[1] + 0.01, GT[2] + 4);
safeX = pos[0]; safeY = pos[1]; safeZ = pos[2];
stream(pos[0], pos[2]);
setBeams();
refreshMenu();
UB[36] = SUN[0]; UB[37] = SUN[1]; UB[38] = SUN[2]; UB[39] = 1 / (R * CH * 0.8);
UB[43] = 0.85; UB[54] = 1 / SHRES;

// adaptive resolution: drop the render scale when frames run long, raise it again when there is headroom
const FT = new Float32Array(60); let ftn = 0, ftSum = 0, adaptCd = 2, fpsShow = 0;
function adapt(ms, dt) {
  ftSum += ms - FT[ftn % 60]; FT[ftn % 60] = ms; ftn++;
  adaptCd -= dt;
  if (ftn < 60 || adaptCd > 0) return;
  const avg = ftSum / 60; fpsShow = 1000 / avg;
  if (avg > 18.5 && scale > 0.5) { scale = max(0.5, scale * 0.88); adaptCd = 1.5; keep('browcour', LV + ',' + scale.toFixed(3)); }
  else if (avg < 13 && scale < 1) { scale = min(1, scale * 1.06); adaptCd = 3; keep('browcour', LV + ',' + scale.toFixed(3)); }
}

let trailTick = 0;
let last = performance.now(), acc = 0, time = 0, frames = 0, stepTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (dead) return;
  let dt = (now - last) / 1000; const ms = now - last; last = now;
  if (dt > 0.1) dt = 0.1;
  time += dt;
  if (frames++ === 30) { try { localStorage.removeItem('browcourLoad'); } catch {} }

  // ---- simulation
  inp.f = keys[0] - keys[1]; inp.s = keys[3] - keys[2]; inp.c = keys[4]; inp.g = keys[5] | keys[6];
  if (locked) {
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      if (freeze > 0) { freeze -= DT; ppos[0] = pos[0]; ppos[1] = pos[1]; ppos[2] = pos[2]; if (freeze <= 0) msg('Go!', 0.8); inp.jq = inp.dq = 0; continue; }
      step(inp);
      if (++trailTick & 1) trailPush(pos[0], pos[1], pos[2], pl.slide ? 2 : pl.wall ? 3 : pl.ground ? 0 : 1);
      if (route >= 0) rtime += DT;
      if (ev.land) { sfx('land', ev.land); if (ev.land > 3) camS.dip -= min(ev.land * 0.018, 0.35); ev.land = 0; }
      if (ev.jump) { sfx('jump'); ev.jump = 0; }
      if (ev.kick) { sfx('kick'); ev.kick = 0; }
      if (ev.dash) { sfx('dash'); ev.dash = 0; }
      if (ev.slide) { sfx('slide'); ev.slide = 0; }
      if (ev.wall) { sfx('wall'); ev.wall = 0; }
      if (ev.grap) { sfx('grap'); ev.grap = 0; }
      if (ev.ghit) { sfx('hook'); hookHit(); camS.dip -= 0.04; ev.ghit = 0; }
      if (ev.gmiss) { const c = cos(inp.pitch); sfx('grap'); hookFired(1, -sin(inp.yaw) * c, sin(inp.pitch), -cos(inp.yaw) * c); ev.gmiss = 0; }
      if (ev.mantle) { sfx('jump'); ev.mantle = 0; }
      if (pos[1] < 0.6) respawn();
      // checkpoints
      if (route >= 0) {
        const k = cp(route, cpi), dx = pos[0] - CPS[k], dy = pos[1] - CPS[k + 1], dz = pos[2] - CPS[k + 2];
        if (dx * dx + dz * dz < 25 && dy > -4 && dy < 8) {
          cpi++;
          if (cpi >= NCP) {
            const r = route, pb = !best[r] || rtime < best[r];
            if (pb) { best[r] = rtime; keep('browcourBest', JSON.stringify(best)); }
            msg((pb ? 'New best  ' : 'Finished  ') + fmt(rtime), 3); sfx('win');
            route = -1; startCd = 4;
          } else sfx('cp');
          setBeams();
        }
      } else if ((startCd -= DT) <= 0) {
        for (let r = 0; r < NR; r++) {
          const k = cp(r, 0), dx = pos[0] - CPS[k], dy = pos[1] - CPS[k + 1], dz = pos[2] - CPS[k + 2];
          if (dx * dx + dz * dz < 16 && abs(dy) < 4) { startRoute(r, false); break; }
        }
      }
      if (pl.ground && pos[1] > 3 && (stepTick++ & 63) === 0) { safeX = pos[0]; safeY = pos[1]; safeZ = pos[2]; safeYaw = inp.yaw; }
    }
  } else acc = 0;

  // ---- camera
  const a = acc / DT;
  const px = mix(ppos[0], pos[0], a), py = mix(ppos[1], pos[1], a), pz = mix(ppos[2], pos[2], a);
  const sp = hypot(vel[0], vel[1], vel[2]), hs = hypot(vel[0], vel[2]);
  const ke = (r) => 1 - exp(-dt * r);
  camS.fov += (cfg.fov + clamp((sp - 12) * 0.5, 0, 24) + (pl.dashT > 0 ? 7 : 0) - camS.fov) * ke(pl.dashT > 0 ? 14 : 5);
  const ry = cos(inp.yaw), rz = -sin(inp.yaw);
  let rollT = pl.wall ? -(pl.wnx * ry + pl.wnz * rz) * 0.16 : -inp.s * 0.012 * min(hs / 10, 1);
  if (pl.slide) rollT += 0.03;
  camS.roll += (rollT - camS.roll) * ke(8);
  camS.eye += (pl.ht - 0.15 - camS.eye) * ke(pl.mantle ? 30 : 14);
  camS.dip *= 1 - ke(7);
  if (pl.ground && !pl.slide && hs > 1 && locked) {
    const ph = camS.phase; camS.phase += hs * dt * 0.95;
    if (floor(ph / PI) !== floor(camS.phase / PI)) sfx('step');
    camS.bob = sin(camS.phase * 2) * 0.035 * min(hs / 10, 1);
  } else camS.bob *= 1 - ke(10);
  camS.lines += (clamp((sp - 18) / 26, 0, 1) - camS.lines) * ke(4);
  camS.shake = pl.slide ? min(hs / 30, 1) * 0.004 : sp > 30 ? (sp - 30) * 0.0002 : 0;
  const ey = py + camS.eye + camS.dip + camS.bob + (camS.shake ? (ihash(frames, 1, 1) - 0.5) * camS.shake * 4 : 0);
  const yaw = inp.yaw + (camS.shake ? (ihash(frames, 2, 1) - 0.5) * camS.shake : 0);

  if (stream(px, pz)) shDirty = 1;
  placeShadow(px, pz);
  resize();
  const asp = cw / chh, fy = camS.fov * PI / 180, ty = tan(fy / 2);
  perspRZ(PM, fy, asp, 0.05);
  viewYPR(VM, CB, px, ey, pz, yaw, inp.pitch, camS.roll);
  mul4(UB, PM, VM);
  UB[32] = px; UB[33] = ey; UB[34] = pz; UB[35] = time;
  UB[40] = camS.lines;
  UB[52] = cw; UB[53] = chh; UB[55] = asp;
  for (let i = 0; i < 3; i++) { UB[56 + i] = CB[i] * ty * asp; UB[60 + i] = CB[3 + i] * ty; UB[64 + i] = CB[6 + i]; }
  // the runner's body, the grapple cable and the hook
  buildBody(dt, px, py, pz, px, ey, pz, yaw, CB, 2 * ty / chh, time);
  if (locked) updateSinger(dt, px, py, pz, inp.yaw, hs);
  buildSinger(dt, px, ey, pz, CB, 2 * ty / chh, time, singing);
  renderFrame(px, ey, pz, camS.lines > 0.01 ? 1 : 0);

  // ---- HUD (text at 15 Hz so the DOM is touched rarely)
  if (msgT > 0 && (msgT -= dt) <= 0) hMsg.style.opacity = 0;
  if (freeze > 0) { const n = Math.ceil(freeze / 0.5); if (hMsg.textContent !== '' + n) msg('' + n, 0.6); }
  if (flash > 0) { flash = max(0, flash - dt * 3); body.style.setProperty('--fl', flash.toFixed(2)); }
  adapt(ms, dt);
  if ((hudT -= dt) <= 0) {
    hudT = 1 / 15;
    hSpd.textContent = round(sp * 3.6);
    hBar.style.transform = `scaleX(${min(sp / 60, 1).toFixed(3)})`;
    if (route >= 0) {
      hTm.textContent = fmt(rtime);
      const k = cp(route, min(cpi, NCP - 1));
      hCp.textContent = `${cpi} / ${NCP - 1}   ·   ${round(hypot(CPS[k] - pos[0], CPS[k + 1] - pos[1], CPS[k + 2] - pos[2]))} m`;
    } else { hTm.textContent = ''; hCp.textContent = 'free run · find a blue beam or press 1-5'; }
    // grapple reticle: is there something to hook within range?
    if (!pl.grap) {
      const cp2 = cos(inp.pitch);
      hXh.className = raycast(px, ey, pz, -sin(inp.yaw) * cp2, sin(inp.pitch), -cos(inp.yaw) * cp2, GRANGE) > 2 ? 'g' : '';
    } else hXh.className = 'g on';
    audioWind(sp);
    singerTick(sg.on && locked, sg.x, sg.y + 1.5, sg.z, px, ey, pz, CB);
    if (showStats) hSt.textContent = `${fpsShow.toFixed(0)} fps  ${cw}×${chh} (${(scale * 100).toFixed(0)}%)  ${drawCalls} draws  ${nv0()} chunks  LV ${'HML'[LV]}`;
  }
}
const nv0 = () => { let n = 0; for (let s = 0; s < SLOTS; s++) if (sCX[s] > -0x3fffffff) n++; return n; };
body.className = 'm';
$('s').textContent = '';
requestAnimationFrame(frame);

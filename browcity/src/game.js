// ============================================================================
// game: input, day and night, the camera, HUD and the main loop
// ============================================================================
const body = document.body;
const cfg = { sens: 1, fov: 68, day: 12 };
try { Object.assign(cfg, JSON.parse(localStorage.browcityCfg || '{}')); } catch {}
const saveCfg = () => keep('browcityCfg', JSON.stringify(cfg));

// ---------------------------------------------------------------- input
const inp = { f: 0, s: 0, run: 0, jq: 0, hb: 0 };
const keys = new Uint8Array(8); // W S A D shift space
const KM = { KeyW: 0, ArrowUp: 0, KeyS: 1, ArrowDown: 1, KeyA: 2, ArrowLeft: 2, KeyD: 3, ArrowRight: 3, ShiftLeft: 4, ShiftRight: 4, Space: 5 };
let locked = false, playing = false, showStats = false, fq = 0, hornQ = 0;
addEventListener('keydown', (e) => {
  if (!locked) return;
  const k = KM[e.code];
  if (k !== undefined) { keys[k] = 1; if (k === 5 && !e.repeat) inp.jq = 1; e.preventDefault(); return; }
  if (e.repeat) return;
  if (e.code === 'KeyF' || e.code === 'KeyE') fq = 1;
  else if (e.code === 'KeyH') hornQ = 1;
  else if (e.code === 'KeyT') { tod = (tod + 1) % 24; msg(clock(), 1); }
  else if (e.code === 'KeyM') setMute(muted ? 0 : 1);
  else if (e.code === 'KeyI') { showStats = !showStats; $('st').hidden = !showStats; }
});
addEventListener('keyup', (e) => { const k = KM[e.code]; if (k !== undefined) keys[k] = 0; });
addEventListener('blur', () => keys.fill(0));
canvas.addEventListener('mousedown', () => { if (!TOUCH && !locked && playing) lock(); });
addEventListener('contextmenu', (e) => e.preventDefault());
let camYaw = 0, camPitch = -0.2, mouseT = 9;
addEventListener('mousemove', (e) => {
  if (!locked) return;
  const k = 0.0022 * cfg.sens;
  camYaw -= e.movementX * k; camPitch = clamp(camPitch - e.movementY * k, -1.2, 0.75); mouseT = 0;
});
const lock = () => { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()); };
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; body.classList.toggle('m', !locked); if (!locked) keys.fill(0); });
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });
function go() {
  playing = true; audioInit(); $('run').textContent = 'Resume';
  if (TOUCH) { touchStart(); locked = true; body.classList.remove('m'); } else lock();
}
const inCarNow = () => pl.car >= 0;
touchInit([
  { label: 'JUMP', pos: 'right:20px;bottom:20px', down: () => { inp.jq = 1; }, show: () => !inCarNow() },
  { label: 'DRIFT', pos: 'right:20px;bottom:20px', down: () => { keys[5] = 1; }, up: () => { keys[5] = 0; }, show: inCarNow },
  { label: 'CAR', pos: 'right:100px;bottom:22px', down: () => { fq = 1; }, show: () => inCarNow() || nearPK >= 0 || nearOK },
  { label: 'HORN', pos: 'right:20px;bottom:100px', down: () => { hornQ = 1; }, show: inCarNow },
  { label: 'II', small: 1, pos: 'left:12px;top:12px', down: () => { locked = false; keys.fill(0); body.classList.add('m'); } },
  { label: '+1h', small: 1, pos: 'left:66px;top:12px', down: () => { tod = (tod + 1) % 24; msg(clock(), 1); } },
], (dx, dy) => { const k = 0.005 * cfg.sens; camYaw -= dx * k; camPitch = clamp(camPitch - dy * k, -1.2, 0.75); mouseT = 0; });
let nearOK = false;
$('run').onclick = go;
for (const b of $('ql').children) { b.classList.toggle('on', +b.dataset.q === LV); b.onclick = () => { keep('browcity', b.dataset.q); location.reload(); }; }
for (const b of $('dl').children) { b.classList.toggle('on', +b.dataset.d === cfg.day); b.onclick = () => { cfg.day = +b.dataset.d; saveCfg(); for (const c of $('dl').children) c.classList.toggle('on', c === b); }; }
const sens = $('sens'); sens.value = cfg.sens; sens.oninput = () => { cfg.sens = +sens.value; saveCfg(); };

// ---------------------------------------------------------------- HUD
const hClock = $('clk'), hSpd = $('spd'), hHint = $('hint'), hMsg = $('msg'), hSt = $('st');
let msgT = 0, hudT = 0;
function msg(t, d) { hMsg.textContent = t; hMsg.style.opacity = 1; msgT = d; }
const clock = () => { const h = floor(tod), m = floor((tod - h) * 60); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; };

// ---------------------------------------------------------------- day and night
let tod = 17.3, sigT = 0;
const SD = new Float32Array(3);
const mix3 = (o, a, b, t) => { o[0] = mix(a[0], b[0], t); o[1] = mix(a[1], b[1], t); o[2] = mix(a[2], b[2], t); };
const C3 = new Float32Array(3), C4 = new Float32Array(3);
const ZEN_N = [0.006, 0.01, 0.03], ZEN_S = [0.16, 0.22, 0.45], ZEN_D = [0.13, 0.32, 0.7];
const HOR_N = [0.02, 0.028, 0.055], HOR_S = [1.0, 0.48, 0.24], HOR_D = [0.66, 0.76, 0.88];
function daylight() {
  // the sun rises at 6:00 in the east (+x), crosses the south sky and sets at 18:00
  const a = (tod - 6) / 12 * PI;
  let x = cos(a), y = sin(a) * 0.85, z = 0.42; const l = hypot(x, y, z); x /= l; y /= l; z /= l;
  SD[0] = x; SD[1] = y; SD[2] = z;
  const day = clamp((y + 0.1) / 0.35, 0, 1), d2 = clamp(y / 0.3, 0, 1), night = clamp((0.05 - y) / 0.17, 0, 1);
  // light: the sun (golden near the horizon), else the moon opposite
  if (y > -0.03) { const sy = max(y, 0.06), ll = hypot(x, sy, z); LS[0] = x / ll; LS[1] = sy / ll; LS[2] = z / ll; }
  else { const my = max(-y, 0.25), ll = hypot(x, my, z); LS[0] = -x / ll; LS[1] = my / ll; LS[2] = -z / ll; }
  const sf = clamp((y + 0.03) / 0.09, 0, 1), warm = clamp(y / 0.4, 0, 1);
  UB[36] = LS[0]; UB[37] = LS[1]; UB[38] = LS[2]; UB[39] = 1 / (R * BS * 1.05);
  UB[40] = (mix(1.7, 2.35, warm) * sf + 0.09 * night); UB[41] = (mix(0.8, 2.1, warm) * sf + 0.11 * night); UB[42] = (mix(0.38, 1.85, warm) * sf + 0.17 * night); UB[43] = night;
  UB[44] = mix(0.018, 0.32, day); UB[45] = mix(0.024, 0.39, day); UB[46] = mix(0.045, 0.54, day); UB[47] = mix(1.6, 0.95, day);
  UB[48] = mix(0.018, 0.22, day); UB[49] = mix(0.018, 0.2, day); UB[50] = mix(0.024, 0.17, day);
  mix3(C3, ZEN_S, ZEN_D, d2); mix3(C4, ZEN_N, C3, day); UB[52] = C4[0]; UB[53] = C4[1]; UB[54] = C4[2]; UB[55] = night;
  mix3(C3, HOR_S, HOR_D, d2); mix3(C4, HOR_N, C3, day); UB[56] = C4[0]; UB[57] = C4[1]; UB[58] = C4[2]; UB[59] = y > -0.03 ? 1 : 0;
  UB[60] = x; UB[61] = y; UB[62] = z;
  return night;
}

// ---------------------------------------------------------------- start: on the square in front of the church
const VM = new Float32Array(16), PM = new Float32Array(16), CB9 = new Float32Array(9);
{
  // block (0, 0) is always the square: stand on it between the houses and the fountain, facing the church
  const x0 = lineP(0, 0), x1 = lineP(1, 0), z0 = lineP(0, 1);
  pp[0] = (x0 + x1) / 2 + 9; pp[2] = z0 + CWS[lineC(0, 1)] / 2 + SWS[lineC(0, 1)] + 19; pp[1] = 0.15;
  ppp[0] = pp[0]; ppp[1] = pp[1]; ppp[2] = pp[2];
  camYaw = PI; pl.yaw = PI / 2;
}
stream(pp[0], pp[2]);
initTraffic(pp[0], pp[2]);
initPeds(pp[0], pp[2]);
UB[66] = 1 / SHRES;

const FT = new Float32Array(60); let ftn = 0, ftSum = 0, adaptCd = 2, fpsShow = 0;
function adapt(ms, dt) {
  ftSum += ms - FT[ftn % 60]; FT[ftn % 60] = ms; ftn++; adaptCd -= dt;
  if (ftn < 60 || adaptCd > 0) return;
  const avg = ftSum / 60; fpsShow = 1000 / avg;
  if (avg > 18.5 && scale > 0.5) { scale = max(0.5, scale * 0.88); adaptCd = 1.5; keep('browcity', LV + ',' + scale.toFixed(3)); }
  else if (avg < 13 && scale < 1) { scale = min(1, scale * 1.06); adaptCd = 3; keep('browcity', LV + ',' + scale.toFixed(3)); }
}

const CP = new Float64Array(4); // previous player-car pose for interpolation: x z yaw y
let last = performance.now(), acc = 0, time = 0, frames = 0, ambT = 2, honkT = 0, stepPh = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (dead) return;
  let dt = (now - last) / 1000; const ms = now - last; last = now;
  if (dt > 0.1) dt = 0.1;
  time += dt;
  if (frames++ === 30) { try { localStorage.removeItem('browcityLoad'); } catch {} }
  if (locked) { tod = (tod + dt * 24 / (cfg.day * 60)) % 24; sigT = (sigT + dt) % 4000; }

  // ---- player
  inp.f = keys[0] - keys[1]; inp.s = keys[3] - keys[2]; inp.run = keys[4]; inp.hb = keys[5];
  if (TJ[2]) { // touch stick: analog steering and walking, push it all the way to sprint
    inp.f = abs(TJ[1]) > 0.18 ? TJ[1] : 0; inp.s = abs(TJ[0]) > 0.18 ? TJ[0] : 0; inp.run = hypot(TJ[0], TJ[1]) > 0.93 ? 1 : 0;
  }
  if (locked) {
    if (fq) {
      if (pl.car < 0) { if (enterCar()) { sfx('door'); const o = pl.car * 32; CP[0] = CA[o]; CP[1] = CA[o + 1]; CP[2] = CA[o + K_YAW]; CP[3] = CA[o + K_Y]; msg(CNAME[CA[o + K_T]], 1.2); } }
      else if (exitCar()) sfx('door'); else msg('Slow down to get out', 1);
    }
    if (hornQ && pl.car >= 0) sfx('horn');
    acc += dt;
    while (acc >= PDT) {
      acc -= PDT;
      if (pl.car < 0) walkStep(inp, camYaw);
      else { const o = pl.car * 32; CP[0] = CA[o]; CP[1] = CA[o + 1]; CP[2] = CA[o + K_YAW]; CP[3] = CA[o + K_Y]; driveStep(inp); }
    }
    if (pl.crash) { sfx('crash', pl.crash); pl.crash = 0; }
  } else acc = 0;
  fq = 0; hornQ = 0;
  const a = acc / PDT, inCar = pl.car >= 0, co = pl.car * 32;
  let px, py, pz, ph = 0;
  if (inCar) {
    let dy = CA[co + K_YAW] - CP[2]; dy -= TAU * round(dy / TAU); ph = CP[2] + dy * a;
    px = mix(CP[0], CA[co], a); pz = mix(CP[1], CA[co + 1], a); py = mix(CP[3], CA[co + K_Y], a);
  } else { px = mix(ppp[0], pp[0], a); py = mix(ppp[1], pp[1], a); pz = mix(ppp[2], pp[2], a); }

  // ---- the world around
  const vfx = -sin(camYaw), vfz = -cos(camYaw);
  if (locked) {
    updateTraffic(dt, sigT, px, pz, vfx, vfz, pp[0], pp[2], !inCar);
    updatePeds(dt, sigT, px, pz, carHit);
  }
  if (stream(px, pz)) shDirty = 1;
  const night = daylight();
  UB[51] = sigT;

  // ---- camera: orbit on foot, chase in a car (it swings back behind the car when the mouse rests)
  mouseT += dt;
  let tx = px, ty = py + 1.55, tz = pz, dist = 4.3;
  if (inCar) {
    const T = CT[CA[co + K_T]], v = CA[co + K_V];
    dist = 4.6 + T[0] * 0.55 + abs(v) * 0.05; ty = py + 1.2 + T[2] * 0.6 + T[3];
    if (mouseT > 1 && abs(v) > 1) {
      const want = atan2(-cos(ph), -sin(ph)) + (v < -1 ? PI : 0);
      let d = want - camYaw; d -= TAU * round(d / TAU); camYaw += d * min(1, dt * 2.5);
      camPitch += (-0.2 - camPitch) * min(1, dt * 2);
    }
  }
  const cp = cos(camPitch), fx = -sin(camYaw) * cp, fy = sin(camPitch), fz = -cos(camYaw) * cp;
  const hit = rayBuildings(tx, ty, tz, -fx, -fy, -fz, dist + 0.4);
  dist = max(0.6, min(dist, hit - 0.35));
  let ex = tx - fx * dist, ey = ty - fy * dist, ez = tz - fz * dist;
  if (ey < 0.5) ey = 0.5;
  resize();
  const fov = (cfg.fov + (inCar ? min(abs(CA[co + K_V]) * 0.22, 14) : 0)) * PI / 180, asp = cw / chh, tyf = tan(fov / 2);
  perspRZ(PM, fov, asp, 0.08);
  viewYPR(VM, CB9, ex, ey, ez, camYaw, camPitch, 0);
  mul4(UB, PM, VM);
  UB[32] = ex; UB[33] = ey; UB[34] = ez; UB[35] = time;
  UB[64] = cw; UB[65] = chh; UB[67] = asp;
  for (let i = 0; i < 3; i++) { UB[68 + i] = CB9[i] * tyf * asp; UB[72 + i] = CB9[3 + i] * tyf; UB[76 + i] = CB9[6 + i]; }
  // headlights of the player's car after dusk
  UB[83] = inCar && night > 0.1 ? night : 0;
  if (inCar) {
    const c = cos(ph), s = sin(ph), L = CT[CA[co + K_T]][0];
    UB[80] = px + c * (L / 2 + 0.2); UB[81] = py + 0.75; UB[82] = pz + s * (L / 2 + 0.2);
    const l = hypot(c, 0.12, s); UB[84] = c / l; UB[85] = -0.12 / l; UB[86] = s / l;
  }
  placeShadow(px, pz);

  // ---- moving things: player, traffic, people, blob shadows
  nDC = 0; nDO = 0; nDD = 0;
  if (!inCar) {
    const hs = hypot(pv[0], pv[2]);
    human(px, py, pz, pl.yaw, pl.phase, hs, !pl.ground, pl.look, 0, 1);
    obox(DD, nDD++, px, py + 0.02, pz, 0, 0.9, 0.04, 0.9, 0, 0, 0, 0, 9);
    if (pl.ground && hs > 1 && floor(pl.phase / PI) !== floor(stepPh / PI)) sfx('step');
    stepPh = pl.phase;
  }
  if (inCar) { // draw the player's car at its interpolated pose
    const sx = CA[co], sz = CA[co + 1], sy = CA[co + K_Y], syaw = CA[co + K_YAW];
    CA[co] = px; CA[co + 1] = pz; CA[co + K_Y] = py; CA[co + K_YAW] = ph;
    drawCars(ex, ez, CB9[6], CB9[8], night);
    CA[co] = sx; CA[co + 1] = sz; CA[co + K_Y] = sy; CA[co + K_YAW] = syaw;
  } else drawCars(ex, ez, CB9[6], CB9[8], night);
  drawPeds(ex, ey, ez, CB9[6], CB9[8]);
  renderFrame(px, pz);

  // ---- sound and HUD
  if (msgT > 0 && (msgT -= dt) <= 0) hMsg.style.opacity = 0;
  adapt(ms, dt);
  if (locked) {
    if ((ambT -= dt) <= 0) { ambT = 1.5 + rnd() * 4; sfx(night > 0.5 ? 'cricket' : 'bird'); }
    honkT -= dt;
    for (let k = 0; k < NCAR && honkT <= 0; k++) if (CA[k * 32 + K_BLK] > 2.5 && hypot(CA[k * 32] - px, CA[k * 32 + 1] - pz) < 40) { sfx('honk', k % 3); honkT = 2 + rnd() * 3; }
  }
  if ((hudT -= dt) <= 0) {
    hudT = 0.1;
    hClock.textContent = clock();
    audioEngine(inCar && locked, inCar ? CA[co + K_V] : 0, inp.f > 0 ? 1 : 0);
    if (inCar) { hSpd.textContent = round(abs(CA[co + K_V]) * 3.6) + ' km/h'; hHint.textContent = 'F  get out   ·   H  horn   ·   Space  handbrake'; }
    else { hSpd.textContent = ''; nearOK = nearestCar() >= 0; hHint.textContent = !TOUCH && (nearOK || nearPK >= 0) ? 'F  get in' : ''; }
    if (inCar && TOUCH) hHint.textContent = '';
    touchShow();
    if (showStats) hSt.textContent = `${fpsShow.toFixed(0)} fps  ${cw}×${chh} (${(scale * 100).toFixed(0)}%)  ${drawCalls} draws  ${nDC} capsules  ${nDO} car boxes  LV ${'HML'[LV]}`;
  }
}
body.className = 'm';
$('s').textContent = '';
requestAnimationFrame(frame);

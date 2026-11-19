// ============================================================================
// the singer: a red-haired girl in a dark coat, green scarf and white headphones who follows the player and sings
// ============================================================================
// She doesn't path-find: she replays the player's own trail (sampled at 60 Hz into a ring buffer) about 0.75 s
// behind, so she takes the same jumps, wall-runs and slides. When the player stops she walks round to stand in
// front of them and turns to sing. Built from capsules like the player's body; nothing is allocated per frame.
const TRN = 240, TR = new Float32Array(TRN * 4); // x, y, z, state (0 ground, 1 air, 2 slide, 3 wall)
const sg = { head: 0, cur: 0.5, x: 0.5, y: 0.5, z: 0.5, vx: 0.5, vz: 0.5, yaw: 0.5, phase: 0.5, idle: 0.5, st: 0, blend: 0.5, on: 1, ok: 0 };
for (const k in sg) sg[k] = 0;
sg.on = 1;
const SPOTS = [0.9, 2.4, -0.9, 2.4, 0.6, 1.6, 2, 0.8, -2, 0.8, 1.5, -1.6, -1.5, -1.6];
const SGF = new Float64Array(4), STG = new Float64Array(2); // trail sample: x y z state; idle spot x z
const C_HAIR = [0.34, 0.075, 0.025], C_COAT = [0.09, 0.075, 0.065], C_SCARF = [0.3, 0.42, 0.08], C_PHONES = [0.88, 0.87, 0.84];
const C_TIGHTS = [0.03, 0.03, 0.035], C_BOOT = [0.1, 0.06, 0.04], C_FACE = [0.64, 0.44, 0.35], C_NOTE = [3.6, 0.6, 1.9];

// called every second physics step (60 Hz)
function trailPush(x, y, z, st) {
  const o = (sg.head % TRN) * 4;
  // a teleport (respawn, route start): restart the trail there, she appears just behind
  const p = ((sg.head + TRN - 1) % TRN) * 4;
  if (sg.head && hypot(x - TR[p], z - TR[p + 2]) > 15) { for (let i = 0; i < TRN; i++) { TR[i * 4] = x; TR[i * 4 + 1] = y; TR[i * 4 + 2] = z; TR[i * 4 + 3] = 0; } sg.cur = sg.head; }
  if (!sg.head) for (let i = 0; i < TRN; i++) { TR[i * 4] = x; TR[i * 4 + 1] = y; TR[i * 4 + 2] = z; }
  TR[o] = x; TR[o + 1] = y; TR[o + 2] = z; TR[o + 3] = st;
  sg.head++;
}
function trailAt(c) {
  const i = floor(c), f = c - i, a = (mod(i, TRN)) * 4, b = (mod(i + 1, TRN)) * 4;
  SGF[0] = mix(TR[a], TR[b], f); SGF[1] = mix(TR[a + 1], TR[b + 1], f); SGF[2] = mix(TR[a + 2], TR[b + 2], f); SGF[3] = TR[a + 3];
}

function updateSinger(dt, px, py, pz, yaw, hs) {
  if (!sg.head) return;
  // ---- advance along the trail: ~45 samples (0.75 s) behind, faster when far behind, never within 2 m
  const lag = sg.head - 1 - sg.cur;
  if (lag > TRN - 8) sg.cur = sg.head - 1 - (TRN - 8);
  const rate = clamp(1 + (lag - 45) / 50, 0.6, 2.5);
  let c = min(sg.cur + dt * 60 * rate, sg.head - 1);
  trailAt(c);
  if (hypot(SGF[0] - px, SGF[2] - pz) < 2 && abs(SGF[1] - py) < 2) { c = sg.cur; trailAt(c); }
  sg.cur = c;
  // ---- stopped: walk round to stand in front of the player (if there is roof there) and face them
  sg.idle = hs < 0.6 && pl.ground ? sg.idle + dt : 0;
  const fx = -sin(yaw), fz = -cos(yaw), rx = cos(yaw), rz = -sin(yaw);
  if (sg.idle > 0.6 && sg.blend < 1) {
    if (!sg.ok) {
      // the first of these spots (right, forward) that has roof under it at the player's height
      sg.ok = -1;
      for (let i = 0; i < SPOTS.length && sg.ok < 0; i += 2) {
        const tx = px + fx * SPOTS[i + 1] + rx * SPOTS[i], tz = pz + fz * SPOTS[i + 1] + rz * SPOTS[i];
        const t = raycast(tx, py + 1.5, tz, 0, -1, 0, 3);
        if (t > 1.2 && t < 1.8) { sg.ok = 1; STG[0] = tx; STG[1] = tz; }
      }
    }
    if (sg.ok > 0) sg.blend = min(1, sg.blend + dt * 1.2);
  } else if (sg.idle === 0) { sg.blend = max(0, sg.blend - dt * 2.5); if (sg.blend === 0) sg.ok = 0; }
  const b = sg.blend * sg.blend * (3 - 2 * sg.blend);
  const nx = mix(SGF[0], STG[0], b), ny = SGF[1], nz = mix(SGF[2], STG[1], b);
  // ---- velocity, facing, gait
  const ivx = (nx - sg.x) / max(dt, 1e-3), ivz = (nz - sg.z) / max(dt, 1e-3);
  const jump = hypot(nx - sg.x, nz - sg.z) > 8;
  sg.vx += ((jump ? 0 : ivx) - sg.vx) * kexp(dt, 10); sg.vz += ((jump ? 0 : ivz) - sg.vz) * kexp(dt, 10);
  sg.x = nx; sg.y = jump ? ny : sg.y + (ny - sg.y) * kexp(dt, 25); sg.z = nz; sg.st = SGF[3];
  const sp = hypot(sg.vx, sg.vz);
  let ty = sp > 0.8 ? atan2(-sg.vx, -sg.vz) : atan2(-(px - sg.x), -(pz - sg.z)); // face where she goes, or the player
  let d = ty - sg.yaw; d -= TAU * round(d / TAU);
  sg.yaw += d * kexp(dt, sp > 0.8 ? 10 : 4);
  if (sp > 0.3) sg.phase += sp * dt * 1.1;
}

// body space of the singer: x right, y up, z forward
const sbx = (x, z) => sg.x + cos(sg.yaw) * x - sin(sg.yaw) * z, sbz = (x, z) => sg.z - sin(sg.yaw) * x - cos(sg.yaw) * z;
const SL = new Float64Array(12); // smoothed foot (2x3) and hand (2x3) targets
function buildSinger(dt, ex, ey, ez, B, pix, time, singing) {
  if (!sg.head || !sg.on) return;
  const dx = sg.x - ex, dy = sg.y + 1 - ey, dz = sg.z - ez, dist = hypot(dx, dy, dz);
  if (dist > 90 || (dx * B[6] + dy * B[7] + dz * B[8]) < -2) return; // far, or behind the camera
  const sp = hypot(sg.vx, sg.vz), run = min(sp / 8, 1), air = sg.st === 1, ph = sg.phase, Y = sg.y;
  const lean = run * 0.12; // leans into the run
  // ---- targets
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1, a = ph + (s > 0 ? PI : 0);
    let fx = s * 0.1, fy = 0, fz = 0;
    if (air) { fy = 0.3; fz = s * 0.15; }
    else if (sg.st === 2) { fy = s > 0 ? 0.06 : 0.02; fz = s > 0 ? 0.6 : 0.05; }
    else if (sp > 0.3) { const st = min(0.12 + sp * 0.04, 0.5); fz = sin(a) * st; fy = max(0, cos(a)) * min(0.06 + sp * 0.025, 0.3); }
    let hx = s * 0.25, hy = 0.85, hz = 0.05;
    if (sp > 0.3 && !air) { hz = -sin(a) * 0.25 * run; hy = 0.95 + abs(sin(a)) * 0.1 * run; hx = s * 0.22; }
    else if (air) { hx = s * 0.38; hy = 1.35; hz = 0.1; }
    else if (singing) {
      // singing: one hand cupped at the headphones, the other out, swaying with the beat
      if (s > 0) { hx = 0.15; hy = 1.47; hz = 0.03; } else { hx = -0.35 - 0.05 * sin(time * 2.2); hy = 1.05 + 0.12 * sin(time * 2.2); hz = 0.25; }
    }
    const o = k * 3, q = 6 + k * 3, r = kexp(dt, 16);
    SL[o] += (fx - SL[o]) * r; SL[o + 1] += (fy - SL[o + 1]) * r; SL[o + 2] += (fz - SL[o + 2]) * r;
    SL[q] += (hx - SL[q]) * r; SL[q + 1] += (hy - SL[q + 1]) * r; SL[q + 2] += (hz - SL[q + 2]) * r;
  }
  const hipY = sg.st === 2 ? 0.5 : air ? 0.78 : 0.86 - run * 0.05, sway = singing && sp < 0.3 ? sin(time * 2.2) * 0.03 : 0;
  // ---- legs
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1, o = k * 3;
    const hx = sbx(s * 0.09 + sway, 0), hz = sbz(s * 0.09 + sway, 0);
    ik(hx, Y + hipY, hz, sbx(SL[o], SL[o + 2]), Y + SL[o + 1] + 0.05, sbz(SL[o], SL[o + 2]), 0.42, 0.42, -sin(sg.yaw), 0, -cos(sg.yaw));
    cap(hx, Y + hipY, hz, J[0], J[1], J[2], 0.065, C_TIGHTS, 0);
    cap(J[0], J[1], J[2], J[3], J[4], J[5], 0.055, C_TIGHTS, 0);
    cap(J[3], J[4] + 0.04, J[5], J[3] - sin(sg.yaw) * 0.15, J[4] - 0.01, J[5] - cos(sg.yaw) * 0.15, 0.055, C_BOOT, 0);
  }
  // ---- coat, scarf, head, hair, headphones
  const cy = Y + hipY + 0.4, cz = lean; // chest
  const chx = sbx(sway, cz), chz = sbz(sway, cz);
  cap(sbx(0, 0), Y + hipY - 0.02, sbz(0, 0), chx, cy - 0.05, chz, 0.125, C_COAT, 0); // torso
  cap(sbx(0, 0), Y + hipY - 0.04, sbz(0, 0), sbx(0, -0.02 - run * 0.1), Y + hipY - 0.3, sbz(0, -0.02 - run * 0.1), 0.15, C_COAT, 0); // coat skirt
  cap(sbx(-0.15 + sway, cz - 0.02), cy - 0.02, sbz(-0.15 + sway, cz - 0.02), sbx(0.15 + sway, cz - 0.02), cy - 0.02, sbz(0.15 + sway, cz - 0.02), 0.075, C_COAT, 0); // shoulders
  const hdx = sbx(sway * 1.3, cz + 0.02), hdy = cy + 0.24, hdz = sbz(sway * 1.3, cz + 0.02);
  cap(chx, cy, chz, hdx, hdy - 0.1, hdz, 0.045, C_FACE, 0); // neck
  cap(sbx(-0.07 + sway, cz + 0.02), cy + 0.04, sbz(-0.07 + sway, cz + 0.02), sbx(0.07 + sway, cz + 0.02), cy + 0.04, sbz(0.07 + sway, cz + 0.02), 0.065, C_SCARF, 0);
  cap(sbx(0.06 + sway, cz + 0.1), cy + 0.02, sbz(0.06 + sway, cz + 0.1), sbx(0.08, cz + 0.13 + run * 0.25), cy - 0.33 + run * 0.18, sbz(0.08, cz + 0.13 + run * 0.25), 0.04, C_SCARF, 0);
  cap(hdx, hdy - 0.02, hdz, hdx, hdy + 0.02, hdz, 0.098, C_FACE, 3); // head, with the face from the photo
  CAP[(nCap - 1) * 12 + 7] = sg.yaw;
  // hair: a cap set back so the face shows, and shoulder-length locks framing the face that swing as she moves
  const hb = sbx(sway * 1.3, cz - 0.015), hbz = sbz(sway * 1.3, cz - 0.015);
  cap(hb, hdy + 0.03, hbz, hb, hdy + 0.04, hbz, 0.104, C_HAIR, 0);
  const swx = -sg.vx * 0.012 + sin(time * 3) * 0.01, swz = -sg.vz * 0.012;
  for (let k = -1; k <= 1; k++) {
    const ox = k * 0.08, oz = k ? 0.02 : -0.06;
    cap(sbx(ox + sway * 1.3, cz + oz), hdy + 0.03, sbz(ox + sway * 1.3, cz + oz), sbx(ox * 1.25, cz + oz - 0.03) + swx, hdy - 0.2, sbz(ox * 1.25, cz + oz - 0.03) + swz, k ? 0.042 : 0.07, C_HAIR, 0);
  }
  for (let k = -1; k <= 1; k += 2) { // ear cups and band
    const ux = sbx(k * 0.1 + sway * 1.3, cz), uz = sbz(k * 0.1 + sway * 1.3, cz);
    cap(ux, hdy, uz, sbx(k * 0.125 + sway * 1.3, cz), hdy, sbz(k * 0.125 + sway * 1.3, cz), 0.05, C_PHONES, 0);
    cap(ux, hdy + 0.04, uz, sbx(k * 0.04 + sway * 1.3, cz), hdy + 0.135, sbz(k * 0.04 + sway * 1.3, cz), 0.018, C_PHONES, 0);
  }
  // ---- arms
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1, q = 6 + k * 3;
    const sx = sbx(s * 0.19 + sway, cz - 0.02), sz = sbz(s * 0.19 + sway, cz - 0.02);
    ik(sx, cy - 0.03, sz, sbx(SL[q], SL[q + 2]), Y + SL[q + 1], sbz(SL[q], SL[q + 2]), 0.28, 0.27,
      sbx(s * 0.5, -0.5) - sg.x, -0.6, sbz(s * 0.5, -0.5) - sg.z);
    cap(sx, cy - 0.03, sz, J[0], J[1], J[2], 0.055, C_COAT, 0);
    cap(J[0], J[1], J[2], J[3], J[4], J[5], 0.048, C_COAT, 0);
    cap(J[3], J[4], J[5], J[3], J[4] - 0.03, J[5], 0.04, C_FACE, 0);
  }
  // ---- music notes rising from her while she sings
  if (singing) {
    for (let j = 0; j < 3; j++) {
      const p = (time * 0.45 + j / 3) % 1, k = sin(p * PI);
      const nx = sbx(sin(p * 5 + j * 2) * 0.35 + (j - 1) * 0.15, 0.1), ny = hdy + 0.25 + p * 1.1, nz = sbz(sin(p * 5 + j * 2) * 0.35 + (j - 1) * 0.15, 0.1);
      const r = max(0.045, hypot(nx - ex, ny - ey, nz - ez) * pix * 1.2);
      glow(nx, ny, nz, nx + 0.03, ny - 0.01, nz, r, k * 0.7);
      glow(nx + 0.045, ny, nz, nx + 0.045, ny + 0.16, nz, max(0.012, r * 0.3), k * 0.7);
      const o = (nCap - 1) * 12; CAP[o + 8] = C_NOTE[0] * k; CAP[o + 9] = C_NOTE[1] * k; CAP[o + 10] = C_NOTE[2] * k;
      CAP[o - 4] = C_NOTE[0] * k; CAP[o - 3] = C_NOTE[1] * k; CAP[o - 2] = C_NOTE[2] * k;
    }
  }
}

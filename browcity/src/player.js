// ============================================================================
// the player: third-person walking and arcade driving, entering and leaving cars
// ============================================================================
const pp = new Float64Array(3), pv = new Float64Array(3), ppp = new Float64Array(3); // position, velocity, previous
const pl = { yaw: 0.5, ground: 0, phase: 0.5, car: -1, enterT: 0.5, steer: 0.5, crash: 0.5, look: 3, horn: 0 };
pl.yaw = 0; pl.phase = 0; pl.enterT = 0; pl.steer = 0; pl.crash = 0; pl.look = 1897; pl.car = -1;
const PR = 0.32, PDT = 1 / 120;

// push a circle (x, z, r) out of solid boxes / circles / cars; writes PO = x z nx nz hit
const PO = new Float64Array(5);
function pushOut(x, z, r, y, step, skipCar) {
  let hit = 0, nx = 0, nz = 0;
  for (let k = 0; k < NC; k++) {
    const o = CAND[k];
    if (WB[o + 1] + WB[o + 5] <= y + step || WB[o + 1] >= y + 1.7) continue;
    const bx0 = WB[o], bz0 = WB[o + 2], bx1 = bx0 + WB[o + 4], bz1 = bz0 + WB[o + 6];
    const qx = clamp(x, bx0, bx1), qz = clamp(z, bz0, bz1), dx = x - qx, dz = z - qz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-10) { const d = sqrt(d2), p = r - d; x += dx / d * p; z += dz / d * p; nx += dx / d; nz += dz / d; }
    else { // centre inside: out along the shortest axis
      const l = x - bx0, rr2 = bx1 - x, b = z - bz0, t = bz1 - z, m = min(l, rr2, b, t);
      if (m === l) { x = bx0 - r; nx -= 1; } else if (m === rr2) { x = bx1 + r; nx += 1; } else if (m === b) { z = bz0 - r; nz -= 1; } else { z = bz1 + r; nz += 1; }
    }
    hit = 1;
  }
  for (let k = 0; k < NCI; k++) {
    const dx = x - CIRC[k * 3], dz = z - CIRC[k * 3 + 1], rr2 = r + CIRC[k * 3 + 2], d = hypot(dx, dz);
    if (d < rr2 && d > 1e-6) { x += dx / d * (rr2 - d); z += dz / d * (rr2 - d); nx += dx / d; nz += dz / d; hit = 1; }
  }
  // cars: each car is two circles along its length
  for (let j = 0; j < NCAR; j++) {
    const q = j * 32; if (!CA[q + K_M] || j === skipCar) continue;
    const T = CT[CA[q + K_T]], c = cos(CA[q + K_YAW]), s = sin(CA[q + K_YAW]), h = T[0] / 2 - T[1] / 2;
    for (let e = -1; e <= 1; e += 2) {
      const cx = CA[q] + c * h * e, cz = CA[q + 1] + s * h * e, dx = x - cx, dz = z - cz, rr2 = r + T[1] / 2, d = hypot(dx, dz);
      if (d < rr2 && d > 1e-6) { x += dx / d * (rr2 - d); z += dz / d * (rr2 - d); nx += dx / d; nz += dz / d; hit = 2; }
    }
  }
  PO[0] = x; PO[1] = z; const nl = hypot(nx, nz) || 1; PO[2] = nx / nl; PO[3] = nz / nl; PO[4] = hit;
}

// ---------------------------------------------------------------- walking
// inp: f/s (move), run (sprint), jq (jump), camera yaw cy (view forward = (-sin, -cos))
function walkStep(inp, cy) {
  ppp[0] = pp[0]; ppp[1] = pp[1]; ppp[2] = pp[2];
  gather(pp[0] - 3, pp[2] - 3, pp[0] + 3, pp[2] + 3);
  let wx = -sin(cy) * inp.f + cos(cy) * inp.s, wz = -cos(cy) * inp.f - sin(cy) * inp.s;
  const wl = hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const sp = inp.run ? 8 : 5.2, acc = pl.ground ? 30 : 5;
  const tx = wx * sp, tz = wz * sp;
  pv[0] += clamp(tx - pv[0], -acc * PDT, acc * PDT); pv[2] += clamp(tz - pv[2], -acc * PDT, acc * PDT);
  if (wl > 0) { let d = atan2(wz, wx) - pl.yaw; d -= TAU * round(d / TAU); pl.yaw += d * min(1, PDT * 12); }
  if (inp.jq && pl.ground) { pv[1] = 5; pl.ground = 0; }
  inp.jq = 0;
  pv[1] -= 18 * PDT;
  pp[0] += pv[0] * PDT; pp[2] += pv[2] * PDT; pp[1] += pv[1] * PDT;
  pushOut(pp[0], pp[2], PR, pp[1], 0.45, -1);
  pp[0] = PO[0]; pp[2] = PO[1];
  const g = groundAt(pp[0], pp[2], pp[1], 0.5);
  if (pp[1] <= g + 0.02 && pv[1] <= 0) { pp[1] = g; pv[1] = 0; pl.ground = 1; } else if (pp[1] > g + 0.05) pl.ground = 0;
  if (pp[1] < g - 1) pp[1] = g; // never below the street
  pl.phase += hypot(pv[0], pv[2]) * PDT * 2.1;
  // bump pedestrians aside
  for (let k = 0; k < NPED; k++) {
    const o = k * 16, dx = PD[o + 7] - pp[0], dz = PD[o + 8] - pp[2], d = hypot(dx, dz);
    if (d < 0.6 && d > 1e-4) { pp[0] -= dx / d * (0.6 - d) * 0.5; pp[2] -= dz / d * (0.6 - d) * 0.5; }
  }
}

// ---------------------------------------------------------------- driving
// inp: f (throttle / reverse), s (steer), hb (handbrake)
function driveStep(inp) {
  const k = pl.car, o = k * 32, T = CT[CA[o + K_T]], L = T[0], W = T[1], maxV = T[8], acc = T[9];
  let h = CA[o + K_YAW], c = cos(h), s = sin(h);
  let vf = CA[o + K_V], vr = CA[o + K_VR];
  if (inp.f > 0) vf += acc * (1 - clamp(vf / maxV, 0, 1) ** 2) * PDT;
  else if (inp.f < 0) vf -= (vf > 0.5 ? 11 : 5) * PDT;
  else vf -= sign(vf) * min(abs(vf), (0.5 + abs(vf) * 0.03) * PDT * 3);
  if (vf < -9) vf = -9;
  if (inp.hb) vf -= sign(vf) * min(abs(vf), 7 * PDT);
  const st = inp.s * (0.58 - 0.38 * min(abs(vf) / 35, 1)); // yaw grows toward the car's right (right = (-sin, cos))
  pl.steer += (st - pl.steer) * min(1, PDT * 7);
  const wb = L * 0.6;
  let yr = vf / wb * tan(pl.steer) * (inp.hb ? 1.35 : 1);
  h += yr * PDT;
  vr *= exp(-PDT * (inp.hb ? 1.1 : 9));
  vr += -vf * yr * PDT * (inp.hb ? 0.5 : 0.08); // the tail steps out under the handbrake
  c = cos(h); s = sin(h);
  let vx = c * vf - s * vr, vz = s * vf + c * vr;
  let x = CA[o] + vx * PDT, z = CA[o + 1] + vz * PDT;
  // collisions: three circles along the car against buildings, poles, trees, parked and moving cars
  gather(x - L, z - L, x + L, z + L);
  const hl = L / 2 - W / 2;
  let crash = 0;
  for (let e = -1; e <= 1; e++) {
    const cx = x + c * hl * e, cz = z + s * hl * e;
    pushOut(cx, cz, W / 2, 0.15, 0.55, k);
    if (PO[4]) {
      x += PO[0] - cx; z += PO[1] - cz;
      const vn = vx * PO[2] + vz * PO[3];
      if (vn < 0) { vx -= PO[2] * vn * 1.3; vz -= PO[3] * vn * 1.3; crash = max(crash, -vn); }
    }
  }
  // parked cars along the curb
  for (let s2 = 0; s2 < SLOTS; s2++) {
    if (abs((sX0[s2] + sX1[s2]) / 2 - x) > BS || abs((sZ0[s2] + sZ1[s2]) / 2 - z) > BS) continue;
    for (let q = 0; q < sP[s2]; q++) {
      const pq = (s2 * MAXP + q) * 8; if (!PK[pq + 5]) continue;
      const PT = CT[PK[pq + 3]], pc = cos(PK[pq + 2]), ps = sin(PK[pq + 2]), ph = PT[0] / 2 - PT[1] / 2;
      for (let e = -1; e <= 1; e += 2) for (let f = -1; f <= 1; f++) {
        const ax = PK[pq] + pc * ph * e, az = PK[pq + 1] + ps * ph * e, bx = x + c * hl * f, bz = z + s * hl * f;
        const dx = bx - ax, dz = bz - az, d = hypot(dx, dz), rr2 = (PT[1] + W) / 2;
        if (d < rr2 && d > 1e-6) {
          const nx = dx / d, nz = dz / d; x += nx * (rr2 - d); z += nz * (rr2 - d);
          const vn = vx * nx + vz * nz; if (vn < 0) { vx -= nx * vn * 1.3; vz -= nz * vn * 1.3; crash = max(crash, -vn); }
        }
      }
    }
  }
  if (crash > 2) pl.crash = crash;
  vf = vx * c + vz * s; vr = -vx * s + vz * c;
  CA[o] = x; CA[o + 1] = z; CA[o + K_YAW] = h; CA[o + K_V] = vf; CA[o + K_VR] = vr;
  CA[o + K_Y] += (groundAt(x, z, 0.2, 0.3) * 0.6 - CA[o + K_Y]) * min(1, PDT * 10);
  CA[o + K_BRK] = inp.f < 0 && vf > 0.5 ? 1 : 0;
  // pedestrians jump out of the way
  pp[0] = x; pp[2] = z; pp[1] = CA[o + K_Y];
}
// is a car about to hit (x, z)? sets the dodge offset
function carHit(x, z) {
  for (let k = 0; k < NCAR; k++) {
    const o = k * 32; if (CA[o + K_M] !== 3 && CA[o + K_M] !== 2 && CA[o + K_M] !== 1) continue;
    const v = CA[o + K_V]; if (abs(v) < 4) continue;
    const c = cos(CA[o + K_YAW]), s = sin(CA[o + K_YAW]), rx = x - CA[o], rz = z - CA[o + 1];
    const along = (rx * c + rz * s) * sign(v), lat = -rx * s + rz * c;
    if (along > 0 && along < 3 + abs(v) * 0.5 && abs(lat) < CT[CA[o + K_T]][1] / 2 + 0.5) {
      const sd = lat >= 0 ? 1 : -1; DGX = -s * sd * 2; DGZ = c * sd * 2; return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- getting in and out
// the nearest enterable car within reach: returns car index, or -(parked index + 2), or -1
let nearPK = -1;
function nearestCar() {
  let best = 3.4, res = -1; nearPK = -1;
  for (let k = 0; k < NCAR; k++) {
    const o = k * 32, m = CA[o + K_M]; if (!m || m === 3) continue;
    if ((m === 1 || m === 2) && CA[o + K_V] > 3) continue;
    const d = hypot(CA[o] - pp[0], CA[o + 1] - pp[2]) - CT[CA[o + K_T]][0] * 0.35;
    if (d < best) { best = d; res = k; }
  }
  for (let s = 0; s < SLOTS; s++) {
    if (abs((sX0[s] + sX1[s]) / 2 - pp[0]) > BS || abs((sZ0[s] + sZ1[s]) / 2 - pp[2]) > BS) continue;
    for (let q = 0; q < sP[s]; q++) {
      const o = (s * MAXP + q) * 8; if (!PK[o + 5]) continue;
      const d = hypot(PK[o] - pp[0], PK[o + 1] - pp[2]) - CT[PK[o + 3]][0] * 0.35;
      if (d < best) { best = d; res = -1; nearPK = s * MAXP + q; }
    }
  }
  return res;
}
function enterCar() {
  const k0 = nearestCar();
  let k = k0;
  if (k0 < 0 && nearPK >= 0) {
    // take a parked car: hide it in its block and drive a moving copy of it
    k = -1; let far = -1, fd = 0;
    for (let j = 0; j < NCAR; j++) { const o = j * 32; if (!CA[o + K_M]) { k = j; break; } const d = hypot(CA[o] - pp[0], CA[o + 1] - pp[2]); if (CA[o + K_M] !== 3 && d > fd) { fd = d; far = j; } }
    if (k < 0) k = far;
    const q = nearPK, s = floor(q / MAXP), o = q * 8, c = k * 32;
    CA[c] = PK[o]; CA[c + 1] = PK[o + 1]; CA[c + K_Y] = 0; CA[c + K_YAW] = PK[o + 2]; CA[c + K_T] = PK[o + 3]; CA[c + K_P] = PK[o + 4];
    PK[o + 5] = 0;
    for (let b = 0; b < 3; b++) PB[(q * 3 + b) * OF + 4] = 0;
    for (let w = 0; w < 4; w++) CB[(s * MAXC + PK[o + 6] + w) * CF + 3] = 0;
    sDirty[s] = 1;
  } else if (k0 < 0) return false;
  else if (CA[k * 32 + K_M] === 1 || CA[k * 32 + K_M] === 2) {
    // a car in traffic: its driver gets out and walks off
    const o = k * 32, c = cos(CA[o + K_YAW]), s = sin(CA[o + K_YAW]), W = CT[CA[o + K_T]][1];
    let far = 0, fd = -1;
    for (let j = 0; j < NPED; j++) { const d = hypot(PD[j * 16 + 7] - pp[0], PD[j * 16 + 8] - pp[2]); if (d > fd) { fd = d; far = j; } }
    pedPlace(far, CA[o] + s * (W / 2 + 0.8), CA[o + 1] - c * (W / 2 + 0.8));
  }
  const o = k * 32;
  CA[o + K_M] = 3; CA[o + K_V] = 0; CA[o + K_VR] = 0; pl.car = k; pl.steer = 0; pl.enterT = 0.5;
  return true;
}
function exitCar() {
  const o = pl.car * 32;
  if (abs(CA[o + K_V]) > 6) return false;
  const c = cos(CA[o + K_YAW]), s = sin(CA[o + K_YAW]), W = CT[CA[o + K_T]][1];
  // driver's door on the left (right = (-sin, cos)); the right side if the left is blocked
  for (let side = -1; side <= 1; side += 2) {
    const dl = W / 2 + 0.7, x = CA[o] - side * s * dl, z = CA[o + 1] + side * c * dl; // side -1: left = (sin, -cos)
    gather(x - 2, z - 2, x + 2, z + 2);
    pushOut(x, z, PR, 0.15, 0.45, pl.car);
    if (hypot(PO[0] - x, PO[1] - z) < 0.3 || side > 0) {
      pp[0] = PO[0]; pp[2] = PO[1]; pp[1] = groundAt(pp[0], pp[2], 1, 0.5); pv[0] = pv[1] = pv[2] = 0;
      ppp[0] = pp[0]; ppp[1] = pp[1]; ppp[2] = pp[2];
      pl.yaw = CA[o + K_YAW]; break;
    }
  }
  CA[o + K_M] = 4; CA[o + K_V] = 0; pl.car = -1; pl.enterT = 0.5;
  return true;
}

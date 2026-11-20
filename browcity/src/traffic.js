// ============================================================================
// traffic: cars that drive the street grid on the right, turn at intersections, obey signals and stop signs and
// keep their distance; plus the car the player drives. Structure-of-arrays, fixed pool, no allocation.
// ============================================================================
// modes: 0 free slot, 1 lane, 2 turning, 3 player-driven, 4 left by the player (stands still)
const NCAR = [46, 34, 24][LV];
const CA = new Float64Array(NCAR * 32);
// fields
const K_X = 0, K_Z = 1, K_Y = 2, K_YAW = 3, K_V = 4, K_T = 5, K_P = 6, K_M = 7, K_AX = 8, K_LI = 9, K_DIR = 10, K_LANE = 11,
  K_U = 12, K_NL = 13, K_TURN = 14, K_STOP = 15, K_WAIT = 16, K_BT = 17, K_BL = 18, K_B0X = 19, K_B0Z = 20, K_B1X = 21,
  K_B1Z = 22, K_B2X = 23, K_B2Z = 24, K_NAX = 25, K_NLI = 26, K_NDIR = 27, K_BRK = 28, K_BLK = 29, K_OFF = 30, K_VR = 31;

function laneXZ(ax, li, dir, off, u) { // into LX: x, z
  if (ax === 0) { LX[0] = lineP(li, 0) - dir * off; LX[1] = u; } else { LX[0] = u; LX[1] = lineP(li, 1) + dir * off; }
}
const LX = new Float64Array(2);
// next crossing line ahead of coordinate u moving dir on axis ax (crossing lines are of the other family)
function nextCross(ax, u, dir) { const c = cellOf(u, 1 - ax); return dir > 0 ? c + 1 : (u - lineP(c, 1 - ax) < 0.5 ? c - 1 : c); }
function chooseTurn(k) {
  const o = k * 32, h = rnd();
  CA[o + K_TURN] = h < 0.55 ? 0 : h < 0.8 ? 1 : 2;
  const c = lineC(CA[o + K_LI], CA[o + K_AX]);
  CA[o + K_LANE] = c === 2 ? (CA[o + K_TURN] === 1 ? 1 : CA[o + K_TURN] === 2 ? 0 : (rnd() < 0.5 ? 1 : 0)) : 0;
}
function spawnCar(k, px, pz, fx, fz, near) {
  const o = k * 32;
  for (let tries = 0; tries < 8; tries++) {
    const ax = rnd() < 0.5 ? 0 : 1, a = rnd() * TAU, d = near ? rr(20, 200) : rr(170, 300);
    const x = px + cos(a) * d, z = pz + sin(a) * d;
    if (!near && (x - px) * fx + (z - pz) * fz > 0 && d < 260) continue; // not in front of the camera
    const li = ax === 0 ? cellOf(x, 0) + (rnd() < 0.5 ? 0 : 1) : cellOf(z, 1) + (rnd() < 0.5 ? 0 : 1);
    const dir = rnd() < 0.5 ? 1 : -1, u = ax === 0 ? z : x;
    // not inside an intersection, not on another car
    const cl = cellOf(u, 1 - ax), d0 = u - lineP(cl, 1 - ax), d1 = lineP(cl + 1, 1 - ax) - u;
    if (d0 < CWS[lineC(cl, 1 - ax)] / 2 + 8 || d1 < CWS[lineC(cl + 1, 1 - ax)] / 2 + 8) continue;
    CA[o + K_AX] = ax; CA[o + K_LI] = li; CA[o + K_DIR] = dir; CA[o + K_U] = u;
    chooseTurn(k);
    const off = laneOff(lineC(li, ax), CA[o + K_LANE]);
    laneXZ(ax, li, dir, off, u);
    if (carNear(LX[0], LX[1], 9)) continue;
    CA[o + K_X] = LX[0]; CA[o + K_Z] = LX[1]; CA[o + K_Y] = 0; CA[o + K_OFF] = off;
    CA[o + K_YAW] = ax === 0 ? (dir > 0 ? PI / 2 : -PI / 2) : (dir > 0 ? 0 : PI);
    const t = pickType(rnd());
    CA[o + K_T] = t; CA[o + K_P] = floor(rnd() * NPAINT); CA[o + K_V] = SPEED[lineC(li, ax)] * 0.7;
    CA[o + K_M] = 1; CA[o + K_NL] = nextCross(ax, u, dir); CA[o + K_STOP] = 0; CA[o + K_WAIT] = 0; CA[o + K_BLK] = 0;
    return true;
  }
  CA[o + K_M] = 0;
  return false;
}
function carNear(x, z, r) {
  for (let k = 0; k < NCAR; k++) { const o = k * 32; if (CA[o + K_M] && abs(CA[o] - x) < r && abs(CA[o + 1] - z) < r && hypot(CA[o] - x, CA[o + 1] - z) < r) return true; }
  return false;
}
function initTraffic(px, pz) { for (let k = 0; k < NCAR; k++) spawnCar(k, px, pz, 0, 0, 1); }

// distance to the nearest thing ahead in the car's path (cars, people, the player)
function gapAhead(k, plx, plz, plOn) {
  const o = k * 32, x = CA[o], z = CA[o + 1], c = cos(CA[o + K_YAW]), s = sin(CA[o + K_YAW]), L = CT[CA[o + K_T]][0];
  const wide = CA[o + K_M] === 2 ? 3 : 2.1;
  let gap = 60;
  if (CA[o + K_BLK] < 0) { CA[o + K_BLK] += 1 / 60; } // nudging out of a deadlock: ignore cars briefly
  else for (let j = 0; j < NCAR; j++) {
    if (j === k) continue;
    const q = j * 32; if (!CA[q + K_M]) continue;
    const rx = CA[q] - x, rz = CA[q + 1] - z, along = rx * c + rz * s;
    if (along <= 0 || along > 50) continue;
    if (abs(-rx * s + rz * c) < wide) gap = min(gap, along - L / 2 - CT[CA[q + K_T]][0] / 2);
  }
  for (let j = 0; j < NPED; j++) {
    const q = j * 16, rx = PD[q + 7] - x, rz = PD[q + 8] - z, along = rx * c + rz * s;
    if (along <= 0 || along > 30) continue;
    if (abs(-rx * s + rz * c) < 1.9) gap = min(gap, along - L / 2 - 1.2);
  }
  if (plOn) { const rx = plx - x, rz = plz - z, along = rx * c + rz * s; if (along > 0 && along < 30 && abs(-rx * s + rz * c) < 2) gap = min(gap, along - L / 2 - 1.5); }
  return gap;
}

function updateTraffic(dt, t, px, pz, fx, fz, plx, plz, plOn) {
  for (let k = 0; k < NCAR; k++) {
    const o = k * 32, m = CA[o + K_M];
    if (m === 3) continue;
    if (!m || hypot(CA[o] - px, CA[o + 1] - pz) > (m === 4 ? 400 : R * BS + 40)) { spawnCar(k, px, pz, fx, fz, 0); continue; }
    if (m === 4) { CA[o + K_V] = 0; continue; }
    const ax = CA[o + K_AX], li = CA[o + K_LI], dir = CA[o + K_DIR], cls = lineC(li, ax);
    let vt = SPEED[cls] * (CA[o + K_T] === 6 ? 0.8 : 1);
    // ---- the intersection ahead
    const nl = CA[o + K_NL], cpos = lineP(nl, 1 - ax), ccl = lineC(nl, 1 - ax), half = CWS[ccl] / 2;
    const dI = m === 1 ? dir * (cpos - CA[o + K_U]) : -1;
    const ii = ax === 0 ? li : nl, jj = ax === 0 ? nl : li, ci = lineC(ii, 0), cj = lineC(jj, 1);
    let stopAt = 1e9;
    if (m === 1 && dI > half) {
      const sl = dI - half - 6; // stop line
      if (ixType(ci, cj) === 2) {
        const st = sigState(t, ii, jj, ax);
        if (st === 0 || (st === 1 && sl > 5)) stopAt = sl;
      } else if (mustStop(ci, cj, ax)) {
        if (!CA[o + K_STOP]) { stopAt = sl; if (sl < 1.5 && CA[o + K_V] < 0.4) { CA[o + K_STOP] = 1; CA[o + K_WAIT] = 1.2; } }
        else if (CA[o + K_WAIT] > 0) { CA[o + K_WAIT] -= dt; stopAt = sl; }
      }
      // slow down for the turn
      if (CA[o + K_TURN] && dI < 30) vt = min(vt, 5.5 + (dI - half) * 0.3);
    }
    // ---- following distance
    const gap = gapAhead(k, plx, plz, plOn);
    if (gap < 1 && CA[o + K_V] < 0.2 && stopAt > 50) { CA[o + K_BLK] += dt; if (CA[o + K_BLK] > 6) CA[o + K_BLK] = -2; }
    else if (CA[o + K_BLK] > 0) CA[o + K_BLK] = 0;
    const room = min(gap - 2, stopAt);
    vt = min(vt, sqrt(max(room, 0) * 2 * 4.5));
    const v = CA[o + K_V];
    CA[o + K_V] = v < vt ? min(vt, v + (CA[o + K_T] === 6 ? 1.2 : 2.6) * dt) : max(vt, v - 7 * dt);
    CA[o + K_BRK] = CA[o + K_V] < v - 0.01 || CA[o + K_V] < 0.1 ? 1 : 0;
    const dv = CA[o + K_V] * dt;
    if (m === 1) {
      CA[o + K_U] += dir * dv;
      // lane change on boulevards happens smoothly
      const off = laneOff(cls, CA[o + K_LANE]);
      CA[o + K_OFF] += clamp(off - CA[o + K_OFF], -1.6 * dt, 1.6 * dt);
      laneXZ(ax, li, dir, CA[o + K_OFF], CA[o + K_U]);
      CA[o] = LX[0]; CA[o + 1] = LX[1];
      const dI2 = dir * (cpos - CA[o + K_U]);
      if (CA[o + K_TURN] && dI2 <= half) {
        // start the turn: a quadratic Bezier from here into the lane of the crossing street
        const tn = CA[o + K_TURN], nax = 1 - ax, ndir = tn === 1 ? (ax === 0 ? -dir : dir) : (ax === 0 ? dir : -dir);
        const ncls = lineC(nl, nax), noff = laneOff(ncls, ncls === 2 ? (tn === 1 ? 1 : 0) : 0);
        const ue = lineP(li, ax) + ndir * (CWS[cls] / 2 + 1);
        laneXZ(nax, nl, ndir, noff, ue);
        CA[o + K_B0X] = CA[o]; CA[o + K_B0Z] = CA[o + 1]; CA[o + K_B2X] = LX[0]; CA[o + K_B2Z] = LX[1];
        CA[o + K_B1X] = ax === 0 ? CA[o] : LX[0]; CA[o + K_B1Z] = ax === 0 ? LX[1] : CA[o + 1];
        CA[o + K_BL] = (hypot(CA[o + K_B1X] - CA[o], CA[o + K_B1Z] - CA[o + 1]) + hypot(LX[0] - CA[o + K_B1X], LX[1] - CA[o + K_B1Z])) * 0.9 + 0.1;
        CA[o + K_BT] = 0; CA[o + K_NAX] = nax; CA[o + K_NLI] = nl; CA[o + K_NDIR] = ndir; CA[o + K_M] = 2; CA[o + K_OFF] = noff;
      } else if (dI2 < -half) {
        // went straight through
        CA[o + K_NL] = nl + dir; CA[o + K_STOP] = 0; chooseTurn(k);
      }
      CA[o + K_YAW] = ax === 0 ? (dir > 0 ? PI / 2 : -PI / 2) : (dir > 0 ? 0 : PI);
    } else {
      CA[o + K_BT] += dv / CA[o + K_BL];
      const b = min(CA[o + K_BT], 1), a = 1 - b;
      const x = a * a * CA[o + K_B0X] + 2 * a * b * CA[o + K_B1X] + b * b * CA[o + K_B2X];
      const z = a * a * CA[o + K_B0Z] + 2 * a * b * CA[o + K_B1Z] + b * b * CA[o + K_B2Z];
      const tx = a * (CA[o + K_B1X] - CA[o + K_B0X]) + b * (CA[o + K_B2X] - CA[o + K_B1X]);
      const tz = a * (CA[o + K_B1Z] - CA[o + K_B0Z]) + b * (CA[o + K_B2Z] - CA[o + K_B1Z]);
      CA[o] = x; CA[o + 1] = z; if (abs(tx) + abs(tz) > 1e-6) CA[o + K_YAW] = atan2(tz, tx);
      if (b >= 1) {
        const nax = CA[o + K_NAX], ndir = CA[o + K_NDIR];
        CA[o + K_AX] = nax; CA[o + K_LI] = CA[o + K_NLI]; CA[o + K_DIR] = ndir; CA[o + K_M] = 1;
        CA[o + K_U] = nax === 0 ? z : x; CA[o + K_NL] = nextCross(nax, CA[o + K_U], ndir); CA[o + K_STOP] = 0;
        chooseTurn(k);
      }
    }
  }
}
function drawCars(ex, ez, fx, fz, night) {
  for (let k = 0; k < NCAR; k++) {
    const o = k * 32; if (!CA[o + K_M]) continue;
    const x = CA[o], z = CA[o + 1], d = hypot(x - ex, z - ez), T = CT[CA[o + K_T]];
    if (d > R * BS + 60 || ((x - ex) * fx + (z - ez) * fz < -T[0] && d > 12)) continue;
    if (nDO + 3 > MAXDO || nDC + 8 > MAXDC) break;
    const lights = CA[o + K_M] === 4 ? 0 : CA[o + K_BRK] ? 2 : 1;
    carModel(CA[o + K_T], CA[o + K_P], x, CA[o + K_Y], z, CA[o + K_YAW], DO, nDO, DC, nDC, d < 160 ? lights : 0, d < 220);
    nDO += oN; nDC += cN;
    if (nDD < MAXDD) obox(DD, nDD++, x, CA[o + K_Y] + 0.03, z, CA[o + K_YAW], T[0] + 0.5, 0.05, T[1] + 0.5, 0, 0, 0, 0, 9);
  }
}

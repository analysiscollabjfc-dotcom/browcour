// ============================================================================
// player movement: fixed 120 Hz step, swept AABB collision against the city boxes
// ============================================================================
// Moves: run, bunny-hop (no friction for a moment after landing), Quake-style air strafing, slide (boost on entry,
// accelerates downhill, landing while crouched turns fall speed into forward speed), slide-hop, wall-run,
// wall-jump / wall-kick, wall-climb, vault and mantle, double jump, air dash, fast-fall and a grappling hook that
// swings and slingshots. All state lives in preallocated typed arrays / fixed-shape objects: a step allocates nothing.
const DT = 1 / 120;
const G = 18, JUMP = 7.2, RUN = 10.5, HW = 0.35, HT = 1.8, HT_C = 1.0, STEP = 0.55, REACH = 2.3, VAULT = 1.25;
const AIRCAP = 0.9, AIRACC = 7, SLIDE_DEC = 4, SLIDE_BOOST = 4.5, WALL_SPD = 13, WALL_T = 2.2;
const DASH = 7, GRANGE = 75, GPULL = 24, DRAG_V = 45, EPS = 1e-4, SKIN = 1e-3;

const pos = new Float64Array(3), vel = new Float64Array(3), ppos = new Float64Array(3);
const FW = new Float64Array(2), SC = new Float64Array(2);
// scalar state; every field starts as a non-integer double so V8 gives the object a stable double-field shape
const pl = {
  ht: HT + 0.5, ground: 0, gnx: 0.5, gny: 1.5, gnz: 0.5, slide: 0, slideCd: 0.5, coyote: 0.5, jbuf: 0.5, dbuf: 0.5, landT: 0.5,
  dash: 1, djump: 1, climb: 1, airT: 0.5, wall: 0, wnx: 0.5, wnz: 0.5, wallT: 0.5, wallCd: 0.5, lwx: 0.5, lwz: 0.5,
  climbT: 0.5, cix: 0.5, ciz: 0.5, grap: 0, gx: 0.5, gy: 0.5, gz: 0.5, glen: 0.5, gcd: 0.5, dashT: 0.5,
  mantle: 0, mt: 0.5, mdur: 0.5, m0x: 0.5, m0y: 0.5, m0z: 0.5, m1x: 0.5, m1y: 0.5, m1z: 0.5, mvx: 0.5, mvz: 0.5,
};
for (const k in pl) pl[k] = 0;
pl.ht = HT; pl.gny = 1; pl.dash = pl.djump = pl.climb = 1;
// events for sound and camera, read and cleared by the game after each step
const ev = { land: 0.5, jump: 0, dash: 0, wall: 0, slide: 0, grap: 0, mantle: 0, kick: 0 };
for (const k in ev) ev[k] = 0;

function teleport(x, y, z) {
  pos[0] = ppos[0] = x; pos[1] = ppos[1] = y; pos[2] = ppos[2] = z;
  vel[0] = vel[1] = vel[2] = 0;
  pl.ground = 0; pl.slide = 0; pl.wall = 0; pl.grap = 0; pl.mantle = 0; pl.climbT = 0; pl.ht = HT;
}

// ---------------------------------------------------------------- collision primitives (over CAND)
// does a player box of height ht at (x, y, z) intersect anything?
function overlapAt(x, y, z, ht) {
  const x0 = x - HW, x1 = x + HW, z0 = z - HW, z1 = z + HW, y1 = y + ht;
  for (let i = 0; i < NC; i++) {
    const o = CAND[i];
    if (WB[o] >= x1 || WB[o] + WB[o + 4] <= x0 || WB[o + 2] >= z1 || WB[o + 2] + WB[o + 6] <= z0) continue;
    if (WB[o + 1] >= y1 || topAt(o, x, z) <= y + 0.01) continue;
    return true;
  }
  return false;
}
// moves the player along one axis, stopping at the first face it would cross. Returns the box hit or -1;
// SC[0] = distance actually moved.
function sweep(ax, d) {
  SC[0] = 0;
  if (d === 0) return -1;
  const px = pos[0], py = pos[1], pz = pos[2];
  const lx = px - HW, hx = px + HW, ly = py, hy = py + pl.ht, lz = pz - HW, hz = pz + HW;
  let hit = -1;
  for (let i = 0; i < NC; i++) {
    const o = CAND[i];
    const bx0 = WB[o], by0 = WB[o + 1], bz0 = WB[o + 2], bx1 = bx0 + WB[o + 4], bz1 = bz0 + WB[o + 6];
    const by1 = WB[o + 7] ? topAt(o, px, pz) : by0 + WB[o + 5];
    if (ax === 1) {
      if (lx >= bx1 - EPS || hx <= bx0 + EPS || lz >= bz1 - EPS || hz <= bz0 + EPS) continue;
      if (d > 0) { const g = by0 - hy; if (g >= -EPS && g < d) { d = max(g - SKIN, 0); hit = o; } }
      else { const g = ly - by1; if (g >= -0.12 && g < -d) { d = by1 + SKIN - ly; hit = o; } }
    } else {
      if (ly >= by1 - EPS || hy <= by0 + EPS) continue;
      if (ax === 0) {
        if (lz >= bz1 - EPS || hz <= bz0 + EPS) continue;
        if (d > 0) { const g = bx0 - hx; if (g >= -EPS && g < d) { d = max(g - SKIN, 0); hit = o; } }
        else { const g = lx - bx1; if (g >= -EPS && g < -d) { d = -max(g - SKIN, 0); hit = o; } }
      } else {
        if (lx >= bx1 - EPS || hx <= bx0 + EPS) continue;
        if (d > 0) { const g = bz0 - hz; if (g >= -EPS && g < d) { d = max(g - SKIN, 0); hit = o; } }
        else { const g = lz - bz1; if (g >= -EPS && g < -d) { d = -max(g - SKIN, 0); hit = o; } }
      }
    }
  }
  pos[ax] += d; SC[0] = d;
  return hit;
}
// highest walkable top under the feet within [feet - down, feet + 0.05]; returns the box or -1, SC[1] = its height
function support(down) {
  const x = pos[0], z = pos[2], y = pos[1];
  let best = -1, by = -1e9;
  for (let i = 0; i < NC; i++) {
    const o = CAND[i];
    if (WB[o] >= x + HW || WB[o] + WB[o + 4] <= x - HW || WB[o + 2] >= z + HW || WB[o + 2] + WB[o + 6] <= z - HW) continue;
    const t = topAt(o, x, z);
    if (t <= y + 0.05 && t >= y - down && t > by) { by = t; best = o; }
  }
  SC[1] = by;
  return best;
}
// a wall (plain box) whose face has normal (nx, nz), within dist of the player's side, at body height
function wallAt(nx, nz, dist) {
  const x = pos[0] - nx * dist, z = pos[2] - nz * dist, y0 = pos[1] + 0.35, y1 = pos[1] + pl.ht - 0.15;
  for (let i = 0; i < NC; i++) {
    const o = CAND[i];
    if (WB[o + 7] !== 0) continue;
    if (WB[o] >= x + HW || WB[o] + WB[o + 4] <= x - HW || WB[o + 2] >= z + HW || WB[o + 2] + WB[o + 6] <= z - HW) continue;
    if (WB[o + 1] >= y1 || WB[o + 1] + WB[o + 5] <= y0) continue;
    return o;
  }
  return -1;
}
// best adjacent wall for a wall-run: the one the velocity is most parallel to. FW = its normal.
function findWall(dist) {
  const hs = hypot(vel[0], vel[2]) || 1;
  let best = 2;
  for (let k = 0; k < 4; k++) {
    const nx = k === 0 ? 1 : k === 1 ? -1 : 0, nz = k === 2 ? 1 : k === 3 ? -1 : 0;
    if (wallAt(nx, nz, dist) < 0) continue;
    const d = abs((vel[0] * nx + vel[2] * nz) / hs);
    if (d < best) { best = d; FW[0] = nx; FW[1] = nz; }
  }
  return best < 2;
}

// ---------------------------------------------------------------- movement helpers
function accelerate(wx, wz, wish, acc) {
  const add = wish - (vel[0] * wx + vel[2] * wz);
  if (add <= 0) return;
  const a = min(acc * DT * RUN, add);
  vel[0] += a * wx; vel[2] += a * wz;
}
function friction(k) {
  const sp = hypot(vel[0], vel[2]);
  if (sp < 1e-3) { vel[0] = vel[2] = 0; return; }
  const f = max(sp - max(sp, 2) * k * DT, 0) / sp;
  vel[0] *= f; vel[2] *= f;
}
// remove the into-ground part of the velocity
function groundProject() {
  const d = vel[0] * pl.gnx + vel[1] * pl.gny + vel[2] * pl.gnz;
  if (d < 0) { vel[0] -= pl.gnx * d; vel[1] -= pl.gny * d; vel[2] -= pl.gnz * d; }
}
function setGround(o) {
  topNormal(o);
  const ch = NRM[0] * pl.gnx + NRM[1] * pl.gny + NRM[2] * pl.gnz < 0.999;
  pl.gnx = NRM[0]; pl.gny = NRM[1]; pl.gnz = NRM[2];
  if (ch) {
    // the slope changed under us: redirect the velocity along the new surface, keeping the speed
    const sp = hypot(vel[0], vel[1], vel[2]), d = vel[0] * NRM[0] + vel[1] * NRM[1] + vel[2] * NRM[2];
    vel[0] -= NRM[0] * d; vel[1] -= NRM[1] * d; vel[2] -= NRM[2] * d;
    const s2 = hypot(vel[0], vel[1], vel[2]);
    if (s2 > 1e-3 && d > -2) { const k = sp / s2; vel[0] *= k; vel[1] *= k; vel[2] *= k; }
  }
}
function refresh() { pl.dash = 1; pl.djump = 1; pl.climb = 1; }
function startSlide(hs) {
  pl.slide = 1; ev.slide = 1;
  if (pl.slideCd <= 0 && hs > 0.1) {
    const b = SLIDE_BOOST * clamp(1 - hs / 28, 0, 1);
    vel[0] += vel[0] / hs * b; vel[2] += vel[2] / hs * b; pl.slideCd = 1.1;
  }
}
function onLand(impact, inp) {
  ev.land = impact; pl.ground = 1; pl.landT = 0.09; pl.wall = 0; pl.climbT = 0; pl.airT = 0; refresh();
  const hs = hypot(vel[0], vel[2]);
  if (inp.c && hs > 1) {
    if (impact > 7) { const b = min((impact - 7) * 0.5, 9); vel[0] += vel[0] / hs * b; vel[2] += vel[2] / hs * b; }
    if (!pl.slide) startSlide(hs);
  }
}
function endWall() { pl.wall = 0; pl.wallCd = 0.3; pl.lwx = pl.wnx; pl.lwz = pl.wnz; }
function wallJump(nx, nz, up) {
  vel[0] += nx * 6.5; vel[2] += nz * 6.5;
  vel[1] = max(vel[1] * 0.3, 0) + up;
  pl.wallCd = 0.3; pl.lwx = nx; pl.lwz = nz; pl.wall = 0; pl.climbT = 0;
}
function tryMantle(ix, iz, top, rise) {
  let ex = pos[0] + ix * 0.6, ez = pos[2] + iz * 0.6;
  if (overlapAt(ex, top + SKIN, ez, HT_C)) { ex = pos[0] + ix * 0.4; ez = pos[2] + iz * 0.4; if (overlapAt(ex, top + SKIN, ez, HT_C)) return false; }
  if (overlapAt(pos[0], top + SKIN, pos[2], HT_C) && overlapAt(pos[0], pos[1] + rise, pos[2], 0.2)) return false;
  pl.mantle = 1; pl.mt = 0; pl.mdur = rise < VAULT ? 0.13 : 0.26;
  pl.m0x = pos[0]; pl.m0y = pos[1]; pl.m0z = pos[2]; pl.m1x = ex; pl.m1y = top + SKIN; pl.m1z = ez;
  let vx = vel[0], vz = vel[2];
  if (rise >= VAULT) { // a mantle costs some speed; a vault keeps all of it
    const hs = hypot(vx, vz), s = max(hs * 0.8, 4) / (hs || 1);
    vx = hs > 0.5 ? vx * s : ix * 4; vz = hs > 0.5 ? vz * s : iz * 4;
  }
  pl.mvx = vx; pl.mvz = vz; pl.ht = HT_C; pl.slide = 0; pl.wall = 0; pl.climbT = 0;
  ev.mantle = rise;
  return true;
}

// ---------------------------------------------------------------- the step
// inp: f/s (-1..1 forward / strafe), c (crouch held), g (grapple held), jq / dq (jump / dash presses), yaw, pitch
function step(inp) {
  ppos[0] = pos[0]; ppos[1] = pos[1]; ppos[2] = pos[2];
  pl.jbuf -= DT; pl.dbuf -= DT; pl.coyote -= DT; pl.landT -= DT; pl.slideCd -= DT; pl.wallCd -= DT; pl.gcd -= DT; pl.dashT -= DT;
  if (inp.jq) { pl.jbuf = 0.13; inp.jq = 0; }
  if (inp.dq) { pl.dbuf = 0.12; inp.dq = 0; }
  const sy = sin(inp.yaw), cy = cos(inp.yaw), cp = cos(inp.pitch);
  const lx = -sy * cp, ly = sin(inp.pitch), lz = -cy * cp;
  let wx = -sy * inp.f + cy * inp.s, wz = -cy * inp.f - sy * inp.s;
  const wl = hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  if (pl.mantle) {
    pl.mt += DT;
    const t = min(pl.mt / pl.mdur, 1), e = t * t * (3 - 2 * t), ty = min(1, t * 1.7);
    pos[0] = mix(pl.m0x, pl.m1x, e); pos[1] = mix(pl.m0y, pl.m1y, ty * (2 - ty)); pos[2] = mix(pl.m0z, pl.m1z, e);
    if (t >= 1) {
      pl.mantle = 0; vel[0] = pl.mvx; vel[1] = 0; vel[2] = pl.mvz;
      pl.ground = 1; pl.gnx = 0; pl.gny = 1; pl.gnz = 0; pl.landT = 0.09; refresh();
    }
    return;
  }

  let hs = hypot(vel[0], vel[2]);
  const m = 2.5 + (hs + abs(vel[1])) * DT;
  gather(pos[0] - m, pos[1] - m, pos[2] - m, pos[0] + m, pos[1] + HT + REACH + m, pos[2] + m);

  // crouch / stand up (only with headroom)
  if (inp.c || pl.slide) pl.ht = HT_C;
  else if (pl.ht < HT && !overlapAt(pos[0], pos[1], pos[2], HT)) pl.ht = HT;

  // grapple: attach to whatever the crosshair points at, release on letting go
  if (inp.g && !pl.grap && pl.gcd <= 0) {
    const t = raycast(pos[0], pos[1] + pl.ht - 0.15, pos[2], lx, ly, lz, GRANGE);
    if (t > 2) { pl.grap = 1; pl.gx = RH[0]; pl.gy = RH[1]; pl.gz = RH[2]; pl.glen = t; ev.grap = 1; if (pl.wall) endWall(); pl.climbT = 0; }
    else pl.gcd = 0.1;
  } else if (!inp.g && pl.grap) { pl.grap = 0; pl.gcd = 0.15; }

  // jump: ground / coyote, wall-run jump, wall kick, double jump
  let jumped = 0;
  if (pl.jbuf > 0) {
    if (pl.ground || pl.coyote > 0) {
      vel[1] = max(vel[1], 0) + JUMP; jumped = 1; ev.jump = 1;
    } else if (pl.wall) {
      const fx = -sy, fz = -cy; // a little extra push where you look
      wallJump(pl.wnx, pl.wnz, JUMP * 0.95); vel[0] += fx * 2; vel[2] += fz * 2; jumped = 1; ev.kick = 1;
    } else if (findWall(0.45) && !(pl.wallCd > 0 && FW[0] === pl.lwx && FW[1] === pl.lwz)) {
      wallJump(FW[0], FW[1], JUMP); jumped = 1; ev.kick = 1;
    } else if (pl.djump) {
      vel[1] = max(vel[1], JUMP * 0.9); pl.djump = 0; jumped = 1; ev.jump = 2;
      if (wl > 0 && hs > 0.5) { // steer the momentum toward the input
        let nx = mix(vel[0] / hs, wx, 0.7), nz = mix(vel[2] / hs, wz, 0.7); const nl = hypot(nx, nz) || 1;
        nx /= nl; nz /= nl; const s = max(hs, 5); vel[0] = nx * s; vel[2] = nz * s;
      }
    }
    if (jumped) { pl.jbuf = 0; pl.ground = 0; pl.coyote = 0; pl.slide = 0; pl.landT = 0; }
  }

  // air dash: redirect toward the input (or the view) with a boost that fades at high speed
  if (pl.dbuf > 0 && !pl.ground && pl.dash) {
    let dx = wx, dz = wz;
    if (wl === 0) { dx = -sy; dz = -cy; }
    const s = max(hs + DASH * clamp(1 - hs / 40, 0, 1), 14);
    vel[0] = dx * s; vel[2] = dz * s; vel[1] = max(vel[1], 1.2);
    pl.dash = 0; pl.dbuf = 0; pl.dashT = 0.18; ev.dash = 1;
    if (pl.wall) endWall();
  }

  hs = hypot(vel[0], vel[2]);
  if (pl.ground) {
    if (!pl.slide && inp.c && hs > 6) startSlide(hs);
    if (pl.slide && (!inp.c || hs < 3)) pl.slide = 0;
    if (pl.slide) {
      const f = max(hs - SLIDE_DEC * DT, 0) / (hs || 1); vel[0] *= f; vel[2] *= f;
      if (wl > 0) accelerate(wx, wz, 2, 3);
    } else {
      if (pl.landT <= 0) friction(hs > RUN + 1 ? 1.6 : 8);
      if (wl > 0) accelerate(wx, wz, inp.c ? 4.5 : RUN, 12);
    }
    vel[1] -= G * DT; groundProject(); // on a slope this leaves the downhill pull
  } else if (pl.climbT > 0) {
    pl.climbT -= DT;
    if (wallAt(-pl.cix, -pl.ciz, 0.3) < 0 || inp.f <= 0) pl.climbT = 0;
    vel[0] = pl.cix * 0.8; vel[2] = pl.ciz * 0.8; vel[1] = 6.8 * min(1, 0.4 + pl.climbT * 2);
  } else if (pl.wall) {
    const nx = pl.wnx, nz = pl.wnz;
    if (wallAt(nx, nz, 0.3) < 0 || pl.wallT > WALL_T || inp.c || inp.f <= 0 || (wl > 0 && wx * nx + wz * nz > 0.7)) endWall();
    else {
      pl.wallT += DT;
      const vn = vel[0] * nx + vel[2] * nz; vel[0] -= nx * vn; vel[2] -= nz * vn;
      const s = hypot(vel[0], vel[2]);
      if (s < 3) endWall();
      else if (s < WALL_SPD) { const k = (s + min(WALL_SPD - s, 9 * DT)) / s; vel[0] *= k; vel[2] *= k; }
      vel[1] = max(vel[1] - (1.5 + pl.wallT * 7) * DT, -4);
    }
  }
  if (!pl.ground && !pl.wall && pl.climbT <= 0) {
    vel[1] -= (inp.c ? G * 2.4 : G) * DT;
    if (wl > 0) { accelerate(wx, wz, AIRCAP, AIRACC); if (hs < 7) accelerate(wx, wz, 7, 1.6); }
  }

  // grapple rope: pull toward the anchor, and the rope never lengthens (pendulum swing)
  if (pl.grap) {
    const dx = pl.gx - pos[0], dy = pl.gy - (pos[1] + pl.ht * 0.6), dz = pl.gz - pos[2], dist = hypot(dx, dy, dz);
    if (dist < 2) { pl.grap = 0; pl.gcd = 0.3; }
    else {
      const nx = dx / dist, ny = dy / dist, nz = dz / dist;
      vel[0] += nx * GPULL * DT; vel[1] += ny * GPULL * DT; vel[2] += nz * GPULL * DT;
      pl.glen = max(3, min(pl.glen, dist) - 6 * DT);
      if (dist > pl.glen) { const vr = vel[0] * nx + vel[1] * ny + vel[2] * nz; if (vr < 0) { vel[0] -= nx * vr; vel[1] -= ny * vr; vel[2] -= nz * vr; } }
      if (pl.ground && ny > 0.2) { pl.ground = 0; pl.slide = 0; }
    }
  }

  // soft speed limit
  const sp = hypot(vel[0], vel[1], vel[2]);
  if (sp > DRAG_V) { const k = max(1 - 0.006 * (sp - DRAG_V) * DT * 10, 0.9); vel[0] *= k; vel[1] *= k; vel[2] *= k; }
  if (vel[1] < -70) vel[1] = -70;

  // ---- integrate with collision: vertical, then the two horizontal axes
  const vy0 = vel[1];
  let landed = 0, o = sweep(1, vel[1] * DT);
  if (o >= 0) {
    if (vy0 < 0) { landed = 1; const wasG = pl.ground; setGround(o); groundProject(); if (!wasG) onLand(-vy0, inp); pl.ground = 1; }
    else vel[1] = 0;
  }
  for (let ax = 0; ax <= 2; ax += 2) {
    const d = vel[ax] * DT;
    o = sweep(ax, d);
    if (o < 0) continue;
    const rem = d - SC[0], top = topAt(o, pos[0], pos[2]), rise = top - pos[1], sgn = d > 0 ? 1 : -1;
    const ix = ax === 0 ? sgn : 0, iz = ax === 2 ? sgn : 0;
    // step up small ledges (and ramp edges) without losing speed
    if (rise > 0 && rise <= STEP && pl.ground && !overlapAt(pos[0], top + SKIN, pos[2], pl.ht)) {
      pos[1] = top + SKIN;
      if (sweep(ax, rem) >= 0) vel[ax] = 0;
      continue;
    }
    // vault / mantle onto ledges within reach
    const into = (inp.f > 0 && wl > 0 && wx * ix + wz * iz > 0.3) || (pl.slide && rise < VAULT);
    if (rise > 0 && rise <= REACH && into && !pl.grap && tryMantle(ix, iz, top, rise)) return;
    // wall climb: run up a wall you face head-on, once per jump
    if (!pl.ground && pl.climb && inp.f > 0 && rise > REACH && (lx * ix + lz * iz) / (hypot(lx, lz) || 1) > 0.7 && vel[1] > -6 && !pl.grap) {
      pl.climb = 0; pl.climbT = 0.42; pl.cix = ix; pl.ciz = iz; if (pl.wall) endWall();
    }
    vel[ax] = 0;
  }

  // ---- ground contact
  hs = hypot(vel[0], vel[2]);
  if (!landed && pl.ground) {
    const vn = vel[0] * pl.gnx + vel[1] * pl.gny + vel[2] * pl.gnz;
    o = jumped || vn > 0.5 ? -1 : support(0.06 + hs * DT * 0.9);
    if (o >= 0) { pos[1] = SC[1] + SKIN; setGround(o); groundProject(); }
    else { pl.ground = 0; if (!jumped) pl.coyote = 0.12; }
  } else if (!pl.ground && vel[1] <= 0) {
    o = support(0.02); // resting exactly on a surface
    if (o >= 0) { setGround(o); onLand(-vel[1], inp); groundProject(); }
  }
  if (pl.ground) { pl.airT = 0; pl.wall = 0; pl.climbT = 0; } else pl.airT += DT;

  // ---- wall-run attach
  if (!pl.ground && !pl.wall && !pl.grap && pl.climbT <= 0 && pl.airT > 0.06 && inp.f > 0 && hs > 5 && vel[1] > -14 && findWall(0.3)) {
    const nx = FW[0], nz = FW[1], d = (vel[0] * nx + vel[2] * nz) / hs;
    if (d < 0.25 && d > -0.8 && !(pl.wallCd > 0 && nx === pl.lwx && nz === pl.lwz)) {
      pl.wall = 1; pl.wnx = nx; pl.wnz = nz; pl.wallT = 0; ev.wall = 1; refresh();
      const vn = vel[0] * nx + vel[2] * nz; vel[0] -= nx * vn; vel[2] -= nz * vn;
      vel[1] = vel[1] > -6 ? max(vel[1] * 0.5, 2.5) : vel[1] * 0.5;
    }
  }
}

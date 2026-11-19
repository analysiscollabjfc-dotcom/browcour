// ============================================================================
// first-person body: arms, legs, the wrist grapple launcher, the cable and the hook, rebuilt as capsules each frame
// ============================================================================
// Arms live in view space (they follow the camera), legs and torso in body space (yaw only). Each move sets hand and
// foot targets; targets are blended with exponential smoothing so changing state never snaps, and two-bone IK
// places the elbows and knees. Every number lives in preallocated arrays: nothing is allocated per frame.
const ARM = new Float64Array(6), LEG = new Float64Array(6); // smoothed targets: hands (view space), feet (body space)
const J = new Float64Array(6), T = new Float64Array(3), LT = new Float64Array(3), HK = new Float64Array(3);
// frame inputs shared by the helpers below (module-level so the helpers need no closures)
const EB = new Float64Array(8); let BB = EB; // eye xyz, feet xyz, body right x/z... ; BB = camera basis
const vwx = (x, y, z) => EB[0] + BB[0] * x + BB[3] * y + BB[6] * z;
const vwy = (x, y, z) => EB[1] + BB[1] * x + BB[4] * y + BB[7] * z;
const vwz = (x, y, z) => EB[2] + BB[2] * x + BB[5] * y + BB[8] * z;
const bdx = (x, z) => EB[3] + EB[6] * x + EB[7] * z, bdz = (x, z) => EB[5] + EB[7] * x - EB[6] * z;
const kexp = (dt, r) => 1 - exp(-dt * r);
const anim = { init: 0, miss: 0.5, mdx: 0.5, mdy: 0.5, mdz: 0.5, flash: 0.5, hitT: 0.5, phase: 0.5 };
anim.miss = anim.flash = anim.hitT = anim.phase = 0;
// palette (linear): sleeve, skin, glove, trousers, shoe accent, launcher, steel cable, hook
const C_SLEEVE = [0.06, 0.07, 0.1], C_SKIN = [0.56, 0.37, 0.28], C_GLOVE = [0.035, 0.035, 0.04], C_PANTS = [0.07, 0.08, 0.1];
const C_SHOE = [0.9, 0.26, 0.08], C_LAUNCH = [0.95, 0.32, 0.08], C_CABLE = [0.42, 0.44, 0.47], C_HOOK = [0.75, 0.77, 0.8];

function cap(ax, ay, az, bx, by, bz, r, c, kind) {
  if (nCap >= MAXCAP) return;
  const o = nCap++ * 12;
  CAP[o] = ax; CAP[o + 1] = ay; CAP[o + 2] = az; CAP[o + 3] = r;
  CAP[o + 4] = bx; CAP[o + 5] = by; CAP[o + 6] = bz; CAP[o + 7] = 0;
  CAP[o + 8] = c[0]; CAP[o + 9] = c[1]; CAP[o + 10] = c[2]; CAP[o + 11] = kind;
}
function glow(ax, ay, az, bx, by, bz, r, k) {
  if (nCap >= MAXCAP) return;
  cap(ax, ay, az, bx, by, bz, r, C_HOOK, 2);
  const o = (nCap - 1) * 12; CAP[o + 8] = 4 * k; CAP[o + 9] = 2.4 * k; CAP[o + 10] = 1.1 * k;
}
// two-bone IK: root s, target t, bone lengths, pole hint p (all world). J = elbow xyz, end xyz.
function ik(sx, sy, sz, tx, ty, tz, l1, l2, px, py, pz) {
  let dx = tx - sx, dy = ty - sy, dz = tz - sz;
  const dl = hypot(dx, dy, dz) || 1e-6; dx /= dl; dy /= dl; dz /= dl;
  const d = clamp(dl, 0.05, l1 + l2 - 1e-3);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = sqrt(max(l1 * l1 - a * a, 0));
  const pd = px * dx + py * dy + pz * dz;
  let qx = px - dx * pd, qy = py - dy * pd, qz = pz - dz * pd;
  const ql = hypot(qx, qy, qz) || 1; qx /= ql; qy /= ql; qz /= ql;
  J[0] = sx + dx * a + qx * h; J[1] = sy + dy * a + qy * h; J[2] = sz + dz * a + qz * h;
  J[3] = sx + dx * d; J[4] = sy + dy * d; J[5] = sz + dz * d;
}
// world point -> view-space coordinates into T (B = camera basis right, up, forward)
function toView(B, ex, ey, ez, x, y, z) {
  x -= ex; y -= ey; z -= ez;
  T[0] = x * B[0] + y * B[1] + z * B[2]; T[1] = x * B[3] + y * B[4] + z * B[5]; T[2] = x * B[6] + y * B[7] + z * B[8];
}

// px, py, pz: feet (interpolated); ex, ey, ez: eye; B: camera basis; pix: radians per pixel (keeps thin parts visible)
function buildBody(dt, px, py, pz, ex, ey, ez, yaw, B, pix, time) {
  nCap = 0;
  BB = B; EB[0] = ex; EB[1] = ey; EB[2] = ez; EB[3] = px; EB[4] = py; EB[5] = pz; EB[6] = cos(yaw); EB[7] = -sin(yaw);
  const hs = hypot(vel[0], vel[2]);
  const rx = cos(yaw), rz = -sin(yaw), fx = -sin(yaw), fz = -cos(yaw); // body right / forward (horizontal)
  if (pl.ground && !pl.slide && hs > 0.5 || pl.wall) anim.phase += hs * dt * 0.95;
  const ph = anim.phase, run = min(hs / 9, 1);
  const grapOn = pl.grap || anim.miss > 0;

  // ---- hand targets (view space: x right, y up, z forward), side s = -1 left (launcher arm), +1 right
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    let x = s * 0.22, y = -0.45, z = 0.2; // idle: arms low, mostly out of view
    if (pl.mantle) {
      toView(B, ex, ey, ez, pl.m1x + rx * s * 0.25 - fx * 0.25, pl.m1y + 0.03, pl.m1z + rz * s * 0.25 - fz * 0.25);
      x = T[0]; y = T[1]; z = T[2];
    } else if (k === 0 && grapOn) {
      // aim the launcher along the cable
      let dx, dy, dz;
      if (pl.grap) { dx = pl.gx - ex; dy = pl.gy - ey; dz = pl.gz - ez; } else { dx = anim.mdx; dy = anim.mdy; dz = anim.mdz; }
      const l = hypot(dx, dy, dz) || 1;
      toView(B, 0, 0, 0, dx / l, dy / l, dz / l);
      x = T[0] * 0.6 - 0.1; y = T[1] * 0.6 - 0.14; z = T[2] * 0.6;
      if (z < 0.2) z = 0.2;
    } else if (pl.climbT > 0) {
      x = s * 0.22; y = 0.02 + 0.14 * sin(time * 15 + s * 1.6); z = 0.42;
    } else if (pl.wall && s * (-pl.wnx * B[0] - pl.wnz * B[2]) > 0.3) {
      // the hand on the wall side touches the wall as you run along it
      toView(B, ex, ey, ez, px - pl.wnx * (HW + 0.03) + fx * 0.35, ey - 0.15, pz - pl.wnz * (HW + 0.03) + fz * 0.35);
      x = T[0]; y = T[1]; z = T[2];
    } else if (pl.dashT > 0) { x = s * 0.2; y = -0.42; z = 0.04; }
    else if (pl.slide) { x = s * 0.4; y = s > 0 ? -0.36 : -0.24; z = s > 0 ? 0.12 : 0.3; }
    else if (!pl.ground) { x = s * 0.33; y = vel[1] > 0 ? -0.1 : -0.18; z = 0.36; }
    else if (hs > 0.5) {
      const sw = sin(ph) * (0.6 + 0.4 * run);
      x = s * (0.2 - run * 0.03); y = -0.33 + abs(sw) * 0.08 * run + run * 0.04; z = 0.24 - s * sw * 0.17 * run + run * 0.04;
    }
    const o = k * 3, r = pl.mantle ? 30 : 16;
    if (!anim.init) { ARM[o] = x; ARM[o + 1] = y; ARM[o + 2] = z; }
    ARM[o] += (x - ARM[o]) * kexp(dt, r); ARM[o + 1] += (y - ARM[o + 1]) * kexp(dt, r); ARM[o + 2] += (z - ARM[o + 2]) * kexp(dt, r);
  }

  // ---- foot targets (body space: x right, y up, z forward)
  const hipY = pl.ht * 0.5;
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    let x = s * 0.13, y = 0, z = 0.02;
    if (pl.mantle) { y = 0.35; z = 0.1; }
    else if (pl.slide) { x = s * 0.12; y = s > 0 ? 0.08 : 0.02; z = s > 0 ? 0.75 : 0.12; }
    else if (pl.ground || pl.wall) {
      if (hs > 0.5 || pl.wall) {
        const a = ph + (s > 0 ? PI : 0), stride = min(0.15 + hs * 0.035, 0.55);
        z = sin(a) * stride; y = max(0, cos(a)) * min(0.08 + hs * 0.025, 0.32);
      }
    } else { y = 0.3 + (vel[1] > 0 ? 0.1 : 0); z = s * 0.14 + 0.05; }
    const o = k * 3;
    if (!anim.init) { LEG[o] = x; LEG[o + 1] = y; LEG[o + 2] = z; }
    LEG[o] += (x - LEG[o]) * kexp(dt, 18); LEG[o + 1] += (y - LEG[o + 1]) * kexp(dt, 18); LEG[o + 2] += (z - LEG[o + 2]) * kexp(dt, 18);
  }
  anim.init = 1;

  // ---- legs and torso (drawn first: front-to-back is irrelevant here, they are small)
  cap(bdx(0, -0.2), py + hipY + 0.05, bdz(0, -0.2), bdx(0, -0.24), py + pl.ht - 0.62, bdz(0, -0.24), 0.15, C_SLEEVE, 0);
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1, o = k * 3;
    const hx = bdx(s * 0.11, -0.06), hy = py + hipY, hz = bdz(s * 0.11, -0.06);
    ik(hx, hy, hz, bdx(LEG[o], LEG[o + 2]), py + LEG[o + 1] + 0.06, bdz(LEG[o], LEG[o + 2]), 0.45, 0.44, fx + rx * s * 0.1, 0, fz + rz * s * 0.1);
    cap(hx, hy, hz, J[0], J[1], J[2], 0.075, C_PANTS, 0);
    cap(J[0], J[1], J[2], J[3], J[4], J[5], 0.06, C_PANTS, 0);
    cap(J[3], J[4] - 0.02, J[5], J[3] + fx * 0.17, J[4] - 0.04, J[5] + fz * 0.17, 0.05, C_SHOE, 0);
  }

  // ---- arms
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1, o = k * 3;
    const sx = vwx(s * 0.2, -0.27, -0.08), sy = vwy(s * 0.2, -0.27, -0.08), sz = vwz(s * 0.2, -0.27, -0.08);
    const tx = vwx(ARM[o], ARM[o + 1], ARM[o + 2]), ty = vwy(ARM[o], ARM[o + 1], ARM[o + 2]), tz = vwz(ARM[o], ARM[o + 1], ARM[o + 2]);
    ik(sx, sy, sz, tx, ty, tz, 0.3, 0.28, B[0] * s * 0.8 - B[3] * 0.6 - B[6] * 0.2, B[1] * s * 0.8 - B[4] * 0.6 - B[7] * 0.2, B[2] * s * 0.8 - B[5] * 0.6 - B[8] * 0.2);
    const ux = J[0], uy = J[1], uz = J[2], wx = J[3], wy = J[4], wz = J[5];
    let dx = wx - ux, dy = wy - uy, dz = wz - uz; const dl = hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    cap(sx, sy, sz, ux, uy, uz, 0.055, C_SLEEVE, 0);
    cap(ux, uy, uz, wx, wy, wz, 0.045, C_SKIN, 0);
    cap(wx, wy, wz, wx + dx * 0.08, wy + dy * 0.08, wz + dz * 0.08, 0.046, C_GLOVE, 0);
    // thumb, on the inner side of the hand
    const tx2 = wx + dx * 0.03 - B[0] * s * 0.035 + B[3] * 0.02, ty2 = wy + dy * 0.03 - B[1] * s * 0.035 + B[4] * 0.02, tz2 = wz + dz * 0.03 - B[2] * s * 0.035 + B[5] * 0.02;
    cap(tx2, ty2, tz2, tx2 + dx * 0.05 - B[0] * s * 0.015, ty2 + dy * 0.05 - B[1] * s * 0.015, tz2 + dz * 0.05 - B[2] * s * 0.015, 0.02, C_GLOVE, 0);
    if (k === 0) {
      // wrist launcher on the left forearm, slightly on top
      const ox = B[3] * 0.035, oy = B[4] * 0.035, oz = B[5] * 0.035;
      cap(ux + (wx - ux) * 0.45 + ox, uy + (wy - uy) * 0.45 + oy, uz + (wz - uz) * 0.45 + oz, wx + dx * 0.03 + ox, wy + dy * 0.03 + oy, wz + dz * 0.03 + oz, 0.036, C_LAUNCH, 0);
      LT[0] = wx + dx * 0.06 + ox; LT[1] = wy + dy * 0.06 + oy; LT[2] = wz + dz * 0.06 + oz;
    }
  }

  // ---- cable and hook
  anim.flash = max(0, anim.flash - dt * 5); anim.hitT += dt;
  let f = -1, slack = 0;
  if (pl.grap) {
    f = pl.gfly > 0 ? 1 - pl.gfly / pl.gfly0 : 1;
    HK[0] = mix(LT[0], pl.gx, f); HK[1] = mix(LT[1], pl.gy, f); HK[2] = mix(LT[2], pl.gz, f);
  } else if (anim.miss > 0) {
    // fired at nothing: the hook flies to full range and is reeled back in, the cable sagging
    anim.miss = max(0, anim.miss - dt);
    const t = 1 - anim.miss / 0.55, out = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
    f = 0; slack = t > 0.45 ? 1 : 0;
    HK[0] = LT[0] + anim.mdx * GRANGE * out; HK[1] = LT[1] + anim.mdy * GRANGE * out - slack * 3 * out; HK[2] = LT[2] + anim.mdz * GRANGE * out;
  }
  if (f >= 0) {
    let dx = HK[0] - LT[0], dy = HK[1] - LT[1], dz = HK[2] - LT[2];
    const len = hypot(dx, dy, dz) || 1e-3; dx /= len; dy /= len; dz /= len;
    // two directions across the cable
    let ax = -dz, az = dx, ay = 0; const al = hypot(ax, az) || 1; ax /= al; az /= al;
    const cx = ay * dz - az * dy, cy = az * dx - ax * dz, cz = ax * dy - ay * dx;
    // the wave: a travelling ripple while the hook flies, a fading twang after it bites
    const amp = pl.grap ? (pl.gfly > 0 ? min(len * 0.03, 0.5) : 0.25 * exp(-anim.hitT * 10)) : min(len * 0.02, 0.6);
    const N = 14;
    let qx = LT[0], qy = LT[1], qz = LT[2];
    for (let i = 1; i <= N; i++) {
      const t = i / N, env = 4 * t * (1 - t), w = sin(t * 9.4 - time * 38) * amp * env, w2 = cos(t * 9.4 - time * 38) * amp * env * 0.4;
      const sag = slack * env * min(len * 0.06, 2.5);
      const nx = LT[0] + dx * len * t + ax * w + cx * w2, ny = LT[1] + dy * len * t + cy * w2 - sag, nz = LT[2] + dz * len * t + az * w + cz * w2;
      const r = max(0.012, hypot(nx - ex, ny - ey, nz - ez) * pix * 0.6);
      cap(qx, qy, qz, nx, ny, nz, r, C_CABLE, 1);
      qx = nx; qy = ny; qz = nz;
    }
    // hook: a head and three prongs that open when it bites
    const hx = HK[0], hy = HK[1], hz = HK[2], dc = hypot(hx - ex, hy - ey, hz - ez) * pix;
    cap(hx - dx * 0.18, hy - dy * 0.18, hz - dz * 0.18, hx, hy, hz, max(0.045, dc * 1.6), C_HOOK, 1); // never smaller than ~3 px
    const open = pl.grap && pl.gfly <= 0 ? 0.16 : 0.07;
    for (let p = 0; p < 3; p++) {
      const a = p * 2.094 + 0.4, ox = (ax * cos(a) + cx * sin(a)) * open, oy = cy * sin(a) * open, oz = (az * cos(a) + cz * sin(a)) * open;
      cap(hx - dx * 0.04, hy - dy * 0.04, hz - dz * 0.04, hx - dx * 0.2 + ox, hy - dy * 0.2 + oy, hz - dz * 0.2 + oz, max(0.022, dc * 0.6), C_HOOK, 1);
    }
  }
  // impact: a flash and sparks thrown off the surface
  if (anim.flash > 0 && pl.grap) {
    const k = anim.flash, gx = pl.gx, gy = pl.gy, gz = pl.gz;
    glow(gx, gy, gz, gx, gy, gz, 0.1 + 0.35 * k, k);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4 + 1, e = 0.3 + 0.6 * ihash(i, 7, 3), sp = (1 - k) * (1.2 + ihash(i, 3, 5));
      let sx = pl.gnx2 + cos(a) * e, sy = pl.gny2 + sin(a) * e * 0.7 + 0.3, sz = pl.gnz2 + sin(a) * e;
      const sl = hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
      const r = max(0.015, hypot(gx - ex, gy - ey, gz - ez) * pix * 0.7);
      glow(gx + sx * sp, gy + sy * sp - sp * sp * 0.3, gz + sz * sp, gx + sx * (sp + 0.25 * k), gy + sy * (sp + 0.25 * k) - sp * sp * 0.3, gz + sz * (sp + 0.25 * k), r, k);
    }
  }
}
function hookFired(miss, lx, ly, lz) { if (miss) { anim.miss = 0.55; anim.mdx = lx; anim.mdy = ly; anim.mdz = lz; } }
function hookHit() { anim.flash = 1; anim.hitT = 0; }

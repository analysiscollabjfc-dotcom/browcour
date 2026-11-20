// ============================================================================
// people: one capsule human model (player and pedestrians) and the pedestrian simulation
// ============================================================================
// Pedestrians walk loops on the sidewalk ring of a block (a rectangle a little inside the curb). At corners some
// cross: at signals they wait for the walk phase (the crossed street's traffic on red), elsewhere for a gap in the
// traffic. Far away ones are moved near the player again. No per-frame allocation.
const J = new Float64Array(6);
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
function dcap(ax, ay, az, bx, by, bz, r, c, o, k) { if (nDC < MAXDC) capw(DC, nDC++, ax, ay, az, bx, by, bz, r, c[o], c[o + 1], c[o + 2], k); }
// palettes (linear rgb): skin, hair, tops, bottoms, shoes
const SKIN = [0.62, 0.42, 0.32, 0.5, 0.32, 0.22, 0.32, 0.19, 0.12, 0.72, 0.52, 0.42, 0.2, 0.12, 0.08];
const HAIR = [0.03, 0.025, 0.02, 0.18, 0.1, 0.05, 0.4, 0.28, 0.12, 0.34, 0.08, 0.03, 0.5, 0.48, 0.45, 0.08, 0.05, 0.03];
const TOPS = [0.05, 0.06, 0.1, 0.6, 0.06, 0.05, 0.08, 0.2, 0.12, 0.55, 0.5, 0.4, 0.7, 0.7, 0.68, 0.12, 0.12, 0.13, 0.3, 0.1, 0.2,
  0.6, 0.35, 0.08, 0.15, 0.3, 0.5, 0.35, 0.22, 0.12, 0.85, 0.32, 0.06];
const BOTS = [0.06, 0.08, 0.16, 0.03, 0.03, 0.035, 0.25, 0.22, 0.17, 0.12, 0.12, 0.13, 0.35, 0.3, 0.22, 0.1, 0.13, 0.25];
const SHOE = [0.02, 0.02, 0.02, 0.8, 0.8, 0.78, 0.18, 0.1, 0.06, 0.3, 0.05, 0.04];
const NTOP = 11;
const HC = new Float64Array(15), HB = new Float64Array(4); // one person: colours (skin, hair, top, bottom, shoes), placement
const sign = Math.sign;
// body space of the person being built: f forward, r right (right = (-sin, cos))
const bx = (f, r) => HB[0] + HB[2] * f - HB[3] * r, bz = (f, r) => HB[1] + HB[3] * f + HB[2] * r;
function setLook(ap) {
  // ap packs palette indices: skin 0-4, hair 0-5, top 0-10, bottom 0-5, shoes 0-3, long hair
  const sk = ap % 5, hr = floor(ap / 5) % 6, tp = floor(ap / 30) % NTOP, bt = floor(ap / 330) % 6, sh = floor(ap / 1980) % 4;
  for (let k = 0; k < 3; k++) { HC[k] = SKIN[sk * 3 + k]; HC[3 + k] = HAIR[hr * 3 + k]; HC[6 + k] = TOPS[tp * 3 + k]; HC[9 + k] = BOTS[bt * 3 + k]; HC[12 + k] = SHOE[sh * 3 + k]; }
}
// a person at feet (x, y, z) facing yaw (forward = (cos, sin)); ph gait phase, sp speed, air, lod 0 full / 1 simple
function human(x, y, z, yaw, ph, sp, air, ap, lod, hs) {
  setLook(ap);
  const c = cos(yaw), s = sin(yaw), run = min(sp / 6, 1), longHair = floor(ap / 7920) % 2;
  HB[0] = x; HB[1] = z; HB[2] = c; HB[3] = s;
  const lean = run * 0.12, hip = y + 0.94 * hs, chest = y + 1.42 * hs, head = y + 1.63 * hs;
  if (lod) {
    const sw = sin(ph) * 0.3 * min(sp / 1.4, 1);
    dcap(bx(sw * 0.5, -0.1), y + 0.08, bz(sw * 0.5, -0.1), bx(0, -0.1), hip, bz(0, -0.1), 0.08, HC, 9, 0);
    dcap(bx(-sw * 0.5, 0.1), y + 0.08, bz(-sw * 0.5, 0.1), bx(0, 0.1), hip, bz(0, 0.1), 0.08, HC, 9, 0);
    dcap(bx(0, 0), hip, bz(0, 0), bx(lean * 0.5, 0), chest, bz(lean * 0.5, 0), 0.18, HC, 6, 0);
    dcap(bx(lean, 0), head, bz(lean, 0), bx(lean, 0), head + 0.02, bz(lean, 0), 0.12, HC, 0, 0);
    return;
  }
  // legs
  for (let k = 0; k < 2; k++) {
    const sd = k ? 1 : -1, a = ph + (k ? PI : 0);
    let ff = 0, fy = 0;
    if (air) { ff = sd * 0.15; fy = 0.3; }
    else if (sp > 0.2) { const st = min(0.18 + sp * 0.06, 0.62); ff = sin(a) * st; fy = max(0, cos(a)) * min(0.06 + sp * 0.035, 0.32); }
    const hx = bx(0, sd * 0.1), hz = bz(0, sd * 0.1);
    ik(hx, hip, hz, bx(ff, sd * 0.11), y + fy + 0.07, bz(ff, sd * 0.11), 0.46 * hs, 0.45 * hs, c, 0, s);
    dcap(hx, hip, hz, J[0], J[1], J[2], 0.078, HC, 9, 0);
    dcap(J[0], J[1], J[2], J[3], J[4], J[5], 0.062, HC, 9, 0);
    dcap(J[3], J[4] - 0.02, J[5], J[3] + c * 0.15, J[4] - 0.03, J[5] + s * 0.15, 0.052, HC, 12, 0);
  }
  // torso, shoulders, head and hair
  dcap(bx(0, -0.09), hip, bz(0, -0.09), bx(0, 0.09), hip, bz(0, 0.09), 0.12, HC, 9, 0);
  dcap(bx(0, 0), hip + 0.05, bz(0, 0), bx(lean, 0), chest - 0.08, bz(lean, 0), 0.15, HC, 6, 0);
  dcap(bx(lean, -0.17), chest, bz(lean, -0.17), bx(lean, 0.17), chest, bz(lean, 0.17), 0.085, HC, 6, 0);
  dcap(bx(lean * 1.2, 0), chest + 0.03, bz(lean * 1.2, 0), bx(lean * 1.2, 0), head - 0.08, bz(lean * 1.2, 0), 0.05, HC, 0, 0);
  dcap(bx(lean * 1.3 + 0.01, 0), head, bz(lean * 1.3 + 0.01, 0), bx(lean * 1.3 + 0.01, 0), head + 0.03, bz(lean * 1.3 + 0.01, 0), 0.105, HC, 0, 0);
  dcap(bx(lean * 1.3 - 0.025, 0), head + 0.05, bz(lean * 1.3 - 0.025, 0), bx(lean * 1.3 - 0.025, 0), head + 0.06, bz(lean * 1.3 - 0.025, 0), 0.108, HC, 3, 0);
  if (longHair) dcap(bx(lean * 1.3 - 0.07, 0), head, bz(lean * 1.3 - 0.07, 0), bx(lean - 0.09, 0), head - 0.24, bz(lean - 0.09, 0), 0.075, HC, 3, 0);
  // arms swing against the legs
  for (let k = 0; k < 2; k++) {
    const sd = k ? 1 : -1, a = ph + (k ? 0 : PI);
    const sx = bx(lean, sd * 0.2), sz = bz(lean, sd * 0.2);
    let hf = sp > 0.2 ? sin(a) * min(0.12 + sp * 0.04, 0.38) : 0.03, hy = y + 0.95 * hs + (sp > 3 ? 0.18 : 0);
    if (air) { hf = 0.15; hy = chest + 0.1; }
    ik(sx, chest, sz, bx(hf + lean, sd * (0.24 + run * 0.02)), hy, bz(hf + lean, sd * (0.24 + run * 0.02)), 0.29 * hs, 0.27 * hs, -c * 0.3 + -s * sd * 0.5, -1, -s * 0.3 + c * sd * 0.5);
    dcap(sx, chest, sz, J[0], J[1], J[2], 0.058, HC, 6, 0);
    dcap(J[0], J[1], J[2], J[3], J[4], J[5], 0.047, HC, 6, 0);
    dcap(J[3], J[4], J[5], J[3], J[4] - 0.05, J[5], 0.045, HC, 0, 0);
  }
}

// ---------------------------------------------------------------- pedestrians
const NPED = [44, 32, 22][LV];
const PD = new Float64Array(NPED * 16); // bi bj p off dir speed phase x z yaw mode timer | cross: sx sz ex ez
const PA = new Int32Array(NPED), PCI = new Int32Array(NPED * 2); // look; crossing target block
// ring of block (bi, bj) at inset off from the curb: writes RG = x0 z0 x1 z1
const RG = new Float64Array(4);
function ring(bi, bj, off) {
  RG[0] = lineP(bi, 0) + CWS[lineC(bi, 0)] / 2 + off; RG[2] = lineP(bi + 1, 0) - CWS[lineC(bi + 1, 0)] / 2 - off;
  RG[1] = lineP(bj, 1) + CWS[lineC(bj, 1)] / 2 + off; RG[3] = lineP(bj + 1, 1) - CWS[lineC(bj + 1, 1)] / 2 - off;
}
// position on the ring (counter-clockwise from the south-west corner) into RP = x z dx dz (walking direction +p)
const RP = new Float64Array(4);
function ringAt(p) {
  const lx = RG[2] - RG[0], lz = RG[3] - RG[1], P = 2 * (lx + lz);
  p = ((p % P) + P) % P;
  if (p < lx) { RP[0] = RG[0] + p; RP[1] = RG[1]; RP[2] = 1; RP[3] = 0; }
  else if (p < lx + lz) { RP[0] = RG[2]; RP[1] = RG[1] + p - lx; RP[2] = 0; RP[3] = 1; }
  else if (p < 2 * lx + lz) { RP[0] = RG[2] - (p - lx - lz); RP[1] = RG[3]; RP[2] = -1; RP[3] = 0; }
  else { RP[0] = RG[0]; RP[1] = RG[3] - (p - 2 * lx - lz); RP[2] = 0; RP[3] = -1; }
  return P;
}
// put pedestrian k on the sidewalk nearest to (x, z)
function pedPlace(k, x, z) {
  const o = k * 16, bi = cellOf(x, 0), bj = cellOf(z, 1), off = PD[o + 3];
  ring(bi, bj, off);
  const lx = RG[2] - RG[0], lz = RG[3] - RG[1];
  const cx = clamp(x, RG[0], RG[2]), cz = clamp(z, RG[1], RG[3]);
  const d0 = cz - RG[1], d1 = RG[2] - cx, d2 = RG[3] - cz, d3 = cx - RG[0], m = min(d0, d1, d2, d3);
  PD[o] = bi; PD[o + 1] = bj; PD[o + 10] = 0;
  PD[o + 2] = m === d0 ? cx - RG[0] : m === d1 ? lx + cz - RG[1] : m === d2 ? lx + lz + RG[2] - cx : 2 * lx + lz + RG[3] - cz;
}
function pedSpawn(k, px, pz, far) {
  const o = k * 16;
  PD[o + 3] = rr(0.9, 2.4); PD[o + 4] = rnd() < 0.5 ? 1 : -1; PD[o + 5] = rr(1.1, 1.6); PD[o + 6] = rnd() * 6;
  PA[k] = floor(rnd() * 15840);
  const a = rnd() * TAU, d = far ? rr(90, 150) : rr(8, 120);
  pedPlace(k, px + cos(a) * d, pz + sin(a) * d);
}
function initPeds(px, pz) { for (let k = 0; k < NPED; k++) pedSpawn(k, px, pz, 0); }

// mode 0 walking the ring, 1 waiting at a corner, 2 crossing, 3 dodging
function updatePeds(dt, t, px, pz, carHit) {
  for (let k = 0; k < NPED; k++) {
    const o = k * 16;
    if (hypot(PD[o + 7] - px, PD[o + 8] - pz) > 170 && PD[o + 10] !== 2) { pedSpawn(k, px, pz, 1); }
    let mode = PD[o + 10], sp = PD[o + 5];
    if (mode === 0) {
      ring(PD[o], PD[o + 1], PD[o + 3]);
      const lx = RG[2] - RG[0], lz = RG[3] - RG[1], P = 2 * (lx + lz);
      const p0 = PD[o + 2], p1 = p0 + PD[o + 4] * sp * dt;
      // passed a corner?
      const c0 = floor(cornerIx(p0, lx, lz, P)), c1 = floor(cornerIx(p1, lx, lz, P));
      PD[o + 2] = ((p1 % P) + P) % P;
      if (c0 !== c1 && rnd() < 0.45) {
        // cross the street straight ahead
        const corner = PD[o + 4] > 0 ? c1 : c0; // corner index 0 SW, 1 SE, 2 NE, 3 NW
        ringAt(p0 - PD[o + 4] * 0.01);
        const dx = RP[2] * PD[o + 4], dz = RP[3] * PD[o + 4]; // walking direction before the corner
        const ix = dx !== 0 ? 1 : 0;
        const ci = PD[o] + (corner === 1 || corner === 2 ? 1 : 0), cj = PD[o + 1] + (corner >= 2 ? 1 : 0);
        PCI[k * 2] = PD[o] + (ix ? sign(dx) : 0); PCI[k * 2 + 1] = PD[o + 1] + (ix ? 0 : sign(dz));
        const sx = corner === 0 || corner === 3 ? RG[0] : RG[2], sz = corner < 2 ? RG[1] : RG[3];
        const wdt = CWS[ix ? lineC(ci, 0) : lineC(cj, 1)] + 2 * PD[o + 3];
        PD[o + 12] = sx; PD[o + 13] = sz; PD[o + 14] = sx + (ix ? sign(dx) * wdt : 0); PD[o + 15] = sz + (ix ? 0 : sign(dz) * wdt);
        PD[o + 10] = 1; PD[o + 11] = 0; PD[o + 7] = sx; PD[o + 8] = sz;
        PD[o + 9] = atan2(PD[o + 15] - sz, PD[o + 14] - sx);
        pedCI[k] = ci; pedCJ[k] = cj; pedAX[k] = ix;
        continue;
      }
      ringAt(PD[o + 2]);
      PD[o + 7] = RP[0]; PD[o + 8] = RP[1];
      const ty = atan2(RP[3] * PD[o + 4], RP[2] * PD[o + 4]);
      let dyw = ty - PD[o + 9]; dyw -= TAU * round(dyw / TAU); PD[o + 9] += dyw * min(1, dt * 8);
      PD[o + 6] += sp * dt * 2.2;
    } else if (mode === 1) {
      // wait: at signals for the walk phase, elsewhere for a gap in traffic
      PD[o + 11] += dt;
      const ci = pedCI[k], cj = pedCJ[k], ax = pedAX[k];
      let go;
      if (ixType(lineC(ci, 0), lineC(cj, 1)) === 2) go = sigState(t, ci, cj, ax ? 1 : 0) === 2 && sigState(t, ci, cj, ax ? 0 : 1) === 0; // the crossed street's traffic is red
      else go = PD[o + 11] > 0.8 && !carNear((PD[o + 12] + PD[o + 14]) / 2, (PD[o + 13] + PD[o + 15]) / 2, 22);
      if (go) { PD[o + 10] = 2; PD[o + 11] = 0; }
    } else if (mode === 2) {
      const L = hypot(PD[o + 14] - PD[o + 12], PD[o + 15] - PD[o + 13]);
      PD[o + 11] += sp * 1.15 * dt / L;
      const f = min(PD[o + 11], 1);
      PD[o + 7] = mix(PD[o + 12], PD[o + 14], f); PD[o + 8] = mix(PD[o + 13], PD[o + 15], f);
      PD[o + 6] += sp * dt * 2.2;
      if (f >= 1) { PD[o] = PCI[k * 2]; PD[o + 1] = PCI[k * 2 + 1]; pedPlace(k, PD[o + 7], PD[o + 8]); PD[o + 10] = 0; }
    } else {
      PD[o + 11] -= dt; if (PD[o + 11] <= 0) pedPlace(k, PD[o + 7], PD[o + 8]);
    }
    // out of the way of fast cars (only on the sidewalk or crossing, never through walls: a short hop)
    if (PD[o + 10] !== 3 && carHit(PD[o + 7], PD[o + 8])) {
      PD[o + 10] = 3; PD[o + 11] = 0.7;
      PD[o + 7] += DGX; PD[o + 8] += DGZ;
    }
  }
}
const pedCI = new Int32Array(NPED), pedCJ = new Int32Array(NPED), pedAX = new Int32Array(NPED);
let DGX = 0, DGZ = 0; // dodge offset set by carHit
const cornerIx = (p, lx, lz, P) => { p = ((p % P) + P) % P; return p < lx ? 0 : p < lx + lz ? 1 : p < 2 * lx + lz ? 2 : 3; };
function drawPeds(ex, ey, ez, fx, fz) {
  for (let k = 0; k < NPED; k++) {
    const o = k * 16, x = PD[o + 7], z = PD[o + 8], d = hypot(x - ex, z - ez);
    if (d > 150 || ((x - ex) * fx + (z - ez) * fz < -3 && d > 4)) continue;
    const sp = PD[o + 10] === 1 ? 0 : PD[o + 5];
    const y = PD[o + 10] === 2 ? 0 : 0.15;
    human(x, y, z, PD[o + 9], PD[o + 6], sp, 0, PA[k], d > 55 ? 1 : 0, 0.94 + (PA[k] % 13) * 0.01);
    if (nDD < MAXDD) obox(DD, nDD++, x, y + 0.02, z, 0, 0.9, 0.04, 0.9, 0, 0, 0, 0, 9);
  }
}

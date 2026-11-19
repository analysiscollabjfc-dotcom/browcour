// ============================================================================
// procedural rooftop city: chunk generation, chunk streaming, collision and ray queries
// ============================================================================
// The whole world is axis-aligned boxes and ramps (a box whose top slopes along one axis). One box is 8 floats and
// the same array is both the collision data and the GPU instance buffer:
//   minx miny minz mat+seed | sx sy sz type      (mat: integer part, seed: fractional part; type 0 box, 1-4 ramp)
// Chunks are CH x CH metres, generated from their coordinates alone, and live in a fixed pool of slots
// (WIN x WIN around the player, toroidally indexed), so streaming never allocates.
const CH = 48, MAXB = 56, BF = 8;
const M_BUILD = 0, M_PROP = 1, M_ACCENT = 2, M_BRIDGE = 3, M_STREET = 4, M_GLASS = 5, M_BEAM = 6;
// ramp types: the top rises toward +x, -x, +z, -z
const T_XP = 1, T_XN = 2, T_ZP = 3, T_ZN = 4;

const WIN = 2 * R + 1, SLOTS = WIN * WIN;
const WB = new Float32Array(SLOTS * MAXB * BF);
const sCX = new Int32Array(SLOTS).fill(-0x40000000), sCZ = new Int32Array(SLOTS).fill(-0x40000000);
const sN = new Int32Array(SLOTS), sMaj = new Int32Array(SLOTS), sH = new Float32Array(SLOTS);
const sDirty = new Uint8Array(SLOTS);

// ---------------------------------------------------------------- generation
// generator output target (module state so the helpers below need no closures)
let gA = WB, gO = 0, gN = 0, gMaj = 0, gMaxH = 0;
const GT = new Float64Array(4); // best checkpoint spot: x, y, z, found
const LOT = new Float64Array(4 * 6); // x0 z0 x1 z1 h flags (1 = slanted roof)
const RES = new Float64Array(24 * 4); let nRes = 0; // rooftop rectangles reserved by ramps / towers

function add(x, y, z, sx, sy, sz, mat, type) {
  if (gN >= MAXB || sx < 0.05 || sy < 0.05 || sz < 0.05) return;
  const o = gO + gN++ * BF;
  gA[o] = x; gA[o + 1] = y; gA[o + 2] = z; gA[o + 3] = mat + rnd() * 0.999;
  gA[o + 4] = sx; gA[o + 5] = sy; gA[o + 6] = sz; gA[o + 7] = type;
  if (y + sy > gMaxH) gMaxH = y + sy;
}
function reserve(x0, z0, x1, z1) { if (nRes < 24) { const k = nRes++ * 4; RES[k] = x0; RES[k + 1] = z0; RES[k + 2] = x1; RES[k + 3] = z1; } }
function reserved(x0, z0, x1, z1) {
  for (let i = 0; i < nRes; i++) { const k = i * 4; if (x0 < RES[k + 2] && x1 > RES[k] && z0 < RES[k + 3] && z1 > RES[k + 1]) return true; }
  return false;
}
// a ramp on lot l against side sd (0:+x 1:-x 2:+z 3:-z), rising toward that side. `at` is its start along the side.
function edgeRamp(l, sd, len, wid, ht, at, mat) {
  const k = l * 6, h = LOT[k + 4];
  len = min(len, (sd < 2 ? LOT[k + 2] - LOT[k] : LOT[k + 3] - LOT[k + 1]) - 1.5);
  if (len < 3) return;
  let x, z, sx, sz, t;
  if (sd < 2) { sx = len; sz = wid; z = at; x = sd === 0 ? LOT[k + 2] - len : LOT[k]; t = sd === 0 ? T_XP : T_XN; }
  else { sx = wid; sz = len; x = at; z = sd === 2 ? LOT[k + 3] - len : LOT[k + 1]; t = sd === 2 ? T_ZP : T_ZN; }
  if (reserved(x - 0.5, z - 0.5, x + sx + 0.5, z + sz + 0.5)) return;
  add(x, h, z, sx, ht, sz, mat, t);
  reserve(x - 1, z - 1, x + sx + 1, z + sz + 1);
}
function setLot(i, x0, z0, x1, z1, h) { const k = i * 6; LOT[k] = x0; LOT[k + 1] = z0; LOT[k + 2] = x1; LOT[k + 3] = z1; LOT[k + 4] = h; LOT[k + 5] = 0; }

// lots a and b are neighbours along axis ax (b on the + side): ramps, bridges, wall-run panels and kickers between them
function connect(a, b, ax) {
  const ka = a * 6, kb = b * 6, ha = LOT[ka + 4], hb = LOT[kb + 4];
  const lo = min(ha, hb), hi = max(ha, hb), dh = hi - lo, low = ha < hb ? a : b, kl = low * 6;
  const gap = ax === 0 ? LOT[kb] - LOT[ka + 2] : LOT[kb + 1] - LOT[ka + 3];
  const o0 = ax === 0 ? max(LOT[ka + 1], LOT[kb + 1]) : max(LOT[ka], LOT[kb]);
  const o1 = ax === 0 ? min(LOT[ka + 3], LOT[kb + 3]) : min(LOT[ka + 2], LOT[kb + 2]);
  if (o1 - o0 < 6) return;
  // side of the low lot that faces the other lot
  const sd = ax === 0 ? (low === a ? 0 : 1) : (low === a ? 2 : 3);
  if (LOT[kl + 5]) return;
  if (gap < 0.5) {
    // touching buildings: a ramp up the step
    if (dh >= 1.5 && dh <= 9 && rnd() < 0.8) { const w = rr(3, 5); edgeRamp(low, sd, clamp(dh * 2.4, 4, 14), w, dh, rr(o0 + 0.5, o1 - 0.5 - w), M_ACCENT); }
    return;
  }
  const p = rnd();
  if (p < 0.35 && dh < 4) {
    // bridge at the lower roof height
    const w = 2.4, c = rr(o0 + 1, o1 - 1 - w);
    if (ax === 0) add(LOT[ka + 2] - 0.5, lo - 0.5, c, gap + 1, 0.5, w, M_BRIDGE, 0);
    else add(c, lo - 0.5, LOT[ka + 3] - 0.5, w, 0.5, gap + 1, M_BRIDGE, 0);
  } else if (p < 0.8 && gap >= 3) {
    // a wall-run panel across the gap, near one edge of the overlap
    const c = rnd() < 0.5 ? o0 + rr(0.3, 1.5) : o1 - rr(0.3, 1.5) - 0.5, y0 = lo - 7, y1 = hi + rr(2.5, 5);
    if (ax === 0) add(LOT[ka + 2] - 3, y0, c, gap + 6, y1 - y0, 0.5, M_ACCENT, 0);
    else add(c, y0, LOT[ka + 3] - 3, 0.5, y1 - y0, gap + 6, M_ACCENT, 0);
  }
  // kicker on the low roof, launching across the gap
  if (rnd() < 0.4) { const w = rr(3, 4.5); edgeRamp(low, sd, rr(4, 6.5), w, rr(1, 1.8), rr(o0 + 0.5, o1 - 0.5 - w), M_ACCENT); }
}

// writes chunk (cx, cz) to A at float offset o. Sets gN (boxes), gMaj (boxes drawn at a distance and in the shadow
// map: everything except small rooftop clutter) and GT (the chunk's best checkpoint spot).
function genChunk(cx, cz, A, o) {
  gA = A; gO = o; gN = 0; gMaxH = 0; nRes = 0; GT[1] = -1; GT[3] = 0;
  rseed(cx, cz, 11);
  const ax = cx * CH, az = cz * CH;
  add(ax, -1, az, CH, 1, CH, M_STREET, 0);
  let mx0 = rr(1.8, 4.2), mx1 = rr(1.8, 4.2), mz0 = rr(1.8, 4.2), mz1 = rr(1.8, 4.2);
  if (mod(cx, 6) === 0) mx0 += 7; // avenues every 6th street: a kicker, a dash or the grapple gets you across
  if (mod(cz, 6) === 0) mz0 += 7;
  const x0 = ax + mx0, x1 = ax + CH - mx1, z0 = az + mz0, z1 = az + CH - mz1;
  // city-scale height field, so neighbouring blocks form flowing routes; downtown where dn is high
  const hn = vnoise2(cx * 0.19 + 0.5, cz * 0.19 + 0.5), dn = vnoise2(cx * 0.055 + 9.3, cz * 0.055 + 2.1);
  let H = 10 + 14 * hn + 50 * dn * dn * hn;
  if (ihash(cx, cz, 3) < 0.07 && (cx | cz) !== 0) H = rr(4, 7); // low plaza block
  // split the block into 1, 2 or 4 lots
  const r = rnd(), g = rnd() < 0.2 ? 0 : rr(2.5, 6.5), wx = x1 - x0, wz = z1 - z0;
  let nl, sAx = 0;
  const lh = () => max(4, H + rr(-8, 8));
  if (r < 0.16) { setLot(0, x0, z0, x1, z1, lh()); nl = 1; }
  else if (r < 0.58) {
    nl = 2; const h0 = lh(); let h1 = lh();
    if (g === 0 && abs(h1 - h0) < 2) h1 = h0 + (rnd() < 0.5 ? -1 : 1) * rr(2.5, 6);
    if (wx >= wz) { const s = x0 + wx * rr(0.38, 0.62); setLot(0, x0, z0, s - g / 2, z1, h0); setLot(1, s + g / 2, z0, x1, z1, max(4, h1)); }
    else { sAx = 2; const s = z0 + wz * rr(0.38, 0.62); setLot(0, x0, z0, x1, s - g / 2, h0); setLot(1, x0, s + g / 2, x1, z1, max(4, h1)); }
  } else {
    nl = 4; const sx = x0 + wx * rr(0.4, 0.6), sz = z0 + wz * rr(0.4, 0.6), g2 = g / 2;
    setLot(0, x0, z0, sx - g2, sz - g2, lh()); setLot(1, sx + g2, z0, x1, sz - g2, lh());
    setLot(2, x0, sz + g2, sx - g2, z1, lh()); setLot(3, sx + g2, sz + g2, x1, z1, lh());
  }
  // buildings, slanted roofs and towers
  for (let i = 0; i < nl; i++) {
    const k = i * 6, lx0 = LOT[k], lz0 = LOT[k + 1], w = LOT[k + 2] - lx0, d = LOT[k + 3] - lz0, h = LOT[k + 4];
    const mat = ihash(cx * 4 + i, cz, 5) < 0.28 ? M_GLASS : M_BUILD;
    add(lx0, 0, lz0, w, h, d, mat, 0);
    let top = h;
    if (rnd() < 0.2 && min(w, d) > 9) {
      // slanted roof: a long slide
      const rh = rr(3, 8);
      add(lx0, h, lz0, w, rh, d, mat, 1 + floor(rnd() * 4));
      LOT[k + 5] = 1; top = h + rh * 0.5;
    } else if (rnd() < 0.16) {
      const tw = rr(2.5, 4), tx = rnd() < 0.5 ? lx0 + 1 : lx0 + w - 1 - tw, tz = rnd() < 0.5 ? lz0 + 1 : lz0 + d - 1 - tw;
      add(tx, h, tz, tw, rr(7, 18), tw, M_PROP, 0); reserve(tx - 1, tz - 1, tx + tw + 1, tz + tw + 1);
    }
    if (top > GT[1]) { GT[0] = lx0 + w / 2; GT[1] = top; GT[2] = lz0 + d / 2; GT[3] = 1; }
  }
  if (nl === 2) connect(0, 1, sAx);
  else if (nl === 4) { connect(0, 1, 0); connect(2, 3, 0); connect(0, 2, 2); connect(1, 3, 2); }
  // street-facing edges: kickers and billboards that stick out over the street (wall-run across)
  for (let i = 0; i < nl; i++) {
    const k = i * 6; if (LOT[k + 5]) continue;
    const h = LOT[k + 4];
    for (let sd = 0; sd < 4; sd++) {
      const out = sd === 0 ? LOT[k + 2] === x1 : sd === 1 ? LOT[k] === x0 : sd === 2 ? LOT[k + 3] === z1 : LOT[k + 1] === z0;
      if (!out) continue;
      const q = rnd(), a0 = sd < 2 ? LOT[k + 1] : LOT[k], a1 = sd < 2 ? LOT[k + 3] : LOT[k + 2];
      if (a1 - a0 < 8) continue;
      if (q < 0.18) { const w = rr(3, 4.5); edgeRamp(i, sd, rr(4.5, 7), w, rr(1.1, 2), rr(a0 + 1, a1 - 1 - w), M_ACCENT); }
      else if (q < 0.3) {
        const c = rr(a0 + 1, a1 - 1.5), y0 = h - 5, y1 = h + rr(3, 6);
        if (sd === 0) add(LOT[k + 2] - 2, y0, c, ax + CH - LOT[k + 2] + 2, y1 - y0, 0.5, M_ACCENT, 0);
        else if (sd === 1) add(ax, y0, c, LOT[k] - ax + 2, y1 - y0, 0.5, M_ACCENT, 0);
        else if (sd === 2) add(c, y0, LOT[k + 3] - 2, 0.5, y1 - y0, az + CH - LOT[k + 3] + 2, M_ACCENT, 0);
        else add(c, y0, az, 0.5, y1 - y0, LOT[k + 1] - az + 2, M_ACCENT, 0);
      }
    }
  }
  // small rooftop clutter: AC units and parapets to vault over (skipped at a distance and in the shadow map)
  gMaj = gN;
  for (let i = 0; i < nl; i++) {
    const k = i * 6; if (LOT[k + 5]) continue;
    const lx0 = LOT[k], lz0 = LOT[k + 1], lx1 = LOT[k + 2], lz1 = LOT[k + 3], h = LOT[k + 4], mx = (lx0 + lx1) / 2, mz = (lz0 + lz1) / 2;
    const n = floor(rr(0, 3.99));
    for (let j = 0; j < n; j++) {
      const sx = rr(1.4, 3.2), sz = rr(1.4, 3.2), x = rr(lx0 + 1.5, lx1 - 1.5 - sx), z = rr(lz0 + 1.5, lz1 - 1.5 - sz);
      if (x + sx < lx0 || z + sz < lz0) continue;
      if (abs(x + sx / 2 - mx) < 4 && abs(z + sz / 2 - mz) < 4) continue; // keep the checkpoint spot clear
      if (reserved(x, z, x + sx, z + sz)) continue;
      add(x, h, z, sx, rr(0.7, 2), sz, M_PROP, 0); reserve(x - 0.8, z - 0.8, x + sx + 0.8, z + sz + 0.8);
    }
    if (rnd() < 0.3 && lx1 - lx0 > 8 && lz1 - lz0 > 8) {
      const sd = floor(rnd() * 4);
      let x = lx0 + 2, z = lz0 + 2, sx = 0.35, sz = 0.35;
      if (sd < 2) { sz = lz1 - lz0 - 4; x = sd === 0 ? lx1 - 0.6 : lx0 + 0.25; } else { sx = lx1 - lx0 - 4; z = sd === 2 ? lz1 - 0.6 : lz0 + 0.25; }
      if (!reserved(x, z, x + sx, z + sz)) add(x, h, z, sx, 1.05, sz, M_PROP, 0);
    }
  }
}

// ---------------------------------------------------------------- streaming
let ctrCX = 0x3fffffff, ctrCZ = 0x3fffffff;
const slotAt = (cx, cz) => { const s = mod(cx, WIN) + WIN * mod(cz, WIN); return sCX[s] === cx && sCZ[s] === cz ? s : -1; };
// loads the chunks around (px, pz) that are not loaded yet; returns how many were generated
function stream(px, pz) {
  const ccx = floor(px / CH), ccz = floor(pz / CH);
  if (ccx === ctrCX && ccz === ctrCZ) return 0;
  ctrCX = ccx; ctrCZ = ccz;
  let n = 0;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const cx = ccx + dx, cz = ccz + dz, s = mod(cx, WIN) + WIN * mod(cz, WIN);
    if (sCX[s] === cx && sCZ[s] === cz) continue;
    genChunk(cx, cz, WB, s * MAXB * BF);
    sCX[s] = cx; sCZ[s] = cz; sN[s] = gN; sMaj[s] = gMaj; sH[s] = gMaxH; sDirty[s] = 1; n++;
  }
  return n;
}

// ---------------------------------------------------------------- queries
// top surface height of box o at (x, z) (ramps slope; the point is clamped into the footprint)
function topAt(o, x, z) {
  const t = WB[o + 7], y0 = WB[o + 1], sy = WB[o + 5];
  if (t === 0) return y0 + sy;
  let f;
  if (t < 3) { f = (x - WB[o]) / WB[o + 4]; if (t === T_XN) f = 1 - f; }
  else { f = (z - WB[o + 2]) / WB[o + 6]; if (t === T_ZN) f = 1 - f; }
  return y0 + sy * clamp(f, 0, 1);
}
// surface normal of the top of box o
const NRM = new Float64Array(3);
function topNormal(o) {
  const t = WB[o + 7], sx = WB[o + 4], sy = WB[o + 5], sz = WB[o + 6];
  let x = 0, y = 1, z = 0;
  if (t === T_XP) { x = -sy; y = sx; } else if (t === T_XN) { x = sy; y = sx; }
  else if (t === T_ZP) { z = -sy; y = sz; } else if (t === T_ZN) { z = sy; y = sz; }
  const l = hypot(x, y, z); NRM[0] = x / l; NRM[1] = y / l; NRM[2] = z / l;
}
// broad phase: offsets of all boxes touching an AABB, into CAND
const CAND = new Int32Array(1024); let NC = 0;
function gather(x0, y0, z0, x1, y1, z1) {
  NC = 0;
  const cx0 = floor(x0 / CH), cx1 = floor(x1 / CH), cz0 = floor(z0 / CH), cz1 = floor(z1 / CH);
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
    const s = slotAt(cx, cz); if (s < 0) continue;
    const base = s * MAXB * BF, n = sN[s];
    for (let k = 0; k < n; k++) {
      const o = base + k * BF;
      if (WB[o] > x1 || WB[o] + WB[o + 4] < x0 || WB[o + 1] > y1 || WB[o + 1] + WB[o + 5] < y0 || WB[o + 2] > z1 || WB[o + 2] + WB[o + 6] < z0) continue;
      if (NC < 1024) CAND[NC++] = o;
    }
  }
}
// ray vs the loaded city (ramps count as boxes, streets are skipped). Returns the distance or -1; RH = hit point, normal.
const RH = new Float64Array(6);
function slab(ox, oy, oz, ix, iy, iz, x0, y0, z0, x1, y1, z1) {
  let a = (x0 - ox) * ix, b = (x1 - ox) * ix, tn = min(a, b), tf = max(a, b);
  a = (y0 - oy) * iy; b = (y1 - oy) * iy; tn = max(tn, min(a, b)); tf = min(tf, max(a, b));
  a = (z0 - oz) * iz; b = (z1 - oz) * iz; tn = max(tn, min(a, b)); tf = min(tf, max(a, b));
  return tf >= max(tn, 0) ? max(tn, 0) : 1e30;
}
function raycast(ox, oy, oz, dx, dy, dz, maxT) {
  const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
  let best = maxT, hit = -1;
  for (let s = 0; s < SLOTS; s++) {
    if (sCX[s] < -0x3fffffff) continue;
    const bx = sCX[s] * CH, bz = sCZ[s] * CH;
    if (slab(ox, oy, oz, ix, iy, iz, bx, 0, bz, bx + CH, sH[s], bz + CH) >= best) continue;
    const base = s * MAXB * BF, n = sN[s];
    for (let k = 1; k < n; k++) { // box 0 is the street
      const o = base + k * BF;
      const t = slab(ox, oy, oz, ix, iy, iz, WB[o], WB[o + 1], WB[o + 2], WB[o] + WB[o + 4], WB[o + 1] + WB[o + 5], WB[o + 2] + WB[o + 6]);
      if (t < best) { best = t; hit = o; }
    }
  }
  if (hit < 0) return -1;
  const px = ox + dx * best, py = oy + dy * best, pz = oz + dz * best;
  RH[0] = px; RH[1] = py; RH[2] = pz;
  // face normal: the face the point is closest to
  let d = abs(px - WB[hit]), nx = -1, ny = 0, nz = 0, e;
  if ((e = abs(px - WB[hit] - WB[hit + 4])) < d) { d = e; nx = 1; ny = 0; nz = 0; }
  if ((e = abs(py - WB[hit + 1] - WB[hit + 5])) < d) { d = e; nx = 0; ny = 1; nz = 0; }
  if ((e = abs(py - WB[hit + 1])) < d) { d = e; nx = 0; ny = -1; nz = 0; }
  if ((e = abs(pz - WB[hit + 2])) < d) { d = e; nx = 0; ny = 0; nz = -1; }
  if ((e = abs(pz - WB[hit + 2] - WB[hit + 6])) < d) { nx = 0; ny = 0; nz = 1; }
  RH[3] = nx; RH[4] = ny; RH[5] = nz;
  return best;
}

// ============================================================================
// Browcity layout: an endless European street grid, block generation, streaming and collision queries
// ============================================================================
// Streets run on two families of lines: x = lineX(i) (streets along z) and z = lineZ(j) (streets along x), about
// BS apart with a seeded jitter, each with a class: residential, main street or boulevard. The same functions exist
// in WGSL, so road markings, crossings and street-lamp light are drawn by the shader without any geometry.
// A block is the cell between four street centre lines: it owns the half-streets around it, its sidewalks, and
// what stands on them. Static geometry per block lives in fixed slots (toroidal index), like Browcour's chunks.
const BS = 112, BJIT = 36;
const CWS = [11, 14, 26], SWS = [3.5, 4.5, 6]; // curb-to-curb width, sidewalk width: residential, main, boulevard
const SPEED = [11, 13.5, 16.5];               // traffic speed limit (m/s) per class
const lineP = (i, a) => i * BS + (ihash(i, 1 + a * 2, 77) - 0.5) * BJIT;
const lineC = (i, a) => { const h = ihash(i, 2 + a * 2, 77); return h < 0.14 ? 2 : h < 0.5 ? 1 : 0; };
// index of the cell containing v on axis a (lines i and i + 1 bound it)
function cellOf(v, a) { let i = floor(v / BS); while (v < lineP(i, a)) i--; while (v >= lineP(i + 1, a)) i++; return i; }
// lane centre offset from the street centre line (lane 0 inner, 1 outer on boulevards)
const laneOff = (c, k) => (c === 2 ? (k ? 7.25 : 3.75) : c === 1 ? 1.75 : 1.6);
// traffic signals: a 40 s cycle; group 0 = traffic along z (on x-lines), group 1 = along x. 0 red, 1 yellow, 2 green
const sigOff = (i, j) => ihash(i, j, 9) * 40;
function sigState(t, i, j, grp) {
  let p = (t + sigOff(i, j)) % 40; if (grp) p = (p + 20) % 40;
  return p < 16 ? 2 : p < 19 ? 1 : 0;
}
// intersection control: 2 signals, 1 the minor street stops, 0 all-way stop
const ixType = (ci, cj) => (max(ci, cj) === 2 || (ci >= 1 && cj >= 1) ? 2 : ci === cj ? 0 : 1);
// does traffic on axis a (0 = along z) have to stop at intersection (i, j)?
const mustStop = (ci, cj, a) => { const t = ixType(ci, cj); return t === 0 || (t === 1 && (a === 0 ? ci < cj : cj < ci)); };

// ---------------------------------------------------------------- materials
const M_ASPH = 0, M_PAVE = 1, M_GRASS = 2, M_PLAZA = 3, M_WATER = 4, M_WOOD = 5, M_HEDGE = 6, M_STOP = 7, M_STONE = 8;
const S_TIMBER = 10, S_BAROQUE = 11, S_GRUND = 12, S_BRICK = 13, S_PANEL = 14, S_GLASS = 15, S_CHURCH = 16;
const R_TILE = 20, R_SLATE = 21;
// box types: 0 box, 5 gable (ridge along x), 6 gable (ridge along z), 7 hip (x), 8 hip (z), 9 pyramid
// style: storeys min/max, ground floor, floor height, facade width min/max, pitched roof chance, roof material
const STY = {
  10: [2, 4, 3.0, 2.8, 6, 11, 1, R_TILE], 11: [3, 5, 4.2, 3.6, 10, 18, 0.85, R_TILE], 12: [4, 6, 4.5, 3.7, 12, 22, 0.8, R_SLATE],
  13: [3, 5, 4.0, 3.4, 10, 20, 0.4, R_TILE], 14: [5, 10, 3.0, 2.8, 26, 60, 0, 0], 15: [4, 9, 4.5, 3.6, 16, 36, 0, 0],
};
// districts: old town in the centre, a 19th-century ring, then post-war and modern outskirts
function pickStyle(cx, cz, h) {
  const d = hypot(cx, cz) / BS + (vnoise2(cx * 0.004, cz * 0.004) - 0.5) * 3;
  if (d < 3.2) return h < 0.42 ? S_TIMBER : h < 0.9 ? S_BAROQUE : S_GRUND;
  if (d < 7.5) return h < 0.55 ? S_GRUND : h < 0.72 ? S_BAROQUE : h < 0.88 ? S_BRICK : S_GLASS;
  return h < 0.38 ? S_PANEL : h < 0.62 ? S_BRICK : h < 0.82 ? S_GLASS : S_GRUND;
}

// ---------------------------------------------------------------- slots
const MAXB = 72, BF = 8, MAXC = 340, MAXP = 40, MAXR = 120;
const WIN = 2 * R + 1, SLOTS = WIN * WIN;
const WB = new Float32Array(SLOTS * MAXB * BF);        // boxes: minx miny minz mat+seed | sx sy sz type
const CB = new Float32Array(SLOTS * MAXC * CF);        // static capsules: trees, lamps, signals, parked-car wheels
const PB = new Float32Array(SLOTS * MAXP * 3 * OF);    // parked cars: 3 oriented boxes each
const PK = new Float32Array(SLOTS * MAXP * 8);         // parked cars: x z yaw type paint present wheelCap boxCount
const RC = new Float32Array(SLOTS * MAXR * 3);         // collision circles (poles, trunks): x z r
const sI = new Int32Array(SLOTS).fill(-0x40000000), sJ = new Int32Array(SLOTS).fill(-0x40000000);
const sN = new Int32Array(SLOTS), sMaj = new Int32Array(SLOTS), sC = new Int32Array(SLOTS), sCMaj = new Int32Array(SLOTS);
const sP = new Int32Array(SLOTS), sR = new Int32Array(SLOTS), sH = new Float32Array(SLOTS);
const sX0 = new Float32Array(SLOTS), sX1 = new Float32Array(SLOTS), sZ0 = new Float32Array(SLOTS), sZ1 = new Float32Array(SLOTS);
const sDirty = new Uint8Array(SLOTS);

// generator state (module level: no closures)
let gS = 0, gN = 0, gC = 0, gP = 0, gR = 0, gMaxH = 0;
const RES = new Float64Array(64 * 4); let nRes = 0;
function add(x, y, z, sx, sy, sz, mat, type, seed) {
  if (gN >= MAXB || sx < 0.02 || sy < 0.02 || sz < 0.02) return;
  const o = (gS * MAXB + gN++) * BF;
  WB[o] = x; WB[o + 1] = y; WB[o + 2] = z; WB[o + 3] = mat + (seed === undefined ? rnd() * 0.999 : seed);
  WB[o + 4] = sx; WB[o + 5] = sy; WB[o + 6] = sz; WB[o + 7] = type;
  if (y + sy > gMaxH) gMaxH = y + sy;
}
function capS(ax, ay, az, bx, by, bz, r, cr, cg, cb, k) { if (gC < MAXC) capw(CB, gS * MAXC + gC++, ax, ay, az, bx, by, bz, r, cr, cg, cb, k); if (ay > gMaxH) gMaxH = ay; }
function circ(x, z, r) { if (gR >= MAXR) return; const o = (gS * MAXR + gR++) * 3; RC[o] = x; RC[o + 1] = z; RC[o + 2] = r; }
function reserve(x0, z0, x1, z1) { if (nRes < 64) { const k = nRes++ * 4; RES[k] = x0; RES[k + 1] = z0; RES[k + 2] = x1; RES[k + 3] = z1; } }
function reserved(x0, z0, x1, z1) {
  for (let i = 0; i < nRes; i++) { const k = i * 4; if (x0 < RES[k + 2] && x1 > RES[k] && z0 < RES[k + 3] && z1 > RES[k + 1]) return true; }
  return false;
}
function tree(x, z, y, big) {
  const h = rr(6, 10) * (big ? 1.35 : 1), r = h * rr(0.24, 0.3), g = rnd();
  const cr = 0.07 + g * 0.06, cg = 0.16 + g * 0.08, cb = 0.04 + g * 0.03;
  capS(x, y + h * 0.55, z, x, y + h * 0.62, z, r, cr, cg, cb, 6);
  capS(x + r * 0.45, y + h * 0.75, z - r * 0.2, x + r * 0.3, y + h * 0.8, z - r * 0.25, r * 0.72, cr * 1.1, cg * 1.08, cb, 6);
  capS(x, y, z, x, y + h * 0.55, z, 0.17 * (big ? 1.3 : 1), 0.12, 0.08, 0.05, 0);
  circ(x, z, 0.3);
}

// ---------------------------------------------------------------- one perimeter side of buildings
// facade along axis ax (0 = along x) from u0 to u1, facade line at v, building depth goes in direction dv (+1/-1)
function side(ax, u0, u1, v, dv, D, cx, cz, shop, corner0, corner1) {
  let u = u0;
  while (u < u1 - 0.5) {
    const st = pickStyle(cx, cz, rnd()), S = STY[st];
    let w = rr(S[4], S[5]);
    if (u1 - (u + w) < S[4] * 0.7) w = u1 - u;
    const n = floor(rr(S[0], S[1] + 0.99)), h = S[2] + (n - 1) * S[3];
    const sh = shop && st !== S_PANEL && st !== S_TIMBER && rnd() < 0.8 ? 0.5 : 0;
    const x = ax === 0 ? u : dv > 0 ? v : v - D, z = ax === 0 ? (dv > 0 ? v : v - D) : u;
    const sx = ax === 0 ? w : D, sz = ax === 0 ? D : w;
    add(x, 0.15, z, sx, h, sz, st, 0, sh + rnd() * 0.49);
    if (rnd() < S[6]) {
      // pitched roof, ridge parallel to the street, hipped on corners; a small eave overhang
      const hip = (u === u0 && corner0) || (u + w >= u1 - 0.01 && corner1) || st === S_GRUND;
      const rh = D * (st === S_TIMBER ? 0.55 : st === S_GRUND ? 0.36 : 0.42);
      const t = ax === 0 ? (hip ? 7 : 5) : (hip ? 8 : 6);
      add(x - 0.3, 0.15 + h, z - 0.3, sx + 0.6, rh, sz + 0.6, S[7] || R_TILE, t);
    }
    u += w;
  }
}

// ---------------------------------------------------------------- the block (i, j)
function genBlock(i, j, s) {
  gS = s; gN = 0; gC = 0; gP = 0; gR = 0; gMaxH = 0; nRes = 0;
  rseed(i, j, 5);
  const x0 = lineP(i, 0), x1 = lineP(i + 1, 0), z0 = lineP(j, 1), z1 = lineP(j + 1, 1);
  const ci0 = lineC(i, 0), ci1 = lineC(i + 1, 0), cj0 = lineC(j, 1), cj1 = lineC(j + 1, 1);
  const cx0 = x0 + CWS[ci0] / 2, cx1 = x1 - CWS[ci1] / 2, cz0 = z0 + CWS[cj0] / 2, cz1 = z1 - CWS[cj1] / 2; // curbs
  const fx0 = cx0 + SWS[ci0], fx1 = cx1 - SWS[ci1], fz0 = cz0 + SWS[cj0], fz1 = cz1 - SWS[cj1];      // facades
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  sX0[s] = x0; sX1[s] = x1; sZ0[s] = z0; sZ1[s] = z1;
  // ground: asphalt cell (top 0), the raised block plate (top 0.15), boulevard median halves
  add(x0, -0.2, z0, x1 - x0, 0.2, z1 - z0, M_ASPH, 0);
  const h = ihash(i, j, 5), d = hypot(mx, mz) / BS;
  const kind = (i === 0 && j === 0) ? 2 : h < 0.1 ? 1 : h < 0.17 && d < 6 ? 2 : h < 0.27 && d > 6 ? 3 : 0; // 0 perimeter, 1 park, 2 square, 3 towers
  add(cx0, 0, cz0, cx1 - cx0, 0.15, cz1 - cz0, kind === 2 ? M_PLAZA : M_PAVE, 0);
  if (ci0 === 2) add(x0, 0, cz0, 2, 0.15, cz1 - cz0, M_GRASS, 0);
  if (ci1 === 2) add(x1 - 2, 0, cz0, 2, 0.15, cz1 - cz0, M_GRASS, 0);
  if (cj0 === 2) add(cx0, 0, z0, cx1 - cx0, 0.15, 2, M_GRASS, 0);
  if (cj1 === 2) add(cx0, 0, z1 - 2, cx1 - cx0, 0.15, 2, M_GRASS, 0);
  // boulevard median trees (owned by the block on the + side of the line)
  if (ci0 === 2) for (let z = cz0 + 6; z < cz1 - 5; z += 11) tree(x0 + 1, z, 0.15, 0);
  if (cj0 === 2) for (let x = cx0 + 6; x < cx1 - 5; x += 11) tree(x, z0 + 1, 0.15, 0);

  if (kind === 0 || kind === 3) {
    if (kind === 0) {
      const D = rr(11, 15);
      if (fx1 - fx0 < 2 * D + 6 || fz1 - fz0 < 2 * D + 6) {
        const st = pickStyle(mx, mz, rnd()), S = STY[st], n = floor(rr(S[0], S[1] + 0.99));
        add(fx0, 0.15, fz0, fx1 - fx0, S[2] + (n - 1) * S[3], fz1 - fz0, st, 0);
      } else {
        side(0, fx0, fx1, fz0, 1, D, mx, mz, cj0 > 0, 1, 1);          // south
        side(0, fx0, fx1, fz1, -1, D, mx, mz, cj1 > 0, 1, 1);         // north
        side(2, fz0 + D, fz1 - D, fx0, 1, D, mx, mz, ci0 > 0, 0, 0);  // west
        side(2, fz0 + D, fz1 - D, fx1, -1, D, mx, mz, ci1 > 0, 0, 0); // east
        // courtyard trees
        for (let k = 0; k < 3; k++) if (rnd() < 0.6) tree(rr(fx0 + D + 3, fx1 - D - 3), rr(fz0 + D + 3, fz1 - D - 3), 0.15, 0);
      }
    } else {
      // post-war towers on open ground
      for (let k = 0; k < 2; k++) {
        const w = rr(16, 26), dd = rr(14, 20), x = k ? fx1 - w - rr(2, 8) : fx0 + rr(2, 8), z = k ? fz0 + rr(2, 10) : fz1 - dd - rr(2, 10);
        const st = rnd() < 0.6 ? S_PANEL : S_GLASS;
        add(x, 0.15, z, w, 3 + floor(rr(10, 16)) * 2.9, dd, st, 0);
        reserve(x - 3, z - 3, x + w + 3, z + dd + 3);
      }
      for (let k = 0; k < 6; k++) { const x = rr(fx0 + 3, fx1 - 3), z = rr(fz0 + 3, fz1 - 3); if (!reserved(x - 3, z - 3, x + 3, z + 3)) tree(x, z, 0.15, 0); }
    }
  } else if (kind === 1) {
    // park: four lawns split by two paths, trees, a pond, benches by the paths
    const gx0 = fx0 - 1, gx1 = fx1 + 1, gz0 = fz0 - 1, gz1 = fz1 + 1, pw = 2.2;
    const px = rr(mx - 8, mx + 8), pz = rr(mz - 8, mz + 8);
    add(gx0, 0.15, gz0, px - pw - gx0, 0.06, pz - pw - gz0, M_GRASS, 0);
    add(px + pw, 0.15, gz0, gx1 - px - pw, 0.06, pz - pw - gz0, M_GRASS, 0);
    add(gx0, 0.15, pz + pw, px - pw - gx0, 0.06, gz1 - pz - pw, M_GRASS, 0);
    add(px + pw, 0.15, pz + pw, gx1 - px - pw, 0.06, gz1 - pz - pw, M_GRASS, 0);
    const q = floor(rnd() * 4), qx0 = q & 1 ? px + pw : gx0, qx1 = q & 1 ? gx1 : px - pw, qz0 = q & 2 ? pz + pw : gz0, qz1 = q & 2 ? gz1 : pz - pw;
    const pr = min(qx1 - qx0, qz1 - qz0) * 0.32;
    if (pr > 4) {
      const ox = (qx0 + qx1) / 2, oz = (qz0 + qz1) / 2;
      add(ox - pr, 0.15, oz - pr * 0.8, pr * 2, 0.08, pr * 1.6, M_WATER, 0);
      add(ox - pr - 0.4, 0.15, oz - pr * 0.8 - 0.4, pr * 2 + 0.8, 0.25, 0.4, M_STONE, 0);
      add(ox - pr - 0.4, 0.15, oz + pr * 0.8, pr * 2 + 0.8, 0.25, 0.4, M_STONE, 0);
      add(ox - pr - 0.4, 0.15, oz - pr * 0.8, 0.4, 0.25, pr * 1.6, M_STONE, 0);
      add(ox + pr, 0.15, oz - pr * 0.8, 0.4, 0.25, pr * 1.6, M_STONE, 0);
      reserve(ox - pr - 3, oz - pr - 3, ox + pr + 3, oz + pr + 3);
    }
    for (let k = 0; k < 4; k++) {
      // benches along the paths, facing them
      const along = k < 2, bx = along ? rr(gx0 + 6, gx1 - 8) : px + (k & 1 ? pw + 0.4 : -pw - 0.9), bz = along ? pz + (k & 1 ? pw + 0.4 : -pw - 0.9) : rr(gz0 + 6, gz1 - 8);
      if (along) { add(bx, 0.15, bz, 1.8, 0.45, 0.5, M_WOOD, 0); } else { add(bx, 0.15, bz, 0.5, 0.45, 1.8, M_WOOD, 0); }
    }
    for (let k = 0; k < 34; k++) {
      const x = rr(gx0 + 2, gx1 - 2), z = rr(gz0 + 2, gz1 - 2);
      if (abs(x - px) < pw + 2.5 || abs(z - pz) < pw + 2.5 || reserved(x - 2, z - 2, x + 2, z + 2)) continue;
      tree(x, z, 0.21, rnd() < 0.3); reserve(x - 3, z - 3, x + 3, z + 3);
    }
  } else {
    // square: a church on one side, a fountain in the middle, trees and benches
    const w = 14, L = 30, cw2 = mx - w / 2, cz = fz1 - L - 2;
    add(cw2, 0.15, cz, w, 15, L, S_CHURCH, 0);
    add(cw2 - 0.4, 15.15, cz - 0.4, w + 0.8, 9, L + 0.8, R_SLATE, 6);
    add(mx - 4, 0.15, cz - 7, 8, 30, 8, S_CHURCH, 0);
    add(mx - 4.3, 30.15, cz - 7.3, 8.6, 18, 8.6, R_SLATE, 9);
    const fx = mx, fz = cz - 26;
    add(fx - 4.5, 0.15, fz - 4.5, 9, 0.6, 0.6, M_STONE, 0); add(fx - 4.5, 0.15, fz + 3.9, 9, 0.6, 0.6, M_STONE, 0);
    add(fx - 4.5, 0.15, fz - 3.9, 0.6, 0.6, 7.8, M_STONE, 0); add(fx + 3.9, 0.15, fz - 3.9, 0.6, 0.6, 7.8, M_STONE, 0);
    add(fx - 3.9, 0.15, fz - 3.9, 7.8, 0.4, 7.8, M_WATER, 0);
    capS(fx, 0.5, fz, fx, 2.6, fz, 0.35, 0.55, 0.52, 0.48, 0);
    capS(fx, 3.1, fz, fx, 3.1, fz, 0.55, 0.55, 0.52, 0.48, 0);
    circ(fx, fz, 4.6);
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; tree(fx + cos(a) * 17, fz + sin(a) * 13, 0.15, 0); }
    // houses on the other sides of the square
    const D = 13;
    side(0, fx0, fx1, fz0, 1, D, mx, mz, 1, 1, 1);
    side(2, fz0 + D, fz1, fx0, 1, D, mx, mz, 1, 0, 0);
    side(2, fz0 + D, fz1, fx1, -1, D, mx, mz, 1, 0, 0);
  }

  // ---- street furniture on the block's four sidewalks
  for (let pass = 0; pass < 2; pass++) {
    if (pass) gCMajor();
    furnish(0, i, ci0, cz0, cz1, cx0, 1, x0, pass);   // west side: line i, the block is on its + side
    furnish(0, i + 1, ci1, cz0, cz1, cx1, -1, x1, pass);
    furnish(1, j, cj0, cx0, cx1, cz0, 1, z0, pass);
    furnish(1, j + 1, cj1, cx0, cx1, cz1, -1, z1, pass);
  }
  // ---- the intersection at the block's south-west corner (x0, z0): signals or stop signs
  const it = ixType(ci0, cj0), hx = CWS[ci0] / 2 + 0.6, hz = CWS[cj0] / 2 + 0.6, off = sigOff(i, j);
  // corner c serves the approach that drives on its side (right-hand traffic): SW +z, SE -x, NE -z, NW +x
  for (let c = 0; c < 4; c++) {
    const sxg = c === 1 || c === 2 ? 1 : -1, szg = c >= 2 ? 1 : -1;
    const px = x0 + sxg * hx, pz = z0 + szg * hz, grp = c === 0 || c === 2 ? 0 : 1;
    const ax = grp; // traffic axis of the approach: 0 along z
    if (it === 2) {
      // signal pole with a three-light head facing the approaching traffic
      capS(px, 0.15, pz, px, 3.4, pz, 0.08, 0.08, 0.09, 0.1, 0);
      const fdx = ax === 1 ? -sxg * 0.16 : 0, fdz = ax === 0 ? -szg * 0.16 : 0;
      capS(px + fdx * 0.5, 2.55, pz + fdz * 0.5, px + fdx * 0.5, 3.35, pz + fdz * 0.5, 0.16, 0.05, 0.05, 0.05, 0);
      for (let b = 0; b < 3; b++) capS(px + fdx, 3.2 - b * 0.28, pz + fdz, px + fdx, 3.2 - b * 0.28, pz + fdz, 0.1, grp, b, off, 5); // red, yellow, green
      circ(px, pz, 0.15);
    } else if (mustStop(ci0, cj0, ax)) {
      capS(px, 0.15, pz, px, 2.4, pz, 0.05, 0.6, 0.6, 0.62, 0);
      const fx = ax === 1 ? -sxg : 0, fz = ax === 0 ? -szg : 0;
      // the sign is a thin box facing the approach
      if (ax === 0) add(px - 0.38, 2.0, pz + fz * 0.06 - 0.02, 0.76, 0.76, 0.04, M_STOP, 0);
      else add(px + fx * 0.06 - 0.02, 2.0, pz - 0.38, 0.04, 0.76, 0.76, M_STOP, 0);
      circ(px, pz, 0.1);
    }
  }
  sN[s] = gN; sC[s] = gC; sP[s] = gP; sR[s] = gR; sH[s] = gMaxH;
}
let gCm = 0;
function gCMajor() { gCm = gC; } // trees above are drawn far away; lamps, signs and wheels below only up close

// lamps, street trees and parked cars along one side of a block: street line k on axis a (0 = line x = const),
// running from u0 to u1 along the street, curb at v, block on side sd (+1: the block is on the + side of the line)
function furnish(a, k, c, u0, u1, v, sd, line, pass) {
  const off = ihash(k, 6 + a, 77) * 25 + (sd < 0 ? 12.5 : 0), hw = CWS[c] / 2 - 0.2;
  for (let u = floor((u0 - off) / 25) * 25 + off; u < u1; u += 25) {
    if (u < u0 + 2) continue;
    // no lamp inside an intersection zone (the shader skips the same lamps)
    const cl = cellOf(u, 1 - a), n0 = lineP(cl, 1 - a), n1 = lineP(cl + 1, 1 - a);
    const near = abs(u - n0) < abs(u - n1) ? cl : cl + 1;
    if (abs(u - lineP(near, 1 - a)) < CWS[lineC(near, 1 - a)] / 2 + 6) continue;
    if (pass === 0) {
      // street trees between lamps on main streets and boulevards (first pass: they are seen from afar)
      const tu = u + 12.5;
      if (c > 0 && tu < u1 - 8) tree(a === 0 ? v + sd * 1.3 : tu, a === 0 ? tu : v + sd * 1.3, 0.15, 0);
      continue;
    }
    const px = a === 0 ? v + sd * 0.6 : u, pz = a === 0 ? u : v + sd * 0.6;
    const hx = a === 0 ? line + sd * hw : u, hz = a === 0 ? u : line + sd * hw;
    capS(px, 0.15, pz, px, 5.6, pz, 0.07, 0.07, 0.075, 0.08, 1);
    capS(px, 5.6, pz, hx, 5.75, hz, 0.04, 0.07, 0.075, 0.08, 1);
    capS(hx, 5.62, hz, hx, 5.62, hz, 0.2, 1, 0.8, 0.55, 4);
    circ(px, pz, 0.12);
  }
  // parked cars in the parking lane, nose in the direction of travel of that side
  if (pass === 0) return;
  const lane = CWS[c] / 2 - (c === 2 ? 3.3 : 1.2);
  for (let u = u0 + 9; u < u1 - 12 && gP < MAXP; u += rr(5.6, 8)) {
    if (rnd() > 0.55) continue;
    const t = pickType(rnd() * 0.88 + (rnd() < 0.1 ? 0.12 : 0)); if (t === 6) continue;
    const L = CT[t][0];
    const px = a === 0 ? line + sd * lane : u + L / 2, pz = a === 0 ? u + L / 2 : line + sd * lane;
    // right-hand traffic: on the + side of an x-line cars face -z; on the + side of a z-line they face +x
    const yaw = a === 0 ? (sd > 0 ? -PI / 2 : PI / 2) : (sd > 0 ? 0 : PI);
    const p = floor(rnd() * NPAINT), o = (gS * MAXP + gP) * 8;
    carModel(t, p, px, 0, pz, yaw, PB, (gS * MAXP + gP) * 3, CB, gS * MAXC + gC, 0, gC + 4 <= MAXC);
    PK[o] = px; PK[o + 1] = pz; PK[o + 2] = yaw; PK[o + 3] = t; PK[o + 4] = p; PK[o + 5] = 1; PK[o + 6] = gC; PK[o + 7] = oN;
    for (let q = oN; q < 3; q++) PB[((gS * MAXP + gP) * 3 + q) * OF + 4] = 0; // unused box slots: zero size
    gC += cN; gP++;
    u += L;
  }
}

// ---------------------------------------------------------------- streaming
let ctrI = 0x3fffffff, ctrJ = 0x3fffffff;
const slotOf = (i, j) => mod(i, WIN) + WIN * mod(j, WIN);
const slotAt = (i, j) => { const s = slotOf(i, j); return sI[s] === i && sJ[s] === j ? s : -1; };
function stream(px, pz) {
  const ci = cellOf(px, 0), cj = cellOf(pz, 1);
  if (ci === ctrI && cj === ctrJ) return 0;
  ctrI = ci; ctrJ = cj;
  let n = 0;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const i = ci + di, j = cj + dj, s = slotOf(i, j);
    if (sI[s] === i && sJ[s] === j) continue;
    genBlock(i, j, s); sMaj[s] = sN[s]; sCMaj[s] = gCm;
    sI[s] = i; sJ[s] = j; sDirty[s] = 1; n++;
  }
  return n;
}

// ---------------------------------------------------------------- collision queries
// candidate solid boxes (not roofs, not ground plates under 0.2 m... those are walked on) and circles near a point
const CAND = new Int32Array(512), CIRC = new Float32Array(256 * 3);
let NC = 0, NCI = 0;
function gather(x0, z0, x1, z1) {
  NC = 0; NCI = 0;
  const i0 = cellOf(x0, 0), i1 = cellOf(x1, 0), j0 = cellOf(z0, 1), j1 = cellOf(z1, 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const s = slotAt(i, j); if (s < 0) continue;
    const base = s * MAXB, n = sN[s];
    for (let k = 0; k < n; k++) {
      const o = (base + k) * BF;
      if (WB[o + 7] >= 5) continue; // roofs
      if (WB[o] > x1 || WB[o] + WB[o + 4] < x0 || WB[o + 2] > z1 || WB[o + 2] + WB[o + 6] < z0) continue;
      if (NC < 512) CAND[NC++] = o;
    }
    for (let k = 0; k < sR[s]; k++) {
      const o = (s * MAXR + k) * 3;
      if (RC[o] + RC[o + 2] < x0 || RC[o] - RC[o + 2] > x1 || RC[o + 1] + RC[o + 2] < z0 || RC[o + 1] - RC[o + 2] > z1) continue;
      if (NCI < 256) { CIRC[NCI * 3] = RC[o]; CIRC[NCI * 3 + 1] = RC[o + 1]; CIRC[NCI * 3 + 2] = RC[o + 2]; NCI++; }
    }
  }
}
// ground height under a point (highest walkable top below y + step)
function groundAt(x, z, y, step) {
  let g = 0;
  for (let k = 0; k < NC; k++) {
    const o = CAND[k];
    if (x < WB[o] || x > WB[o] + WB[o + 4] || z < WB[o + 2] || z > WB[o + 2] + WB[o + 6]) continue;
    const t = WB[o + 1] + WB[o + 5];
    if (t <= y + step && t > g) g = t;
  }
  return g;
}
// ray against buildings in the loaded city (for the camera): distance or maxT
function rayBuildings(ox, oy, oz, dx, dy, dz, maxT) {
  const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
  let best = maxT;
  const i0 = cellOf(min(ox, ox + dx * maxT), 0), i1 = cellOf(max(ox, ox + dx * maxT), 0);
  const j0 = cellOf(min(oz, oz + dz * maxT), 1), j1 = cellOf(max(oz, oz + dz * maxT), 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const s = slotAt(i, j); if (s < 0) continue;
    for (let k = 0; k < sN[s]; k++) {
      const o = (s * MAXB + k) * BF;
      if (WB[o + 5] < 2.5 || WB[o + 7] >= 5) continue;
      let a = (WB[o] - ox) * ix, b = (WB[o] + WB[o + 4] - ox) * ix, tn = min(a, b), tf = max(a, b);
      a = (WB[o + 1] - oy) * iy; b = (WB[o + 1] + WB[o + 5] - oy) * iy; tn = max(tn, min(a, b)); tf = min(tf, max(a, b));
      a = (WB[o + 2] - oz) * iz; b = (WB[o + 2] + WB[o + 6] - oz) * iz; tn = max(tn, min(a, b)); tf = min(tf, max(a, b));
      if (tf >= max(tn, 0) && tn < best) best = max(tn, 0);
    }
  }
  return best;
}

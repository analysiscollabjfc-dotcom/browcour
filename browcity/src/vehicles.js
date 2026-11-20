// ============================================================================
// vehicle models: every car is 2-3 oriented boxes (body, cabin, extra) + 4 capsule wheels (+ 4 light capsules)
// ============================================================================
// Oriented box instance (12 floats): centre xyz, yaw | length (local x = forward), height, width, taper | r g b, mat
// Capsule instance (12 floats): a xyz, radius | b xyz, - | r g b, kind
// Car mats: 0 paint, 1 cabin (glass sides, painted roof), 2 glass, 9 blob shadow
const OF = 12, CF = 12;
// L, W, body height, cabin height, cabin length, cabin offset, taper, wheel radius, top speed (m/s), acceleration
const CT = [
  [3.9, 1.75, 0.62, 0.58, 2.0, -0.35, 0.32, 0.31, 42, 6],   // 0 hatchback
  [4.6, 1.8, 0.62, 0.55, 2.4, -0.1, 0.3, 0.32, 50, 6.5],    // 1 sedan
  [4.7, 1.82, 0.64, 0.58, 2.9, -0.45, 0.18, 0.32, 47, 6],   // 2 estate
  [5.0, 2.0, 0.95, 1.05, 3.6, -0.6, 0.05, 0.34, 36, 4.5],   // 3 van
  [4.6, 1.8, 0.62, 0.55, 2.4, -0.1, 0.3, 0.32, 48, 6.5],    // 4 taxi
  [4.3, 1.9, 0.52, 0.45, 1.9, -0.25, 0.42, 0.33, 66, 10],   // 5 sports
  [11.8, 2.55, 2.3, 0, 0, 0, 0, 0.5, 24, 2.4],              // 6 bus
  [3.5, 1.65, 0.62, 0.62, 1.85, -0.2, 0.36, 0.29, 36, 5.5], // 7 city car
];
const CNAME = ['Hatchback', 'Sedan', 'Estate', 'Van', 'Taxi', 'Sports car', 'Bus', 'City car'];
// paint: white, silver, black, graphite, navy, red, bottle green, beige, sky blue, mustard
const PAINT = [0.8, 0.8, 0.78, 0.5, 0.52, 0.54, 0.03, 0.03, 0.035, 0.16, 0.17, 0.18, 0.05, 0.08, 0.22, 0.5, 0.05, 0.04,
  0.06, 0.2, 0.1, 0.55, 0.47, 0.34, 0.25, 0.45, 0.65, 0.65, 0.48, 0.1];
const NPAINT = 10;
const pickType = (h) => (h < 0.22 ? 0 : h < 0.47 ? 1 : h < 0.6 ? 2 : h < 0.7 ? 3 : h < 0.78 ? 4 : h < 0.84 ? 5 : h < 0.89 ? 6 : 7);

let oN = 0, cN = 0; // boxes / capsules written by the last carModel call
function obox(O, i, x, y, z, yaw, l, h, w, tp, r, g, b, m) {
  const o = i * OF;
  O[o] = x; O[o + 1] = y; O[o + 2] = z; O[o + 3] = yaw; O[o + 4] = l; O[o + 5] = h; O[o + 6] = w; O[o + 7] = tp;
  O[o + 8] = r; O[o + 9] = g; O[o + 10] = b; O[o + 11] = m;
}
function capw(C, i, ax, ay, az, bx, by, bz, r, cr, cg, cb, k) {
  const o = i * CF;
  C[o] = ax; C[o + 1] = ay; C[o + 2] = az; C[o + 3] = r; C[o + 4] = bx; C[o + 5] = by; C[o + 6] = bz; C[o + 7] = 0;
  C[o + 8] = cr; C[o + 9] = cg; C[o + 10] = cb; C[o + 11] = k;
}
// writes car type t, paint p at (x, y, z) heading yaw. lights: 0 none (parked), 1 normal, 2 braking
function carModel(t, p, x, y, z, yaw, O, oi, C, ci, lights, wheels) {
  const T = CT[t], L = T[0], W = T[1], bh = T[2], chh = T[3], cl = T[4], co = T[5], wr = T[7];
  const c = cos(yaw), s = sin(yaw);
  let r = PAINT[p * 3], g = PAINT[p * 3 + 1], b = PAINT[p * 3 + 2];
  if (t === 4) { r = 0.75; g = 0.66; b = 0.3; } // taxi
  if (t === 6) { r = p & 1 ? 0.62 : 0.08; g = p & 1 ? 0.12 : 0.28; b = p & 1 ? 0.08 : 0.5; } // bus: red or blue
  const by = y + 0.25 + bh / 2;
  oN = 0; cN = 0;
  obox(O, oi + oN++, x, by, z, yaw, L, bh, W, t === 6 ? 0 : 0.06, r, g, b, 0);
  if (t === 6) {
    obox(O, oi + oN++, x + c * 0.1, y + 1.85, z + s * 0.1, yaw, L - 0.5, 1.05, W + 0.04, 0, 0.1, 0.12, 0.14, 2);
  } else {
    const cy = y + 0.25 + bh + chh / 2, ox = c * co, oz = s * co;
    obox(O, oi + oN++, x + ox, cy, z + oz, yaw, cl, chh, W * 0.92, T[6], r, g, b, t === 3 ? 0 : 1);
    if (t === 3) obox(O, oi + oN++, x + ox + c * (cl / 2 - 0.3), cy, z + oz + s * (cl / 2 - 0.3), yaw, 0.7, chh * 0.9, W * 0.94, 0, 0.1, 0.12, 0.14, 2);
    if (t === 4) obox(O, oi + oN++, x + ox, cy + chh / 2 + 0.09, z + oz, yaw, 0.25, 0.18, 0.55, 0, 0.95, 0.9, 0.7, 0);
  }
  if (wheels) {
    // wheels: capsules along the axle (local z), rubber black
    const wx = L / 2 - (t === 6 ? 2.2 : 0.78), wz = W / 2 - 0.13;
    for (let k = 0; k < 4; k++) {
      const lx = k & 1 ? wx : -wx, lz = k & 2 ? wz : -wz, px = x + c * lx - s * lz, pz = z + s * lx + c * lz;
      capw(C, ci + cN++, px - s * 0.09, y + wr, pz + c * 0.09, px + s * 0.09, y + wr, pz - c * 0.09, wr, 0.03, 0.03, 0.03, 0);
    }
  }
  if (lights) {
    const hy = y + 0.25 + bh * 0.62, fx = L / 2 - 0.02, lz2 = W / 2 - 0.3;
    for (let k = 0; k < 4; k++) {
      const front = k < 2, lx = front ? fx : -fx, lz = k & 1 ? lz2 : -lz2, px = x + c * lx - s * lz, pz = z + s * lx + c * lz;
      const br = front ? 1 : lights === 2 ? 2.5 : 0.6;
      capw(C, ci + cN++, px, hy, pz, px, hy, pz, 0.09, front ? br : br * 1.2, front ? br * 0.95 : br * 0.05, front ? br * 0.8 : br * 0.04, front ? 4 : 8);
    }
  }
}

// ============================================================================
// math helpers. Everything here is allocation free: matrices write into caller-owned Float32Arrays.
// ============================================================================
const { sin, cos, tan, sqrt, min, max, abs, floor, round, PI, hypot, exp, atan2 } = Math;
const TAU = PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const mod = (a, n) => ((a % n) + n) % n;

// integer hash of three ints -> [0, 1)
const ihash = (x, y, z) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
// seeded stream (mulberry32); each chunk reseeds it from its coordinates, so the city is the same on every visit
let _seed = 1;
const rseed = (x, y, z) => { _seed = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ 0x5bd1e995) | 0; };
const rnd = () => {
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rr = (a, b) => a + (b - a) * rnd();
const vnoise2 = (x, z) => {
  const ix = floor(x), iz = floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  return mix(mix(ihash(ix, iz, 0), ihash(ix + 1, iz, 0), fx), mix(ihash(ix, iz + 1, 0), ihash(ix + 1, iz + 1, 0), fx), fz);
};

// ---------------------------------------------------------------- 4x4 matrices, column-major
// o = a * b
function mul4(o, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
}
// reversed-Z infinite perspective (depth 1 at the near plane, 0 at infinity): best depth precision with depth32float
function perspRZ(o, fovy, aspect, near) {
  const f = 1 / tan(fovy / 2);
  o.fill(0); o[0] = f / aspect; o[5] = f; o[11] = -1; o[14] = near;
}
// view from yaw (around +Y, 0 looks down -Z), pitch and roll. B receives right, up, forward (9 floats).
function viewYPR(o, B, px, py, pz, yaw, pitch, roll) {
  const sy = sin(yaw), cy = cos(yaw), sp = sin(pitch), cp = cos(pitch);
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  let rx = cy, ry = 0, rz = -sy;
  let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const cr = cos(roll), sr = sin(roll);
  const rx2 = rx * cr + ux * sr, ry2 = ry * cr + uy * sr, rz2 = rz * cr + uz * sr;
  ux = ux * cr - rx * sr; uy = uy * cr - ry * sr; uz = uz * cr - rz * sr;
  rx = rx2; ry = ry2; rz = rz2;
  o[0] = rx; o[4] = ry; o[8] = rz; o[12] = -(rx * px + ry * py + rz * pz);
  o[1] = ux; o[5] = uy; o[9] = uz; o[13] = -(ux * px + uy * py + uz * pz);
  o[2] = -fx; o[6] = -fy; o[10] = -fz; o[14] = fx * px + fy * py + fz * pz;
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  B[0] = rx; B[1] = ry; B[2] = rz; B[3] = ux; B[4] = uy; B[5] = uz; B[6] = fx; B[7] = fy; B[8] = fz;
}
// orthographic light camera looking along -L from (cx,cy,cz)+L*dist, half extent h, depth range [0, depth] mapped to [0,1]
function lightMat(o, tmp, L, cx, cy, cz, h, dist, depth) {
  // basis: f = -L, r = normalize(f x up), u = r x f
  const fx = -L[0], fy = -L[1], fz = -L[2];
  let rx = -fz, rz = fx; const rl = hypot(rx, rz); rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const ex = cx + L[0] * dist, ey = cy + L[1] * dist, ez = cz + L[2] * dist;
  tmp[0] = rx; tmp[4] = 0; tmp[8] = rz; tmp[12] = -(rx * ex + rz * ez);
  tmp[1] = ux; tmp[5] = uy; tmp[9] = uz; tmp[13] = -(ux * ex + uy * ey + uz * ez);
  tmp[2] = -fx; tmp[6] = -fy; tmp[10] = -fz; tmp[14] = fx * ex + fy * ey + fz * ez;
  tmp[3] = 0; tmp[7] = 0; tmp[11] = 0; tmp[15] = 1;
  // ortho: x,y / h ; z: view z in [-0, -depth] -> [0, 1]
  for (let c = 0; c < 4; c++) {
    o[c * 4] = tmp[c * 4] / h; o[c * 4 + 1] = tmp[c * 4 + 1] / h;
    o[c * 4 + 2] = -tmp[c * 4 + 2] / depth; o[c * 4 + 3] = tmp[c * 4 + 3];
  }
}

// ============================================================================
// WGSL. One module, six entry-point pairs. No textures besides the shadow map: every surface pattern (windows,
// concrete, stripes, asphalt) is computed from world position, with fwidth-based anti-aliasing and a distance
// fade to the pattern's average colour, so far facades neither shimmer nor moire.
// ============================================================================
const W_MAIN = /*wgsl*/`
struct U { vp: mat4x4f, sp: mat4x4f, cam: vec4f, sun: vec4f, fx: vec4f, r0: vec4f, r1: vec4f, scr: vec4f, cr: vec4f, cu: vec4f, cf: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var shT: texture_depth_2d;
@group(0) @binding(2) var shS: sampler_comparison;

const SUNC = vec3f(2.5, 2.1, 1.65);
// unit cube from the vertex index: 8 corners (bit 0 x, bit 1 y, bit 2 z), faces +x -x +y -y +z -z, CCW outside
var<private> CI: array<u32, 36> = array<u32, 36>(1u,3u,7u,1u,7u,5u, 0u,4u,6u,0u,6u,2u, 2u,6u,7u,2u,7u,3u, 0u,1u,5u,0u,5u,4u, 4u,5u,7u,4u,7u,6u, 0u,2u,3u,0u,3u,1u);

fn ih(p: vec2i) -> f32 {
  var h = bitcast<u32>(p.x) * 0x27d4eb2du + bitcast<u32>(p.y) * 0x165667b1u;
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return f32(h ^ (h >> 15u)) * 2.3283064e-10;
}
fn vn(p: vec2f) -> f32 {
  let i = vec2i(floor(p)); let f = fract(p); let w = f * f * (3. - 2. * f);
  return mix(mix(ih(i), ih(i + vec2i(1, 0)), w.x), mix(ih(i + vec2i(0, 1)), ih(i + vec2i(1, 1)), w.x), w.y);
}
// 1 inside [a, b], with edges smoothed over w
fn band(x: f32, a: f32, b: f32, w: f32) -> f32 { return smoothstep(a - w, a + w, x) * (1. - smoothstep(b - w, b + w, x)); }
fn sky(d: vec3f) -> vec3f {
  var c = mix(vec3f(.70, .78, .87), vec3f(.15, .34, .74), sqrt(max(d.y, 0.)));
  c = mix(c, vec3f(.62, .66, .72), clamp(-d.y * 3., 0., 1.));
  let s = max(dot(d, u.sun.xyz), 1e-4);
  return c + vec3f(1., .70, .42) * (pow(s, 5.) * .25 + pow(s, 40.) * .35);
}
// cubic fog: clear nearby, a solid wall at the edge of the streamed area
fn fogf(d: f32) -> f32 { let x = d * u.sun.w; return 1. - exp(-x * x * x); }
fn tone(c: vec3f, px: vec2f) -> vec4f {
  let x = c * u.fx.w;
  let a = clamp(x * (2.51 * x + .03) / (x * (2.43 * x + .59) + .14), vec3f(0.), vec3f(1.));
  return vec4f(pow(a, vec3f(.4545)) + (ih(vec2i(px)) - .5) / 255., 1.);
}
fn shadow(w: vec3f) -> f32 {
  let s = u.sp * vec4f(w, 1.);
  let uv = s.xy * vec2f(.5, -.5) + .5;
  let e = max(abs(uv.x - .5), abs(uv.y - .5));
  if (e > .499 || s.z >= 1.) { return 1.; }
  let t = u.scr.z * .7; let z = s.z - .0002;
  let v = textureSampleCompareLevel(shT, shS, uv + vec2f(-t, -t), z) + textureSampleCompareLevel(shT, shS, uv + vec2f(t, -t), z)
        + textureSampleCompareLevel(shT, shS, uv + vec2f(-t, t), z) + textureSampleCompareLevel(shT, shS, uv + vec2f(t, t), z);
  return mix(v * .25, 1., smoothstep(.4, .499, e));
}

// ---------------------------------------------------------------- boxes and ramps
struct VO { @builtin(position) p: vec4f, @location(0) w: vec3f, @location(1) l: vec3f,
  @location(2) @interpolate(flat) n: vec3f, @location(3) @interpolate(flat) s: vec3f, @location(4) @interpolate(flat) m: vec2f };
// instance a = min corner + mat.seed, b = size + type. Ramps: the top edge on the low side is pulled down.
fn cube(vi: u32, a: vec4f, b: vec4f, q: ptr<function, vec3f>, n: ptr<function, vec3f>) -> vec3f {
  let c = CI[vi];
  var l = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32(c >> 2u));
  let f = vi / 6u; let ax = f >> 1u;
  var nn = vec3f(f32(ax == 0u), f32(ax == 1u), f32(ax == 2u)) * select(1., -1., (f & 1u) == 1u);
  let t = u32(b.w + .5);
  if (t > 0u) {
    var lo = l.z;
    if (t == 1u) { lo = 1. - l.x; } else if (t == 2u) { lo = l.x; } else if (t == 3u) { lo = 1. - l.z; }
    l.y *= 1. - lo;
    if (f == 2u) {
      if (t == 1u) { nn = vec3f(-b.y, b.x, 0.); } else if (t == 2u) { nn = vec3f(b.y, b.x, 0.); }
      else if (t == 3u) { nn = vec3f(0., b.z, -b.y); } else { nn = vec3f(0., b.z, b.y); }
      nn = normalize(nn);
    }
  }
  *q = l * b.xyz; *n = nn;
  return a.xyz + *q;
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var q: vec3f; var n: vec3f;
  let w = cube(vi, a, b, &q, &n);
  var o: VO;
  o.p = u.vp * vec4f(w, 1.); o.w = w; o.l = q; o.n = n; o.s = b.xyz; o.m = vec2f(floor(a.w), fract(a.w));
  return o;
}
@vertex fn vss(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> @builtin(position) vec4f {
  var q: vec3f; var n: vec3f;
  return u.sp * vec4f(cube(vi, a, b, &q, &n), 1.);
}

fn facade(fu: f32, y: f32, ly: f32, sy: f32, sd: f32, glass: bool, n: vec3f, vd: vec3f, dfu: f32, dy: f32,
          emi: ptr<function, vec3f>, spec: ptr<function, f32>) -> vec3f {
  var base = mix(vec3f(.86, .84, .80), vec3f(.73, .76, .80), fract(sd * 5.7));
  // about one building in five gets a pastel colour, so blocks are easy to tell apart at speed
  let pk = fract(sd * 17.13);
  if (pk > .8) { base = select(select(vec3f(.52, .70, .72), vec3f(.86, .66, .52), pk > .87), vec3f(.80, .76, .56), pk > .94); }
  if (glass) { base = vec3f(.34, .37, .41); }
  let cw = select(mix(2.6, 3.8, fract(sd * 7.31)), 1.5, glass);
  let g = vec2f(fu / cw, y / 3.6); let fw = vec2f(dfu / cw, dy / 3.6);
  let id = vec2i(floor(g)); let f = fract(g);
  let hx = select(mix(.26, .38, fract(sd * 3.7)), .45, glass);
  let y0 = select(.3, .06, glass); let y1 = select(.86, .97, glass);
  let lod = clamp(max(fw.x, fw.y) * 2.5 - .5, 0., 1.);
  var m = band(f.x, .5 - hx, .5 + hx, fw.x) * band(f.y, y0, y1, fw.y);
  m = mix(m, 2. * hx * (y1 - y0), lod) * smoothstep(3.8, 4.4, y);
  let r = reflect(vd, n);
  let fr = .2 + .8 * pow(1. - abs(dot(vd, n)), 4.);
  let wr = mix(ih(id + vec2i(i32(sd * 4096.), 0)), .5, lod);
  let tint = select(vec3f(.07, .09, .12), vec3f(.05, .10, .15), glass);
  *emi = mix(tint * (.6 + .8 * wr), sky(r) * .75, fr) * m;
  *spec = m * pow(max(dot(r, u.sun.xyz), 1e-4), 90.) * 2.5;
  var a = mix(base, vec3f(.02), m);
  // white cornice band on the top edge: reads as "roof edge here" at speed
  let cor = smoothstep(sy - .75, sy - .65, ly);
  a = mix(a, vec3f(.92, .91, .88), cor); *emi *= 1. - cor; *spec *= 1. - cor;
  return a;
}
fn roof(p: vec2f, edge: f32, dxz: f32, de: f32) -> vec3f {
  var a = vec3f(.54, .52, .50) * (.84 + .16 * vn(p * 1.1)) * (.94 + .06 * vn(p * 5.3));
  let s = abs(fract(p / 3. + .5) - .5) * 3.;
  a *= 1. - .18 * (1. - smoothstep(.03, .04 + dxz * 1.5, min(s.x, s.y))) * (1. - clamp(dxz * 4., 0., 1.));
  return mix(a, vec3f(.9, .89, .86), 1. - smoothstep(.35, .36 + de, edge));
}

@fragment fn fs(i: VO) -> @location(0) vec4f {
  let n = i.n; let mat = u32(i.m.x + .5); let sd = i.m.y;
  let V = i.w - u.cam.xyz; let dist = length(V); let vd = V / dist;
  let top = n.y > .5;
  let fu = select(i.w.z, i.w.x, abs(n.z) > .5);
  let edge = min(min(i.l.x, i.s.x - i.l.x), min(i.l.z, i.s.z - i.l.z));
  // derivatives up front: they must be taken in uniform control flow
  let dfu = fwidth(fu); let dy = fwidth(i.w.y); let de = fwidth(edge); let dxz = length(fwidth(i.w.xz)); let dg = fwidth(i.l.x + i.l.z);
  var alb = vec3f(.7); var emi = vec3f(0.); var spec = 0.; var ao = 1.;
  if (mat == 0u || mat == 5u) {
    if (top) { alb = roof(i.w.xz, edge, dxz, de); }
    else {
      alb = facade(fu, i.w.y, i.l.y, i.s.y, sd, mat == 5u, n, vd, dfu, dy, &emi, &spec);
      ao = mix(.42, 1., clamp(i.w.y / 36., 0., 1.)); // street canyons get darker toward the bottom
    }
  } else if (mat == 1u) {
    alb = vec3f(.68, .69, .71) * (.92 + .08 * sd);
    if (!top) { alb *= .88 + .12 * band(fract(fu * 2.), .1, .5, dfu * 2.); ao = mix(.55, 1., clamp(i.l.y / 1.5, 0., 1.)); }
  } else if (mat == 2u) {
    // runner-vision accent: ramps, kickers and wall-run panels
    alb = mix(vec3f(.93, .30, .12), vec3f(.95, .45, .10), sd);
    if (top) { alb *= 1. - .2 * band(fract((i.l.x + i.l.z) * .5), .02, .5, dg * .5 + .01); }
  } else if (mat == 3u) {
    alb = vec3f(.30, .32, .36);
    if (!top) { alb = mix(alb, vec3f(.95, .75, .1), band(i.l.y / i.s.y, .55, 1.2, dy / i.s.y)); }
  } else {
    let g = vn(i.w.xz * 2.3);
    alb = vec3f(.15, .15, .16) * (.8 + .35 * g);
    let lc = abs(fract(i.w.xz / 48. + .5) - .5) * 48.;
    let dash = band(lc.x, -1., .12, dxz) * step(.5, fract(i.w.z / 3.)) + band(lc.y, -1., .12, dxz) * step(.5, fract(i.w.x / 3.));
    alb = mix(alb, vec3f(.8, .78, .7), min(dash, 1.));
  }
  let nl = max(dot(n, u.sun.xyz), 0.);
  var sh = 0.;
  if (nl > 0.) { sh = shadow(i.w + n * .1); }
  let amb = mix(vec3f(.22, .20, .19), vec3f(.30, .40, .58), n.y * .5 + .5);
  var c = alb * (SUNC * nl * sh + amb * ao) + emi * mix(.55, 1., ao) + SUNC * spec * sh;
  c = mix(c, sky(vd), fogf(dist));
  return tone(c, i.p.xy);
}

// ---------------------------------------------------------------- full-screen passes: sky and speed lines
struct QO { @builtin(position) p: vec4f, @location(0) q: vec2f };
@vertex fn vsq(@builtin(vertex_index) i: u32) -> QO {
  let p = vec2f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1));
  var o: QO; o.p = vec4f(p, 0., 1.); o.q = p; return o;
}
@fragment fn fsk(i: QO) -> @location(0) vec4f {
  let d = normalize(u.cf.xyz + i.q.x * u.cr.xyz + i.q.y * u.cu.xyz);
  var c = sky(d);
  let s = dot(d, u.sun.xyz);
  c += vec3f(9., 7., 5.) * smoothstep(.9993, .9997, s);
  if (d.y > 0.) {
    let p = u.cam.xz + d.xz * (900. - u.cam.y) / max(d.y, .02);
    let q = p * .0011 + vec2f(u.cam.w * .004, 0.);
    let cl = smoothstep(.52, .85, vn(q) * .55 + vn(q * 2.7) * .3 + vn(q * 7.3) * .15);
    c = mix(c, vec3f(1., .97, .93) * (.9 + .25 * pow(max(s, 1e-4), 3.)), cl * smoothstep(.03, .3, d.y) * .8);
  }
  return tone(c, i.p.xy);
}
@fragment fn fsl(i: QO) -> @location(0) vec4f {
  let p = i.q * vec2f(u.scr.w, 1.);
  let r = length(p); let k = (atan2(p.y, p.x) + 3.14159265) * 22.;
  let h = ih(vec2i(i32(floor(k)), 3));
  let w = abs(fract(k) - .5);
  let seg = fract(r * .7 - u.cam.w * (1.5 + h * 2.) + h * 7.);
  let a = step(.55, h) * (1. - smoothstep(.04, .14, w)) * smoothstep(0., .1, seg) * (1. - smoothstep(.25, .45, seg)) * smoothstep(.5, 1.25, r) * u.fx.x;
  return vec4f(vec3f(a * .32), 0.);
}

// ---------------------------------------------------------------- checkpoint beams (additive) and grapple rope
@fragment fn fsb(i: VO) -> @location(0) vec4f {
  let h = i.l.y / i.s.y;
  let a = i.m.y * (1. - h) * (.75 + .25 * sin(u.cam.w * 6. - i.l.y * .3)) * (1. - .7 * fogf(length(i.w - u.cam.xyz)));
  return vec4f(vec3f(.25, .8, 1.) * a, 0.);
}
@vertex fn vsr(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let a = u.vp * vec4f(u.r0.xyz, 1.); let b = u.vp * vec4f(u.r1.xyz, 1.);
  let e = select(a, b, i == 1u || i == 2u || i == 4u);
  var d = (b.xy / b.w - a.xy / a.w) * u.scr.xy;
  d = normalize(vec2f(-d.y, d.x) + vec2f(1e-5, 0.)) / u.scr.xy * 3.;
  let sg = select(-1., 1., i == 2u || i == 4u || i == 5u);
  return vec4f(e.xy + d * sg * e.w, e.z, e.w);
}
@fragment fn fsr() -> @location(0) vec4f { return vec4f(.1, .11, .12, 1.); }
`;

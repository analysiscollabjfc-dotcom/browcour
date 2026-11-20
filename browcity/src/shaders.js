// ============================================================================
// Browcity WGSL. No textures at all: facades of six eras, roofs, roads and their markings, paving, grass, water,
// cars, people, trees and the sky are computed from world position. The street grid is mirrored here (lineP /
// lineC are the same hash as layout.js), so road markings and the light of every street lamp cost no geometry.
// ============================================================================
const W_CITY = /*wgsl*/`
struct U { vp: mat4x4f, sp: mat4x4f, cam: vec4f, sun: vec4f, sunc: vec4f, amb: vec4f, ambg: vec4f, zen: vec4f, hor: vec4f,
  sdir: vec4f, scr: vec4f, cr: vec4f, cu: vec4f, cf: vec4f, hl0: vec4f, hl1: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var shT: texture_depth_2d;
@group(0) @binding(2) var shS: sampler_comparison;
var<private> CI: array<u32, 36> = array<u32, 36>(1u,3u,7u,1u,7u,5u, 0u,4u,6u,0u,6u,2u, 2u,6u,7u,2u,7u,3u, 0u,1u,5u,0u,5u,4u, 4u,5u,7u,4u,7u,6u, 0u,2u,3u,0u,3u,1u);

// ---------------------------------------------------------------- hashes, noise, the street grid
fn ih(p: vec2i) -> f32 {
  var h = bitcast<u32>(p.x) * 0x27d4eb2du + bitcast<u32>(p.y) * 0x165667b1u;
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du; h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return f32(h ^ (h >> 15u)) * 2.3283064e-10;
}
// identical to ihash() in math.js
fn ih3(x: i32, y: i32, z: i32) -> f32 {
  var h = bitcast<u32>(x) * 374761393u + bitcast<u32>(y) * 668265263u + bitcast<u32>(z) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) * 2.3283064e-10;
}
fn vn(p: vec2f) -> f32 {
  let i = vec2i(floor(p)); let f = fract(p); let w = f * f * (3. - 2. * f);
  return mix(mix(ih(i), ih(i + vec2i(1, 0)), w.x), mix(ih(i + vec2i(0, 1)), ih(i + vec2i(1, 1)), w.x), w.y);
}
fn band(x: f32, a: f32, b: f32, w: f32) -> f32 { return smoothstep(a - w, a + w, x) * (1. - smoothstep(b - w, b + w, x)); }
fn lineP(i: i32, a: i32) -> f32 { return f32(i) * 112. + (ih3(i, 1 + a * 2, 77) - .5) * 36.; }
fn lineC(i: i32, a: i32) -> i32 { let h = ih3(i, 2 + a * 2, 77); return select(select(0, 1, h < .5), 2, h < .14); }
fn cwid(c: i32) -> f32 { return select(select(11., 14., c == 1), 26., c == 2); }
// nearest street line to v on axis a: (v - line, class, index)
fn nearL(v: f32, a: i32) -> vec3f {
  let i0 = i32(floor(v / 112.));
  var b = vec3f(1e9, 0., 0.);
  for (var k = -1; k <= 1; k++) { let i = i0 + k; let d = v - lineP(i, a); if (abs(d) < abs(b.x)) { b = vec3f(d, f32(lineC(i, a)), f32(i)); } }
  return b;
}

// ---------------------------------------------------------------- light
fn sky(d: vec3f) -> vec3f {
  var c = mix(u.hor.rgb, u.zen.rgb, sqrt(max(d.y, 0.)));
  c = mix(c, u.hor.rgb * .7, clamp(-d.y * 3., 0., 1.));
  let s = max(dot(d, u.sdir.xyz), 1e-4);
  c += u.sunc.rgb * (pow(s, 6.) * .18 + pow(s, 40.) * .3) * (1. - u.sunc.w);
  let m = max(dot(d, -u.sdir.xyz), 1e-4);
  return c + vec3f(.15, .2, .3) * pow(m, 30.) * u.sunc.w;
}
fn fogf(d: f32) -> f32 { let x = d * u.sun.w; return 1. - exp(-x * x * x); }
fn tone(c: vec3f, px: vec2f) -> vec4f {
  let x = c * u.amb.w;
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
// street lamps: every 25 m on both sides of every street, staggered; none inside intersections (as in layout.js)
fn lamps(w: vec3f, n: vec3f) -> vec3f {
  var acc = 0.;
  for (var a = 0; a < 2; a++) {
    let L = nearL(select(w.x, w.z, a == 1), a);
    if (abs(L.x) > 40.) { continue; }
    let li = i32(L.z); let hw = cwid(i32(L.y)) * .5 - .2; let along = select(w.z, w.x, a == 1);
    let lp0 = lineP(li, a); let off = ih3(li, 6 + a, 77) * 25.;
    for (var sd = -1; sd <= 1; sd += 2) {
      let o2 = off + select(12.5, 0., sd > 0);
      let k = round((along - o2) / 25.) * 25. + o2;
      let c = nearL(k, 1 - a);
      if (abs(c.x) < cwid(i32(c.y)) * .5 + 6.) { continue; }
      let lp = select(vec3f(lp0 + f32(sd) * hw, 5.62, k), vec3f(k, 5.62, lp0 + f32(sd) * hw), a == 1);
      let d = lp - w; let dd = dot(d, d);
      acc += max(dot(n, d * inverseSqrt(dd)) * .8 + .2, 0.) * 13. / (dd + 4.);
    }
  }
  return acc * vec3f(1., .7, .4);
}
// all light arriving at a surface point, times albedo, plus fog
fn shade(alb: vec3f, emi: vec3f, spec: f32, w: vec3f, n: vec3f, ao: f32, px: vec2f) -> vec4f {
  let V = w - u.cam.xyz; let dist = length(V); let vd = V / dist;
  let nl = max(dot(n, u.sun.xyz), 0.);
  var sh = 0.; if (nl > 0.) { sh = shadow(w + n * .12); }
  var c = alb * (u.sunc.rgb * nl * sh + mix(u.ambg.rgb, u.amb.rgb, n.y * .5 + .5) * ao) + emi + u.sunc.rgb * spec * sh;
  if (u.sunc.w > .01) { c += alb * lamps(w, n) * u.sunc.w; }
  if (u.hl0.w > 0.) {
    // the player car's headlights
    let d = w - u.hl0.xyz; let dl = length(d); let dn = d / dl;
    c += alb * smoothstep(.8, .95, dot(dn, u.hl1.xyz)) * 90. / (dl * dl + 2.) * max(dot(n, -dn), 0.) * u.hl0.w * vec3f(1., .95, .85);
  }
  return tone(mix(c, sky(vd), fogf(dist)), px);
}

// ---------------------------------------------------------------- static boxes: buildings, roofs, roads, plates
struct VO { @builtin(position) p: vec4f, @location(0) w: vec3f, @location(1) l: vec3f,
  @location(2) @interpolate(flat) n: vec3f, @location(3) @interpolate(flat) s: vec3f, @location(4) @interpolate(flat) m: vec3f };
fn cube(vi: u32, a: vec4f, b: vec4f, q: ptr<function, vec3f>, n: ptr<function, vec3f>) -> vec3f {
  let c = CI[vi];
  var l = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32(c >> 2u));
  let f = vi / 6u; let ax = f >> 1u;
  *n = vec3f(f32(ax == 0u), f32(ax == 1u), f32(ax == 2u)) * select(1., -1., (f & 1u) == 1u);
  let t = u32(b.w + .5);
  if (t >= 5u && l.y > .5) {
    // roofs: 5/6 gable (ridge along x / z), 7/8 hipped, 9 pyramid
    if (t == 5u || t == 7u || t == 9u) { l.z = .5; }
    if (t == 6u || t == 8u || t == 9u) { l.x = .5; }
    if (t == 7u) { l.x = clamp(l.x * b.x, b.z * .5, max(b.x - b.z * .5, b.x * .5)) / b.x; }
    if (t == 8u) { l.z = clamp(l.z * b.z, b.x * .5, max(b.z - b.x * .5, b.z * .5)) / b.z; }
  }
  *q = l * b.xyz;
  return a.xyz + *q;
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var q: vec3f; var n: vec3f;
  let w = cube(vi, a, b, &q, &n);
  var o: VO; o.p = u.vp * vec4f(w, 1.); o.w = w; o.l = q; o.n = n; o.s = b.xyz; o.m = vec3f(floor(a.w), fract(a.w), b.w); return o;
}
@vertex fn vss(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> @builtin(position) vec4f {
  var q: vec3f; var n: vec3f; return u.sp * vec4f(cube(vi, a, b, &q, &n), 1.);
}

// per style (timber, baroque, 19th c., brick, panel, glass, church): ground floor and floor heights, window spacing,
// window half width (fraction of the spacing), window bottom and top (fraction of the floor)
var<private> SGF: array<f32, 7> = array<f32, 7>(3., 4.2, 4.5, 4., 3., 4.5, 4.);
var<private> SFH: array<f32, 7> = array<f32, 7>(2.8, 3.6, 3.7, 3.4, 2.8, 3.6, 30.);
var<private> SWW: array<f32, 7> = array<f32, 7>(2.2, 3., 3.2, 2.8, 3., 1.6, 4.);
var<private> SHX: array<f32, 7> = array<f32, 7>(.2, .2, .19, .22, .4, .46, .18);
var<private> SY0: array<f32, 7> = array<f32, 7>(.3, .27, .24, .3, .36, .05, .1);
var<private> SY1: array<f32, 7> = array<f32, 7>(.76, .8, .82, .78, .72, .97, .4);
var<private> BAROQ: array<vec3f, 5> = array<vec3f, 5>(vec3f(.87, .7, .42), vec3f(.85, .58, .48), vec3f(.66, .75, .6), vec3f(.62, .69, .79), vec3f(.9, .8, .52));
var<private> AWN: array<vec3f, 4> = array<vec3f, 4>(vec3f(.55, .08, .06), vec3f(.08, .3, .14), vec3f(.08, .15, .35), vec3f(.75, .7, .55));
var<private> BULB: array<vec3f, 3> = array<vec3f, 3>(vec3f(1., .08, .04), vec3f(1., .6, .05), vec3f(.1, 1., .35));
// facade of a building of style st (10 timber, 11 baroque, 12 19th c., 13 brick, 14 panel, 15 glass, 16 church)
fn facade(st: u32, fu: f32, lu: f32, su: f32, y: f32, sd: f32, shop: bool, n: vec3f, vd: vec3f, dfu: f32, dy: f32,
          emi: ptr<function, vec3f>, spec: ptr<function, f32>) -> vec3f {
  let k = st - 10u; let r1 = fract(sd * 7.31); let r2 = fract(sd * 13.7);
  var GF = SGF[k]; let FH = SFH[k]; let WW = SWW[k]; let HX = SHX[k]; let Y0 = SY0[k]; let Y1 = SY1[k];
  var base = vec3f(.7);
  var trim = vec3f(.92, .9, .86);
  if (k == 0u) { base = mix(vec3f(.88, .84, .74), vec3f(.84, .78, .66), r1); }
  else if (k == 1u) {
    let p = u32(r1 * 5.);
    base = BAROQ[p];
  }
  else if (k == 2u) { base = mix(vec3f(.84, .78, .66), vec3f(.76, .75, .73), r1); }
  else if (k == 3u) { base = mix(vec3f(.52, .22, .14), vec3f(.44, .27, .19), r1); trim = vec3f(.72, .68, .62); }
  else if (k == 4u) { base = mix(vec3f(.63, .63, .61), vec3f(.7, .68, .63), r1); }
  else if (k == 5u) { base = vec3f(.3, .34, .38); }
  else { base = vec3f(.7, .66, .58); GF = 0.; }
  let gnd = y < GF;
  let fl = select(floor((y - GF) / FH), -1., gnd);
  let fy = select(fract((y - GF) / FH), y / GF, gnd);
  let g = fu / WW; let fx = fract(g); let col = floor(g);
  let fw = dfu / WW; let fyw = dy / select(FH, GF, gnd);
  let lod = clamp(max(fw, fyw) * 2.2 - .4, 0., 1.);
  var m = band(fx, .5 - HX, .5 + HX, fw) * band(fy, Y0, Y1, fyw);
  var a = base;
  if (k == 6u) {
    // church: tall pointed windows between buttresses
    let wy = (y - 4.) / 9.; let ax = abs(fx - .5);
    m = band(fx, .5 - HX, .5 + HX, fw) * band(wy, 0., 1., dy / 9.) * step(ax * 2.2, 1.2 - wy);
  }
  if (gnd && shop) {
    // shop front: big windows, an awning band above, lit late into the evening
    let sg = fu / 4.; let sx = fract(sg);
    m = band(sx, .08, .92, dfu / 4.) * band(y, .45, GF - 1.1, dy);
    let aw = band(y, GF - 1.05, GF - .45, dy);
    let ac = AWN[u32(r2 * 4.)];
    a = mix(a, ac * mix(1., .75, step(.5, fract(fu * 1.2))), aw);
  } else if (gnd) {
    m *= select(1., 0., k == 0u);
    // plinth: a darker, rusticated ground floor; the front door in the middle of the facade
    a *= mix(.78, .9, step(.5, fract(y / .45)) * (1. - lod));
    let door = band(lu, su * .5 - .65, su * .5 + .65, dfu) * step(y, 2.5);
    a = mix(a, vec3f(.2, .12, .07), door);
  }
  // era details
  if (k == 0u && !gnd) {
    // timber framing: beams at the floors, posts, and braces in the wall panels
    let beam = (1. - smoothstep(.04, .06 + fyw, min(fy, 1. - fy))) + (1. - smoothstep(.03, .05 + fw, min(fract(g * 2.), 1. - fract(g * 2.))));
    let br = 1. - smoothstep(.03, .05 + fw, abs(fract(g * 2. + fy * select(1., -1., (u32(col) & 1u) == 1u)) - .5));
    a = mix(a, vec3f(.2, .12, .07), clamp(beam + br * (1. - m), 0., 1.) * (1. - lod * .6));
  } else if (k == 1u || k == 2u) {
    // stucco or stone: white window surrounds, a cornice band at every floor, iron balconies on the 1st and top floors
    let sur = band(fx, .5 - HX - .05, .5 + HX + .05, fw) * band(fy, Y0 - .06, Y1 + .1, fyw) * (1. - m);
    a = mix(a, trim, sur * (1. - lod * .5));
    if (!gnd) { a = mix(a, trim * .95, 1. - smoothstep(.0, .04 + fyw, fy)); }
    if (k == 2u && (fl == 0. || fl == 4.)) {
      let bal = band(fy, 0., .3, fyw) * (.6 + .4 * step(.5, fract(fu * 6.)) * (1. - lod));
      a = mix(a, vec3f(.06, .06, .07), bal * .85); m *= 1. - band(fy, 0., .3, fyw) * .5;
    }
    if (k == 2u) { a *= 1. - .08 * (1. - smoothstep(0., .05 + fyw * 4., fract(y / .5))) * (1. - lod); }
  } else if (k == 3u) {
    // brick bond, white mortar, arched window heads
    let bw = vec2f(fu / .25 + step(.5, fract(y / .15)) * .5, y / .075);
    let mo = 1. - smoothstep(.04, .08 + fw * 8., min(min(fract(bw.x), 1. - fract(bw.x)) * .5, min(fract(bw.y), 1. - fract(bw.y))));
    a = mix(a * (.85 + .3 * ih(vec2i(floor(bw)))), trim, mo * .45 * (1. - lod));
    let arch = length(vec2f((fx - .5) / HX, (fy - Y1 + HX * WW / FH) / (HX * WW / FH)));
    m *= select(1., 1. - smoothstep(.95, 1.05, arch), fy > Y1 - HX * WW / FH);
  } else if (k == 4u) {
    // concrete panels and coloured balcony fronts
    let seam = (1. - smoothstep(0., .02 + fyw, min(fy, 1. - fy))) + (1. - smoothstep(0., .02 + fw, abs(fx - .02)));
    a *= 1. - seam * .25 * (1. - lod);
    if ((u32(col) % 3u) == 1u && !gnd) { a = mix(a, mix(vec3f(.65, .45, .3), vec3f(.4, .55, .6), r2), band(fy, 0., Y0, fyw) * (1. - m)); }
  } else if (k == 5u) {
    a *= 1. - band(fy, .97, 1.05, fyw) * .4;
  }
  m = mix(m, select(.5, .85, k == 5u) * (HX * 2.) * (Y1 - Y0) * select(1., .2, k == 6u), lod * select(1., 0., gnd && shop));
  // windows: sky reflection by day, warm light in some of them at night
  let id = vec2i(i32(col) + i32(sd * 4096.), i32(fl) * 7 + i32(sd * 999.));
  let lit = step(ih(id), u.sunc.w * select(.42, .9, gnd && shop));
  let r = reflect(vd, n);
  let fr = .15 + .85 * pow(1. - abs(dot(vd, n)), 4.);
  let tint = select(vec3f(.05, .06, .08), vec3f(.04, .08, .12), k == 5u);
  *emi = (mix(tint, sky(r) * .7, fr) + vec3f(1., .66, .34) * lit * mix(.35, .9, ih(id + vec2i(3, 5)))) * m;
  *spec = m * pow(max(dot(r, u.sun.xyz), 1e-4), 80.) * 2.;
  return mix(a, vec3f(.02), m);
}

@fragment fn fs(i: VO) -> @location(0) vec4f {
  let mat = u32(i.m.x + .5); let sd = i.m.y; let typ = u32(i.m.z + .5);
  let w = i.w;
  // flat normal: from the vertex shader for boxes, from screen derivatives for the slanted roof faces
  var dn = normalize(cross(dpdx(w), dpdy(w)));
  dn = select(dn, -dn, dot(dn, u.cam.xyz - w) < 0.);
  let n = select(i.n, dn, typ >= 5u);
  let vd = normalize(w - u.cam.xyz);
  let fu = select(w.z, w.x, abs(n.z) > .5);
  let lu = select(i.l.z, i.l.x, abs(n.z) > .5); let su = select(i.s.z, i.s.x, abs(n.z) > .5);
  let edge = min(min(i.l.x, i.s.x - i.l.x), min(i.l.z, i.s.z - i.l.z));
  let dfu = fwidth(fu); let dy = fwidth(w.y); let de = fwidth(edge); let dxz = length(fwidth(w.xz));
  let top = n.y > .5;
  var alb = vec3f(.6); var emi = vec3f(0.); var spec = 0.; var ao = 1.;
  if (mat >= 10u && mat <= 16u) {
    if (top) { alb = vec3f(.33, .32, .31) * (.85 + .15 * vn(w.xz * 2.)); alb = mix(alb, vec3f(.6, .58, .55), 1. - smoothstep(.3, .32 + de, edge)); }
    else {
      alb = facade(mat, fu, lu, su, w.y, fract(sd * 2.), sd >= .5, n, vd, dfu, dy, &emi, &spec);
      ao = mix(.5, 1., clamp(w.y / 18., 0., 1.));
    }
  } else if (mat == 20u || mat == 21u) {
    // roof tiles or slate; the gable ends are plaster
    if (abs(n.y) < .2) { alb = mix(vec3f(.86, .82, .72), vec3f(.8, .7, .55), fract(sd * 9.)); }
    else {
      let tile = select(vec3f(.2, .22, .26), mix(vec3f(.55, .23, .13), vec3f(.62, .32, .18), fract(sd * 5.)), mat == 20u);
      let row = w.y / .32; let rw = dy / .32;
      let rl = 1. - smoothstep(0., .12 + rw, fract(row));
      let jt = 1. - smoothstep(0., .1 + dfu * 3., abs(fract(fu / .3 + step(.5, fract(row * .5)) * .5) - .5) * 2. - .9);
      alb = tile * (1. - (.25 * rl + .1 * jt) * (1. - clamp(rw * 3., 0., 1.))) * (.9 + .2 * ih(vec2i(i32(fu / .3), i32(row))) * (1. - clamp(rw * 3., 0., 1.)));
    }
  } else if (mat == 0u) {
    // asphalt with markings from the street grid
    alb = vec3f(.13, .13, .14) * (.8 + .3 * vn(w.xz * 3.) + .1 * vn(w.xz * .3));
    let nx = nearL(w.x, 0); let nz = nearL(w.z, 1);
    let hx = cwid(i32(nx.y)) * .5; let hz = cwid(i32(nz.y)) * .5;
    let ox = abs(nx.x) < hx; let oz = abs(nz.x) < hz;
    var mk = 0.;
    if (ox != oz) {
      // d: across the street from its centre line; e: along it, past the edge of the crossing street
      let d = select(nz.x, nx.x, ox); let hw = select(hz, hx, ox); let c = i32(select(nz.y, nx.y, ox));
      let cr = select(nx, nz, ox); let e = abs(cr.x) - select(hx, hz, ox);
      let al = select(w.x, w.z, ox);
      let ad = abs(d); let aw = dxz;
      // zebra crossing, stop line on the incoming half
      mk += band(e, .8, 4.8, aw) * band(fract(d / 1.1), 0., .5, aw) * step(ad, hw - .4);
      mk += band(e, 5.2, 5.6, aw) * step(0., d * cr.x) * step(ad, hw - .4);
      if (e > 5.6) {
        if (c == 2) { mk += band(ad, 5.45, 5.6, aw) * step(.5, fract(al / 6.)) + band(ad, 8.9, 9.05, aw); }
        else { mk += band(ad, -.08, .08, aw) * step(.45, fract(al / 6.)); mk += band(ad, hw - 2.3, hw - 2.2, aw); }
      }
    }
    alb = mix(alb, vec3f(.78, .76, .7), min(mk, 1.) * (1. - clamp(dxz * 2., 0., .7)));
  } else if (mat == 1u) {
    // sidewalk slabs, granite curb along the edge
    let t = abs(fract(w.xz / .6) - .5) * .6;
    alb = vec3f(.5, .49, .47) * (.9 + .1 * ih(vec2i(floor(w.xz / .6)))) * (1. - .2 * (1. - smoothstep(.0, .015 + dxz, min(t.x, t.y))) * (1. - clamp(dxz * 6., 0., 1.)));
    alb = mix(alb, vec3f(.62, .61, .6), 1. - smoothstep(.28, .3 + de, edge));
  } else if (mat == 3u) {
    // square: cobblestones
    let q = w.xz / vec2f(.22, .18) + vec2f(step(.5, fract(w.z / .36)) * .5, 0.); let t = abs(fract(q) - .5);
    alb = vec3f(.47, .44, .41) * (.75 + .4 * ih(vec2i(floor(q)))) * (1. - .35 * (1. - smoothstep(.36, .46, max(t.x, t.y))) * (1. - clamp(dxz * 8., 0., 1.)));
  } else if (mat == 2u || mat == 6u) {
    alb = vec3f(.16, .28, .08) * (.75 + .3 * vn(w.xz * 1.7) + .15 * vn(w.xz * 9.));
  } else if (mat == 4u) {
    // water: dark, reflective, rippling
    let rp = vec3f(vn(w.xz * 2. + u.cam.w * .7) - .5, 6., vn(w.xz * 2.3 - u.cam.w * .6) - .5);
    let nn = normalize(rp); let r = reflect(vd, nn);
    alb = vec3f(.02, .05, .05); emi = sky(r) * (.1 + .9 * pow(1. - abs(dot(vd, nn)), 4.));
    spec = pow(max(dot(r, u.sun.xyz), 1e-4), 200.) * 4.;
  } else if (mat == 5u) {
    alb = vec3f(.38, .24, .13) * (.85 + .15 * step(.5, fract(w.y / .12)));
  } else if (mat == 7u) {
    // stop sign: red octagon, white border and legend
    let p = select(i.l.zy / i.s.zy, i.l.xy / i.s.xy, abs(n.z) > .5) * 2. - 1.;
    let oct = max(max(abs(p.x), abs(p.y)), (abs(p.x) + abs(p.y)) * .7071);
    if (oct > 1. && abs(n.y) < .5 && min(i.s.x, i.s.z) < .1) { discard; }
    alb = select(vec3f(.6, .04, .04), vec3f(.85), oct > .86 || (abs(p.y) < .14 && abs(p.x) < .6));
    emi = alb * .05;
  } else {
    alb = vec3f(.62, .6, .56) * (.9 + .1 * vn(w.xz * 4. + w.y));
  }
  return shade(alb, emi, spec, w, n, ao, i.p.xy);
}

// ---------------------------------------------------------------- capsules: people, trees, lamps, signals, wheels
struct CO { @builtin(position) p: vec4f, @location(0) w: vec3f, @location(1) @interpolate(flat) a: vec4f,
  @location(2) @interpolate(flat) b: vec4f, @location(3) @interpolate(flat) c: vec4f };
fn capBox(vi: u32, a: vec4f, b: vec4f) -> vec3f {
  let k = CI[vi];
  let ab = b.xyz - a.xyz; let l = length(ab);
  let x = select(vec3f(0., 1., 0.), ab / l, l > 1e-5);
  let y = normalize(cross(x, select(vec3f(0., 1., 0.), vec3f(1., 0., 0.), abs(x.y) > .9)));
  let z = cross(x, y); let r = a.w;
  return a.xyz + x * (select(-r, l + r, (k & 1u) == 1u)) + y * (select(-r, r, ((k >> 1u) & 1u) == 1u)) + z * (select(-r, r, (k >> 2u) == 1u));
}
@vertex fn vsc(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f) -> CO {
  let w = capBox(vi, a, b);
  var o: CO; o.p = u.vp * vec4f(w, 1.); o.w = w; o.a = a; o.b = b; o.c = c; return o;
}
@vertex fn vscs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f) -> CO {
  let w = capBox(vi, a, b);
  var o: CO; o.p = u.sp * vec4f(w, 1.); o.w = w; o.a = a; o.b = b; o.c = c; return o;
}
// ray / capsule: distance or -1
fn capHit(ro: vec3f, rd: vec3f, pa: vec3f, pb: vec3f, r: f32) -> f32 {
  let ba = pb - pa; let oa = ro - pa;
  let baba = max(dot(ba, ba), 1e-8); let bard = dot(ba, rd); let baoa = dot(ba, oa); let rdoa = dot(rd, oa); let oaoa = dot(oa, oa);
  let qa = baba - bard * bard; let qb = baba * rdoa - baoa * bard; let qc = baba * oaoa - baoa * baoa - r * r * baba;
  let h = qb * qb - qa * qc;
  var t = -1.;
  if (h >= 0. && qa > 1e-9) { t = (-qb - sqrt(h)) / qa; let y = baoa + t * bard; if (y <= 0. || y >= baba) { t = -1.; } }
  if (t < 0.) {
    let y = baoa + max((-qb - sqrt(max(h, 0.))) / max(qa, 1e-9), 0.) * bard;
    let oc = select(ro - pb, oa, y <= baba * .5);
    let b2 = dot(rd, oc); let h2 = b2 * b2 - dot(oc, oc) + r * r;
    if (h2 < 0.) { return -1.; }
    t = -b2 - sqrt(h2);
  }
  return t;
}
struct CF { @location(0) c: vec4f, @builtin(frag_depth) d: f32 };
@fragment fn fsc(i: CO) -> CF {
  let ro = u.cam.xyz; let rd = normalize(i.w - ro);
  let t = capHit(ro, rd, i.a.xyz, i.b.xyz, i.a.w);
  if (t <= 0.) { discard; }
  let p = ro + rd * t; let ba = i.b.xyz - i.a.xyz;
  let n = normalize(p - (i.a.xyz + ba * clamp(dot(p - i.a.xyz, ba) / max(dot(ba, ba), 1e-8), 0., 1.)));
  let kind = u32(i.c.w + .5);
  var o: CF;
  let cp = u.vp * vec4f(p, 1.); o.d = cp.z / cp.w;
  var emi = vec3f(0.); var alb = i.c.rgb; var spec = 0.;
  if (kind == 2u) { o.c = tone(mix(i.c.rgb, sky(rd), fogf(t)), i.p.xy); return o; }
  if (kind == 4u) { alb = vec3f(.05); emi = i.c.rgb * (.4 + u.sunc.w * 7.); }
  else if (kind == 8u) { alb = vec3f(.05); emi = i.c.rgb * (1. + u.sunc.w * 1.5); }
  else if (kind == 5u) {
    // traffic signal bulb: the same 40 s cycle as the traffic in traffic.js
    var ph = (u.ambg.w + i.c.b) % 40.; if (i.c.r > .5) { ph = (ph + 20.) % 40.; }
    let st = select(select(0., 1., ph < 19.), 2., ph < 16.);
    let on = abs(st - i.c.g) < .5;
    let bc = BULB[u32(i.c.g + .5)];
    alb = vec3f(.03); emi = bc * select(.06, 6., on);
  } else if (kind == 6u) {
    // foliage: lumpy leaves, light through the edge of the crown
    let lv = vn(p.xz * 3. + p.y * 2.) * .6 + vn(p.xy * 7.) * .4;
    alb = i.c.rgb * (.7 + .6 * lv);
  } else if (kind == 1u) { let r = reflect(rd, n); emi = sky(r) * .15; spec = .3 * pow(max(dot(r, u.sun.xyz), 1e-4), 30.); }
  o.c = shade(alb, emi, spec, p, n, 1., i.p.xy);
  return o;
}
// capsules in the shadow map: ray-traced along the light direction
struct SF { @builtin(frag_depth) d: f32 };
@fragment fn fscs(i: CO) -> SF {
  let rd = -u.sun.xyz; let ro = i.w + u.sun.xyz * 80.;
  let t = capHit(ro, rd, i.a.xyz, i.b.xyz, i.a.w);
  if (t <= 0.) { discard; }
  var o: SF; o.d = (u.sp * vec4f(ro + rd * t, 1.)).z; return o;
}

// ---------------------------------------------------------------- cars: oriented boxes; blob shadows
struct OO { @builtin(position) p: vec4f, @location(0) w: vec3f, @location(1) q: vec3f, @location(2) @interpolate(flat) c: vec4f };
@vertex fn vso(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f) -> OO {
  let k = CI[vi];
  let q = vec3f(f32(k & 1u), f32((k >> 1u) & 1u), f32(k >> 2u));
  var lp = (q - .5) * b.xyz;
  if (q.y > .5) { lp.x *= 1. - b.w; lp.z *= 1. - b.w * .45; }
  let cs = cos(a.w); let sn = sin(a.w);
  let w = a.xyz + vec3f(cs * lp.x - sn * lp.z, lp.y, sn * lp.x + cs * lp.z);
  var o: OO; o.p = u.vp * vec4f(w, 1.); o.w = w; o.q = q; o.c = c; return o;
}
@fragment fn fso(i: OO) -> @location(0) vec4f {
  var n = normalize(cross(dpdx(i.w), dpdy(i.w)));
  n = select(n, -n, dot(n, u.cam.xyz - i.w) < 0.);
  let vd = normalize(i.w - u.cam.xyz);
  let mat = u32(i.c.w + .5);
  let r = reflect(vd, n); let fr = .04 + .96 * pow(1. - abs(dot(vd, n)), 5.);
  var alb = i.c.rgb; var emi = vec3f(0.); var spec = 0.;
  let glass = mat == 2u || (mat == 1u && n.y < .6);
  if (glass) { alb = vec3f(.015); emi = sky(r) * (.08 + .6 * fr); spec = 1.5 * pow(max(dot(r, u.sun.xyz), 1e-4), 120.); }
  else { emi = sky(r) * fr * .7; spec = .8 * pow(max(dot(r, u.sun.xyz), 1e-4), 60.); }
  // a dark band along the bottom of the body (sills, bumpers)
  alb *= select(1., .25, i.q.y < .18 && mat == 0u);
  return shade(alb, emi, spec, i.w, n, 1., i.p.xy);
}
@fragment fn fsd(i: OO) -> @location(0) vec4f {
  let d = length((i.q.xz - .5) * 2.);
  return vec4f(0., 0., 0., (1. - smoothstep(.45, 1., d)) * .55 * (1. - u.sunc.w * .5));
}

// ---------------------------------------------------------------- sky: gradient, sun, moon, stars, clouds
struct QO { @builtin(position) p: vec4f, @location(0) q: vec2f };
@vertex fn vsq(@builtin(vertex_index) i: u32) -> QO {
  let p = vec2f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1));
  var o: QO; o.p = vec4f(p, 0., 1.); o.q = p; return o;
}
@fragment fn fsk(i: QO) -> @location(0) vec4f {
  let d = normalize(u.cf.xyz + i.q.x * u.cr.xyz + i.q.y * u.cu.xyz);
  var c = sky(d);
  let s = dot(d, u.sdir.xyz);
  c += vec3f(9., 7., 5.) * smoothstep(.9993, .9997, s) * u.hor.w;
  c += vec3f(1.6, 1.7, 1.9) * smoothstep(.9994, .9996, -s) * u.sunc.w;
  if (d.y > 0.) {
    // stars at night: a hash per cell of a direction grid, twinkling
    let sp = d.xz / (d.y + .25) * 260.; let id = vec2i(floor(sp)); let h = ih(id);
    let st = step(.996, h) * (1. - smoothstep(.05, .35, length(fract(sp) - .5))) * (.6 + .4 * sin(u.cam.w * 3. + h * 90.));
    c += vec3f(.9, .95, 1.) * st * u.zen.w * smoothstep(.0, .2, d.y);
    let p = u.cam.xz + d.xz * (900. - u.cam.y) / max(d.y, .02);
    let q = p * .0011 + vec2f(u.cam.w * .004, 0.);
    let cl = smoothstep(.55, .85, vn(q) * .55 + vn(q * 2.7) * .3 + vn(q * 7.3) * .15);
    let cc = mix(u.hor.rgb * 1.15 + u.sunc.rgb * .15, vec3f(.06, .07, .1), u.sunc.w);
    c = mix(c, cc, cl * smoothstep(.03, .3, d.y) * .75);
  }
  return tone(c, i.p.xy);
}
`;

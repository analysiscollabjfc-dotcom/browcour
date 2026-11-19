// Headless movement tests: runs the real city + player code in a Node VM (no GPU) and checks the move set.
//   node test/sim.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(path.join(here, '..', 'src', f), 'utf8');
const code = 'const LV = 0, R = 3;\n' + src('math.js') + src('city.js') + src('player.js') + `
globalThis.api = { pos, vel, pl, ev, step, teleport, stream, genChunk, GT, WB, sN, gather, raycast, CH, MAXB, BF, sCX, SLOTS, topAt, NC, CAND };`;
const ctx = vm.createContext({ Math, console });
vm.runInContext(code, ctx);
const A = ctx.api;
const inp = { f: 0, s: 0, c: 0, g: 0, jq: 0, dq: 0, yaw: 0, pitch: 0 };
const reset = () => Object.assign(inp, { f: 0, s: 0, c: 0, g: 0, jq: 0, dq: 0, yaw: 0, pitch: 0 });
const hs = () => Math.hypot(A.vel[0], A.vel[2]);
const run = (sec, fn) => { for (let i = 0; i < sec * 120; i++) { if (fn) fn(i); A.step(inp); } };
let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) fails++; };

// a flat test arena: overwrite one loaded chunk with hand-placed boxes
A.stream(24, 24);
function arena(boxes) {
  // place boxes into chunk (0,0)'s slot
  let slot = -1;
  for (let s = 0; s < A.SLOTS; s++) if (A.sCX[s] === 0 && vm.runInContext('sCZ', ctx)[s] === 0) slot = s;
  if (slot < 0) throw new Error("arena slot not found");
  const base = slot * A.MAXB * A.BF;
  boxes.unshift([0, -1, 0, 48, 1, 48, 4, 0]);
  // arena rows are [x y z sx sy sz mat type]; the buffer layout is [x y z mat sx sy sz type]
  boxes.forEach((b, i) => [b[0], b[1], b[2], b[6], b[3], b[4], b[5], b[7]].forEach((v, k) => (A.WB[base + i * A.BF + k] = v)));
  A.sN[slot] = boxes.length;
}
// 1. long flat roof at y=20 along -z, with an obstacle course
arena([
  [4, 0, 2, 10, 20, 44, 0.1, 0],        // roof from z=2..46, x=4..14
  [5, 20, 20, 3, 1.0, 1, 1.1, 0],       // 1 m vault obstacle at z=20
  [30, 0, 2, 10, 30, 44, 0.2, 0],       // tall building x=30..40
  [20, 15, 2, 0.5, 20, 44, 2.3, 0],     // wall-run panel at x=20..20.5, z=2..46
  [4, 20, 30, 4, 3, 8, 0.4, 3],        // ramp on roof rising toward +z (z=30..38)
]);

// run
reset(); A.teleport(11.5, 20.01, 44); inp.f = 1;
run(1.5);
check('run speed', Math.abs(hs() - 10.5) < 0.6, `hs=${hs().toFixed(2)}`);

// slide boost
reset(); A.teleport(11.5, 20.01, 44); inp.f = 1; run(1.0); const before = hs(); inp.c = 1; run(0.05); const after = hs();
check('slide boost', after > before + 2, `${before.toFixed(2)} -> ${after.toFixed(2)}`);
run(0.6); check('slide keeps momentum', hs() > 9, `hs after 0.6s=${hs().toFixed(2)} slide=${A.pl.slide}`);

// vault: run toward -z into the obstacle at z=20..21 (start at 30)
reset(); A.teleport(6.5, 20.01, 28); inp.f = 1; let vaulted = 0;
run(1.6, () => { if (A.ev.mantle) { vaulted = A.ev.mantle; A.ev.mantle = 0; } });
check('vault obstacle', vaulted > 0 && A.pos[2] < 20, `rise=${vaulted.toFixed?.(2)} z=${A.pos[2].toFixed(2)} hs=${hs().toFixed(2)}`);

// jump + no fall-through at high speed
reset(); A.teleport(9, 60, 10); A.vel[1] = -65; run(1.5);
check('no tunnelling at 65 m/s', A.pos[1] > 19.9 && A.pos[1] < 20.2 && A.pl.ground, `y=${A.pos[1].toFixed(3)} ground=${A.pl.ground}`);

// ramp: walk up the ramp (z 38 -> 30 rising toward +z means high end at z=38; walking -z from 44 hits the high end)
reset(); A.teleport(6, 20.01, 28); inp.f = 1; inp.yaw = Math.PI; // walk +z, up the ramp from its low end at z=30
run(1.2);
check('ramp climb', A.pos[1] > 22, `y=${A.pos[1].toFixed(2)} z=${A.pos[2].toFixed(2)}`);

// wall-run along the panel (x=20..20.5): start in the air beside it, moving -z
reset(); A.teleport(19.4, 30, 44); A.vel[2] = -12; A.vel[1] = 2; A.pl.airT = 0.2; inp.f = 1; let wr = 0;
run(0.8, () => { if (A.pl.wall) wr++; });
check('wall-run', wr > 60, `steps on wall=${wr} y=${A.pos[1].toFixed(2)} z=${A.pos[2].toFixed(2)}`);

// grapple: look at the tall building and hold
reset(); A.teleport(9, 20.01, 10); inp.yaw = -Math.PI / 2; inp.pitch = 0.3; inp.g = 1; let gmax = 0;
run(1.2, () => { gmax = Math.max(gmax, Math.hypot(A.vel[0], A.vel[1], A.vel[2])); });
check('grapple pull', A.pl.grap || A.pos[0] > 20, `grap=${A.pl.grap} x=${A.pos[0].toFixed(2)} vmax=${gmax.toFixed(1)}`);

// bunny hop + air strafe gains speed
arena([[0, 0, 0, 48, 10, 48, 0.1, 0]]);
reset(); A.teleport(24, 10.01, 46); inp.f = 1; run(0.8); inp.f = 0;
let t = 0;
run(2.6, (i) => { t = i / 120; const ph = Math.floor(t / 0.35) % 2; inp.s = ph ? 1 : -1; const vyaw = Math.atan2(-A.vel[0], -A.vel[2]); inp.yaw = vyaw + (ph ? -1 : 1) * 0.02; if (A.pl.ground) inp.jq = 1; });
let air = 0, hmax = 0; run(1.5, (i) => { const ph = Math.floor(i / 42) % 2; inp.s = ph ? 1 : -1; inp.yaw = Math.atan2(-A.vel[0], -A.vel[2]) + (ph ? -1 : 1) * 0.02; if (A.pl.ground) inp.jq = 1; else air++; hmax = Math.max(hmax, hs()); });
check('air strafe gains', hmax > 11.5, `max hs=${hmax.toFixed(2)} air=${(air / 180 * 100).toFixed(0)}% y=${A.pos[1].toFixed(1)} (run speed 10.5)`);

// dash
reset(); A.teleport(9, 40, 10); inp.dq = 1; run(0.05);
check('air dash', hs() >= 13.9, `hs=${hs().toFixed(2)}`);

// procedural city sanity: chunks generate, boxes inside bounds
let tot = 0, maxN = 0;
for (let cx = -20; cx < 20; cx++) for (let cz = -20; cz < 20; cz++) { const buf = new Float32Array(A.MAXB * A.BF); A.genChunk(cx, cz, buf, 0); const n = vm.runInContext('gN', ctx); tot += n; maxN = Math.max(maxN, n); }
check('city generation', maxN <= A.MAXB, `avg ${(tot / 1600).toFixed(1)} boxes/chunk, max ${maxN}`);
const t0 = performance.now(); for (let i = 0; i < 2000; i++) { const b = new Float32Array(A.MAXB * A.BF); A.genChunk(i, -i, b, 0); }
console.log(`      genChunk: ${((performance.now() - t0) / 2000 * 1000).toFixed(1)} us/chunk`);
const t1 = performance.now(); reset(); A.teleport(11.5, 20.01, 44); inp.f = 1; run(10);
console.log(`      step: ${((performance.now() - t1) / 1200 * 1000).toFixed(2)} us/step`);
process.exit(fails ? 1 : 0);

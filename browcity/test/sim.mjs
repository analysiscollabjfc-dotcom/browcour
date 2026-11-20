// Headless tests: city generation and (later) driving / walking, running the real code in a Node VM.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(f.startsWith('../') ? path.join(here, '..', '..', 'source', 'src', f.slice(3)) : path.join(here, '..', 'src', f), 'utf8');
export const FILES = ['../math.js', 'vehicles.js', 'layout.js'];
const ctx = vm.createContext({ Math, console, performance });
vm.runInContext('const LV = 0, R = 4;\n' + FILES.map(src).join('\n') + '\nglobalThis.T = { genBlock, stream, sN, sC, sP, sR, sH, MAXB, MAXC, MAXP, MAXR, SLOTS, lineP, lineC, cellOf, WB, BF, gather, groundAt, rayBuildings };', ctx);
const T = ctx.T;
let fails = 0;
const check = (n, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`); if (!ok) fails++; };
// generation
let mb = 0, mc = 0, mp = 0, mr = 0, tb = 0;
const t0 = performance.now();
for (let i = -12; i < 12; i++) for (let j = -12; j < 12; j++) { T.genBlock(i, j, 0); mb = Math.max(mb, T.sN[0]); mc = Math.max(mc, T.sC[0]); mp = Math.max(mp, T.sP[0]); mr = Math.max(mr, T.sR[0]); tb += T.sN[0]; }
const dt = (performance.now() - t0) / 576;
check('block budgets', mb < T.MAXB && mc < T.MAXC && mp <= T.MAXP && mr < T.MAXR, `max boxes ${mb}/${T.MAXB}, capsules ${mc}/${T.MAXC}, parked ${mp}/${T.MAXP}, circles ${mr}/${T.MAXR}, avg boxes ${(tb / 576).toFixed(0)}`);
check('generation speed', dt < 2, `${(dt * 1000).toFixed(0)} us/block`);
// streets: realistic widths and spacing
let minGap = 1e9;
for (let i = -50; i < 50; i++) minGap = Math.min(minGap, T.lineP(i + 1, 0) - T.lineP(i, 0));
check('block spacing', minGap > 70, `min street spacing ${minGap.toFixed(1)} m`);
const t1 = performance.now(); T.stream(0, 0); console.log(`      first stream (${T.SLOTS} blocks): ${(performance.now() - t1).toFixed(0)} ms`);
// ground: asphalt 0 on the street, 0.15 on the sidewalk
T.gather(-5, -5, 5, 5);
check('street ground', T.groundAt(T.lineP(0, 0), T.lineP(0, 1) + 0.5, 1, 0.5) === 0, 'intersection is asphalt at y=0');
process.exitCode = fails ? 1 : 0;

// ============================================================================
// WebGPU renderer. Static per-block buffers (boxes, capsules, parked cars) are uploaded once when a block streams
// in; moving things (traffic, people, blob shadows) are rewritten each frame into fixed-size buffers. The sun moves,
// but the shadow map is still cached: it is redrawn only when the sun has turned ~0.1 deg, the view moved a
// 64-texel step, or blocks changed (a few times a second instead of every frame).
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const fail = (m) => { throw new Error(m, { cause: 1 }); };
if (!navigator.gpu) fail('Browcity needs WebGPU. Try a current Chrome, Edge, Safari or Firefox.');
keep('browcityLoad', 1);
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
const device = await adapter.requestDevice();
let dead = 0;
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
device.lost.then((l) => {
  if (l.reason === 'destroyed') return;
  dead = 1;
  if (LV < 2) { keep('browcity', LV + 1); location.reload(); }
  else { document.body.className = 'm e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.'; }
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
const Q = device.queue, TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage, DF = 'depth32float';

const tShadow = device.createTexture({ size: [SHRES, SHRES], format: 'depth16unorm', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
const tDummy = device.createTexture({ size: [1, 1], format: 'depth16unorm', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
// uniforms (floats): vp 0, sp 16, cam 32, sun 36 (light dir, fog), sunc 40 (colour, night), amb 44 (sky ambient,
// exposure), ambg 48 (ground ambient, signal clock), zen 52 (zenith, stars), hor 56 (horizon, sun disk), sdir 60,
// scr 64, cr 68, cu 72, cf 76, hl0 80 (headlights pos, on), hl1 84 (dir)
const UB = new Float32Array(88);
const ubo = device.createBuffer({ size: UB.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
const vbuf = (n) => device.createBuffer({ size: n, usage: BU.VERTEX | BU.COPY_DST });
const wbBuf = vbuf(WB.byteLength), cbBuf = vbuf(CB.byteLength), pbBuf = vbuf(PB.byteLength);
// per-frame buffers: capsules (people, wheels, lights), car boxes, blob shadows
const MAXDC = 2600, MAXDO = 360, MAXDD = 240;
const DC = new Float32Array(MAXDC * CF), DO = new Float32Array(MAXDO * OF), DD = new Float32Array(MAXDD * OF);
let nDC = 0, nDO = 0, nDD = 0;
const dcBuf = vbuf(DC.byteLength), doBuf = vbuf(DO.byteLength), ddBuf = vbuf(DD.byteLength);
const VF = SS.VERTEX | SS.FRAGMENT;
const bgl = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: SS.FRAGMENT, texture: { sampleType: 'depth' } },
  { binding: 2, visibility: SS.FRAGMENT, sampler: { type: 'comparison' } }] });
const mkBG = (t) => device.createBindGroup({ layout: bgl, entries: [
  { binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: sCmp }] });
const bgMain = mkBG(tShadow), bgShadow = mkBG(tDummy);
const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
const sm = device.createShaderModule({ code: W_CITY });
const VB8 = [{ arrayStride: 32, stepMode: 'instance', attributes: [
  { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }];
const VB12 = [{ arrayStride: 48, stepMode: 'instance', attributes: [
  { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }] }];
const BLEND = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
const pipe = (vs, fs, o) => device.createRenderPipelineAsync({
  layout, vertex: { module: sm, entryPoint: vs, buffers: o.vb === 12 ? VB12 : o.vb === 8 ? VB8 : [] },
  fragment: fs ? { module: sm, entryPoint: fs, targets: o.sh ? [] : [{ format: FMT, blend: o.blend ? BLEND : undefined }] } : undefined,
  primitive: { cullMode: o.cull || 'none' }, multisample: { count: o.sh ? 1 : AA },
  depthStencil: { format: o.sh ? 'depth16unorm' : DF, depthWriteEnabled: !!o.dw, depthCompare: o.dc || 'greater',
    depthBias: o.sh ? 2 : 0, depthBiasSlopeScale: o.sh ? 2.5 : 0 } });
const [pMain, pShadow, pCapS, pCap, pObx, pDecal, pSky] = await Promise.all([
  pipe('vs', 'fs', { vb: 8, cull: 'back', dw: 1 }),
  pipe('vss', null, { vb: 8, cull: 'back', dw: 1, dc: 'less', sh: 1 }),
  pipe('vscs', 'fscs', { vb: 12, dw: 1, dc: 'less', sh: 1, cull: 'front' }),
  pipe('vsc', 'fsc', { vb: 12, dw: 1, cull: 'front' }),
  pipe('vso', 'fso', { vb: 12, dw: 1, cull: 'back' }),
  pipe('vso', 'fsd', { vb: 12, blend: 1 }),
  pipe('vsq', 'fsk', { dc: 'equal' }),
]);

let tColor = null, tDepth = null, msView = null, cw = 0, chh = 0, offView = null;
const colorAtt = { view: null, resolveTarget: undefined, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' };
const depthAtt = { view: null, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' };
const mainPass = { colorAttachments: [colorAtt], depthStencilAttachment: depthAtt };
const shadowPass = { colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } };
const SUB = [null];
function resize() {
  const dpr = min(devicePixelRatio || 1, 2);
  const w = max(16, round(canvas.clientWidth * dpr * scale)), h = max(16, round(canvas.clientHeight * dpr * scale));
  if (w === cw && h === chh) return;
  cw = canvas.width = w; chh = canvas.height = h;
  if (tDepth) tDepth.destroy();
  if (tColor) tColor.destroy();
  tDepth = device.createTexture({ size: [w, h], format: DF, sampleCount: AA, usage: TU.RENDER_ATTACHMENT });
  depthAtt.view = tDepth.createView();
  if (AA > 1) {
    tColor = device.createTexture({ size: [w, h], format: FMT, sampleCount: AA, usage: TU.RENDER_ATTACHMENT });
    msView = tColor.createView(); colorAtt.storeOp = 'discard';
  }
}

// ---------------------------------------------------------------- culling
const PL = new Float32Array(20), VIS = new Int32Array(SLOTS), VISD = new Float32Array(SLOTS);
function planes(m) {
  for (let p = 0; p < 5; p++) {
    const r = p === 4 ? 2 : p >> 1, s = p === 4 ? -1 : p & 1 ? -1 : 1;
    for (let k = 0; k < 4; k++) PL[p * 4 + k] = m[k * 4 + 3] + s * m[k * 4 + r];
  }
}
function boxVisible(x0, y0, z0, x1, y1, z1) {
  for (let p = 0; p < 5; p++) {
    const a = PL[p * 4], b = PL[p * 4 + 1], c = PL[p * 4 + 2], d = PL[p * 4 + 3];
    if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------- shadow map placement
const SPM = UB.subarray(16, 32), MT = new Float32Array(16), LS = new Float32Array(3), LSL = new Float32Array(3);
const SH_HALF = 150, SH_DIST = 400;
let shDirty = 1, shKx = 1e9, shKy = 1e9, drawCalls = 0;
function placeShadow(px, pz) {
  // redraw when the light has turned enough (cos 0.1 deg) or the frustum steps
  const turned = LS[0] * LSL[0] + LS[1] * LSL[1] + LS[2] * LSL[2] < 0.9999985;
  const fx = -LS[0], fy = -LS[1], fz = -LS[2];
  let rx = -fz, rz = fx; const rl = hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const stp = (2 * SH_HALF / SHRES) * 64, py = 10;
  const a = px * rx + pz * rz, b = px * ux + py * uy + pz * uz;
  const kx = round(a / stp), ky = round(b / stp);
  if (kx === shKx && ky === shKy && !turned && !shDirty) return;
  shKx = kx; shKy = ky; shDirty = 1; LSL[0] = LS[0]; LSL[1] = LS[1]; LSL[2] = LS[2];
  const da = kx * stp - a, db = ky * stp - b;
  lightMat(SPM, MT, LS, px + rx * da + ux * db, py + uy * db, pz + rz * da + uz * db, SH_HALF, SH_DIST, SH_DIST * 2);
}

function renderFrame(camx, camz) {
  for (let s = 0; s < SLOTS; s++) if (sDirty[s]) {
    sDirty[s] = 0; shDirty = 1;
    Q.writeBuffer(wbBuf, s * MAXB * BF * 4, WB.buffer, s * MAXB * BF * 4, sN[s] * BF * 4);
    if (sC[s]) Q.writeBuffer(cbBuf, s * MAXC * CF * 4, CB.buffer, s * MAXC * CF * 4, sC[s] * CF * 4);
    if (sP[s]) Q.writeBuffer(pbBuf, s * MAXP * 3 * OF * 4, PB.buffer, s * MAXP * 3 * OF * 4, sP[s] * 3 * OF * 4);
  }
  Q.writeBuffer(ubo, 0, UB);
  if (nDC) Q.writeBuffer(dcBuf, 0, DC, 0, nDC * CF);
  if (nDO) Q.writeBuffer(doBuf, 0, DO, 0, nDO * OF);
  if (nDD) Q.writeBuffer(ddBuf, 0, DD, 0, nDD * OF);
  const enc = device.createCommandEncoder();
  drawCalls = 0;
  if (shDirty) {
    shDirty = 0;
    const p = enc.beginRenderPass(shadowPass);
    p.setBindGroup(0, bgShadow);
    p.setPipeline(pShadow); p.setVertexBuffer(0, wbBuf);
    const lim = SH_HALF * 1.5 + BS;
    for (let s = 0; s < SLOTS; s++) {
      if (sI[s] < -0x3fffffff || abs((sX0[s] + sX1[s]) / 2 - camx) > lim || abs((sZ0[s] + sZ1[s]) / 2 - camz) > lim) continue;
      p.draw(36, sMaj[s], 0, s * MAXB); drawCalls++;
    }
    p.setPipeline(pCapS); p.setVertexBuffer(0, cbBuf);
    for (let s = 0; s < SLOTS; s++) {
      if (sI[s] < -0x3fffffff || !sCMaj[s] || abs((sX0[s] + sX1[s]) / 2 - camx) > lim || abs((sZ0[s] + sZ1[s]) / 2 - camz) > lim) continue;
      p.draw(36, sCMaj[s], 0, s * MAXC); drawCalls++;
    }
    p.end();
  }
  planes(UB);
  let nv = 0;
  for (let s = 0; s < SLOTS; s++) {
    if (sI[s] < -0x3fffffff || !boxVisible(sX0[s], -1, sZ0[s], sX1[s], sH[s] + 2, sZ1[s])) continue;
    const dx = (sX0[s] + sX1[s]) / 2 - camx, dz = (sZ0[s] + sZ1[s]) / 2 - camz, d = dx * dx + dz * dz;
    let j = nv++;
    while (j > 0 && VISD[j - 1] > d) { VIS[j] = VIS[j - 1]; VISD[j] = VISD[j - 1]; j--; }
    VIS[j] = s; VISD[j] = d;
  }
  const view = offView || ctx.getCurrentTexture().createView();
  if (AA > 1) { colorAtt.view = msView; colorAtt.resolveTarget = view; } else colorAtt.view = view;
  const p = enc.beginRenderPass(mainPass);
  p.setBindGroup(0, bgMain);
  p.setPipeline(pMain); p.setVertexBuffer(0, wbBuf);
  for (let k = 0; k < nv; k++) { const s = VIS[k]; p.draw(36, sN[s], 0, s * MAXB); }
  // cars: parked (static per block, near only) and moving
  p.setPipeline(pObx); p.setVertexBuffer(0, pbBuf);
  const near = 280 * 280, mid = 190 * 190;
  for (let k = 0; k < nv; k++) { const s = VIS[k]; if (sP[s] && VISD[k] < near) { p.draw(36, sP[s] * 3, 0, s * MAXP * 3); drawCalls++; } }
  if (nDO) { p.setVertexBuffer(0, doBuf); p.draw(36, nDO); drawCalls++; }
  // capsules: trees everywhere, lamps / signals / wheels up close, then people and traffic details
  p.setPipeline(pCap); p.setVertexBuffer(0, cbBuf);
  for (let k = 0; k < nv; k++) { const s = VIS[k], n = VISD[k] < mid ? sC[s] : sCMaj[s]; if (n) { p.draw(36, n, 0, s * MAXC); drawCalls++; } }
  if (nDC) { p.setVertexBuffer(0, dcBuf); p.draw(36, nDC); drawCalls++; }
  if (nDD) { p.setPipeline(pDecal); p.setVertexBuffer(0, ddBuf); p.draw(36, nDD); drawCalls++; }
  p.setPipeline(pSky); p.draw(3);
  p.end();
  SUB[0] = enc.finish(); Q.submit(SUB);
  drawCalls += nv + 1;
}

// ============================================================================
// WebGPU renderer: one instanced draw per visible chunk, a shadow map that is only redrawn when it has to be,
// reversed-Z depth, MSAA. Per frame it allocates nothing of its own (only what the WebGPU API returns).
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
if (!navigator.gpu) fail('Browcour needs WebGPU. Try a current Chrome, Edge, Safari or Firefox.');
keep('browcourLoad', 1);
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
const device = await adapter.requestDevice();
let dead = 0;
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
device.lost.then((l) => {
  if (l.reason === 'destroyed') return;
  dead = 1;
  if (LV < 2) { keep('browcour', LV + 1); location.reload(); }
  else { document.body.className = 'e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.'; }
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
const Q = device.queue, TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage, DF = 'depth32float';

// ---------------------------------------------------------------- resources (all fixed size, made once)
const tShadow = device.createTexture({ size: [SHRES, SHRES], format: 'depth16unorm', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
const tDummy = device.createTexture({ size: [1, 1], format: 'depth16unorm', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
// uniforms: vp 0, sp 16, cam 32 (xyz, time), sun 36 (dir, fog), fx 40 (lines, -, -, exposure), r0 44, r1 48 (rope),
// scr 52 (w, h, 1/shadow res, aspect), cr 56, cu 60, cf 64 (camera ray basis for the sky)
const UB = new Float32Array(68);
const ubo = device.createBuffer({ size: UB.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
const instBuf = device.createBuffer({ size: WB.byteLength, usage: BU.VERTEX | BU.COPY_DST });
const NBEAM = 8, BEAM = new Float32Array(NBEAM * BF);
const beamBuf = device.createBuffer({ size: BEAM.byteLength, usage: BU.VERTEX | BU.COPY_DST });
let nBeam = 0;
const VF = SS.VERTEX | SS.FRAGMENT;
const bgl = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: SS.FRAGMENT, texture: { sampleType: 'depth' } },
  { binding: 2, visibility: SS.FRAGMENT, sampler: { type: 'comparison' } }] });
const mkBG = (t) => device.createBindGroup({ layout: bgl, entries: [
  { binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: sCmp }] });
const bgMain = mkBG(tShadow), bgShadow = mkBG(tDummy); // the shadow pass can't sample the map it draws into
const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
const sm = device.createShaderModule({ code: W_MAIN });
const VB = [{ arrayStride: BF * 4, stepMode: 'instance', attributes: [
  { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }];
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pipe = (vs, fs, o) => device.createRenderPipelineAsync({
  layout, vertex: { module: sm, entryPoint: vs, buffers: o.vb ? VB : [] },
  fragment: fs ? { module: sm, entryPoint: fs, targets: [{ format: FMT, blend: o.add ? ADD : undefined }] } : undefined,
  primitive: { cullMode: o.cull || 'none' }, multisample: { count: o.sh ? 1 : AA },
  depthStencil: { format: o.sh ? 'depth16unorm' : DF, depthWriteEnabled: !!o.dw, depthCompare: o.dc || 'greater',
    depthBias: o.sh ? 2 : 0, depthBiasSlopeScale: o.sh ? 2.5 : 0 } });
const [pMain, pShadow, pSky, pBeam, pRope, pLines] = await Promise.all([
  pipe('vs', 'fs', { vb: 1, cull: 'back', dw: 1 }),
  pipe('vss', null, { vb: 1, cull: 'back', dw: 1, dc: 'less', sh: 1 }),
  pipe('vsq', 'fsk', { dc: 'equal' }),
  pipe('vs', 'fsb', { vb: 1, add: 1 }),
  pipe('vsr', 'fsr', { dw: 1 }),
  pipe('vsq', 'fsl', { add: 1, dc: 'always' }),
]);

// ---------------------------------------------------------------- render targets (only rebuilt on resize)
let tColor = null, tDepth = null, msView = null, cw = 0, chh = 0, offView = null; // offView: dev capture target
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
  // w+x, w-x, w+y, w-y, w-z (near; reversed-Z has no far plane)
  for (let p = 0; p < 5; p++) {
    const r = p >> 1, s = p === 4 ? -1 : p & 1 ? -1 : 1, rr2 = p === 4 ? 2 : r;
    for (let k = 0; k < 4; k++) PL[p * 4 + k] = m[k * 4 + 3] + s * m[k * 4 + rr2];
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
// The light frustum is snapped to whole shadow texels in light space, so static shadows never crawl, and it moves in
// 64-texel steps: the map is redrawn only when it moves or the chunks under it change (not every frame).
const SUN = new Float32Array([0.55, 0.52, 0.66]); // late afternoon: long shadows
{ const l = hypot(SUN[0], SUN[1], SUN[2]); SUN[0] /= l; SUN[1] /= l; SUN[2] /= l; }
const SH_HALF = 110, SH_DIST = 350, MT = new Float32Array(16);
let shDirty = 1, shKx = 1e9, shKy = 1e9, drawCalls = 0;
const SPM = UB.subarray(16, 32);
function placeShadow(px, pz) {
  // light basis: r = normalize(f x up), u = r x f, with f = -SUN
  const fx = -SUN[0], fy = -SUN[1], fz = -SUN[2];
  let rx = -fz, rz = fx; const rl = hypot(rx, rz); rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const stp = (2 * SH_HALF / SHRES) * 64, py = 30;
  const a = px * rx + pz * rz, b = px * ux + py * uy + pz * uz;
  const kx = round(a / stp), ky = round(b / stp);
  if (kx === shKx && ky === shKy) return;
  shKx = kx; shKy = ky; shDirty = 1;
  const da = kx * stp - a, db = ky * stp - b;
  lightMat(SPM, MT, SUN, px + rx * da + ux * db, py + uy * db, pz + rz * da + uz * db, SH_HALF, SH_DIST, SH_DIST * 2);
}

function renderFrame(camx, camy, camz, rope, lines) {
  for (let s = 0; s < SLOTS; s++) if (sDirty[s]) {
    sDirty[s] = 0; shDirty = 1;
    Q.writeBuffer(instBuf, s * MAXB * BF * 4, WB.buffer, s * MAXB * BF * 4, sN[s] * BF * 4);
  }
  Q.writeBuffer(ubo, 0, UB);
  const enc = device.createCommandEncoder();
  drawCalls = 0;
  if (shDirty) {
    shDirty = 0;
    const p = enc.beginRenderPass(shadowPass);
    p.setPipeline(pShadow); p.setBindGroup(0, bgShadow); p.setVertexBuffer(0, instBuf);
    for (let s = 0; s < SLOTS; s++) {
      if (sCX[s] < -0x3fffffff) continue;
      const dx = abs(sCX[s] * CH + CH / 2 - camx), dz = abs(sCZ[s] * CH + CH / 2 - camz);
      if (dx > SH_HALF * 1.6 + CH || dz > SH_HALF * 1.6 + CH) continue;
      p.draw(36, sMaj[s], 0, s * MAXB); drawCalls++;
    }
    p.end();
  }
  // visible chunks, nearest first (early depth rejection), small clutter only up close
  planes(UB);
  let nv = 0;
  for (let s = 0; s < SLOTS; s++) {
    if (sCX[s] < -0x3fffffff) continue;
    const x0 = sCX[s] * CH, z0 = sCZ[s] * CH;
    if (!boxVisible(x0, -1, z0, x0 + CH, sH[s], z0 + CH)) continue;
    const dx = x0 + CH / 2 - camx, dz = z0 + CH / 2 - camz, d = dx * dx + dz * dz;
    let j = nv++;
    while (j > 0 && VISD[j - 1] > d) { VIS[j] = VIS[j - 1]; VISD[j] = VISD[j - 1]; j--; }
    VIS[j] = s; VISD[j] = d;
  }
  const view = offView || ctx.getCurrentTexture().createView();
  if (AA > 1) { colorAtt.view = msView; colorAtt.resolveTarget = view; } else colorAtt.view = view;
  const p = enc.beginRenderPass(mainPass);
  p.setBindGroup(0, bgMain); p.setPipeline(pMain); p.setVertexBuffer(0, instBuf);
  const near2 = (CH * 2.6) * (CH * 2.6);
  for (let k = 0; k < nv; k++) { const s = VIS[k]; p.draw(36, VISD[k] < near2 ? sN[s] : sMaj[s], 0, s * MAXB); }
  drawCalls += nv;
  p.setPipeline(pSky); p.draw(3);
  if (nBeam) { p.setPipeline(pBeam); p.setVertexBuffer(0, beamBuf); p.draw(36, nBeam); }
  if (rope) { p.setPipeline(pRope); p.draw(6); }
  if (lines) { p.setPipeline(pLines); p.draw(3); }
  p.end();
  SUB[0] = enc.finish(); Q.submit(SUB);
  drawCalls += 1 + (nBeam ? 1 : 0) + rope + lines;
}

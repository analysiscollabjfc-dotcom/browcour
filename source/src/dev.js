// ============================================================================
// dev.html only: exposes game state and a GPU readback screenshot for automated tests
// (headless browsers often can't capture a WebGPU canvas, so frames are rendered offscreen and read back)
// ============================================================================
window.__bc = {
  pos, vel, ppos, inp, pl, keys, UB, camS, CPS, WB, sN, sCX, SLOTS, MAXB, BF, sg, teleport, stream, startRoute,
  setLocked: (v) => { locked = v; body.classList.toggle('m', !v); },
  get dc() { return drawCalls; }, get scale() { return scale; }, set scale(v) { scale = v; },
  async capture() {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t = window.__off;
    const w = t.width, h = t.height, bpr = Math.ceil(w * 4 / 256) * 256;
    const B = device.createBuffer({ size: bpr * h, usage: BU.COPY_DST | BU.MAP_READ });
    const e = device.createCommandEncoder();
    e.copyTextureToBuffer({ texture: t }, { buffer: B, bytesPerRow: bpr }, [w, h]);
    Q.submit([e.finish()]);
    await B.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(B.getMappedRange()), out = new Uint8ClampedArray(w * h * 4), bgra = FMT.startsWith('bgra');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * bpr + x * 4, o = (y * w + x) * 4;
      out[o] = src[i + (bgra ? 2 : 0)]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + (bgra ? 0 : 2)]; out[o + 3] = 255;
    }
    B.destroy();
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    c2.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
    return c2.toDataURL('image/png');
  },
};

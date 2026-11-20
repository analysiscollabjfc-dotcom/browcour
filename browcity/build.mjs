// Bundles src/*.js (plus Browcour's math.js) into the single self-contained ../browcity.html
//   npm run build            minified + self-extracting
//   npm run build:readable   ../browcity-dev.html: unminified, with test hooks (src/dev.js)
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
// concatenation order matters: later files use earlier ones
const FILES = ['quality.js', '../math.js', 'vehicles.js', 'layout.js', 'shaders.js', 'render.js', 'people.js', 'traffic.js', 'player.js', 'audio.js', 'game.js'];
const readable = process.argv.includes('--readable');
const out = readable ? 'browcity-dev.html' : 'browcity.html';
const rd = (f) => readFileSync(f.startsWith('../') ? path.join(here, '..', 'source', 'src', f.slice(3)) : path.join(here, 'src', f), 'utf8');
let js = FILES.map(rd).join('\n');
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
const wrap = (b) => `(async()=>{${b}\n})().catch(e=>{console.error(e);document.body.className='m e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;

let html;
if (readable) {
  // ?cap: never configure the canvas; render offscreen for dev.js to read back (headless browsers), one frame in flight
  const CAP = "location.search.includes('cap')";
  js = js.replace('ctx.configure({', `if (!${CAP}) ctx.configure({`)
    .replace('renderFrame(px, pz);', `if (${CAP} && window.__busy) return; if (${CAP}) { window.__busy = 1; Q.onSubmittedWorkDone().then(() => { window.__busy = 0; }); }\n  renderFrame(px, pz);`)
    .replace('viewYPR(VM, CB9, ex, ey, ez, camYaw, camPitch, 0);', 'if (window.__cam) { const c = window.__cam; ex = c[0]; ey = c[1]; ez = c[2]; viewYPR(VM, CB9, ex, ey, ez, c[3], c[4], 0); } else viewYPR(VM, CB9, ex, ey, ez, camYaw, camPitch, 0);') // dev free camera
    .replace('depthAtt.view = tDepth.createView();', `depthAtt.view = tDepth.createView();\n  if (${CAP}) { if (window.__off) __off.destroy(); window.__off = device.createTexture({ size: [w, h], format: FMT, usage: TU.RENDER_ATTACHMENT | TU.COPY_SRC }); offView = __off.createView(); }`);
  html = tpl.replace('/*SCRIPT*/', () => wrap(js + '\n' + rd('dev.js')));
} else {
  const minWgsl = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@^]) ?/g, '$1').trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '`' + minWgsl(w) + '`');
  const code = transformSync(wrap(js), { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  const css = (_, s) => '<style>' + transformSync(s, { loader: 'css', minify: true }).code.trim();
  const packed = deflateRawSync(Buffer.from(code), { level: 9 }).toString('base64');
  const loader = `fetch("data:;base64,${packed}").then(r=>new Response(r.body.pipeThrough(new DecompressionStream("deflate-raw"))).text()).then(eval).catch(e=>{document.body.className="m e";document.getElementById("s").textContent="Failed to start: "+e.message})`;
  html = tpl.replace(/<style>([^]*?)(?=<\/style>)/, css).replace(/>\s+</g, '><').replace('/*SCRIPT*/', () => (loader.length < code.length ? loader : code));
  console.log(`code ${(code.length / 1024).toFixed(1)} kB -> packed ${(loader.length / 1024).toFixed(1)} kB`);
}
writeFileSync(path.join(here, '..', out), html);
console.log(`${out}: ${(html.length / 1024).toFixed(1)} kB${readable ? ' (readable)' : ''}, ${(gzipSync(Buffer.from(html), { level: 9 }).length / 1024).toFixed(1)} kB gzipped`);

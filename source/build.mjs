// Bundles src/*.js into the single self-contained ../index.html
//   npm run build            minified
//   npm run build:readable   unminified, for debugging
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
// concatenation order matters: later files use earlier ones
const FILES = ['quality.js', 'math.js', 'city.js', 'player.js', 'shaders.js', 'audio.js', 'render.js', 'body.js', 'singer.js', 'touch.js', 'game.js'];
const readable = process.argv.includes('--readable');
const out = readable ? 'dev.html' : 'index.html';

let js = FILES.map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
// inline binary assets
js = js.replace("'__POSTERS__'", () => "'" + readFileSync(path.join(here, 'assets', 'posters.avif')).toString('base64') + "'");
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
// everything runs inside one async function; startup errors are shown on screen
const wrap = (b) => `(async()=>{${b}\n})().catch(e=>{console.error(e);document.body.className='m e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;

let html;
// dev.html exposes the game state for automated screenshots and tests
if (readable) {
  // ?cap: never configure the canvas, render into an offscreen texture that dev.js reads back
  const CAP = "location.search.includes('cap')";
  js = js.replace('ctx.configure({', `if (!${CAP}) ctx.configure({`)
    // no swapchain means no back-pressure: keep one frame in flight
    .replace('renderFrame(px, ey, pz,', `if (${CAP} && window.__busy) return; if (${CAP}) { window.__busy = 1; Q.onSubmittedWorkDone().then(() => { window.__busy = 0; }); }\n  renderFrame(px, ey, pz,`)
    .replace('time, singing);', 'time, singing || window.__sing);') // headless: no audio, show the singing pose anyway
    .replace('depthAtt.view = tDepth.createView();', `depthAtt.view = tDepth.createView();\n  if (${CAP}) { if (window.__off) __off.destroy(); window.__off = device.createTexture({ size: [w, h], format: FMT, usage: TU.RENDER_ATTACHMENT | TU.COPY_SRC }); offView = __off.createView(); }`);
}
if (readable) html = tpl.replace('/*SCRIPT*/', () => wrap(js + '\n' + readFileSync(path.join(here, 'src', 'dev.js'), 'utf8')));
else {
  // shrink the WGSL inside /*wgsl*/ template literals, then minify the JS and the page's CSS
  const minWgsl = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@^]) ?/g, '$1').trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '`' + minWgsl(w) + '`');
  const code = transformSync(wrap(js), { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  const css = (_, s) => '<style>' + transformSync(s, { loader: 'css', minify: true }).code.trim();
  // self-extracting: the minified code (and the posters inside it) deflated, base64'd and inflated by the browser's
  // own DecompressionStream at start-up (a few ms). Used only when it is actually smaller.
  const packed = deflateRawSync(Buffer.from(code), { level: 9 }).toString('base64');
  const loader = `fetch("data:;base64,${packed}").then(r=>new Response(r.body.pipeThrough(new DecompressionStream("deflate-raw"))).text()).then(eval).catch(e=>{document.body.className="m e";document.getElementById("s").textContent="Failed to start: "+e.message})`;
  const body = loader.length < code.length ? loader : code;
  html = tpl.replace(/<style>([^]*?)(?=<\/style>)/, css).replace(/>\s+</g, '><').replace('/*SCRIPT*/', () => body);
  console.log(`code ${(code.length / 1024).toFixed(1)} kB -> packed ${(loader.length / 1024).toFixed(1)} kB`);
}
writeFileSync(path.join(here, '..', out), html);
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
console.log(`${out}: ${(html.length / 1024).toFixed(1)} kB${readable ? ' (readable)' : ''}, ${(gz / 1024).toFixed(1)} kB gzipped`);

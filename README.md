# Browcour

**A first-person parkour game in an endless procedural rooftop city, in one ~57 KB HTML file.**

No engine, no models, no sound files. Everything is generated at run time: the city from a seed, the surface detail in the shaders, the sound with the Web Audio API. The only image is one 11 KB poster atlas.

A red-haired singer in white headphones follows you through the city, retracing your exact path, and sings an original synthesized dream-pop melody, placed in 3D at her position. Stop and she comes round to sing to you. Drop an audio file on the page (or pick one in the menu) and she sings that instead. Posters appear on walls across the city.

## Also in this repo: Browcity

[`browcity.html`](browcity.html): an endless European city with day and night, traffic and pedestrians, which you walk in third person and drive through. Same engine ideas, ~40 KB. See [`browcity/README.md`](browcity/README.md).

## Play

Open [`index.html`](index.html) in a browser with **WebGPU**: current Chrome/Edge, Safari 26+, or Firefox 141+ on Windows. Press **Run**.

| Input | Move |
|---|---|
| `W` `A` `S` `D` | Run. In the air, strafe + turn the mouse the same way to gain speed (air-strafing) |
| `Space` | Jump · in the air: double jump · next to a wall: wall-kick. Jump right as you land (bunny-hop) to keep your speed |
| `Shift` / `C` | Slide: speed boost, accelerates down slopes. In the air: fast-fall; land in a slide to turn the fall into forward speed |
| Mouse 1 / `E` | Grapple: the hook flies from your wrist launcher and bites; hold to swing, release to slingshot. A miss flies out and reels back |
| Mouse 2 / `F` / `Q` | Air dash |
| run along a wall | Wall-run (orange panels are made for it). Jump off it to chain wall-runs |
| run into a ledge | Low: vault without losing speed. Up to ~2.3 m: mantle. Facing a wall in the air: run up it |
| `R` | Restart the route / respawn |
| `1`–`5`, `0` | Start a checkpoint route, back to free run |
| `V` | Show / hide the singer |
| `M` `H` `Esc` | Sound, stats, menu |

Free run is the whole city. Blue beams mark the starts of 5 checkpoint routes; run into one (or press `1`–`5`) to race it. Best times are saved in the browser.

## How it is built

| File | What's inside |
|---|---|
| [`source/src/player.js`](source/src/player.js) | Movement and collision: the moves, all the tuning constants at the top |
| [`source/src/city.js`](source/src/city.js) | City generator, chunk streaming, collision and ray queries |
| [`source/src/shaders.js`](source/src/shaders.js) | WGSL: procedural facades, roofs, accents, asphalt, sky, shadows, speed lines |
| [`source/src/render.js`](source/src/render.js) | WebGPU setup and the frame |
| [`source/src/body.js`](source/src/body.js) | First-person body: procedural run / slide / wall-run / climb / mantle / air poses with two-bone IK, the wrist launcher, cable and hook |
| [`source/src/singer.js`](source/src/singer.js) | The follower: trail replay, idle positioning, her capsule model, music notes |
| [`source/src/game.js`](source/src/game.js) | Input, camera feel (FOV kick, wall-run roll, landing dip), routes, HUD |
| [`source/src/audio.js`](source/src/audio.js) | Synthesized sound, and the singer's formant voice, pad and reverb |
| [`source/assets/posters.avif`](source/assets/posters.avif) | The three posters in one 768×320 AVIF (11 KB). The singer's face is projected from the third |
| [`source/src/quality.js`](source/src/quality.js) | Detail levels |

### Memory and speed

- **One data format for everything.** The world is boxes and ramps, 8 floats each (`min xyz, material+seed, size xyz, type`). The same `Float32Array` is the collision data and the GPU instance buffer. A chunk is ≤56 boxes, about 1.8 KB.
- **Fixed pools, zero per-frame allocation.** Chunks live in a fixed set of slots around the player, indexed `mod(cx) + W·mod(cz)`, so streaming never allocates or searches. Physics and rendering write only into preallocated typed arrays. The GC never runs mid-run.
- **No vertex or index buffers.** The cube is generated from `vertex_index`. A ramp is the same cube with its top edge pulled down in the vertex shader.
- **One instanced draw per visible chunk.** Chunks are frustum-culled and drawn front-to-back for early depth rejection. Small rooftop clutter is skipped beyond ~125 m and in the shadow map.
- **Textures: zero (besides the shadow map).** Windows, concrete, seams, stripes and asphalt are computed from world position. `fwidth` anti-aliasing plus a fade to the pattern's average with distance means no shimmer or moiré.
- **The shadow map is only redrawn when it moves.** It is snapped to whole texels in light space (no crawling edges) and moves in 64-texel steps. It is redrawn only on those steps or when new chunks stream in, not every frame. It uses `depth16unorm` (half the memory of 32-bit).
- **The body is 30-odd ray-traced capsules.** Each limb is one instance: the vertex shader draws a box around it, the fragment shader intersects the exact capsule and writes its depth. You get round limbs at any distance from 36 vertices, with no meshes and no skinning. Thin parts (cable, hook prongs) never shrink below ~1 pixel.
- **Posters: one AVIF atlas, 11 KB.** It becomes a 3-layer sRGB texture array. The mip chain is made by the browser's own image scaler (`createImageBitmap` resize), so there is no mip shader. Posters are ordinary boxes in the city format with their own random stream, so adding them didn't change the existing city.
- **The singer costs almost nothing.** She replays the player's trail from a 240-sample ring buffer, so there is no path-finding. She is ~25 capsules, skipped when behind the camera or far away. Her face is the photo layer projected onto the head capsule. Audio pauses when the tab is hidden.
- **Self-extracting build.** The minified code and the inlined atlas are deflate-compressed and unpacked by the browser's `DecompressionStream` at start-up (a few ms): 73 kB of code becomes 51 kB.
- **Reversed-Z infinite projection** with `depth32float`: no far plane and no z-fighting at distance.
- **Adaptive resolution:** the render scale drops when frames run long and recovers with headroom. The result is remembered per device.
- **Fixed 120 Hz physics** with interpolated rendering. Collision is swept per axis, so nothing tunnels even at 70 m/s.

Detail levels (menu): High = 13×13 chunks (~600 m), 4× MSAA, 2048 shadows · Medium = 11×11 · Low = 9×9, no MSAA, 1024 shadows, 70 % start scale.

## Build

Needs Node 18+.

```bash
cd source
npm install
npm run build            # ../index.html (minified, size printed)
npm run build:readable   # ../dev.html (readable + test hooks)
npm test                 # headless movement tests (no GPU needed)
```

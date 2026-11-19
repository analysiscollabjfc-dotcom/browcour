# Browcour

**A first-person parkour game in an endless procedural rooftop city, in one ~45 KB HTML file.**

No engine, no textures, no models, no sound files. Everything is generated at run time: the city from a seed, the surface detail in the shaders, the sound with the Web Audio API.

## Play

Open [`index.html`](index.html) in a browser with **WebGPU**: current Chrome/Edge, Safari 26+, or Firefox 141+ on Windows. Press **Run**.

| Input | Move |
|---|---|
| `W` `A` `S` `D` | Run. In the air, strafe + turn the mouse the same way to gain speed (air-strafing) |
| `Space` | Jump · in the air: double jump · next to a wall: wall-kick. Jump right as you land (bunny-hop) to keep your speed |
| `Shift` / `C` | Slide: speed boost, accelerates down slopes. In the air: fast-fall; land in a slide to turn the fall into forward speed |
| Mouse 1 / `E` | Grapple: hold to swing, release to slingshot |
| Mouse 2 / `F` / `Q` | Air dash |
| run along a wall | Wall-run (orange panels are made for it). Jump off it to chain wall-runs |
| run into a ledge | Low: vault without losing speed. Up to ~2.3 m: mantle. Facing a wall in the air: run up it |
| `R` | Restart the route / respawn |
| `1`–`5`, `0` | Start a checkpoint route, back to free run |
| `M` `H` `Esc` | Sound, stats, menu |

Free run is the whole city. Blue beams mark the starts of 5 checkpoint routes; run into one (or press `1`–`5`) to race it. Best times are saved in the browser.

## How it is built

| File | What's inside |
|---|---|
| [`source/src/player.js`](source/src/player.js) | Movement and collision: the moves, all the tuning constants at the top |
| [`source/src/city.js`](source/src/city.js) | City generator, chunk streaming, collision and ray queries |
| [`source/src/shaders.js`](source/src/shaders.js) | WGSL: procedural facades, roofs, accents, asphalt, sky, shadows, speed lines |
| [`source/src/render.js`](source/src/render.js) | WebGPU setup and the frame |
| [`source/src/game.js`](source/src/game.js) | Input, camera feel (FOV kick, wall-run roll, landing dip), routes, HUD |
| [`source/src/audio.js`](source/src/audio.js) | Synthesized sound |
| [`source/src/quality.js`](source/src/quality.js) | Detail levels |

### Memory and speed

- **One data format for everything.** The world is boxes and ramps, 8 floats each (`min xyz, material+seed, size xyz, type`). The same `Float32Array` is the collision data and the GPU instance buffer. A chunk is ≤56 boxes, about 1.8 KB.
- **Fixed pools, zero per-frame allocation.** Chunks live in a fixed set of slots around the player, indexed `mod(cx) + W·mod(cz)`, so streaming never allocates or searches. Physics and rendering write only into preallocated typed arrays. The GC never runs mid-run.
- **No vertex or index buffers.** The cube is generated from `vertex_index`. A ramp is the same cube with its top edge pulled down in the vertex shader.
- **One instanced draw per visible chunk.** Chunks are frustum-culled and drawn front-to-back for early depth rejection. Small rooftop clutter is skipped beyond ~125 m and in the shadow map.
- **Textures: zero (besides the shadow map).** Windows, concrete, seams, stripes and asphalt are computed from world position. `fwidth` anti-aliasing plus a fade to the pattern's average with distance means no shimmer or moiré.
- **The shadow map is only redrawn when it moves.** It is snapped to whole texels in light space (no crawling edges) and moves in 64-texel steps. It is redrawn only on those steps or when new chunks stream in, not every frame. It uses `depth16unorm` (half the memory of 32-bit).
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

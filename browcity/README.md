# Browcity

**An endless procedural European city you can walk and drive through, in one ~40 KB HTML file.**

Open [`../browcity.html`](../browcity.html) in a browser with WebGPU (current Chrome or Edge; Safari 26+, Firefox 141+ on Windows) and press **Explore**.

## The city

- **A real street grid.** Blocks are ~110 m apart, with a seeded jitter. Three street classes have realistic widths (facade to facade): residential **18 m**, main street **23 m**, boulevard **38 m** with a tree-lined median and 2+2 lanes. Sidewalks are 3.5–6 m with granite curbs. Traffic drives on the right.
- **Intersections** get traffic signals (one 40 s cycle, shared by the shader, the cars and the pedestrians) or stop signs (all-way, or the minor street stops). Zebra crossings, stop lines, centre lines and lane lines are drawn by the shader from the same street function the traffic uses.
- **Perimeter blocks with courtyards**, built from individual buildings of different eras, with storey heights true to each era:
  - half-timbered houses
  - baroque stucco
  - 19th-century stone with iron balconies
  - brick with arched windows
  - post-war concrete panels
  - modern glass

  Roofs are tiled, slate or hipped (mansard), or flat. Main streets have shop fronts with awnings. The old town is at the centre, the 19th-century ring around it, post-war and modern outskirts further out.
- **Parks** with lawns, paths, a pond, benches and trees. **Squares** with a church and a fountain. **Tower blocks** in the outskirts.
- **Day and night:** the sun crosses the sky, sunsets glow, the moon and stars come out. Windows light up, and street lamps really light the streets, every one of them, computed in the shader. Your car's headlights do too.
- **Traffic:** 8 car types (hatchback, sedan, estate, van, taxi, sports car, bus, city car) in 10 paints. Cars follow their lanes, choose a turn at each intersection, stop for red lights, make a full stop at stop signs, and keep their distance from cars, pedestrians and you.
- **Pedestrians** walk the sidewalks and cross at crossings on the walk signal, or when the road is clear, and step out of the way of fast cars.

## Controls

| On foot | |
|---|---|
| `W` `A` `S` `D` + mouse | Walk (third person, camera orbits) |
| `Shift` · `Space` | Sprint · jump |
| `F` | Get into the nearest car: a parked one, one you left, or one stopped in traffic (its driver gets out and walks off) |

| Driving | |
|---|---|
| `W` · `S` | Accelerate · brake, then reverse |
| `A` · `D` | Steer |
| `Space` · `H` | Handbrake (drift) · horn |
| `F` | Get out (below ~20 km/h) |

`T` skips an hour, `M` sound, `I` stats, `Esc` menu (day length, detail level, mouse sensitivity).

## How it stays small and fast

- **No textures, no models, no audio files.** Every surface pattern is computed from world position: each era's facade, roof tiles, cobbles, paving, asphalt markings, grass, water, car paint and glass.
- **The street grid exists twice: in JS and in WGSL** (the same integer hash). So markings, crossings and the light of every street lamp need no geometry and no light list.
- **Blocks stream into fixed slots** (toroidal index). Static data per block (boxes, capsules for trees, lamps and signals, parked cars) is uploaded once. Generating a block takes ~0.15 ms; the first 81 blocks take ~20 ms.
- **Three primitives draw everything:**
  - Axis-aligned boxes (buildings, plates, and roofs as deformed boxes) are pulled from `vertex_index`, with no vertex buffer.
  - Oriented boxes are the car bodies.
  - Ray-traced capsules are people, trees, wheels, lamps and signal bulbs.

  There's about one draw per visible block per primitive.
- **The shadow map is cached** even though the sun moves. It's redrawn only when the sun has turned 0.1° or the view stepped 64 texels (a few times a second). Trees cast real shadows, ray-traced into it. Moving things get soft blob shadows.
- **Distance detail:** small furniture, parked cars and capsule detail drop out with distance, people switch to a 4-capsule body beyond 55 m, and things behind the camera are skipped.
- **Zero per-frame allocation:** all state lives in fixed typed arrays.
- **The build is self-extracting:** 61 kB of minified code is deflated to 36 kB.

## Build

```bash
cd browcity
npm install
npm run build            # ../browcity.html
npm run build:readable   # ../browcity-dev.html (readable, with test hooks)
npm test                 # headless city-generation tests
```

`math.js` is shared with Browcour (`../source/src/math.js`).

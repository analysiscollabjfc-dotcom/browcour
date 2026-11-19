// ============================================================================
// quality level, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Levels differ in view distance (chunks streamed around the player), MSAA, shadow
// map size and the starting render scale. localStorage.browcour = "level,scale". browcourLoad is set while the GPU
// is set up: still set on the next visit means that load crashed the tab, so this one runs a level lower.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.browcour || '').split(','); bad = localStorage.browcourLoad; } catch {}
LV = SV[0] ? +SV[0] : mob || mem <= 4 ? 2 : 0;
if (bad && LV < 2) { SV = [++LV]; keep('browcour', LV); }
const R = [6, 5, 4][LV];                 // chunk radius streamed around the player
const AA = LV > 1 ? 1 : 4;               // MSAA samples
const SHRES = LV > 1 ? 1024 : 2048;      // shadow map size (depth16: 8 MB at 2048)
let scale = SV[1] ? +SV[1] : [1, 0.85, 0.7][LV]; // render scale, adapted at run time

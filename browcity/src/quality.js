// ============================================================================
// quality level (0 High, 1 Medium, 2 Low): view radius in blocks, MSAA, shadow map size, starting render scale.
// localStorage.browcity = "level,scale"; browcityLoad still set at start means the last load crashed: go lower.
// ============================================================================
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.browcity || '').split(','); bad = localStorage.browcityLoad; } catch {}
LV = SV[0] ? +SV[0] : mob || mem <= 4 ? 2 : 0;
if (bad && LV < 2) { SV = [++LV]; keep('browcity', LV); }
const R = [4, 3, 3][LV];                 // blocks streamed around the player in each direction (~110 m each)
const AA = LV > 1 ? 1 : 4;
const SHRES = LV > 1 ? 1024 : 2048;
let scale = SV[1] ? +SV[1] : [1, 0.85, 0.7][LV];

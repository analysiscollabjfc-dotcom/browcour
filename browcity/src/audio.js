// ============================================================================
// sound, all synthesized: the player's engine (pitch follows speed through the gears), horn, doors, crashes,
// footsteps, and a city bed (distant traffic rumble; birds by day, crickets at night). One shared noise buffer.
// ============================================================================
let AC = null, master = null, NB = null, muted = 0, eng = null, engG = null, engF = null, bedG = null;
try { muted = +localStorage.browcityMute || 0; } catch {}
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try { AC = new AudioContext(); } catch { return; }
  master = AC.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(AC.destination);
  const n = AC.sampleRate * 2; NB = AC.createBuffer(1, n, AC.sampleRate);
  const d = NB.getChannelData(0); let b = 0;
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  // engine: two detuned saws through a lowpass
  engG = AC.createGain(); engG.gain.value = 0; engF = AC.createBiquadFilter(); engF.type = 'lowpass'; engF.frequency.value = 600;
  eng = [AC.createOscillator(), AC.createOscillator()];
  for (const o of eng) { o.type = 'sawtooth'; o.frequency.value = 40; o.connect(engF); o.start(); }
  engF.connect(engG).connect(master);
  // city bed: brown-ish noise, low
  const src = AC.createBufferSource(); src.buffer = NB; src.loop = true;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
  bedG = AC.createGain(); bedG.gain.value = 0.12;
  src.connect(lp).connect(bedG).connect(master); src.start();
}
function setMute(m) { muted = m; keep('browcityMute', m); if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, AC.currentTime, 0.05); }
function noise(type, f0, f1, vol, dur) {
  if (!AC || muted) return;
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = NB; f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 1.5, dur + 0.05);
}
function tone(type, f0, f1, vol, dur, at = 0) {
  if (!AC || muted) return;
  const t = AC.currentTime + at, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(k, a) {
  switch (k) {
    case 'step': noise('highpass', 1400 + Math.random() * 600, 0, 0.05, 0.05); break;
    case 'door': noise('lowpass', 500, 120, 0.4, 0.18); tone('triangle', 140, 70, 0.15, 0.12); break;
    case 'crash': noise('lowpass', 900, 100, min(a / 10, 1) * 0.8, 0.4); noise('highpass', 2500, 0, min(a / 14, 1) * 0.3, 0.2); break;
    case 'horn': tone('square', 392, 0, 0.07, 0.45); tone('square', 494, 0, 0.06, 0.45); break;
    case 'honk': tone('square', 440 + a * 30, 0, 0.03, 0.25); break;
    case 'bird': for (let i = 0; i < 3; i++) tone('sine', 2600 + Math.random() * 1500, 3400 + Math.random() * 900, 0.015, 0.07, i * 0.09); break;
    case 'cricket': for (let i = 0; i < 4; i++) tone('sine', 4300, 0, 0.008, 0.03, i * 0.05); break;
  }
}
// engine: driving 0/1, speed m/s, throttle 0/1; four gears
function audioEngine(on, v, thr) {
  if (!AC) return;
  const t = AC.currentTime, s = abs(v), g = s < 8 ? 0 : s < 16 ? 1 : s < 26 ? 2 : 3, lo = [0, 8, 16, 26][g], hi = [8, 16, 26, 45][g];
  const rpm = 0.25 + 0.75 * clamp((s - lo) / (hi - lo), 0, 1), f = 38 + rpm * 85;
  eng[0].frequency.setTargetAtTime(f, t, 0.05); eng[1].frequency.setTargetAtTime(f * 1.505, t, 0.05);
  engF.frequency.setTargetAtTime(300 + rpm * 900 + thr * 500, t, 0.05);
  engG.gain.setTargetAtTime(on ? 0.05 + thr * 0.06 : 0, t, 0.1);
}

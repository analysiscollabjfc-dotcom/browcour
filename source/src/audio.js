// ============================================================================
// sound, synthesized: wind that rises with speed, footsteps, landings, whooshes, the grapple zip and checkpoint chimes.
// One 2 s noise buffer is shared by every noise sound.
// ============================================================================
let AC = null, master = null, windG = null, windF = null, NB = null, muted = 0;
try { muted = +localStorage.browcourMute || 0; } catch {}
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try { AC = new AudioContext(); } catch { return; }
  master = AC.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(AC.destination);
  const n = AC.sampleRate * 2; NB = AC.createBuffer(1, n, AC.sampleRate);
  const d = NB.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = AC.createBufferSource(); src.buffer = NB; src.loop = true;
  windF = AC.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 300; windF.Q.value = 0.6;
  windG = AC.createGain(); windG.gain.value = 0;
  src.connect(windF).connect(windG).connect(master); src.start();
}
function setMute(m) { muted = m; keep('browcourMute', m); if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, AC.currentTime, 0.05); }
function audioWind(sp) {
  if (!AC) return;
  const t = AC.currentTime, k = min(sp / 45, 1.5);
  windG.gain.setTargetAtTime(k * k * 0.32, t, 0.12);
  windF.frequency.setTargetAtTime(180 + sp * 30, t, 0.12);
}
// noise burst through a filter: type, frequency (Hz, optionally swept to f1), volume, duration
function noise(type, f0, f1, vol, dur) {
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = NB; f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 1.5, dur + 0.05);
}
function tone(type, f0, f1, vol, dur, at = 0) {
  const t = AC.currentTime + at, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(kind, amt) {
  if (!AC || muted) return;
  switch (kind) {
    case 'step': noise('highpass', 1600 + Math.random() * 800, 0, 0.09, 0.05); break;
    case 'land': noise('lowpass', 260, 90, min(amt / 14, 1) * 0.7, 0.25); noise('highpass', 2000, 0, min(amt / 30, 0.3), 0.06); break;
    case 'jump': noise('bandpass', 700, 1400, 0.12, 0.12); break;
    case 'kick': noise('bandpass', 500, 1800, 0.2, 0.14); tone('triangle', 180, 90, 0.15, 0.12); break;
    case 'dash': noise('bandpass', 500, 3200, 0.35, 0.28); break;
    case 'slide': noise('lowpass', 900, 300, 0.2, 0.45); break;
    case 'wall': noise('bandpass', 1200, 600, 0.12, 0.2); break;
    case 'grap': tone('square', 1500, 220, 0.05, 0.16); noise('highpass', 3000, 0, 0.12, 0.04); break;
    case 'cp': tone('sine', 880, 0, 0.2, 0.35); tone('sine', 1320, 0, 0.16, 0.5, 0.08); break;
    case 'win': for (let i = 0; i < 4; i++) tone('sine', 660 * (1 + i * 0.25), 0, 0.16, 0.6, i * 0.09); break;
  }
}

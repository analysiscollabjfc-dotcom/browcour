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
    case 'hook': tone('triangle', 1100, 260, 0.18, 0.09); noise('highpass', 2500, 0, 0.25, 0.05); noise('lowpass', 400, 0, 0.3, 0.12); break;
    case 'cp': tone('sine', 880, 0, 0.2, 0.35); tone('sine', 1320, 0, 0.16, 0.5, 0.08); break;
    case 'win': for (let i = 0; i < 4; i++) tone('sine', 660 * (1 + i * 0.25), 0, 0.16, 0.6, i * 0.09); break;
  }
}

// ---------------------------------------------------------------- the singer's song
// An original dream-pop loop (A minor, i-VI-III-VII, 76 bpm): a formant "voice" (two detuned saws through three
// vowel formant filters, with vibrato) over a soft pad, in a generated reverb, placed in 3D at the singer's head.
// A song file dropped on the page (or picked in the menu) replaces it, played from the same spot.
const BPM = 76, BEAT = 60 / BPM, LOOP = 32; // beats
// melody: beat, length (beats), MIDI note, vowel (0 a, 1 o, 2 u, 3 e)
const MEL = [0, 1.5, 76, 0, 1.5, 0.5, 74, 0, 2, 1, 72, 1, 3, 1, 69, 2, 4, 1, 72, 0, 5, 1, 74, 3, 6, 2, 76, 0,
  8, 1.5, 77, 1, 9.5, 0.5, 76, 1, 10, 1, 74, 0, 11, 1, 72, 2, 12, 3, 69, 0,
  16, 1, 67, 3, 17, 1, 72, 0, 18, 1.5, 76, 0, 19.5, 0.5, 74, 1, 20, 2, 72, 2, 22, 1, 74, 0, 23, 1, 76, 3,
  24, 1.5, 74, 0, 25.5, 0.5, 71, 1, 26, 1, 67, 2, 27, 1, 69, 0, 28, 1, 71, 3, 29, 1, 74, 0, 30, 2, 69, 1];
const CHORDS = [57, 60, 64, 53, 57, 60, 48, 52, 55, 55, 59, 62]; // Am F C G (2 bars each)
const FORM = [800, 1150, 2900, 450, 800, 2830, 325, 700, 2700, 530, 1840, 2480];
let sBus = null, sPan = null, sNext = 0, sStep = 0, sT0 = 0, songSrc = null, songBuf = null, singing = 0;
const FGAIN = [1, 0.5, 0.22];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function singerInit() {
  if (sBus || !AC) return;
  sPan = AC.createPanner(); sPan.panningModel = 'HRTF'; sPan.distanceModel = 'inverse'; sPan.refDistance = 3; sPan.rolloffFactor = 1.1;
  sBus = AC.createGain(); sBus.gain.value = 0.9;
  // reverb: 2.4 s of decaying stereo noise
  const n = AC.sampleRate * 2.4, ir = AC.createBuffer(2, n, AC.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
  const rv = AC.createConvolver(); rv.buffer = ir;
  const wet = AC.createGain(); wet.gain.value = 0.45;
  sBus.connect(sPan); sBus.connect(rv).connect(wet).connect(sPan); sPan.connect(master);
  sT0 = AC.currentTime + 0.2; sNext = 0; sStep = 0;
}
function voice(t, dur, f, vow) {
  const g = AC.createGain(), o1 = AC.createOscillator(), o2 = AC.createOscillator(), vib = AC.createOscillator(), vg = AC.createGain();
  o1.type = o2.type = 'sawtooth'; o1.frequency.value = f; o2.frequency.value = f * 1.004;
  vib.frequency.value = 5.3; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.012, t + min(dur, 0.6));
  vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.07); g.gain.setTargetAtTime(0.0001, t + dur, 0.12);
  for (let k = 0; k < 3; k++) {
    const bp = AC.createBiquadFilter(), fg = AC.createGain();
    bp.type = 'bandpass'; bp.frequency.value = FORM[vow * 3 + k] * 1.1; bp.Q.value = 7 + k * 3; fg.gain.value = FGAIN[k];
    o1.connect(bp); o2.connect(bp); bp.connect(fg).connect(g);
  }
  g.connect(sBus);
  const e = t + dur + 0.7;
  o1.start(t); o2.start(t); vib.start(t); o1.stop(e); o2.stop(e); vib.stop(e);
}
function pad(t, dur, k) {
  for (let i = 0; i < 3; i++) {
    const o = AC.createOscillator(), g = AC.createGain(), lp = AC.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = mtof(CHORDS[k * 3 + i]); lp.type = 'lowpass'; lp.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.8); g.gain.setTargetAtTime(0.0001, t + dur - 0.3, 0.4);
    o.connect(lp).connect(g).connect(sBus); o.start(t); o.stop(t + dur + 2);
  }
}
// called ~15 times a second: schedules the next notes a little ahead, moves the voice and the listener
function singerTick(on, x, y, z, ex, ey, ez, B) {
  singing = on && AC && !muted && AC.state === 'running' ? 1 : 0;
  if (!AC) return;
  singerInit();
  const t = AC.currentTime, L = AC.listener;
  sBus.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.2);
  if (sPan.positionX) {
    sPan.positionX.setTargetAtTime(x, t, 0.05); sPan.positionY.setTargetAtTime(y, t, 0.05); sPan.positionZ.setTargetAtTime(z, t, 0.05);
    L.positionX.setTargetAtTime(ex, t, 0.05); L.positionY.setTargetAtTime(ey, t, 0.05); L.positionZ.setTargetAtTime(ez, t, 0.05);
    L.forwardX.value = B[6]; L.forwardY.value = B[7]; L.forwardZ.value = B[8]; L.upX.value = B[3]; L.upY.value = B[4]; L.upZ.value = B[5];
  } else { sPan.setPosition(x, y, z); L.setPosition(ex, ey, ez); L.setOrientation(B[6], B[7], B[8], B[3], B[4], B[5]); }
  if (!singing || songSrc) return;
  if (sT0 + sNext * BEAT < t) sNext = Math.ceil((t - sT0) / BEAT); // fell behind (tab was hidden): skip ahead
  while (sT0 + sNext * BEAT < t + 0.35) {
    // advance through the melody and chord lists in loop order
    const loop = floor(sNext / LOOP), b = sNext - loop * LOOP, t0 = sT0 + loop * LOOP * BEAT;
    if (b % 8 === 0) pad(t0 + b * BEAT, 8 * BEAT, b / 8);
    for (let i = 0; i < MEL.length; i += 4) if (MEL[i] >= b && MEL[i] < b + 1) voice(t0 + MEL[i] * BEAT, MEL[i + 1] * BEAT * 0.95, mtof(MEL[i + 2]), MEL[i + 3]);
    sNext++;
  }
}
// your own song instead of the synth voice
async function singerSong(file) {
  audioInit(); singerInit();
  try {
    songBuf = await AC.decodeAudioData(await file.arrayBuffer());
    if (songSrc) songSrc.stop();
    songSrc = AC.createBufferSource(); songSrc.buffer = songBuf; songSrc.loop = true; songSrc.connect(sBus); songSrc.start();
    return true;
  } catch { return false; }
}

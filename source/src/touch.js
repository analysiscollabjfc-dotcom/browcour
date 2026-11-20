// ============================================================================
// touch controls, shared by Browcour and Browcity (phones and tablets; desktop never builds any of it)
// ============================================================================
// Left 45% of the screen: a floating joystick that appears under the thumb. The rest: drag to look. Buttons come
// from the game: { label, pos (css), down(), up(), show() }. Multi-touch via pointer events, one id per role.
const TOUCH = matchMedia('(pointer:coarse)').matches;
const TJ = new Float32Array(3); // stick x, y (up = +1 = forward), active
const TBN = [];                  // buttons and their show() tests
function touchInit(buttons, look) {
  if (!TOUCH) return;
  const ui = document.createElement('div');
  ui.id = 'tc'; ui.innerHTML = '<div id="tjb"><div id="tjk"></div></div>';
  document.body.appendChild(ui);
  const base = ui.firstChild, knob = base.firstChild, RAD = 56;
  let stick = -1, sx = 0, sy = 0, lk = -1, lx = 0, ly = 0;
  const home = () => { base.style.transform = `translate(${110}px,${innerHeight - 110}px)`; base.style.opacity = 0.35; };
  home(); addEventListener('resize', home);
  const cap = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch {} };
  ui.addEventListener('pointerdown', (e) => {
    if (e.target !== ui && e.target !== base) return;
    e.preventDefault();
    if (e.clientX < innerWidth * 0.45 && stick < 0) {
      stick = e.pointerId; sx = e.clientX; sy = e.clientY; TJ[2] = 1;
      base.style.transform = `translate(${sx}px,${sy}px)`; base.style.opacity = 1;
    } else if (lk < 0) { lk = e.pointerId; lx = e.clientX; ly = e.clientY; }
    cap(ui, e);
  });
  ui.addEventListener('pointermove', (e) => {
    if (e.pointerId === stick) {
      let dx = e.clientX - sx, dy = e.clientY - sy; const l = Math.hypot(dx, dy);
      if (l > RAD) { dx *= RAD / l; dy *= RAD / l; }
      TJ[0] = dx / RAD; TJ[1] = -dy / RAD; knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === lk) { look(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; }
  });
  const end = (e) => {
    if (e.pointerId === stick) { stick = -1; TJ[0] = TJ[1] = TJ[2] = 0; knob.style.transform = ''; home(); }
    if (e.pointerId === lk) lk = -1;
  };
  ui.addEventListener('pointerup', end); ui.addEventListener('pointercancel', end);
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'tb' + (b.small ? ' ts' : ''); el.textContent = b.label; el.style.cssText = b.pos;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); cap(el, e); el.classList.add('on'); b.down(); });
    const up = () => { if (!el.classList.contains('on')) return; el.classList.remove('on'); if (b.up) b.up(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    ui.appendChild(el); TBN.push(el, b.show);
  }
}
// show / hide buttons for the current state (call a few times a second)
function touchShow() { for (let i = 0; i < TBN.length; i += 2) { const s = TBN[i + 1]; if (s) TBN[i].hidden = !s(); } }
// on start: full screen and landscape where the browser allows it
function touchStart() {
  if (!TOUCH) return;
  try {
    const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (p) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  } catch {}
}

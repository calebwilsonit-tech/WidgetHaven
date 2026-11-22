// A single Haven Studio widget on the desktop.
const api = window.haven;
const SID = new URLSearchParams(location.search).get('sid');
const host = document.getElementById('host');
let rec = null, view = null, ctx = {}, fonts = new Set();

function contextFrom(wall) { return { accent: wall && wall.accent, accent2: wall && (wall.accent2 || wall.accent) }; }

async function loadFonts(list) {
  for (const f of list || []) {
    if (fonts.has(f.family)) continue;
    fonts.add(f.family);
    try { const ff = new FontFace(f.family, `url("${f.url}")`); document.fonts.add(await ff.load()); } catch {}
  }
}

let fitTimer = null;
function fit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    const r = host.getBoundingClientRect();
    api.studioFit(SID, Math.ceil(r.width), Math.ceil(r.height));
  }, 30);
}
new ResizeObserver(fit).observe(host);

async function init() {
  const s = await api.studioGet(SID);
  if (!s || !s.rec) return;
  rec = s.rec;
  ctx = contextFrom(s.wallpaper);
  await loadFonts(s.customFonts);
  view = HavenStudio.mount(host, rec.design, ctx);
  await document.fonts.ready;
  apply(s);
  fit();
}
function apply(s) {
  document.body.classList.toggle('locked', !!s.locked);
  document.body.classList.toggle('editing', !!s.editing);
}

api.on('studio:design', async (s) => {
  if (!s || !s.rec || s.rec.id !== SID) return;
  rec = s.rec;
  await loadFonts(s.customFonts);
  view.update(rec.design, ctx);
  apply(s);
  document.fonts.ready.then(fit);
});
api.on('theme:wallpaper', (w) => { ctx = contextFrom(w); if (view && rec) view.update(rec.design, ctx); });

// Drag anywhere on the widget (Haven moves it and snaps it, like the other widgets).
document.addEventListener('pointerdown', (e) => { if (e.button === 0) api.dragStart(); });
document.addEventListener('pointerup', () => api.dragEnd());
document.addEventListener('dblclick', () => api.studioOpen({ tab: 'widgets', id: SID }));

// Ctrl + scroll resizes the whole design.
document.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !rec) return;
  e.preventDefault();
  const d = rec.design;
  d.scale = Math.round(Math.min(400, Math.max(20, (d.scale || 100) + (e.deltaY < 0 ? 5 : -5))));
  view.update(d, ctx);
  api.studioUpdate(SID, { design: d });
}, { passive: false });

document.addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  if (!rec) return;
  const fl = rec.layer === 'float';
  const pick = await api.popupMenu([
    { header: rec.design.name || 'Studio widget' },
    { id: 'edit', label: 'Edit in Studio…' },
    { id: 'dup', label: 'Duplicate' },
    { sep: true },
    { label: 'Place', sub: [
      { id: 'p:center:middle', label: 'Center of the screen' }, { id: 'p:center:top', label: 'Top middle' }, { id: 'p:center:bottom', label: 'Bottom middle' },
      { sep: true },
      { id: 'p:left:top', label: 'Top left' }, { id: 'p:right:top', label: 'Top right' }, { id: 'p:left:bottom', label: 'Bottom left' }, { id: 'p:right:bottom', label: 'Bottom right' }] },
    { id: 'layer', label: fl ? 'Put back on the desktop' : 'Float above windows' },
    fl ? { id: 'ct', label: 'Click-through (ignore the mouse)' } : null,
    { sep: true },
    { id: 'bigger', label: 'Bigger   (Ctrl + scroll)' },
    { id: 'smaller', label: 'Smaller' },
    { sep: true },
    { id: 'remove', label: 'Remove this widget' },
  ].filter(Boolean));
  if (!pick) return;
  if (pick === 'edit') api.studioOpen({ tab: 'widgets', id: SID });
  else if (pick === 'dup') api.studioAdd({ design: rec.design, layer: rec.layer });
  else if (pick.startsWith('p:')) { const [, h, v] = pick.split(':'); api.studioPlace(SID, h, v); }
  else if (pick === 'layer') api.studioUpdate(SID, { layer: fl ? 'desktop' : 'float' });
  else if (pick === 'ct') api.studioUpdate(SID, { clickThrough: true });
  else if (pick === 'bigger' || pick === 'smaller') {
    rec.design.scale = Math.round(Math.min(400, Math.max(20, (rec.design.scale || 100) * (pick === 'bigger' ? 1.15 : 0.87))));
    api.studioUpdate(SID, { design: rec.design });
  } else if (pick === 'remove') api.studioRemove(SID);
});

init();

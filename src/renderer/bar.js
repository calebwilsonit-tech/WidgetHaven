// A HavenBar window (one per screen).
const api = window.haven;
let payload = null;
const view = HavenBar.mount(document.body, {
  action: (kind, arg) => api.barAction(kind, arg),
  menu: (where) => api.barMenu(where),
  flyout: (kind, rect) => api.barFlyout(kind, rect),
  // The wallpaper fills this screen; the window sits at its top (or bottom) edge.
  frame: () => payload && { w: payload.display.bounds.width, h: payload.display.bounds.height, ox: payload.display.bounds.x - payload.display.win.x, oy: payload.display.bounds.y - payload.display.win.y },
});
async function loadFonts(list) {
  for (const f of list || []) { try { const ff = new FontFace(f.family, `url("${f.url}")`); document.fonts.add(await ff.load()); } catch {} }
}
function apply(p) { payload = p; view.setConfig(p); document.fonts.ready.then(() => view.relayout()); }
api.on('bar:config', apply);
api.on('bar:state', (s) => view.setState(s));
api.barGet().then(async (p) => { await loadFonts(p.customFonts); apply(p); view.setState(p.state); });

// Draws snap guides / zones. Coordinates arrive in screen DIPs; `origin` is this overlay's top-left.
'use strict';
const root = document.getElementById('root');
window.haven.on('overlay:draw', (d) => {
  if (!d) { root.innerHTML = ''; return; }
  document.documentElement.style.setProperty('--c', d.accent || '#8b5cf6');
  const ox = d.origin.x, oy = d.origin.y;
  let html = '';
  (d.zones || []).forEach((z, i) => {
    html += `<div class="zone ${i === d.activeZone ? 'on' : ''}" style="left:${z.x - ox}px;top:${z.y - oy}px;width:${z.width}px;height:${z.height}px">${i === d.activeZone ? 'Drop here' : ''}</div>`;
  });
  for (const g of d.guides || []) {
    const cls = `g ${g.dir} ${g.kind === 'center' ? 'center' : ''}`;
    if (g.gap) {
      // Equal-spacing marker: shaded gap with its size.
      const size = Math.round(g.gap[1] - g.gap[0]);
      if (g.dir === 'v') {
        const mid = (g.from + g.to) / 2;
        html += `<div class="gap" style="left:${g.gap[0] - ox}px;top:${g.from - oy}px;width:${size}px;height:${Math.max(0, g.to - g.from)}px"></div>`;
        html += `<div class="pill" style="left:${g.pos - ox}px;top:${mid - oy}px">${size}</div>`;
      } else {
        const mid = (g.from + g.to) / 2;
        html += `<div class="gap" style="top:${g.gap[0] - oy}px;left:${g.from - ox}px;height:${size}px;width:${Math.max(0, g.to - g.from)}px"></div>`;
        html += `<div class="pill" style="top:${g.pos - oy}px;left:${mid - ox}px">${size}</div>`;
      }
      continue;
    }
    if (g.dir === 'v') html += `<div class="${cls}" style="left:${g.pos - ox}px;top:${g.from - oy}px;height:${g.to - g.from}px"></div>`;
    else html += `<div class="${cls}" style="top:${g.pos - oy}px;left:${g.from - ox}px;width:${g.to - g.from}px"></div>`;
  }
  if (d.hint) html += `<div class="hint">${d.hint}</div>`;
  root.innerHTML = html;
});

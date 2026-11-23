// Haven Launcher page: type to filter your Haven library, Enter to open.
const api = window.haven;
const box = document.getElementById('box'), q = document.getElementById('q'), list = document.getElementById('list');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hexRgb = (h) => { const n = parseInt(String(h || '#888').replace('#', '').slice(0, 6).padEnd(6, '0'), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(' '); };
const KIND = { app: 'App', game: 'Game', file: 'File', folder: 'Folder', link: 'Link' };
let items = [], shown = [], sel = 0;

function score(it, t) {
  if (!t) return (it.launches || 0) * 10 + (it.lastLaunched ? 1 : 0) + (it.type === 'app' || it.type === 'game' ? 5 : 0);
  const n = it.name.toLowerCase();
  if (n === t) return 1000;
  if (n.startsWith(t)) return 800 + (it.launches || 0);
  if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(t))) return 600 + (it.launches || 0);
  if (n.includes(t)) return 400 + (it.launches || 0);
  // letters in order (fuzzy): "vsc" → "Visual Studio Code"
  let i = 0; for (const ch of n) if (ch === t[i]) i++;
  return i === t.length ? 100 + (it.launches || 0) : -1;
}
function hl(name, t) {
  const i = t ? name.toLowerCase().indexOf(t) : -1;
  return i < 0 ? esc(name) : esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + t.length)) + '</mark>' + esc(name.slice(i + t.length));
}
function render() {
  const t = q.value.trim().toLowerCase();
  shown = items.map((it) => [it, score(it, t)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([it]) => it);
  sel = Math.min(sel, Math.max(0, shown.length - 1));
  list.innerHTML = shown.length ? shown.map((it, i) => `<div class="it ${i === sel ? 'on' : ''}" data-i="${i}" style="animation-delay:${Math.min(i, 10) * 14}ms">${it.icon ? `<img src="${esc(it.icon)}" alt="" data-l="${esc(it.name.charAt(0))}">` : `<span class="lt">${esc(it.name.charAt(0))}</span>`}<div class="t"><b>${hl(it.name, t)}</b><span>${KIND[it.type] || 'Item'}</span></div><span class="go">Open ↵</span></div>`).join('')
    : `<div class="empty">Nothing matches “${esc(q.value)}”</div>`;
}
function move(d) {
  if (!shown.length) return;
  sel = (sel + d + shown.length) % shown.length;
  list.querySelectorAll('.it').forEach((el, i) => el.classList.toggle('on', i === sel));
  const el = list.children[sel]; if (el) el.scrollIntoView({ block: 'nearest' });
}
function go(i = sel) { const it = shown[i]; if (it) api.launcherLaunch(it.id); }

q.addEventListener('input', () => { sel = 0; render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); api.launcherHide(); }
  else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); go(); }
});
list.addEventListener('mousemove', (e) => { const el = e.target.closest('.it'); if (el && +el.dataset.i !== sel) { sel = +el.dataset.i; list.querySelectorAll('.it').forEach((x, i) => x.classList.toggle('on', i === sel)); } });
list.addEventListener('click', (e) => { const el = e.target.closest('.it'); if (el) go(+el.dataset.i); });
list.addEventListener('error', (e) => { const img = e.target; if (img.tagName !== 'IMG') return; const s = document.createElement('span'); s.className = 'lt'; s.textContent = img.dataset.l; img.replaceWith(s); }, true);

api.on('launcher:open', (p) => {
  const r = document.documentElement.style;
  for (const k of ['base', 'surface', 'text', 'subtext', 'accent', 'accent2']) { r.setProperty('--' + k, p.palette[k]); r.setProperty('--' + k + '-rgb', hexRgb(p.palette[k])); }
  const rad = p.radius ?? 22;
  r.setProperty('--lr', Math.min(22, rad + 6) + 'px');
  document.body.classList.toggle('square', rad <= 4);
  if (p.font) r.setProperty('--font', `"${p.font}", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`);
  items = p.items || [];
  q.value = ''; sel = 0;
  render();
  box.classList.remove('out', 'in');
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('in')));
  setTimeout(() => q.focus(), 10);
});
api.on('launcher:close', () => { box.classList.remove('in'); box.classList.add('out'); });

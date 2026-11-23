// Haven Studio: the "Bar" and "Themes" tabs. Shares globals ($, $$, esc, toast, api, ST, BUNDLED, systemFonts)
// with studio-editor.js, which loads first.
(function () {
  let B = null;            // bar payload from main: { config, modules, palette, themes, wallpaperURL, state, ... }
  let prev = null;         // live bar preview
  let TH = null;           // theme list
  let saveOpen = false;
  const SAMPLE = {
    desktops: [{ index: 0, current: true, windows: 3 }, { index: 1, current: false, windows: 1 }, { index: 2, current: false, windows: 0 }],
    tasks: [{ h: 1, title: 'Browser', name: 'Browser', active: true }, { h: 2, title: 'Music', name: 'Music' }, { h: 3, title: 'Files', name: 'Files' }],
    active: { title: 'Haven Studio', name: 'Haven' },
    media: { title: 'Midnight City', artist: 'M83', status: 'Playing' },
    volume: { level: 64, muted: false }, stats: { cpu: 12, mem: 41, memUsed: 6.5, memTotal: 16, net: { online: true, kind: 'wifi', ssid: 'Home' } },
  };
  const C = () => B.config;
  const modName = (id) => (B.modules.find((m) => m[0] === id) || [id, id])[1];
  const modDesc = (id) => (B.modules.find((m) => m[0] === id) || [id, id, ''])[2];
  const stateFor = (s) => (C().enabled && s && (s.tasks.length || s.desktops.length) ? s : SAMPLE);

  // ---------------------------------------------------------------- shared helpers
  const fld = (label, ctl, hint) => `<div class="f"><label>${label}</label><div class="row">${ctl}</div></div>${hint ? `<p class="hint" style="margin:-2px 0 6px 100px">${hint}</p>` : ''}`;
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), C());
  function setPath(path, v) {
    const keys = path.split('.');
    const top = keys[0];
    if (keys.length === 1) { C()[top] = v; return { [top]: v }; }
    C()[top] = { ...C()[top], [keys[1]]: v };
    return { [top]: C()[top] };
  }
  const bseg = (path, opts) => `<div class="seg" data-bseg="${path}">${opts.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(get(path)) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const bsw = (path) => `<button class="switch ${get(path) ? 'on' : ''}" data-bsw="${path}"></button>`;
  const brange = (path, min, max, step = 1, unit = '') => { const v = get(path); return `<input type="range" data-br="${path}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${v}" style="--p:${((v - min) / (max - min)) * 100}%"><span class="val">${v}${unit}</span>`; };
  const btext = (path, ph) => `<input type="text" data-bt="${path}" value="${esc(get(path) ?? '')}" placeholder="${esc(ph || '')}" spellcheck="false">`;

  let sendTimer = null;
  function change(patch, { now, rerender } = {}) {
    drawPreview();
    clearTimeout(sendTimer);
    const go = async () => { const c = await api.barSet(patch); B.config = c; if (rerender) renderBar(); };
    if (now) go(); else sendTimer = setTimeout(go, 120);
  }

  // ---------------------------------------------------------------- Bar tab
  async function showBar() {
    B = await api.barGet();
    renderBar();
  }
  function renderBar() {
    const c = C();
    $('#barOn').classList.toggle('on', !!c.enabled);
    $('#barStatus').textContent = c.enabled ? `On — ${c.position === 'top' ? 'top' : 'bottom'} of ${c.displays === 'all' ? 'every screen' : 'your main screen'}. Ctrl+Alt+B hides or shows it.` : 'Off. Turn it on to put it on your desktop (Ctrl+Alt+B works too).';
    $('#barOn').onclick = () => { c.enabled = !c.enabled; change({ enabled: c.enabled }, { now: true, rerender: true }); };
    mountPreview();
    renderZones();
    renderBarOpts();
  }
  function mountPreview() {
    const box = $('#barPrev');
    $('#barPrevWall').style.backgroundImage = B.wallpaperURL ? `url("${B.wallpaperURL}")` : '';
    const host = $('#barPrevHost');
    if (!prev) {
      prev = HavenBar.mount(host, { preview: true, frame: () => { const r = $('#barPrevWall').getBoundingClientRect(), k = prevScale(), d = B.display.bounds; return { w: d.width, h: d.height, ox: r.left, oy: r.top, scale: k }; } });
      new ResizeObserver(() => drawPreview()).observe(box);
    }
    drawPreview();
  }
  // The preview is the real bar at your screen's width, scaled down to fit.
  const prevScale = () => { const w = (B && B.display && B.display.bounds.width) || 1920; return Math.min(1, $('#barPrev').clientWidth / w); };
  function drawPreview() {
    if (!prev || !B) return;
    const c = C();
    const host = $('#barPrevHost');
    const th = c.style === 'full' ? c.height : c.height + c.gap * 2;
    const k = prevScale();
    host.style.width = ((B.display && B.display.bounds.width) || 1920) + 'px';
    host.style.transform = `scale(${k})`;
    host.style.transformOrigin = c.position === 'top' ? 'top left' : 'bottom left';
    host.style.height = th + 'px';
    // The preview shows the same slice of wallpaper the real bar sits on.
    const wall = $('#barPrevWall'), d = (B.display && B.display.bounds) || { width: 1920, height: 1080 };
    wall.style.width = d.width * k + 'px'; wall.style.height = d.height * k + 'px';
    wall.style.top = c.position === 'top' ? '0' : ''; wall.style.bottom = c.position === 'bottom' ? '0' : '';
    host.style.top = c.position === 'top' ? '0' : '';
    host.style.bottom = c.position === 'bottom' ? '0' : '';
    prev.setConfig({ ...B, config: c });
    prev.setState(stateFor(B.state));
  }

  // Zones: drag modules between Left / Center / Right.
  function renderZones() {
    const c = C();
    const used = new Set([...c.left, ...c.center, ...c.right]);
    const chip = (id, zone) => `<div class="mchip" draggable="true" data-mid="${id}" data-zone="${zone || ''}" title="${esc(modDesc(id))}"><span>${esc(modName(id))}</span>${zone ? `<button data-rm="${id}" title="Remove">✕</button>` : '<button title="Add">＋</button>'}</div>`;
    $('#barZones').innerHTML = ['left', 'center', 'right'].map((z) => `<div class="zone" data-z="${z}"><h6>${{ left: 'Left', center: 'Middle', right: 'Right' }[z]}</h6><div class="zl">${c[z].map((id) => chip(id, z)).join('') || '<span class="zempty">Drop modules here</span>'}</div></div>`).join('');
    const spare = B.modules.map((m) => m[0]).filter((id) => !used.has(id));
    $('#barSpare').innerHTML = spare.length ? spare.map((id) => chip(id)).join('') : '<span class="zempty">Every module is on the bar.</span>';
    let drag = null;
    $$('.mchip').forEach((el) => {
      el.addEventListener('dragstart', (e) => { drag = el.dataset.mid; e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('.zone').forEach((z) => z.classList.remove('over')); });
    });
    $$('#barSpare .mchip').forEach((el) => (el.onclick = () => moveMod(el.dataset.mid, 'right', null)));
    $$('[data-rm]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); moveMod(b.dataset.rm, null, null); }));
    $$('.zone').forEach((z) => {
      z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove('over'); });
      z.addEventListener('drop', (e) => {
        e.preventDefault();
        z.classList.remove('over');
        if (!drag) return;
        // Insert before the chip under the pointer.
        const after = [...z.querySelectorAll('.mchip')].find((ch) => { const r = ch.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 && e.clientY < r.bottom; });
        moveMod(drag, z.dataset.z, after ? after.dataset.mid : null);
        drag = null;
      });
    });
    const sp = $('#barSpare');
    sp.ondragover = (e) => e.preventDefault();
    sp.ondrop = (e) => { e.preventDefault(); if (drag) moveMod(drag, null, null); drag = null; };
  }
  function moveMod(id, zone, before) {
    const c = C();
    for (const z of ['left', 'center', 'right']) c[z] = c[z].filter((m) => m !== id);
    if (zone) {
      const list = [...c[zone]];
      const i = before ? list.indexOf(before) : -1;
      if (i >= 0) list.splice(i, 0, id); else list.push(id);
      c[zone] = list;
    }
    renderZones();
    change({ left: c.left, center: c.center, right: c.right }, { now: true });
  }

  function renderBarOpts() {
    const c = C();
    const fonts = [...new Set([...BUNDLED, ...(ST.customFonts || []).map((f) => f.family), ...(systemFonts || [])])];
    const ws = c.workspaces;
    const box = $('#barOpts');
    box.innerHTML = `
      <div class="group"><h5>Look</h5>
        ${fld('Style', bseg('style', [['islands', 'Islands'], ['zones', 'Pills'], ['floating', 'Float'], ['full', 'Edge']]))}
        ${fld('Position', bseg('position', [['top', 'Top'], ['bottom', 'Bottom']]))}
        ${fld('Height', brange('height', 24, 56, 1, 'px'))}
        ${c.style !== 'full' ? fld('Edge gap', brange('gap', 0, 24, 1, 'px')) + fld('Roundness', brange('radius', 0, 28, 1, 'px')) : ''}
        ${fld('Opacity', brange('opacity', 0, 100, 1, '%'))}
        ${fld('Frosted glass', bsw('glass'), 'Blurs your wallpaper behind the bar.')}
        ${fld('Outline', bsw('border'))}${fld('Shadow', bsw('shadow'))}${fld('Glow', bsw('glow'))}
      </div>
      <div class="group"><h5>Text</h5>
        ${fld('Font', `<select data-bsel="font">${fonts.map((f) => `<option ${f === c.font ? 'selected' : ''} style="font-family:'${esc(f)}'">${esc(f)}</option>`).join('')}</select>`)}
        ${fld('Size', brange('fontSize', 10, 18, 0.5, 'px'))}
      </div>
      <div class="group"><h5>Desktops</h5>
        ${fld('Show as', bseg('workspaces.style', [['numbers', '123'], ['dots', '•••'], ['roman', 'I·II'], ['kanji', '一二'], ['labels', 'Names']]))}
        ${ws.style === 'labels' ? fld('Names', `<input type="text" data-wsl value="${esc((ws.labels || []).join(', '))}" placeholder="code, web, chat, games" spellcheck="false">`, 'Comma-separated, one per desktop. Emoji work too.') : ''}
        ${fld('Show apps', bsw('workspaces.highlightOccupied'), 'Desktops with open windows look brighter.')}
        ${fld('+ button', bsw('workspaces.showAdd'))}
        <p class="hint">Click a desktop to jump to it, scroll over them to flip through, right-click one to close it or give it its own theme.</p>
      </div>
      <div class="group"><h5>Clock</h5>
        ${fld('Time', btext('clock.time', 'h:mm'))}
        <div class="chips" style="margin:0 0 8px 100px">${[['h:mm', '9:41'], ['h:mm A', '9:41 AM'], ['HH:mm', '21:41'], ['HH:mm:ss', '21:41:07']].map(([f, l]) => `<button class="chip" data-tf="${f}">${l}</button>`).join('')}</div>
        ${fld('Show date', bsw('clock.showDate'))}
        ${c.clock.showDate ? fld('Date', btext('clock.date', 'ddd MMM d')) + `<div class="chips" style="margin:0 0 8px 100px">${[['ddd MMM d', 'Mon Jun 3'], ['dddd', 'Monday'], ['d MMM', '3 Jun'], ['M/d', '6/3'], ['yyyy-MM-dd', '2025-06-03']].map(([f, l]) => `<button class="chip" data-df="${f}">${l}</button>`).join('')}</div>` : ''}
      </div>
      <div class="group"><h5>Open apps</h5>${fld('Show names', bsw('tasks.labels'))}<p class="hint">Click an app to switch to it (again to minimize), middle-click to close it.</p></div>
      <div class="group"><h5>Behavior</h5>
        ${fld('Screens', bseg('displays', [['primary', 'Main screen'], ['all', 'All screens']]))}
        ${fld('Hide taskbar', bsw('hideTaskbar'), 'Sets the Windows taskbar to auto-hide while the bar is on, and puts it back when you turn the bar off. Move your mouse to the bottom edge to reach it.')}
        ${fld('Shortcuts', bsw('shortcuts'), 'Ctrl+Alt+1…9 jumps to a desktop, Ctrl+Alt+T switches theme. Ctrl+Alt+B always shows or hides the bar.')}
      </div>
      <div class="group"><p class="hint">The bar reserves its own strip of the screen, so maximized windows stop right under it, and it hides itself when a game or video goes fullscreen.</p></div>`;
    $$('[data-bseg]', box).forEach((s) => $$('button', s).forEach((b) => (b.onclick = () => {
      const v = b.dataset.v;
      const patch = setPath(s.dataset.bseg, isNaN(+v) || v === '' ? v : +v);
      change(patch, { now: true });
      renderBarOpts();
    })));
    $$('[data-bsw]', box).forEach((b) => (b.onclick = () => { const patch = setPath(b.dataset.bsw, !get(b.dataset.bsw)); change(patch, { now: true }); renderBarOpts(); }));
    $$('[data-br]', box).forEach((r) => {
      r.addEventListener('input', () => {
        r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%');
        r.nextElementSibling.textContent = r.value + r.dataset.unit;
        setPath(r.dataset.br, +r.value); drawPreview();
      });
      r.addEventListener('change', () => change(setPath(r.dataset.br, +r.value)));
    });
    $$('[data-bt]', box).forEach((t) => t.addEventListener('input', () => change(setPath(t.dataset.bt, t.value))));
    $$('[data-bsel]', box).forEach((s) => s.addEventListener('change', () => change(setPath(s.dataset.bsel, s.value), { now: true })));
    $$('[data-tf]', box).forEach((b) => (b.onclick = () => { change(setPath('clock.time', b.dataset.tf), { now: true }); renderBarOpts(); }));
    $$('[data-df]', box).forEach((b) => (b.onclick = () => { change(setPath('clock.date', b.dataset.df), { now: true }); renderBarOpts(); }));
    const wsl = $('[data-wsl]', box);
    if (wsl) wsl.addEventListener('input', () => change(setPath('workspaces.labels', wsl.value.split(',').map((x) => x.trim()))));
  }

  api.on('bar:config', (p) => { if (!B) return; const keep = B.config; B = { ...B, ...p, config: keep }; drawPreview(); });
  api.on('bar:state', (s) => { if (!B) return; B.state = s; if (prev) prev.setState(stateFor(s)); });

  // ---------------------------------------------------------------- Themes tab
  async function showThemes() {
    TH = await api.themeList();
    if (!B) B = await api.barGet();
    renderThemes();
  }
  function miniBar(p) {
    return `<div class="tmb" style="--b:${p.base};--t:${p.text};--s:${p.subtext};--a:${p.accent};--a2:${p.accent2}">
      <span class="tp"><i class="lg"></i><i class="ws on"></i><i class="ws"></i><i class="ws"></i></span>
      <span class="tp"><b>9:41</b></span>
      <span class="tp"><i class="dt"></i><i class="dt"></i><i class="dt a"></i></span></div>`;
  }
  function renderThemes() {
    const grid = $('#themeGrid');
    grid.innerHTML = TH.themes.map((t) => {
      const p = t.palette;
      const extras = [t.hasWallpaper && 'wallpaper', t.hasLive && 'live wallpaper', t.hasBar && 'bar layout'].filter(Boolean);
      return `<div class="tcard ${t.id === TH.current ? 'on' : ''}" data-tid="${t.id}">
        <div class="tprev" style="background:${t.id === 'auto' && B && B.wallpaperURL ? `url('${B.wallpaperURL}') center/cover` : `radial-gradient(120% 90% at 85% 110%, ${p.accent}55, transparent 60%), radial-gradient(90% 80% at 0% 0%, ${p.accent2}40, transparent 60%), ${p.mantle}`}">
          ${miniBar(p)}
          <div class="tsw">${[p.base, p.surface, p.text, p.accent, p.accent2, p.red, p.green, p.yellow].map((c) => `<i style="background:${c}"></i>`).join('')}</div>
          ${t.scene ? `<button class="btn sm tscene" data-tscene="${t.id}" title="Also turn on the matching live wallpaper">▶ With live wallpaper</button>` : ''}
          ${t.custom ? `<button class="tdel" data-tdel="${t.id}" title="Delete this theme">✕</button>` : ''}
        </div>
        <div class="tt">${t.id === TH.current ? '<span class="tnow">In use</span>' : ''}<b>${esc(t.name)}</b><span>${esc(t.desc || '')}${extras.length ? ' · with ' + extras.join(', ') : ''}</span></div>
      </div>`;
    }).join('');
    $$('.tcard', grid).forEach((card) => (card.onclick = async (e) => {
      if (e.target.closest('[data-tdel]') || e.target.closest('[data-tscene]')) return;
      TH = await api.themeApply(card.dataset.tid);
      renderThemes();
      toast(`${TH.themes.find((t) => t.id === TH.current).name} applied`);
    }));
    $$('[data-tdel]', grid).forEach((b) => (b.onclick = async () => { TH = await api.themeDelete(b.dataset.tdel); renderThemes(); }));
    $$('[data-tscene]', grid).forEach((b) => (b.onclick = async () => {
      const id = b.dataset.tscene;
      if (TH.current !== id) TH = await api.themeApply(id);
      await api.themeScene(id);
      ST.live = (await api.studioState()).live;
      renderThemes();
      toast('Live wallpaper on — tweak it in the Live wallpaper tab');
    }));
    renderSave();
    renderThemeOpts();
  }
  function renderSave() {
    const box = $('#themeSave');
    if (!saveOpen) { box.innerHTML = `<button class="btn primary" id="tsOpen">＋ Save my current look as a theme</button>`; $('#tsOpen').onclick = () => { saveOpen = true; renderSave(); }; return; }
    box.innerHTML = `<div class="tsform"><input type="text" id="tsName" placeholder="Name it — e.g. Late night" maxlength="40" spellcheck="false">
      <label><input type="checkbox" id="tsWall" checked> Wallpaper picture</label><label><input type="checkbox" id="tsLive" ${ST.live && ST.live.enabled ? 'checked' : ''}> Live wallpaper</label>
      <label><input type="checkbox" id="tsBar" checked> Bar layout</label><label><input type="checkbox" id="tsLook"> Widget see-through look</label>
      <button class="btn primary" id="tsGo">Save</button><button class="btn ghost" id="tsX">Cancel</button></div>
      <p class="hint">Saves the colors you have on now, plus whatever you tick. Picking it later brings all of that back at once.</p>`;
    $('#tsName').focus();
    $('#tsX').onclick = () => { saveOpen = false; renderSave(); };
    const go = async () => {
      const name = $('#tsName').value.trim() || 'My theme';
      TH = await api.themeSave(name, { wallpaper: $('#tsWall').checked, live: $('#tsLive').checked, bar: $('#tsBar').checked, look: $('#tsLook').checked });
      saveOpen = false;
      renderThemes();
      toast(`Saved “${name}”`);
    };
    $('#tsGo').onclick = go;
    $('#tsName').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }
  function renderThemeOpts() {
    const box = $('#themeOpts');
    const ds = (B && B.state && B.state.desktops) || [];
    const barOn = B && B.config.enabled;
    const opt = (sel) => `<option value="">Keep the current theme</option>${TH.themes.map((t) => `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}`;
    box.innerHTML = `
      <div class="group"><h5>Windows too</h5>
        <div class="f"><label>Light / dark</label><div class="row"><button class="switch ${TH.opts.windowsMode ? 'on' : ''}" id="toWin"></button></div></div>
        <p class="hint">Also switches Windows' own apps and menus to match a theme's light or dark mode.</p></div>
      <div class="group"><h5>A theme per desktop</h5>
        ${!barOn ? '<p class="hint">Turn on the Haven Bar to give each virtual desktop its own theme. It switches as you move between desktops.</p>'
          : ds.length ? ds.map((d) => `<div class="f"><label>Desktop ${d.index + 1}</label><div class="row"><select data-dth="${d.id}">${opt(TH.desktopThemes[d.id])}</select></div></div>`).join('') + '<p class="hint">Switching desktops changes the theme automatically.</p>'
            : '<p class="hint">Looking for your desktops…</p>'}
      </div>
      <div class="group"><h5>Quick switching</h5><p class="hint">Right-click the Haven tray icon or the bar for a Theme menu. Add the <b>Theme</b> module to the bar to switch with a click or a scroll. With bar shortcuts on, <b>Ctrl+Alt+T</b> moves to the next theme.</p></div>`;
    $('#toWin').onclick = async () => { TH = await api.themeOpts({ windowsMode: !TH.opts.windowsMode }); renderThemeOpts(); };
    $$('[data-dth]', box).forEach((s) => s.addEventListener('change', async () => { TH = await api.themeDesktop(s.dataset.dth, s.value || null); }));
  }
  api.on('theme:changed', (l) => { TH = l; if (!$('#pThemes').hidden) renderThemes(); });

  window.BarEditor = {
    show(tab) { if (tab === 'bar') showBar(); if (tab === 'themes') showThemes(); },
  };
  // studio-editor.js may have picked this tab before this script loaded.
  if (!document.getElementById('pBar').hidden) showBar();
  if (!document.getElementById('pThemes').hidden) showThemes();
})();

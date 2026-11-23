// Haven Bar renderer, shared by the bar windows (bar.html) and the live preview in Haven Studio.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const P = {
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    mem: '<rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M6.5 17v3M10.5 17v3M13.5 17v3M17.5 17v3M7 10.5v3M11 10.5v3M15 10.5v3"/>',
    vol: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    volLow: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
    wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
    wifiOff: '<path d="m3 3 18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.2-2.4M2 8.8a15 15 0 0 1 5.4-3.3M14.8 10.2A10 10 0 0 1 19 12.5M22 8.8a15 15 0 0 0-9.5-3.8"/>',
    lan: '<rect x="9" y="2.5" width="6" height="5" rx="1"/><rect x="2.5" y="16.5" width="6" height="5" rx="1"/><rect x="15.5" y="16.5" width="6" height="5" rx="1"/><path d="M12 7.5V12M5.5 16.5V12h13v4.5"/>',
    bat: '<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    power: '<path d="M12 2v9"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    palette: '<path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A1.7 1.7 0 0 1 12 22z"/><circle cx="7.5" cy="11" r="1.3" fill="currentColor"/><circle cx="11" cy="7" r="1.3" fill="currentColor"/><circle cx="16" cy="8.5" r="1.3" fill="currentColor"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
    next: '<path d="M5 5v14l10-7z" fill="currentColor"/><path d="M19 5v14"/>',
    prev: '<path d="M19 5v14L9 12z" fill="currentColor"/><path d="M5 5v14"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    cal: '<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M3 10h18M8 2.5v4M16 2.5v4"/>',
  };
  const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;
  const LOGO = '<span class="hb-logo"><i></i><i></i><i></i><i></i></span>';
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const hexRgb = (h) => { const n = parseInt(String(h || '#888').replace('#', '').slice(0, 6).padEnd(6, '0'), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(' '); };
  const fmt = (d, f) => (window.HavenStudio ? window.HavenStudio.formatDate(d, f) : d.toLocaleTimeString());

  function mount(host, opts = {}) {
    const root = document.createElement('div');
    root.className = 'hb';
    root.innerHTML = '<div class="hb-bar"><div class="hb-z z-left"></div><div class="hb-z z-center"></div><div class="hb-z z-right"></div></div>';
    host.appendChild(root);
    const bar = root.firstChild;
    let P0 = null, ST = { desktops: [], tasks: [], stats: {}, volume: null, media: null }, battery = null;
    const modEls = new Map(); // id -> element
    const last = new Map();   // id -> last html

    if (navigator.getBattery) navigator.getBattery().then((b) => {
      const upd = () => { battery = { level: b.level, charging: b.charging, desktop: b.level === 1 && b.charging && b.chargingTime === 0 }; renderMod('battery'); };
      ['levelchange', 'chargingchange', 'chargingtimechange'].forEach((e) => b.addEventListener(e, upd));
      upd();
    }).catch(() => {});

    function setConfig(payload) {
      P0 = payload;
      const c = payload.config, p = payload.palette;
      const st = root.style;
      st.setProperty('--h', c.height + 'px');
      st.setProperty('--gap', (c.style === 'full' ? 0 : c.gap) + 'px');
      st.setProperty('--r', (c.style === 'full' ? 0 : c.radius) + 'px');
      st.setProperty('--op', String(c.opacity / 100));
      st.setProperty('--fs', c.fontSize + 'px');
      st.setProperty('--font', `"${c.font}", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`);
      for (const k of ['base', 'mantle', 'surface', 'text', 'subtext', 'accent', 'accent2', 'red', 'green', 'yellow']) { st.setProperty('--' + k, p[k]); st.setProperty('--' + k + '-rgb', hexRgb(p[k])); }
      root.dataset.style = c.style;
      root.dataset.pos = c.position;
      root.dataset.mode = p.mode;
      root.classList.toggle('glass', !!c.glass && !!payload.wallpaperURL);
      root.classList.toggle('border', !!c.border);
      root.classList.toggle('shadow', !!c.shadow);
      root.classList.toggle('glow', !!c.glow);
      st.setProperty('--wall', payload.wallpaperURL ? `url("${payload.wallpaperURL}")` : 'none');
      // Rebuild the zones when the module list changes.
      const sig = JSON.stringify([c.left, c.center, c.right]);
      if (sig !== root.dataset.sig) {
        root.dataset.sig = sig;
        modEls.clear(); last.clear();
        for (const z of ['left', 'center', 'right']) {
          const zone = bar.querySelector('.z-' + z);
          zone.innerHTML = '';
          zone.classList.toggle('empty', !c[z].length);
          for (const id of c[z]) {
            const el = document.createElement('div');
            el.className = 'hb-mod m-' + id;
            el.dataset.mod = id;
            zone.appendChild(el);
            modEls.set(id, el);
          }
        }
      }
      loadWall();
      renderAll();
      markSurfaces();
    }
    function setState(s) { ST = s || ST; renderAll(); }

    // ---------------------------------------------------------- modules
    const R = {
      launcher: () => `<button class="hb-btn" data-act="launcher" title="Open Haven (right-click: Start menu)">${LOGO}</button>`,
      workspaces: (c) => {
        const ws = ST.desktops.length ? ST.desktops : [{ index: 0, current: true, windows: 1 }];
        const style = c.workspaces.style, labels = c.workspaces.labels || [];
        const lab = (d) => {
          const i = d.index;
          if (style === 'dots') return '';
          if (style === 'roman') return ROMAN[i] || i + 1;
          if (style === 'kanji') return KANJI[i] || i + 1;
          if (style === 'labels') return esc(labels[i] || d.name || i + 1);
          return i + 1;
        };
        return `<div class="hb-ws ${style === 'dots' ? 'dots' : ''}">${ws.map((d) => `<button class="w ${d.current ? 'on' : ''} ${d.windows && c.workspaces.highlightOccupied ? 'occ' : ''}" data-act="ws" data-arg="${d.index}" data-desktop="${d.index}" title="Desktop ${d.index + 1}${d.name ? ' — ' + esc(d.name) : ''}${d.windows ? ` · ${d.windows} window${d.windows > 1 ? 's' : ''}` : ''}">${lab(d)}</button>`).join('')}${c.workspaces.showAdd ? `<button class="w add" data-act="wsNew" title="New desktop">${ic('plus')}</button>` : ''}</div>`;
      },
      tasks: (c) => {
        if (!ST.tasks.length) return '<span class="hb-dim">No open apps</span>';
        return `<div class="hb-tasks">${ST.tasks.map((t) => `<button class="t ${t.active ? 'on' : ''} ${t.min ? 'min' : ''}" data-act="task" data-arg="${t.h}" data-task="${t.h}" title="${esc(t.title)}">${t.icon ? `<img src="${t.icon}" alt="">` : `<span class="ltr">${esc((t.name || t.title || '?').charAt(0))}</span>`}${c.tasks.labels ? `<span class="lb">${esc(trim(t.name || t.title, c.tasks.maxLabel))}</span>` : ''}</button>`).join('')}</div>`;
      },
      window: (c) => {
        const a = ST.active;
        return a ? `<div class="hb-win" style="max-width:${c.window.maxWidth}px" title="${esc(a.title)}">${a.icon ? `<img src="${a.icon}" alt="">` : ''}<span>${esc(a.title)}</span></div>` : '<span class="hb-dim">Desktop</span>';
      },
      pins: () => {
        const pins = (P0.pins || []).slice(0, 12);
        if (!pins.length) return '<span class="hb-dim" title="Add favorites in Haven to see them here">No favorites yet</span>';
        return `<div class="hb-tasks">${pins.map((p) => `<button class="t" data-act="pin" data-arg="${esc(p.id)}" title="${esc(p.name)}"><img src="${esc(p.icon)}" alt="" data-ltr="${esc((p.name || '?').charAt(0))}"></button>`).join('')}</div>`;
      },
      clock: (c) => {
        const d = new Date();
        return `<button class="hb-btn hb-clock" data-act="notify" title="${esc(d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}"><b>${esc(fmt(d, c.clock.time))}</b>${c.clock.showDate && c.clock.date ? `<span>${esc(fmt(d, c.clock.date))}</span>` : ''}</button>`;
      },
      media: (c) => {
        const m = ST.media;
        if (!m) return '';
        const playing = m.status === 'Playing';
        return `<div class="hb-media ${playing ? 'playing' : ''}"><button class="hb-btn mc" data-act="media" data-arg="prev" title="Previous">${ic('prev')}</button><button class="hb-btn mt" data-act="media" data-arg="toggle" title="${playing ? 'Pause' : 'Play'}">${ic(playing ? 'music' : 'pause', 'acc')}<span style="max-width:${c.media.maxWidth}px">${esc(m.title)}${m.artist ? `<i> — ${esc(m.artist)}</i>` : ''}</span></button><button class="hb-btn mc" data-act="media" data-arg="next" title="Next">${ic('next')}</button></div>`;
      },
      system: () => {
        const s = ST.stats || {};
        const lvl = (v) => (v >= 90 ? 'hot' : v >= 70 ? 'warm' : '');
        return `<div class="hb-row" title="CPU ${s.cpu ?? 0}% · Memory ${s.memUsed ?? '?'} of ${s.memTotal ?? '?'} GB"><span class="st ${lvl(s.cpu)}">${ic('cpu')}${s.cpu ?? 0}%</span><span class="st ${lvl(s.mem)}">${ic('mem')}${s.mem ?? 0}%</span></div>`;
      },
      volume: () => {
        const v = ST.volume;
        if (!v) return `<button class="hb-btn" data-act="quick">${ic('vol')}</button>`;
        const icn = v.muted || v.level === 0 ? 'mute' : v.level < 45 ? 'volLow' : 'vol';
        return `<button class="hb-btn hb-vol ${v.muted ? 'muted' : ''}" data-act="mute" data-wheel="vol" title="Volume ${v.level}%${v.muted ? ' (muted)' : ''} · scroll to change">${ic(icn)}<span>${v.muted ? 'Muted' : v.level + '%'}</span><i class="lvl" style="--v:${v.muted ? 0 : v.level}%"></i></button>`;
      },
      network: () => {
        const n = (ST.stats && ST.stats.net) || {};
        const icn = !n.online ? 'wifiOff' : n.kind === 'wifi' ? 'wifi' : 'lan';
        const t = !n.online ? 'Offline' : n.kind === 'wifi' ? `${n.ssid || 'Wi-Fi'}${n.signal != null ? ' · ' + n.signal + '%' : ''}` : 'Ethernet';
        return `<button class="hb-btn ${n.online ? '' : 'off'}" data-act="quick" title="${esc(t)}">${ic(icn)}</button>`;
      },
      battery: () => {
        if (!battery || battery.desktop) return '';
        const pct = Math.round(battery.level * 100);
        return `<button class="hb-btn hb-bat ${pct <= 15 && !battery.charging ? 'low' : ''}" data-act="quick" title="Battery ${pct}%${battery.charging ? ' · charging' : ''}"><span class="bat"><i style="width:${pct}%"></i></span>${battery.charging ? ic('bolt', 'acc') : ''}<span>${pct}%</span></button>`;
      },
      theme: () => {
        const t = (P0.themes || []).find((x) => x.id === P0.themeId);
        return `<button class="hb-btn" data-act="themeNext" data-arg="1" data-wheel="theme" title="Theme: ${esc(t ? t.name : 'Auto')} · click or scroll to switch">${ic('palette', 'acc')}<span>${esc(t ? t.name : 'Auto')}</span></button>`;
      },
      tray: () => `<button class="hb-btn" data-act="tray" title="Hidden icons">${ic('up')}</button>`,
      notify: () => `<button class="hb-btn" data-act="notify" title="Notifications">${ic('bell')}</button>`,
      quick: () => `<button class="hb-btn" data-act="quick" title="Quick settings">${ic('sliders')}</button>`,
      power: () => `<button class="hb-btn hb-power" data-act="powerMenu" title="Power">${ic('power')}</button>`,
    };
    const trim = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
    function renderMod(id) {
      const el = modEls.get(id);
      if (!el || !P0) return;
      const html = R[id] ? R[id](P0.config) : '';
      if (last.get(id) === html) return;
      last.set(id, html);
      el.innerHTML = html;
      el.classList.toggle('blank', !html);
      markSurfaces();
    }
    function renderAll() { for (const id of modEls.keys()) renderMod(id); }
    const clockTimer = setInterval(() => renderMod('clock'), 1000);

    // ---------------------------------------------------------- frosted glass: the wallpaper behind each pill
    let wallImg = null, wallFor = '';
    function loadWall() {
      const u = P0 && P0.wallpaperURL;
      if (!u || u === wallFor) return;
      wallFor = u;
      const img = new Image();
      img.onload = () => { wallImg = img; relayout(); };
      img.src = u;
    }
    let raf = 0;
    function relayout() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!wallImg || !root.classList.contains('glass')) return;
        const f = opts.frame ? opts.frame() : null;
        if (!f) return;
        const s = Math.max(f.w / wallImg.naturalWidth, f.h / wallImg.naturalHeight);
        const ww = wallImg.naturalWidth * s, wh = wallImg.naturalHeight * s;
        const ox = (f.w - ww) / 2, oy = (f.h - wh) / 2;
        root.style.setProperty('--wall-size', `${ww}px ${wh}px`);
        for (const el of root.querySelectorAll('.surf')) {
          const r = el.getBoundingClientRect();
          const k = f.scale || 1;
          el.style.setProperty('--wx', `${ox - (r.left - f.ox) / k}px`); el.style.setProperty('--wy', `${oy - (r.top - f.oy) / k}px`);
        }
      });
    }
    const ro = new ResizeObserver(relayout);
    ro.observe(root);
    // Which elements carry the glass (and the pill background) depends on the style.
    function markSurfaces() {
      const style = root.dataset.style;
      const want = new Set(style === 'islands' ? root.querySelectorAll('.hb-mod:not(.blank)') : style === 'zones' ? [...root.querySelectorAll('.hb-z')].filter((z) => z.querySelector('.hb-mod:not(.blank)')) : [bar]);
      for (const e of [bar, ...root.querySelectorAll('.hb-z, .hb-mod')]) e.classList.toggle('surf', want.has(e));
      relayout();
    }
    // Icons that fail to load become a letter tile.
    root.addEventListener('error', (e) => {
      const img = e.target;
      if (img.tagName !== 'IMG' || !img.dataset.ltr) return;
      const sp = document.createElement('span'); sp.className = 'ltr'; sp.textContent = img.dataset.ltr; img.replaceWith(sp);
    }, true);

    // ---------------------------------------------------------- input
    if (!opts.preview) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const a = b.dataset.act;
        if (a === 'powerMenu') return opts.menu && opts.menu({ power: true });
        opts.action && opts.action(a, b.dataset.arg);
      });
      root.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        const t = e.target.closest('[data-task]');
        if (t) opts.action && opts.action('taskClose', t.dataset.task);
      });
      root.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const ws = e.target.closest('[data-desktop]'), t = e.target.closest('[data-task]'), l = e.target.closest('[data-act="launcher"]');
        if (l) return opts.action && opts.action('start');
        opts.menu && opts.menu(ws ? { desktop: ws.dataset.desktop } : t ? { task: t.dataset.task } : {});
      });
      let wheelT = 0;
      root.addEventListener('wheel', (e) => {
        const up = e.deltaY < 0;
        const w = e.target.closest('[data-wheel]');
        if (w && w.dataset.wheel === 'vol') { opts.action && opts.action('volStep', up ? 2 : -2); return; }
        const now = Date.now();
        if (now - wheelT < 280) return;
        wheelT = now;
        if (w && w.dataset.wheel === 'theme') return opts.action && opts.action('themeNext', up ? -1 : 1);
        if (e.target.closest('.m-workspaces')) opts.action && opts.action('wsRel', up ? -1 : 1);
      }, { passive: true });
    }

    return {
      root, setConfig, setState, relayout,
      destroy() { clearInterval(clockTimer); ro.disconnect(); root.remove(); },
    };
  }

  window.HavenBar = { mount, icon: ic };
})();

// Haven Studio — shared design model + renderer for creative desktop widgets (clocks, dates, text…).
// Used by the widget windows (studio.html) and the editor's live preview (studio-editor.html).
(function () {
  const uid = () => 'e' + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ------------------------------------------------------------ defaults
  const BASE_EL = {
    font: 'Segoe UI Variable Display', weight: 300, size: 96, italic: false, spacing: 0, upper: false, opacity: 100,
    fill: { mode: 'solid', c1: '#ffffff', c2: '#a78bfa', angle: 135 },
    glow: { on: false, color: '#a78bfa', blur: 18 },
    shadow: { on: true, color: '#00000088', blur: 12, x: 0, y: 3 },
    outline: { on: false, color: '#000000', width: 1 },
  };
  const TYPE_DEFAULTS = {
    time: { h24: false, seconds: false, ampm: true, blink: false, lead0: false },
    date: { format: 'dddd, MMMM d', size: 24, weight: 400, spacing: 4, upper: true },
    text: { text: 'Hello there', size: 28, weight: 400 },
    countdown: { target: '', format: '{d} days until the weekend', size: 24, weight: 400 },
    analog: { size: 220, face: 'ring', faceColor: '#ffffff22', tickColor: '#ffffffcc', hourColor: '#ffffff', minColor: '#ffffff', secColor: '#f472b6', seconds: true, numbers: false, thick: 6 },
    flip: { size: 80, weight: 700, font: 'Bebas Neue', h24: false, seconds: false, card: '#16161ecc', cardRadius: 12, shadow: { on: true, color: '#00000088', blur: 14, x: 0, y: 6 } },
    word: { size: 26, weight: 600, font: 'Space Grotesk', spacing: 22, dim: '#ffffff26' },
  };
  const TYPE_NAMES = { time: 'Time', date: 'Date', text: 'Text', countdown: 'Countdown', analog: 'Analog clock', flip: 'Flip clock', word: 'Word clock' };

  function makeElement(type, over = {}) {
    const d = TYPE_DEFAULTS[type] || {};
    const el = { ...clone(BASE_EL), ...clone(d), ...clone(over), id: uid(), type };
    for (const k of ['fill', 'glow', 'shadow', 'outline']) el[k] = { ...BASE_EL[k], ...(d[k] || {}), ...(over[k] || {}) };
    return el;
  }
  const BASE_DESIGN = {
    name: 'My widget', layout: 'stack', align: 'center', gap: 6, padding: 18, scale: 100,
    bg: { kind: 'none', color: '#10101a', opacity: 45, radius: 28, border: 0, borderColor: '#ffffff33', blur: true },
  };
  function normalize(d) {
    d = clone(d || {});
    const out = { ...clone(BASE_DESIGN), ...d, bg: { ...BASE_DESIGN.bg, ...(d.bg || {}) } };
    out.elements = (d.elements || []).map((e) => {
      const n = makeElement(e.type, e);
      if (e.id) n.id = e.id;
      return n;
    });
    return out;
  }

  // ------------------------------------------------------------ presets
  const P = (name, desc, design) => ({ name, desc, design: normalize({ ...design, name }) });
  const PRESETS = [
    P('Minimal', 'Thin, big and quiet', { elements: [
      { type: 'time', size: 120, weight: 200, spacing: -2 },
      { type: 'date', size: 20, weight: 400, spacing: 8, upper: true, fill: { c1: '#ffffffcc' } }] }),
    P('Neon', 'Glowing gradient tube lights', { elements: [
      { type: 'time', font: 'Righteous', size: 110, weight: 400, fill: { mode: 'gradient', c1: '#f0abfc', c2: '#22d3ee', angle: 90 }, glow: { on: true, color: '#e879f9', blur: 26 }, shadow: { on: false } },
      { type: 'date', font: 'Righteous', size: 22, spacing: 6, fill: { c1: '#67e8f9' }, glow: { on: true, color: '#22d3ee', blur: 14 }, shadow: { on: false } }] }),
    P('Wallpaper match', 'Colors pulled from your wallpaper', { elements: [
      { type: 'time', font: 'Space Grotesk', size: 112, weight: 700, spacing: -3, fill: { mode: 'wallpaper', angle: 120 } },
      { type: 'date', font: 'Space Grotesk', size: 20, weight: 500, spacing: 3, fill: { mode: 'solid', c1: '#ffffffd9' } }] }),
    P('Retro flip', 'Chunky flip-clock cards', { elements: [{ type: 'flip', size: 86 }, { type: 'date', font: 'Bebas Neue', size: 26, spacing: 10, weight: 400 }] }),
    P('Elegant', 'Serif italics, gold accents', { elements: [
      { type: 'time', font: 'Playfair Display', size: 104, weight: 400, italic: true, fill: { mode: 'gradient', c1: '#fde68a', c2: '#d97706', angle: 160 } },
      { type: 'date', font: 'Cinzel', size: 18, spacing: 10, weight: 500, fill: { c1: '#fef3c7' } }] }),
    P('Big bold', 'Poster-style stacked hours', { elements: [
      { type: 'time', font: 'Bebas Neue', size: 190, weight: 400, spacing: 2, ampm: false },
      { type: 'date', font: 'Bebas Neue', size: 34, spacing: 14, weight: 400, format: 'dddd' }] }),
    P('Word clock', 'Tells the time in words', { elements: [{ type: 'word' }], bg: { kind: 'card', opacity: 35 } }),
    P('Analog', 'Clean ring face with a pink second hand', { elements: [{ type: 'analog' }, { type: 'date', size: 16, spacing: 6, format: 'ddd d MMM' }] }),
    P('Terminal', 'Monospace, green phosphor', { align: 'start', elements: [
      { type: 'text', text: '> uptime', font: 'JetBrains Mono', size: 16, fill: { c1: '#86efac99' }, shadow: { on: false } },
      { type: 'time', font: 'JetBrains Mono', size: 72, weight: 300, seconds: true, h24: true, fill: { c1: '#4ade80' }, glow: { on: true, color: '#22c55e', blur: 12 }, shadow: { on: false } },
      { type: 'date', font: 'JetBrains Mono', size: 16, format: 'yyyy-MM-dd ddd', fill: { c1: '#86efac' }, shadow: { on: false } }],
      bg: { kind: 'card', color: '#031208', opacity: 55, radius: 14 } }),
    P('Pixel', '8-bit arcade', { elements: [
      { type: 'time', font: 'Press Start 2P', size: 56, h24: true, fill: { mode: 'gradient', c1: '#fde047', c2: '#f97316', angle: 180 }, shadow: { on: true, color: '#7c2d12', blur: 0, x: 5, y: 5 } },
      { type: 'text', text: 'PRESS START', font: 'Press Start 2P', size: 14, fill: { c1: '#ffffff' }, shadow: { on: true, color: '#000000', blur: 0, x: 2, y: 2 } }] }),
    P('Handwritten', 'A note on your desktop', { elements: [
      { type: 'time', font: 'Caveat', size: 110, weight: 600 },
      { type: 'text', text: 'have a lovely day ♡', font: 'Caveat', size: 34, fill: { c1: '#fbcfe8' } }] }),
    P('Countdown', 'Days until something good', { elements: [
      { type: 'countdown', font: 'Space Grotesk', size: 92, weight: 700, format: '{d}', target: '', fill: { mode: 'wallpaper' } },
      { type: 'text', text: 'days to go', font: 'Space Grotesk', size: 20, spacing: 6, upper: true }] }),
  ];

  // ------------------------------------------------------------ time formatting
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const p2 = (n) => String(n).padStart(2, '0');
  function formatDate(d, fmt) {
    const tok = {
      yyyy: d.getFullYear(), yy: p2(d.getFullYear() % 100), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: p2(d.getMonth() + 1), M: d.getMonth() + 1,
      dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3), dd: p2(d.getDate()), d: d.getDate(),
      HH: p2(d.getHours()), H: d.getHours(), hh: p2(d.getHours() % 12 || 12), h: d.getHours() % 12 || 12, mm: p2(d.getMinutes()), ss: p2(d.getSeconds()),
      A: d.getHours() < 12 ? 'AM' : 'PM', a: d.getHours() < 12 ? 'am' : 'pm', Do: d.getDate() + ordinal(d.getDate()),
    };
    return String(fmt || '').replace(/\[([^\]]*)\]|yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|Do|d|HH|H|hh|h|mm|ss|A|a/g, (m, lit) => (lit !== undefined ? lit : tok[m]));
  }
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
  function timeParts(d, el) {
    const h = el.h24 ? d.getHours() : d.getHours() % 12 || 12;
    return { h: el.h24 || el.lead0 ? p2(h) : String(h), m: p2(d.getMinutes()), s: p2(d.getSeconds()), ap: el.h24 || !el.ampm ? '' : d.getHours() < 12 ? 'AM' : 'PM' };
  }
  // Countdown target: explicit date, or "the coming Saturday" when empty.
  function countdownTarget(el, now) {
    if (el.target) { const t = new Date(el.target); if (!isNaN(t)) return t; }
    const t = new Date(now); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + ((6 - t.getDay() + 7) % 7 || 7));
    return t;
  }
  function countdownText(el, now) {
    const ms = Math.max(0, countdownTarget(el, now) - now);
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    return String(el.format || '{d}').replace(/\{(d|h|m|s|hh|mm|ss)\}/g, (_, k) => ({ d, h, m, s, hh: p2(Math.floor(ms / 36e5)), mm: p2(m), ss: p2(s) })[k]);
  }

  // ------------------------------------------------------------ word clock
  const WORD_GRID = ['ITLISASAMPM', 'ACQUARTERDC', 'TWENTYFIVEX', 'HALFSTENFTO', 'PASTERUNINE', 'ONESIXTHREE', 'FOURFIVETWO', 'EIGHTELEVEN', 'SEVENTWELVE', 'TENSEOCLOCK'];
  const W = {
    IT: [0, 0, 2], IS: [0, 3, 2], A: [1, 0, 1], QUARTER: [1, 2, 7], TWENTY: [2, 0, 6], FIVE_M: [2, 6, 4], HALF: [3, 0, 4], TEN_M: [3, 5, 3], TO: [3, 9, 2], PAST: [4, 0, 4],
    9: [4, 7, 4], 1: [5, 0, 3], 6: [5, 3, 3], 3: [5, 6, 5], 4: [6, 0, 4], 5: [6, 4, 4], 2: [6, 8, 3], 8: [7, 0, 5], 11: [7, 5, 6], 7: [8, 0, 5], 12: [8, 5, 6], 10: [9, 0, 3], OCLOCK: [9, 5, 6],
  };
  function wordsFor(d) {
    const m = Math.floor(d.getMinutes() / 5) * 5;
    const words = ['IT', 'IS'];
    const mins = { 0: ['OCLOCK'], 5: ['FIVE_M', 'PAST'], 10: ['TEN_M', 'PAST'], 15: ['A', 'QUARTER', 'PAST'], 20: ['TWENTY', 'PAST'], 25: ['TWENTY', 'FIVE_M', 'PAST'], 30: ['HALF', 'PAST'],
      35: ['TWENTY', 'FIVE_M', 'TO'], 40: ['TWENTY', 'TO'], 45: ['A', 'QUARTER', 'TO'], 50: ['TEN_M', 'TO'], 55: ['FIVE_M', 'TO'] }[m];
    let h = (d.getHours() + (m >= 35 ? 1 : 0)) % 12 || 12;
    words.push(...mins.filter((w) => w !== 'OCLOCK'), String(h));
    if (m === 0) words.push('OCLOCK');
    const lit = new Set();
    for (const w of words) { const [r, c, n] = W[w]; for (let i = 0; i < n; i++) lit.add(r * 11 + c + i); }
    return lit;
  }

  // ------------------------------------------------------------ styling
  function fillColors(el, ctx) {
    const f = el.fill || {};
    if (f.mode === 'wallpaper') return [ctx.accent || '#a78bfa', ctx.accent2 || ctx.accent || '#22d3ee'];
    if (f.mode === 'gradient') return [f.c1, f.c2];
    return [f.c1, f.c1];
  }
  function textStyle(el, ctx) {
    const [c1, c2] = fillColors(el, ctx);
    const grad = c1 !== c2;
    const st = {
      fontFamily: `"${el.font}", "Segoe UI Variable Display", "Segoe UI", sans-serif`, fontWeight: el.weight, fontSize: el.size + 'px',
      fontStyle: el.italic ? 'italic' : 'normal', letterSpacing: (el.spacing / 100) + 'em', textTransform: el.upper ? 'uppercase' : 'none',
      opacity: (el.opacity ?? 100) / 100, lineHeight: 1.05, whiteSpace: 'pre', color: c1,
      backgroundImage: grad ? `linear-gradient(${el.fill.angle ?? 135}deg, ${c1}, ${c2})` : 'none',
      webkitBackgroundClip: grad ? 'text' : 'border-box', webkitTextFillColor: grad ? 'transparent' : c1,
      webkitTextStroke: el.outline && el.outline.on ? `${el.outline.width}px ${el.outline.color}` : '0',
      filter: effects(el),
    };
    return st;
  }
  // drop-shadow (not text-shadow) so glow/shadow also work on gradient text.
  function effects(el) {
    const f = [];
    if (el.glow && el.glow.on) f.push(`drop-shadow(0 0 ${el.glow.blur * 0.5}px ${el.glow.color}) drop-shadow(0 0 ${el.glow.blur}px ${el.glow.color})`);
    if (el.shadow && el.shadow.on) f.push(`drop-shadow(${el.shadow.x}px ${el.shadow.y}px ${el.shadow.blur}px ${el.shadow.color})`);
    return f.join(' ') || 'none';
  }
  function applyStyle(node, st) {
    for (const [k, v] of Object.entries(st)) {
      const prop = k.startsWith('webkit') ? '-webkit-' + k.slice(6).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^-/, '') : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      node.style.setProperty(prop, String(v));
    }
  }
  const hexA = (hex, a) => {
    const h = String(hex || '#000').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
    return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${a})`;
  };

  // ------------------------------------------------------------ render
  // Builds the DOM for a design inside `host`, ticks every second. Returns { update(design, ctx), destroy() }.
  function mount(host, design, ctx = {}) {
    let D = normalize(design), C = ctx, timer = null, parts = [];
    const root = document.createElement('div');
    root.className = 'hs-root';
    host.appendChild(root);

    function build() {
      root.innerHTML = '';
      parts = [];
      const s = D.scale / 100;
      Object.assign(root.style, {
        display: 'inline-flex', flexDirection: D.layout === 'row' ? 'row' : 'column', alignItems: { start: 'flex-start', center: 'center', end: 'flex-end' }[D.align] || 'center',
        gap: D.gap * s + 'px', padding: D.padding * s + 'px', borderRadius: D.bg.radius * s + 'px', textAlign: D.align === 'start' ? 'left' : D.align === 'end' ? 'right' : 'center',
        background: D.bg.kind === 'none' ? 'transparent' : hexA(D.bg.color, D.bg.opacity / 100),
        backdropFilter: D.bg.kind === 'glass' ? 'blur(18px) saturate(1.4)' : 'none',
        border: D.bg.border ? `${D.bg.border * s}px solid ${D.bg.borderColor}` : 'none',
        boxShadow: D.bg.kind === 'none' ? 'none' : '0 10px 40px rgba(0,0,0,.25)',
      });
      if (D.layout === 'row') root.style.alignItems = 'center';
      for (const raw of D.elements) {
        const el = { ...raw, size: raw.size * s, spacing: raw.spacing };
        if (el.shadow) el.shadow = { ...el.shadow, blur: el.shadow.blur * s, x: el.shadow.x * s, y: el.shadow.y * s };
        if (el.glow) el.glow = { ...el.glow, blur: el.glow.blur * s };
        const wrap = document.createElement('div');
        wrap.className = 'hs-el';
        wrap.dataset.id = raw.id;
        root.appendChild(wrap);
        parts.push(buildEl(wrap, el, s));
      }
      tick(true);
    }

    function buildEl(wrap, el, s) {
      if (el.type === 'analog') return buildAnalog(wrap, el, s);
      if (el.type === 'flip') return buildFlip(wrap, el);
      if (el.type === 'word') return buildWord(wrap, el);
      const span = document.createElement('div');
      applyStyle(span, textStyle(el, C));
      wrap.appendChild(span);
      let last = '';
      return (now) => {
        let txt = '';
        if (el.type === 'time') {
          const t = timeParts(now, el);
          const colon = el.blink && now.getSeconds() % 2 ? ' ' : ':';
          txt = t.h + colon + t.m + (el.seconds ? colon + t.s : '');
          const key = txt + t.ap;
          if (key === last) return;
          last = key;
          span.innerHTML = '';
          span.append(txt);
          if (el.blink) span.innerHTML = span.innerHTML.replace(/ /g, '<span style="opacity:0">:</span>');
          if (t.ap) { const a = document.createElement('span'); a.textContent = t.ap; a.style.cssText = 'font-size:.28em;letter-spacing:.08em;margin-left:.18em;vertical-align:.15em'; span.appendChild(a); }
          return;
        }
        if (el.type === 'date') txt = formatDate(now, el.format);
        else if (el.type === 'countdown') txt = countdownText(el, now);
        else txt = el.text || '';
        if (txt !== last) { last = txt; span.textContent = txt; }
      };
    }

    function buildAnalog(wrap, el, s) {
      const NS = 'http://www.w3.org/2000/svg';
      const size = el.size;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 200 200');
      svg.setAttribute('width', size); svg.setAttribute('height', size);
      svg.style.filter = effects(el);
      svg.style.opacity = (el.opacity ?? 100) / 100;
      svg.style.overflow = 'visible';
      const [c1, c2] = fillColors(el, C);
      const gid = 'g' + el.id;
      let h = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`;
      if (el.face === 'full') h += `<circle cx="100" cy="100" r="96" fill="${el.faceColor}"/>`;
      if (el.face === 'ring' || el.face === 'full') h += `<circle cx="100" cy="100" r="96" fill="none" stroke="${el.fill.mode === 'solid' ? el.tickColor : `url(#${gid})`}" stroke-width="2.5"/>`;
      if (el.face !== 'none') {
        for (let i = 0; i < 60; i++) {
          const big = i % 5 === 0, a = (i / 60) * Math.PI * 2, r1 = big ? 80 : 86, r2 = 90;
          if (!big && el.face === 'dots') continue;
          if (el.face === 'dots') { h += `<circle cx="${100 + Math.sin(a) * 86}" cy="${100 - Math.cos(a) * 86}" r="${i % 15 === 0 ? 4 : 2.4}" fill="${el.tickColor}"/>`; continue; }
          h += `<line x1="${100 + Math.sin(a) * r1}" y1="${100 - Math.cos(a) * r1}" x2="${100 + Math.sin(a) * r2}" y2="${100 - Math.cos(a) * r2}" stroke="${el.tickColor}" stroke-width="${big ? 3 : 1.2}" stroke-linecap="round"/>`;
        }
      }
      if (el.numbers) for (let i = 1; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        h += `<text x="${100 + Math.sin(a) * 66}" y="${100 - Math.cos(a) * 66}" text-anchor="middle" dominant-baseline="central" font-family="${el.font}" font-weight="${el.weight}" font-size="15" fill="${el.tickColor}">${i}</text>`;
      }
      const t = el.thick;
      h += `<line id="h" x1="100" y1="112" x2="100" y2="52" stroke="${el.fill.mode === 'solid' ? el.hourColor : `url(#${gid})`}" stroke-width="${t * 1.3}" stroke-linecap="round"/>`
        + `<line id="m" x1="100" y1="114" x2="100" y2="28" stroke="${el.fill.mode === 'solid' ? el.minColor : `url(#${gid})`}" stroke-width="${t}" stroke-linecap="round"/>`
        + (el.seconds ? `<line id="s" x1="100" y1="120" x2="100" y2="22" stroke="${el.secColor}" stroke-width="1.8" stroke-linecap="round"/>` : '')
        + `<circle cx="100" cy="100" r="${t * 0.9}" fill="${el.seconds ? el.secColor : el.hourColor}"/>`;
      svg.innerHTML = h;
      wrap.appendChild(svg);
      const H = svg.querySelector('#h'), M = svg.querySelector('#m'), S = svg.querySelector('#s');
      return (now) => {
        const sec = now.getSeconds(), min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
        H.setAttribute('transform', `rotate(${hr * 30} 100 100)`);
        M.setAttribute('transform', `rotate(${min * 6} 100 100)`);
        if (S) S.setAttribute('transform', `rotate(${sec * 6} 100 100)`);
      };
    }

    function buildFlip(wrap, el) {
      const box = document.createElement('div');
      box.style.cssText = `display:flex;gap:${el.size * 0.08}px;align-items:center;filter:${effects(el)};opacity:${(el.opacity ?? 100) / 100}`;
      wrap.appendChild(box);
      const st = textStyle({ ...el, shadow: { on: false }, glow: el.glow }, C);
      st.filter = 'none';
      const cards = [];
      const mk = (sep) => {
        if (sep) { const c = document.createElement('div'); applyStyle(c, st); c.textContent = ':'; c.style.margin = `0 ${el.size * 0.02}px`; c.style.opacity = '.75'; box.appendChild(c); return; }
        const card = document.createElement('div');
        card.style.cssText = `position:relative;background:${el.card};border-radius:${el.cardRadius * el.size / 80}px;padding:${el.size * 0.06}px ${el.size * 0.12}px;overflow:hidden;min-width:${el.size * 0.62}px;text-align:center`;
        const span = document.createElement('div');
        applyStyle(span, st);
        span.style.lineHeight = '1.1';
        card.appendChild(span);
        const line = document.createElement('i');
        line.style.cssText = 'position:absolute;left:0;right:0;top:50%;height:2px;margin-top:-1px;background:rgba(0,0,0,.45)';
        card.appendChild(line);
        box.appendChild(card);
        cards.push(span);
      };
      const n = el.seconds ? 3 : 2;
      for (let i = 0; i < n; i++) { if (i) mk(true); mk(); }
      let ap = null;
      if (!el.h24 && el.ampm !== false) { ap = document.createElement('div'); applyStyle(ap, st); ap.style.fontSize = el.size * 0.26 + 'px'; ap.style.alignSelf = 'flex-end'; ap.style.marginLeft = '.2em'; box.appendChild(ap); }
      return (now) => {
        const t = timeParts(now, { ...el, lead0: true });
        const vals = [t.h, t.m, t.s].slice(0, n);
        vals.forEach((v, i) => {
          if (cards[i].textContent === v) return;
          cards[i].textContent = v;
          cards[i].parentElement.animate([{ transform: 'perspective(400px) rotateX(-75deg)', filter: 'brightness(.6)' }, { transform: 'none', filter: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
        });
        if (ap) ap.textContent = t.ap || (now.getHours() < 12 ? 'AM' : 'PM');
      };
    }

    function buildWord(wrap, el) {
      const grid = document.createElement('div');
      grid.style.cssText = `display:grid;grid-template-columns:repeat(11,1fr);gap:${el.size * 0.3}px ${el.size * (0.3 + el.spacing / 100)}px;opacity:${(el.opacity ?? 100) / 100}`;
      const st = textStyle({ ...el, spacing: 0 }, C);
      const cells = [];
      WORD_GRID.join('').split('').forEach((ch) => {
        const c = document.createElement('div');
        applyStyle(c, st);
        c.style.textAlign = 'center';
        c.style.transition = 'opacity .6s, color .6s';
        c.textContent = ch;
        grid.appendChild(c);
        cells.push(c);
      });
      wrap.appendChild(grid);
      let lastKey = '';
      return (now) => {
        const key = now.getHours() + ':' + Math.floor(now.getMinutes() / 5);
        if (key === lastKey) return;
        lastKey = key;
        const lit = wordsFor(now);
        cells.forEach((c, i) => {
          if (lit.has(i)) applyStyle(c, st);
          else applyStyle(c, { ...st, color: el.dim, webkitTextFillColor: el.dim, backgroundImage: 'none', filter: 'none', webkitTextStroke: '0' });
        });
      };
    }

    function tick(force) {
      const now = C.now ? C.now() : new Date();
      for (const p of parts) try { p(now, force); } catch (e) { console.error(e); }
    }
    function schedule() {
      clearTimeout(timer);
      // Line up with the next whole second.
      timer = setTimeout(() => { tick(); schedule(); }, 1000 - (Date.now() % 1000) + 5);
    }
    build();
    schedule();
    return {
      root,
      update(design, ctx2) { D = normalize(design); if (ctx2) C = ctx2; build(); },
      setContext(ctx2) { C = ctx2; build(); },
      destroy() { clearTimeout(timer); root.remove(); },
    };
  }

  window.HavenStudio = { mount, normalize, makeElement, PRESETS, TYPE_NAMES, TYPE_DEFAULTS, formatDate, clone, uid };
})();

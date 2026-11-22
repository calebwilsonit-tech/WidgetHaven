// Snapping engine — PowerPoint-style smart guides for desktop widgets.
// Pure geometry: given a proposed rect, the other widgets and the screen area, returns the
// snapped rect plus the guide lines to draw. No Electron here, so it's easy to test.

const DEFAULTS = {
  enabled: true,      // master switch
  edges: true,        // screen edges + center lines
  widgets: true,      // other widgets' edges / centers / equal gaps
  guides: true,       // draw alignment lines while dragging
  gap: 12,            // spacing used when snapping next to another widget
  distance: 14,       // how close (px) before it snaps
  zones: 'shift',     // 'off' | 'shift' (hold Shift while dragging to drop into a zone)
  zoneSet: 'grid2x2',
};

// Zone presets as fractions [x, y, w, h] of the usable screen area.
const ZONE_SETS = {
  grid2x2: { name: 'Quarters', zones: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
  columns3: { name: 'Three columns', zones: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  halves: { name: 'Halves', zones: [[0, 0, .5, 1], [.5, 0, .5, 1]] },
  rightStack: { name: 'Right stack', zones: [[0, 0, .66, 1], [.66, 0, .34, 1 / 3], [.66, 1 / 3, .34, 1 / 3], [.66, 2 / 3, .34, 1 / 3]] },
  priority: { name: 'Focus center', zones: [[0, 0, .25, 1], [.25, 0, .5, 1], [.75, 0, .25, 1]] },
  grid3x2: { name: 'Six grid', zones: [[0, 0, 1 / 3, .5], [1 / 3, 0, 1 / 3, .5], [2 / 3, 0, 1 / 3, .5], [0, .5, 1 / 3, .5], [1 / 3, .5, 1 / 3, .5], [2 / 3, .5, 1 / 3, .5]] },
};

function zoneRects(area, setId, gap) {
  const set = ZONE_SETS[setId] || ZONE_SETS.grid2x2;
  const g = gap / 2;
  return set.zones.map(([x, y, w, h]) => ({
    x: Math.round(area.x + x * area.width + g), y: Math.round(area.y + y * area.height + g),
    width: Math.round(w * area.width - gap), height: Math.round(h * area.height - gap),
  }));
}

const R = (b) => ({ l: b.x, r: b.x + b.width, t: b.y, b: b.y + b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 });

// Candidate lines on one axis. Each target: { pos, kind, span:[from,to], label }
function targetsFor(axis, area, others, opts) {
  const out = [];
  const A = R(area);
  if (opts.edges) {
    const g = opts.gap;
    if (axis === 'x') {
      out.push({ pos: A.l, span: [A.t, A.b], kind: 'screen' }, { pos: A.r, span: [A.t, A.b], kind: 'screen' }, { pos: A.cx, span: [A.t, A.b], kind: 'center', anchors: ['c'] });
      // Inset from the screen edge by the same gap used between widgets.
      if (g) out.push({ pos: A.l + g, span: [A.t, A.b], kind: 'screen', anchors: ['l'] }, { pos: A.r - g, span: [A.t, A.b], kind: 'screen', anchors: ['r'] });
    } else {
      out.push({ pos: A.t, span: [A.l, A.r], kind: 'screen' }, { pos: A.b, span: [A.l, A.r], kind: 'screen' }, { pos: A.cy, span: [A.l, A.r], kind: 'center', anchors: ['c'] });
      if (g) out.push({ pos: A.t + g, span: [A.l, A.r], kind: 'screen', anchors: ['t'] }, { pos: A.b - g, span: [A.l, A.r], kind: 'screen', anchors: ['b'] });
    }
  }
  if (opts.widgets) {
    for (const o of others) {
      const O = R(o);
      if (axis === 'x') {
        const span = [O.t, O.b];
        out.push({ pos: O.l, span, kind: 'align' }, { pos: O.r, span, kind: 'align' }, { pos: O.cx, span, kind: 'center', anchors: ['c'] });
        // Sit beside it with an even gap.
        out.push({ pos: O.r + opts.gap, span, kind: 'gap', anchors: ['l'], gapFrom: O.r });
        out.push({ pos: O.l - opts.gap, span, kind: 'gap', anchors: ['r'], gapFrom: O.l });
      } else {
        const span = [O.l, O.r];
        out.push({ pos: O.t, span, kind: 'align' }, { pos: O.b, span, kind: 'align' }, { pos: O.cy, span, kind: 'center', anchors: ['c'] });
        out.push({ pos: O.b + opts.gap, span, kind: 'gap', anchors: ['t'], gapFrom: O.b });
        out.push({ pos: O.t - opts.gap, span, kind: 'gap', anchors: ['b'], gapFrom: O.t });
      }
    }
  }
  return out;
}

// anchorsAllowed: which edges of the moving rect may snap (all for a move; just the dragged edge for a resize).
function bestOnAxis(axis, rect, targets, dist, anchorsAllowed) {
  const B = R(rect);
  const anchors = axis === 'x' ? { l: B.l, c: B.cx, r: B.r } : { t: B.t, c: B.cy, b: B.b };
  let best = null;
  for (const [name, val] of Object.entries(anchors)) {
    if (!anchorsAllowed.includes(name)) continue;
    for (const t of targets) {
      if (t.anchors && !t.anchors.includes(name)) continue;
      if (!t.anchors && name === 'c') continue; // edges snap to edges, centers to centers
      const d = t.pos - val;
      if (Math.abs(d) <= dist && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t, anchor: name };
    }
  }
  return best;
}

function guideFor(axis, hit, rect) {
  const B = R(rect);
  const t = hit.t;
  if (axis === 'x') {
    const from = Math.min(t.span[0], B.t), to = Math.max(t.span[1], B.b);
    const g = { dir: 'v', pos: t.pos, from, to, kind: t.kind };
    if (t.kind === 'gap') { g.pos = (t.pos + t.gapFrom) / 2; g.gap = [Math.min(t.pos, t.gapFrom), Math.max(t.pos, t.gapFrom)]; g.from = Math.max(t.span[0], B.t); g.to = Math.min(t.span[1], B.b); }
    return g;
  }
  const from = Math.min(t.span[0], B.l), to = Math.max(t.span[1], B.r);
  const g = { dir: 'h', pos: t.pos, from, to, kind: t.kind };
  if (t.kind === 'gap') { g.pos = (t.pos + t.gapFrom) / 2; g.gap = [Math.min(t.pos, t.gapFrom), Math.max(t.pos, t.gapFrom)]; g.from = Math.max(t.span[0], B.l); g.to = Math.min(t.span[1], B.r); }
  return g;
}

// Snap a moved window (size unchanged).
function snapMove(rect, others, area, opts) {
  const o = { ...DEFAULTS, ...opts };
  const out = { ...rect };
  const guides = [];
  const hx = bestOnAxis('x', rect, targetsFor('x', area, others, o), o.distance, ['l', 'c', 'r']);
  if (hx) out.x += hx.d;
  const hy = bestOnAxis('y', rect, targetsFor('y', area, others, o), o.distance, ['t', 'c', 'b']);
  if (hy) out.y += hy.d;
  if (hx) guides.push(guideFor('x', hx, out));
  if (hy) guides.push(guideFor('y', hy, out));
  return { bounds: out, guides };
}

// Snap a resize: only the edges being dragged move. edge like 'right', 'bottom', 'bottom-right'.
function snapResize(rect, edge, others, area, opts, min = { width: 260, height: 200 }) {
  const o = { ...DEFAULTS, ...opts };
  const out = { ...rect };
  const guides = [];
  const e = String(edge || 'bottom-right');
  const xa = e.includes('left') ? ['l'] : e.includes('right') ? ['r'] : [];
  const ya = e.includes('top') ? ['t'] : e.includes('bottom') ? ['b'] : [];
  if (xa.length) {
    const h = bestOnAxis('x', rect, targetsFor('x', area, others, o), o.distance, xa);
    if (h) {
      if (xa[0] === 'r') out.width = Math.max(min.width, out.width + h.d);
      else { const nw = Math.max(min.width, out.width - h.d); out.x += out.width - nw; out.width = nw; }
      guides.push(guideFor('x', h, out));
    }
  }
  if (ya.length) {
    const h = bestOnAxis('y', rect, targetsFor('y', area, others, o), o.distance, ya);
    if (h) {
      if (ya[0] === 'b') out.height = Math.max(min.height, out.height + h.d);
      else { const nh = Math.max(min.height, out.height - h.d); out.y += out.height - nh; out.height = nh; }
      guides.push(guideFor('y', h, out));
    }
  }
  return { bounds: out, guides };
}

function zoneAt(point, zones) {
  return zones.findIndex((z) => point.x >= z.x && point.x < z.x + z.width && point.y >= z.y && point.y < z.y + z.height);
}

// Window positions must be whole pixels.
const whole = (fn) => (...a) => { const r = fn(...a); for (const k of ['x', 'y', 'width', 'height']) r.bounds[k] = Math.round(r.bounds[k]); return r; };

module.exports = { DEFAULTS, ZONE_SETS, zoneRects, snapMove: whole(snapMove), snapResize: whole(snapResize), zoneAt };

// The command-center screens.
import { Panel, C, F, S, text, rrect, fmtPrice, fmtPct, fmtMoney, colorFor, hexA } from './hud.js';
import { ema, vwap, fmtClock, fmtDuration, fmtHM, marketStatus, chartSession, INTERVAL_LABEL, INTERVAL_MS } from './market.js';
import { drawingsFor, addDrawing, removeDrawing, clearDrawings, saveDrawings, distToSegment } from './draw.js';
import { LEADLAG } from './feeds.js';
import { pnlGrid, positionSummary } from './options.js';
import { STRATEGIES, PROFILES, buildPlan } from './signals.js';
import { SCENES, sceneName } from './scenes.js';

export const RAGC = { GREEN: C.up, AMBER: C.amber, RED: C.down };

function wrap(ctx, str, maxW, size, fam = F.hud, weight = 500) {
  ctx.font = `${weight} ${size}px ${fam}`;
  const words = String(str).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function para(ctx, str, x, y, maxW, { size = 22, lh = 1.35, color = C.text, weight = 500, maxLines = 99 } = {}) {
  const lines = wrap(ctx, str, maxW, size, F.hud, weight).slice(0, maxLines);
  lines.forEach((l, i) => text(ctx, l, x, y + i * size * lh, { size, color, weight }));
  return lines.length * size * lh;
}
function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
// The brand logo, drawn on the top bar like the website's header.
const LOGO = new Image(); let logoReady = false;
LOGO.onload = () => { logoReady = true; for (const f of logoWaiters) f(); };
const logoWaiters = [];
LOGO.src = './brand/indai-logo-clear.png';
function pill(ctx, x, y, label, color, { size = 20, align = 'left' } = {}) {
  ctx.font = `600 ${size}px ${F.hud}`;
  const w = ctx.measureText(label).width + size * 1.2, h = size * 1.6;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  rrect(ctx, x0, y, w, h, h / 2); ctx.fillStyle = hexA(color, 0.10); ctx.fill();
  ctx.strokeStyle = hexA(color, 0.45); ctx.lineWidth = 2; ctx.stroke();
  text(ctx, label, x0 + w / 2, y + h / 2 + 1, { size, weight: 600, color, align: 'center', base: 'middle' });
  return w;
}
function fmtVol(v) { if (!v) return '0'; if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'; return String(Math.round(v)); }
function fmtBig(v) { if (v == null) return '—'; const a = Math.abs(v); const s = a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0); return (v < 0 ? '−$' : '$') + s; }
const pct0 = (v) => v == null ? '—' : `${Math.round(v * 100)}%`;
const expLabel = (exp) => { if (!exp) return ''; const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); if (exp === today) return 'today (0DTE)'; const d = new Date(exp + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
export function ideaLabel(idea) { return `${idea.sym} ${idea.strike ?? ''}${idea.type === 'P' ? 'P' : 'C'}${idea.side < 0 ? ' (short)' : ''} · ${expLabel(idea.expiry)}`; }

function sparkline(ctx, bars, x, y, w, h, base) {
  if (!bars || bars.length < 2) return;
  const lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h));
  const yv = (v) => y + h - ((v - lo) / ((hi - lo) || 1)) * h;
  if (base != null && base >= lo && base <= hi) { ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, yv(base)); ctx.lineTo(x + w, yv(base)); ctx.stroke(); ctx.setLineDash([]); }
  const up = bars[bars.length - 1].c >= (base ?? bars[0].o);
  const col = up ? C.up : C.down;
  ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
  bars.forEach((b, k) => { const xx = x + (k / (bars.length - 1)) * w; k ? ctx.lineTo(xx, yv(b.c)) : ctx.moveTo(xx, yv(b.c)); });
  ctx.stroke();
}
// Chart labels sit on a dark backing so they never fight the candles (website chart.js).
function chartLabel(ctx, str, x, y, { size = 19, color = C.text, align = 'left', weight = 600 } = {}) {
  ctx.font = `${weight} ${size}px ${F.hud}`;
  const w = ctx.measureText(str).width, x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = 'rgba(5,7,9,0.72)'; ctx.fillRect(x0 - 5, y - size * 0.95, w + 10, size * 1.3);
  text(ctx, str, x, y, { size, weight, color, align });
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

// ---------------------------------------------------------------- top bar
export class TopBar extends Panel {
  constructor(app) { super({ id: 'top', w: 1.30, h: 0.13, header: false }); this.app = app; if (!logoReady) logoWaiters.push(() => { this.dirty = true; }); }
  drawBody(ctx) {
    const { W, app } = this;
    const ms = marketStatus();
    if (logoReady) { const lh = 50, lw = lh * LOGO.width / LOGO.height; ctx.drawImage(LOGO, 34, 30, lw, lh); }
    else text(ctx, 'INDAI', 34, 72, { size: 44, weight: 700, color: C.white, spacing: 2 });
    text(ctx, `Command Center${app.settings.name ? ' · ' + app.settings.name : ''}`, 36, 112, { size: 20, weight: 500, color: C.dim, max: 360 });
    text(ctx, fmtClock() + ' ET', W / 2, 66, { size: 44, weight: 500, fam: F.mono, color: C.white, align: 'center' });
    const stColor = ms.state === 'open' ? C.up : ms.state === 'closed' ? C.down : C.amber;
    const label = ms.label.charAt(0) + ms.label.slice(1).toLowerCase();
    const sub = `${label} · ${ms.nextEvent} in ${fmtDuration(ms.msToNext)}`;
    ctx.font = `500 22px ${F.hud}`;
    const sw = Math.min(470, ctx.measureText(sub).width);
    dot(ctx, W / 2 - sw / 2 - 16, 102, 6, stColor);
    text(ctx, sub, W / 2, 109, { size: 22, weight: 500, color: stColor, align: 'center', max: 470 });
    const st = app.feed.status;
    const ps = app.priceStatus();
    const bcol = ps.kind === 'demo' ? C.amber : ps.kind === 'live' ? C.up : C.sky;
    pill(ctx, W - 34, 26, ps.text, bcol, { size: 22, align: 'right' });
    const sl = app.schwabLive;
    const src = ps.kind === 'demo' ? 'Simulated prices' : sl && sl.state === 'live' ? `Schwab stream${sl.ticks ? ` · ${sl.ticks.toLocaleString()} trades` : ''}`
      : ps.kind === 'live' || ps.kind === 'idle' ? (ps.source === 'TradingView' ? 'TradingView bridge' : ps.source === 'Finnhub' ? `Finnhub ${st.finnhubWs === 'live' ? 'streaming' : st.finnhubWs}` : `${ps.source}${ps.kind === 'idle' ? ' · last update' : ''}`)
      : `CBOE ${st.cboe === 'ok' ? 'connected' : st.cboe}`;
    text(ctx, src, W - 34, 110, { size: 19, weight: 500, color: C.faint, align: 'right', max: 330 });
  }
}

// ---------------------------------------------------------------- watchlist
export class Watchlist extends Panel {
  constructor(app) { super({ id: 'watch', title: 'Watchlist', w: 0.62, h: 0.80 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app; const syms = app.settings.symbols;
    const rowH = Math.min(100, Math.floor(a.h / Math.max(syms.length, 1)));
    syms.forEach((sym, i) => {
      const y = a.y + i * rowH;
      const q = app.feed.quote(sym);
      const sel = sym === app.settings.main;
      const hov = this.hoverBtn === 'row:' + sym;
      rrect(ctx, a.x - 8, y + 4, a.w + 16, rowH - 8, 18);
      ctx.fillStyle = sel ? 'rgba(240,198,116,0.10)' : hov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)';
      ctx.fill();
      if (sel) { ctx.lineWidth = 2; ctx.strokeStyle = hexA(C.gold, 0.7); ctx.stroke(); }
      this.buttons.push({ id: 'row:' + sym, sym, x: a.x - 8, y: y + 4, w: a.w + 16, h: rowH - 8, onClick: () => app.selectSymbol(sym) });
      const mid = y + rowH / 2;
      text(ctx, sym, a.x + 12, mid - 2, { size: 34, weight: 600, color: sel ? C.gold : C.white });
      const lv = app.levelsFor(sym);
      if (q && lv) {
        const near = nearestLevel(q.last, lv);
        if (near) text(ctx, `${near.short} ${near.dist >= 0 ? '+' : ''}${near.dist.toFixed(2)}%`, a.x + 12, mid + 28, { size: 19, weight: 500, fam: F.mono, color: Math.abs(near.dist) < 0.15 ? C.amber : C.faint, max: 180 });
      }
      sparkline(ctx, app.feed.getBars(sym, '5min'), a.x + 200, mid - rowH * 0.24, 150, rowH * 0.48, q?.base);
      text(ctx, q ? fmtPrice(q.last) : '—', a.x + a.w - 10, mid - 2, { size: 32, weight: 500, fam: F.mono, color: C.white, align: 'right' });
      const sub = q ? (q.ext != null ? `${fmtPct(q.pct)} · ext ${fmtPct(q.extPct)}` : fmtPct(q.pct)) : 'loading…';
      text(ctx, sub, a.x + a.w - 10, mid + 28, { size: 21, weight: 600, fam: F.mono, color: q ? colorFor(q.chg) : C.faint, align: 'right', max: 260 });
    });
  }
}

export function nearestLevel(price, lv) {
  const names = { cw: ['Call wall', 'CW'], pw: ['Put wall', 'PW'], zg: ['Gamma flip', 'FLIP'] };
  let best = null;
  for (const k of ['cw', 'pw', 'zg']) {
    if (lv[k] == null) continue;
    const dist = ((lv[k] - price) / price) * 100;
    if (!best || Math.abs(dist) < Math.abs(best.dist)) best = { key: k, name: names[k][0], short: names[k][1], level: lv[k], dist };
  }
  return best;
}

// ---------------------------------------------------------------- main chart
// Works like the website's chart: pinch (or trigger) and drag to move it, drag the price axis to stretch prices,
// drag the time axis or pinch with both hands to zoom, double-pinch to reset. "Draw" adds trend lines and price
// levels that can be selected, moved and deleted; they are kept on this device per ticker (same store as the website).
const MIN_SLOTS = 8;
export class MainChart extends Panel {
  constructor(app) {
    super({ id: 'chart', title: 'Chart', w: 1.30, h: 0.76 }); this.app = app; this.wantsHoverRedraw = true; this.titleColor = C.white; this.framed = true;
    this.view = null; this.ys = null; this.viewKey = ''; this.geo = null;
    this.drawMode = false; this.tool = 'move'; this.sel = null; this.drag = null; this.pending = null; this.lastTap = null;
  }
  prepare() { const s = this.app.settings; this.title = `${s.main} · ${INTERVAL_LABEL[s.interval]}`; }
  get manual() { return !!(this.view || this.ys); }

  // ---- geometry helpers (all in panel canvas units)
  xOf(t) { const g = this.geo; return g.plot.x + ((t - g.open) / g.ivMs - g.first + 0.5) * g.cw; }
  tOf(x) { const g = this.geo; return g.open + ((x - g.plot.x) / g.cw + g.first - 0.5) * g.ivMs; }
  pOf(y) { const g = this.geo; return g.lo + ((g.plot.y + g.plot.h - Math.max(g.plot.y, Math.min(g.plot.y + g.plot.h, y))) / g.plot.h) * (g.hi - g.lo); }
  yOf(p) { const g = this.geo; return g.plot.y + g.plot.h - ((p - g.lo) / (g.hi - g.lo)) * g.plot.h; }
  inPlot(p) { const g = this.geo; return g && p.x >= g.plot.x && p.x <= g.plot.x + g.plot.w && p.y >= g.plot.y && p.y <= g.plot.y + g.plot.h; }
  zone(p) {
    const g = this.geo; if (!g) return null;
    const right = g.plot.x + g.plot.w, bottom = g.plot.y + g.plot.h;
    if (p.x > right && p.x < right + 118 && p.y >= g.plot.y && p.y <= bottom + 10) return 'yscale';
    if (p.y > bottom && p.y < bottom + 46 && p.x >= g.plot.x && p.x <= right) return 'xscale';
    return this.inPlot(p) ? 'plot' : null;
  }
  clampSlots(n) { const g = this.geo; return Math.max(MIN_SLOTS, Math.min(g ? g.zoomMax : 390, n)); }
  setView(first, slots) { this.view = { first, slots }; this.dirty = true; }
  setY(lo, hi) {
    const g = this.geo, fit = g ? g.autoHi - g.autoLo : hi - lo;
    const span = Math.max(fit * 0.03, Math.min(fit * 40, hi - lo)), mid = (lo + hi) / 2;
    this.ys = { lo: mid - span / 2, hi: mid + span / 2 }; this.dirty = true;
  }
  resetView() { this.view = null; this.ys = null; this.dirty = true; this.app.chartEvent?.('reset'); }
  setDrawMode(on) { this.drawMode = !!on; if (!on) { this.tool = 'move'; this.pending = null; this.sel = null; } this.dirty = true; }
  setTool(tool) { this.tool = this.tool === tool ? 'move' : tool; this.pending = null; if (this.tool !== 'move') { this.sel = null; this.drawMode = true; this.app.chartEvent?.('tool-' + this.tool); } this.dirty = true; }
  deleteSelected() { if (!this.sel) return; removeDrawing(this.app.settings.main, this.sel); this.sel = null; this.dirty = true; }
  clearAll() { clearDrawings(this.app.settings.main); this.sel = null; this.pending = null; this.dirty = true; }

  // The drawing under a point: an end of the selected line, a line's body, or a level.
  hitDrawing(p, coarse = true) {
    const g = this.geo; if (!g || !this.inPlot(p)) return null;
    const list = drawingsFor(this.app.settings.main), near = coarse ? 40 : 22, edge = coarse ? 26 : 14;
    const ends = (d) => [this.xOf(d.a.t), this.yOf(d.a.p), this.xOf(d.b.t), this.yOf(d.b.p)];
    const picked = list.find(d => d.id === this.sel);
    if (picked && picked.type === 'line') {
      const [ax, ay, bx, by] = ends(picked);
      if (Math.hypot(p.x - ax, p.y - ay) <= near) return { d: picked, part: 'a' };
      if (Math.hypot(p.x - bx, p.y - by) <= near) return { d: picked, part: 'b' };
    }
    for (let n = list.length - 1; n >= 0; n--) {
      const d = list[n];
      if (d.type === 'level') { if (d.p <= g.hi && d.p >= g.lo && Math.abs(p.y - this.yOf(d.p)) <= edge) return { d, part: 'level' }; continue; }
      const [ax, ay, bx, by] = ends(d);
      if (distToSegment(p.x, p.y, ax, ay, bx, by) <= edge) return { d, part: 'body' };
    }
    return null;
  }

  // ---- pointer input (pinch / trigger / mouse). Returns true when the chart takes the press.
  pointerDown(p, { coarse = true } = {}) {
    const g = this.geo; this.drag = null;
    if (!g) return false;
    const z = this.zone(p); if (!z) return false;
    const moveTol = coarse ? 22 : 6;
    if (z === 'yscale') { this.drag = { kind: 'yscale', start: p, lo0: g.lo, hi0: g.hi, moved: false, tol: moveTol }; return true; }
    if (z === 'xscale') { this.drag = { kind: 'xscale', start: p, first0: g.first, slots0: g.slots, moved: false, tol: moveTol }; return true; }
    const at = { t: this.tOf(p.x), p: this.pOf(p.y) }, sym = this.app.settings.main;
    if (this.tool === 'line') this.drag = { kind: 'new', a: this.pending || at, b: at, start: p, second: !!this.pending, tol: moveTol };
    else if (this.tool === 'level') { const d = addDrawing(sym, { type: 'level', p: at.p }); this.sel = d.id; this.drag = { kind: 'level', d, start: p, moved: true, tol: moveTol }; }
    else {
      const hit = this.hitDrawing(p, coarse);
      if (hit && hit.d.id === this.sel) this.drag = { kind: hit.part, d: hit.d, start: p, from: at, a0: hit.d.a && { ...hit.d.a }, b0: hit.d.b && { ...hit.d.b }, moved: false, tol: moveTol };
      else this.drag = { kind: 'pan', start: p, first0: g.first, slots0: g.slots, cw0: g.cw, lo0: g.lo, hi0: g.hi, hit, moved: false, tol: moveTol };
    }
    this.dirty = true;
    return true;
  }
  pointerMove(p) {
    const g = this.geo, d = this.drag;
    this.hover = p;
    if (!g || !d) { this.dirty = true; return; }
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > d.tol) d.moved = true;
    const at = { t: this.tOf(p.x), p: this.pOf(p.y) };
    if (d.kind === 'yscale') { if (d.moved) { const k = Math.exp((p.y - d.start.y) * 0.004), mid = (d.lo0 + d.hi0) / 2, half = (d.hi0 - d.lo0) / 2 * k; this.setY(mid - half, mid + half); } return; }
    if (d.kind === 'xscale') { if (d.moved) { const slots = this.clampSlots(d.slots0 * Math.exp((d.start.x - p.x) * 0.004)); this.setView(d.first0 + d.slots0 - slots, slots); this.app.chartEvent?.('zoom'); } return; }
    if (d.kind === 'pan') {
      if (d.moved) {
        if (this.ys) { const dp = (p.y - d.start.y) / g.plot.h * (d.hi0 - d.lo0); this.ys = { lo: d.lo0 + dp, hi: d.hi0 + dp }; }
        this.setView(d.first0 - (p.x - d.start.x) / d.cw0, d.slots0);
        this.app.chartEvent?.('pan');
      } else this.dirty = true;
      return;
    }
    if (d.kind === 'new') d.b = at;
    else if (d.kind === 'level') d.d.p = at.p;
    else if (d.kind === 'a' || d.kind === 'b') d.d[d.kind] = at;
    else if (d.kind === 'body') { const dt = at.t - d.from.t, dp = at.p - d.from.p; d.d.a = { t: d.a0.t + dt, p: d.a0.p + dp }; d.d.b = { t: d.b0.t + dt, p: d.b0.p + dp }; }
    this.dirty = true;
  }
  pointerUp(p, cancelled = false) {
    const g = this.geo, d = this.drag, sym = this.app.settings.main;
    this.drag = null;
    if (!d) return;
    if (p && !d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > d.tol) d.moved = true;
    const now = performance.now();
    if (d.kind === 'new') {
      const far = p && Math.hypot(p.x - d.start.x, p.y - d.start.y) >= 24;
      if (cancelled || !g) this.pending = null;
      else if (d.second || far) {
        const long = Math.hypot(this.xOf(d.a.t) - this.xOf(d.b.t), this.yOf(d.a.p) - this.yOf(d.b.p)) >= 16;
        if (long) { this.sel = addDrawing(sym, { type: 'line', day: g.open, a: d.a, b: d.b }).id; this.app.chartEvent?.('line'); }
        this.pending = null; this.tool = 'move';
      } else this.pending = d.a;          // one pinch places the start; the next one places the end
    } else if (d.kind === 'pan') {
      if (!d.moved && !cancelled) {
        const again = this.lastTap && !this.lastTap.zone && now - this.lastTap.t < 500 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 60;
        this.lastTap = again ? null : { t: now, x: p.x, y: p.y };
        if (d.hit) { this.sel = d.hit.d.id; this.drawMode = true; }
        else if (this.sel) this.sel = null;
        else if (again) this.resetView();     // two quick pinches on the chart go back to the automatic view
      }
    } else if (d.kind === 'yscale' || d.kind === 'xscale') {
      if (!d.moved && !cancelled) {
        const again = this.lastTap && this.lastTap.zone === d.kind && now - this.lastTap.t < 500;
        this.lastTap = again ? null : { t: now, x: p.x, y: p.y, zone: d.kind };
        if (again) { if (d.kind === 'yscale') this.ys = null; else this.view = null; }
      }
    } else {
      if (d.kind === 'level' && this.tool === 'level') { this.tool = 'move'; this.app.chartEvent?.('level'); }
      saveDrawings();
    }
    this.dirty = true;
  }
  // Two hands (or two controllers) on the chart: spread to zoom in, bring together to zoom out.
  pinchStart(pa, pb) {
    const g = this.geo; if (!g) return;
    if (this.drag && ['level', 'a', 'b', 'body'].includes(this.drag.kind)) saveDrawings();
    this.drag = { kind: 'pinch', d0: Math.max(40, Math.abs(pa.x - pb.x)), mid0: (pa.x + pb.x) / 2, first0: g.first, slots0: g.slots, cw0: g.cw };
  }
  pinchMove(pa, pb) {
    const g = this.geo, d = this.drag; if (!g || !d || d.kind !== 'pinch') return;
    const slots = this.clampSlots(d.slots0 * d.d0 / Math.max(40, Math.abs(pa.x - pb.x)));
    const under = d.first0 + (d.mid0 - g.plot.x) / d.cw0;
    this.setView(under - ((pa.x + pb.x) / 2 - g.plot.x) / (g.plot.w / slots), slots);
    this.app.chartEvent?.('zoom');
  }
  pinchEnd() { if (this.drag && this.drag.kind === 'pinch') this.drag = null; this.dirty = true; }
  // Mouse wheel in the 2D preview: over the price axis it stretches prices, sideways it moves, up/down it zooms.
  wheel(p, dx, dy) {
    const g = this.geo; if (!g) return false;
    const z = this.zone(p); if (!z) return false;
    if (z === 'yscale') { const k = Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0015), mid = (g.lo + g.hi) / 2, half = (g.hi - g.lo) / 2 * k; this.setY(mid - half, mid + half); return true; }
    if (Math.abs(dx) > Math.abs(dy)) { this.setView(g.first + dx / g.cw, g.slots); return true; }
    const slots = this.clampSlots(g.slots * Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0015));
    const under = g.first + (p.x - g.plot.x) / g.cw;
    this.setView(under - (p.x - g.plot.x) / (g.plot.w / slots), slots);
    return true;
  }
  // Controller thumbstick while pointing at the chart: left/right moves it, up/down zooms.
  stick(x, y, p, dt) {
    const g = this.geo; if (!g) return;
    let first = g.first, slots = g.slots;
    if (Math.abs(x) > 0.15) { first += x * slots * 0.9 * dt; this.app.chartEvent?.('pan'); }
    if (Math.abs(y) > 0.15) {
      const ns = this.clampSlots(slots * Math.exp(y * 1.6 * dt));
      const px = p && this.inPlot(p) ? p.x : g.plot.x + g.plot.w;
      const under = first + (px - g.plot.x) / (g.plot.w / slots);
      first = under - (px - g.plot.x) / (g.plot.w / ns); slots = ns; this.app.chartEvent?.('zoom');
    }
    this.setView(first, slots);
  }

  drawBody(ctx, a) {
    const app = this.app, s = app.settings, sym = s.main, iv = s.interval;
    const W = this.W;
    let bx = W - 28;
    const btn = (id, label, w, opts) => { bx -= w; this.button(id, bx, 10, w, 40, label, { size: 20, ...opts }); bx -= 8; };
    btn('gex', 'GEX', 66, { active: s.show.gex, color: C.amber, onClick: () => app.toggleShow('gex') });
    btn('vwap', 'VWAP', 78, { active: s.show.vwap, color: C.gold, onClick: () => app.toggleShow('vwap') });
    btn('ema', 'EMA', 66, { active: s.show.ema, color: C.up, onClick: () => app.toggleShow('ema') });
    bx -= 12;
    for (const ivx of ['15min', '5min', '1min']) btn('iv' + ivx, INTERVAL_LABEL[ivx], 58, { active: iv === ivx, onClick: () => app.setTimeframe(ivx) });
    bx -= 12;
    btn('next', '›', 46, { size: 30, onClick: () => app.cycleSymbol(1) });
    btn('prev', '‹', 46, { size: 30, onClick: () => app.cycleSymbol(-1) });
    bx -= 12;
    btn('draw', 'Draw', 84, { active: this.drawMode, onClick: () => this.setDrawMode(!this.drawMode) });
    if (this.manual) btn('reset', 'Reset view', 140, { onClick: () => this.resetView() });

    const q = app.feed.quote(sym);
    const bars = app.feed.getBars(sym, iv);
    const iy = a.y + 36;
    text(ctx, q ? fmtPrice(q.last) : '—', a.x + 4, iy + 6, { size: 50, weight: 500, fam: F.mono, color: C.white });
    if (q) text(ctx, `${q.chg >= 0 ? '+' : ''}${q.chg.toFixed(2)}  ${fmtPct(q.pct)}`, a.x + 240, iy, { size: 28, weight: 600, fam: F.mono, color: colorFor(q.chg) });
    if (this.drawMode) {
      // the drawing bar: tools, then delete / clear / done
      let tx = a.x + 540;
      const tb = (id, label, w, opts) => { this.button(id, tx, a.y + 2, w, 44, label, { size: 20, ...opts }); tx += w + 8; };
      const count = drawingsFor(sym).length;
      tb('t-line', 'Trend line', 150, { active: this.tool === 'line', onClick: () => this.setTool('line') });
      tb('t-level', 'Level', 100, { active: this.tool === 'level', onClick: () => this.setTool('level') });
      tb('t-del', 'Delete', 104, { disabled: !this.sel, color: C.down, active: !!this.sel, onClick: () => this.deleteSelected() });
      tb('t-clear', 'Clear all', 124, { disabled: !count, onClick: () => this.clearAll() });
      tb('t-done', 'Done', 90, { primary: true, onClick: () => this.setDrawMode(false) });
    } else if (q) {
      text(ctx, `H ${fmtPrice(q.high)}  L ${fmtPrice(q.low)}${q.ext != null ? `  ·  ext ${fmtPrice(q.ext)}` : ''}`, a.x + 540, iy, { size: 22, weight: 500, fam: F.mono, color: C.dim, max: 520 });
    }
    const plot = { x: a.x, y: a.y + 68, w: a.w - 118, h: a.h - 108 };
    this.geo = null;
    if (bars.length < 2) {
      text(ctx, 'Loading market data…', plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 28, color: C.dim, align: 'center' });
      if (app.feed.status.note) text(ctx, app.feed.status.note, plot.x + plot.w / 2, plot.y + plot.h / 2 + 42, { size: 21, color: C.faint, align: 'center', max: plot.w - 40 });
      return;
    }
    const sess = chartSession(), ivMs = INTERVAL_MS[iv];
    const closes = bars.map(b => b.c);
    const e5 = ema(closes, 5), e12 = ema(closes, 12), e34 = ema(closes, 34), e50 = ema(closes, 50);
    const vw = vwap(bars);
    const idxOf = (b) => Math.round((b.t - sess.open) / ivMs);
    // Automatic view: the session so far with room to the right (as on the website), or the trader's own view.
    const full = Math.max(bars.length, Math.ceil((sess.close - sess.open) / ivMs)), li = idxOf(bars[bars.length - 1]);
    const minSlots = { '1min': 45, '5min': 30, '15min': 14 }[iv] || 30;
    let slots = Math.min(full, Math.max(minSlots, Math.ceil((li + 1) * 1.3) + 1)), first = 0;
    const key = sym + '|' + iv + '|' + sess.open;
    if (this.viewKey !== key) { this.viewKey = key; this.view = null; this.ys = null; this.sel = null; this.pending = null; if (this.drag && this.drag.kind !== 'pinch') this.drag = null; }
    const zoomMax = Math.max(full, 30);
    if (this.view) {
      slots = Math.max(MIN_SLOTS, Math.min(zoomMax, this.view.slots));
      first = Math.max(idxOf(bars[0]) + 3 - slots, Math.min(li - 2, this.view.first));
      this.view = { first, slots };
    }
    const cw = plot.w / slots;
    const xi = (i) => plot.x + (i - first + 0.5) * cw;
    const vis = [];
    bars.forEach((b, k) => { const i = idxOf(b); if (i > first - 1 && i < first + slots) vis.push({ b, i, k }); });
    if (!vis.length) { text(ctx, 'No candles here. Double-pinch the chart to reset.', plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 24, color: C.dim, align: 'center' }); this.geo = { plot, first, slots, cw, lo: 0, hi: 1, autoLo: 0, autoHi: 1, open: sess.open, ivMs, zoomMax }; return; }
    let lo = Math.min(...vis.map(p => p.b.l)), hi = Math.max(...vis.map(p => p.b.h));
    const lv = s.show.gex ? app.levelsFor(sym) : null;
    const span0 = hi - lo || hi * 0.002;
    const offscreen = [];
    const lines = [];
    if (lv) {
      for (const [k, name, col, w] of [['cw', 'Call wall', C.up, 2.5], ['zg', 'Gamma flip', C.amber, 2.5], ['pw', 'Put wall', C.down, 2.5], ['cw2', 'Call wall 2', hexA(C.up, 0.55), 1.5], ['pw2', 'Put wall 2', hexA(C.down, 0.55), 1.5]]) if (lv[k] != null) lines.push({ v: lv[k], name, col, w });
      if (lv.near) for (const [k, name, col] of [['cw', '0DTE call wall', C.up], ['pw', '0DTE put wall', C.down]]) if (lv.near[k] != null && lv.near[k] !== lv[k]) lines.push({ v: lv.near[k], name, col: hexA(col, 0.7), w: 1.5, dotted: true });
      for (const l of lines) { if (l.v > hi && l.v - hi < span0 * 0.6) hi = l.v; else if (l.v < lo && lo - l.v < span0 * 0.6) lo = l.v; }
    }
    const pad = (hi - lo) * 0.08 || 0.1; lo -= pad; hi += pad;
    const autoLo = lo, autoHi = hi;
    if (this.ys) { lo = this.ys.lo; hi = this.ys.hi; }
    this.geo = { plot, first, slots, cw, lo, hi, autoLo, autoHi, open: sess.open, ivMs, zoomMax };
    const yv = (v) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;
    // grid, price axis
    const step = niceStep((hi - lo) / 6);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = yv(v);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      text(ctx, fmtPrice(v), plot.x + plot.w + 10, y + 7, { size: 20, weight: 500, fam: F.mono, color: C.faint });
    }
    // time axis: labels at least ~120 units apart
    const minStep = [5, 15, 30, 60, 120].find(m => (m * 60e3 / ivMs) * cw >= 120) || 120;
    for (let t = sess.open + minStep * 60e3; t <= sess.close; t += minStep * 60e3) {
      const x = plot.x + ((t - sess.open) / ivMs - first) * cw;
      if (x < plot.x || x > plot.x + plot.w) continue;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      const lab = minStep >= 60 ? fmtHM(t).replace(':00', '').replace(' ', '').toLowerCase() : fmtHM(t).replace(' ', '').toLowerCase();
      text(ctx, lab, x, plot.y + plot.h + 30, { size: 20, weight: 500, color: C.faint, align: 'center' });
    }
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
    if (s.show.ema) {
      const cloud = (fa, fb, upCol, dnCol) => {
        for (let n = 0; n < vis.length - 1; n++) {
          const k = vis[n].k, k2 = vis[n + 1].k, A = fa[k], B = fb[k], A2 = fa[k2], B2 = fb[k2];
          if (A == null || B == null || A2 == null || B2 == null) continue;
          ctx.fillStyle = A >= B ? upCol : dnCol;
          ctx.beginPath(); ctx.moveTo(xi(vis[n].i), yv(A)); ctx.lineTo(xi(vis[n + 1].i), yv(A2)); ctx.lineTo(xi(vis[n + 1].i), yv(B2)); ctx.lineTo(xi(vis[n].i), yv(B)); ctx.closePath(); ctx.fill();
        }
      };
      cloud(e34, e50, 'rgba(110,195,242,0.13)', 'rgba(240,150,74,0.13)');
      cloud(e5, e12, 'rgba(62,207,142,0.22)', 'rgba(242,112,107,0.22)');
    }
    const bw = Math.max(1.5, cw * 0.66);
    for (const p of vis) {
      const b = p.b, x = xi(p.i), up = b.c >= b.o;
      const col = up ? C.up : C.down;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, Math.min(3, cw * 0.15));
      ctx.beginPath(); ctx.moveTo(x, yv(b.h)); ctx.lineTo(x, yv(b.l)); ctx.stroke();
      const y1 = yv(Math.max(b.o, b.c)), y2 = yv(Math.min(b.o, b.c));
      ctx.fillStyle = col;
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1.5, y2 - y1));
    }
    if (s.show.vwap) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5 * S; ctx.setLineDash([6 * S, 4 * S]); ctx.beginPath();
      vis.forEach((p, n) => { const x = xi(p.i), y = yv(vw[p.k]); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (lv) {
      for (const l of lines) {
        if (l.v > hi || l.v < lo) { if (l.w > 2) offscreen.push(`${l.name} ${fmtPrice(l.v)} ${l.v > hi ? '↑' : '↓'}`); continue; }
        const y = yv(l.v);
        ctx.strokeStyle = l.col; ctx.lineWidth = l.w; ctx.setLineDash(l.dotted ? [3, 7] : [9 * S, 6 * S]);
        ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // the trader's drawings: violet, the selected one white with handles
    const dl = drawingsFor(sym);
    for (const d of dl) {
      const selc = d.id === this.sel, col = selc ? C.white : C.violet;
      ctx.strokeStyle = col; ctx.lineWidth = selc ? 4 : 3;
      if (d.type === 'level') { const y = yv(d.p); ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke(); continue; }
      const ax = this.xOf(d.a.t), ay = yv(d.a.p), bx2 = this.xOf(d.b.t), by = yv(d.b.p);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by); ctx.stroke();
      if (selc) for (const [hx, hy] of [[ax, ay], [bx2, by]]) { ctx.beginPath(); ctx.arc(hx, hy, 11, 0, 7); ctx.fillStyle = C.ink; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.white; ctx.stroke(); }
    }
    // a line being placed: from its first point to where the pointer is
    const h = this.hover;
    const live = this.drag && this.drag.kind === 'new' ? this.drag : this.pending && h && this.inPlot(h) ? { a: this.pending, b: { t: this.tOf(h.x), p: this.pOf(h.y) } } : null;
    if (live) {
      ctx.strokeStyle = C.violet; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(this.xOf(live.a.t), yv(live.a.p)); ctx.lineTo(this.xOf(live.b.t), yv(live.b.p)); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(this.xOf(live.a.t), yv(live.a.p), 9, 0, 7); ctx.fillStyle = C.violet; ctx.fill();
    }
    ctx.restore();
    // labels on top of everything, inside the plot
    if (s.show.vwap) { const lp = vis[vis.length - 1]; const vy = yv(vw[lp.k]); if (vy > plot.y + 10 && vy < plot.y + plot.h - 10) chartLabel(ctx, 'VWAP', Math.min(plot.x + plot.w - 10, xi(lp.i) - 10), vy + 26, { size: 19, color: C.gold, align: 'right' }); }
    if (lv) {
      for (const l of lines) { if (l.v > hi || l.v < lo) continue; chartLabel(ctx, `${l.name} ${fmtPrice(l.v)}`, l.dotted ? plot.x + plot.w - 12 : plot.x + 12, yv(l.v) - 8, { size: l.w > 2 ? 20 : 17, color: l.col, align: l.dotted ? 'right' : 'left' }); }
      if (offscreen.length) text(ctx, offscreen.join('   '), plot.x + plot.w - 12, plot.y + 28, { size: 19, weight: 500, color: C.dim, align: 'right' });
      text(ctx, levelSourceLabel(lv), plot.x + plot.w - 12, plot.y + plot.h - 12, { size: 17, weight: 500, color: lv.source === 'demo' ? C.amber : C.faint, align: 'right' });
    }
    for (const d of dl) if (d.type === 'level' && d.p <= hi && d.p >= lo) { const y = yv(d.p); rrect(ctx, plot.x + plot.w + 2, y - 15, 110, 30, 6); ctx.fillStyle = d.id === this.sel ? C.white : C.violet; ctx.fill(); text(ctx, fmtPrice(d.p), plot.x + plot.w + 57, y + 1, { size: 19, weight: 600, fam: F.mono, color: C.ink, align: 'center', base: 'middle' }); }
    const lastBar = bars[bars.length - 1], last = q ? q.last : lastBar.c;
    const ly = yv(Math.min(hi, Math.max(lo, last))), lx = Math.min(plot.x + plot.w, Math.max(plot.x, xi(idxOf(lastBar))));
    ctx.strokeStyle = C.sky; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(plot.x + plot.w, ly); ctx.stroke(); ctx.setLineDash([]);
    rrect(ctx, plot.x + plot.w + 2, ly - 17, 110, 34, 6); ctx.fillStyle = C.sky; ctx.fill();
    text(ctx, fmtPrice(last), plot.x + plot.w + 57, ly + 1, { size: 21, weight: 600, fam: F.mono, color: '#04121c', align: 'center', base: 'middle' });
    // what to do next, when a drawing tool is in hand
    const hint = this.tool === 'line' ? (this.pending ? 'Now pinch where the line ends' : 'Pinch where the line starts (or pinch and drag)') : this.tool === 'level' ? 'Pinch a price to put a level there' : this.sel ? 'Pinch and drag to move it · Delete removes it' : this.drawMode ? 'Pick a tool, or pinch a drawing to select it' : '';
    if (hint) chartLabel(ctx, hint, plot.x + 12, plot.y + plot.h - 14, { size: 20, color: C.violet });
    // crosshair and the candle under the pointer
    if (h && this.inPlot(h) && !(this.drag && this.drag.moved && this.drag.kind === 'pan')) {
      const slot = Math.floor((h.x - plot.x) / cw + first);
      let best = null; for (const p of vis) if (!best || Math.abs(p.i - slot) < Math.abs(best.i - slot)) best = p;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
      if (best && Math.abs(best.i - slot) <= 2) { const x = xi(best.i); ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(plot.x, h.y); ctx.lineTo(plot.x + plot.w, h.y); ctx.stroke();
      if (best && Math.abs(best.i - slot) <= 2 && !hint) {
        const b = best.b;
        const line = `${fmtHM(b.t)}  O ${fmtPrice(b.o)}  H ${fmtPrice(b.h)}  L ${fmtPrice(b.l)}  C ${fmtPrice(b.c)}  V ${fmtVol(b.v)}`;
        rrect(ctx, plot.x + 8, plot.y + 8, plot.w * 0.74, 40, 9); ctx.fillStyle = 'rgba(5,7,9,0.92)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.stroke();
        text(ctx, line, plot.x + 22, plot.y + 36, { size: 21, weight: 500, fam: F.mono, color: C.white, max: plot.w * 0.72 - 24 });
      }
      const pv = lo + ((plot.y + plot.h - h.y) / plot.h) * (hi - lo);
      rrect(ctx, plot.x + plot.w + 2, h.y - 15, 110, 30, 6); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
      text(ctx, fmtPrice(pv), plot.x + plot.w + 57, h.y + 1, { size: 19, weight: 600, fam: F.mono, color: '#04121c', align: 'center', base: 'middle' });
    }
    if (!this.drawMode) {
      if (app.feed.status.mode === 'demo') text(ctx, 'Demo data, not real prices', a.x + a.w - 118, iy + 4, { size: 20, weight: 600, color: C.amber, align: 'right' });
      else if (app.priceStatus().kind === 'delayed') text(ctx, 'Delayed ~15 min', a.x + a.w - 118, iy + 4, { size: 19, weight: 500, color: C.faint, align: 'right' });
    }
  }
}
export function levelSourceLabel(lv) {
  if (!lv) return '';
  if (lv.source === 'manual') return 'Levels: pasted in Settings';
  if (lv.source === 'morning') return `Levels: Morning GEX refresh ${lv.asof ? lv.asof.slice(11) : ''}`;
  if (lv.source === 'morning-stale') return `Levels: Morning GEX refresh (${lv.asof ? lv.asof.slice(5, 10) : 'older'})`;
  if (lv.source === 'live') return 'Levels: live from options chain';
  if (lv.source === 'tradingview') return `Levels: TradingView alert ${lv.asof ? lv.asof.slice(11) : ''}`;
  return 'Demo levels';
}

// ---------------------------------------------------------------- lead / lag
export class LeadLag extends Panel {
  constructor(app) { super({ id: 'leadlag', title: 'Lead / lag since the open', w: 0.62, h: 0.42 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app; const cols = { SPY: C.white, QQQ: C.violet, IWM: C.gold };
    const sess = chartSession();
    const series = LEADLAG.map(sym => {
      const bars = app.feed.getBars(sym, '5min');
      const base = bars.length ? bars[0].o : null;
      const pts = base ? bars.map(b => ({ t: b.t + 150e3, v: (b.c / base - 1) * 100 })) : [];
      return { sym, pts, now: pts.length ? pts[pts.length - 1].v : null };
    });
    let lx = a.x + 4;
    for (const sr of series) {
      const w1 = text(ctx, sr.sym, lx, a.y + 22, { size: 26, weight: 600, color: cols[sr.sym] });
      const w2 = text(ctx, sr.now == null ? '—' : fmtPct(sr.now), lx + w1 + 10, a.y + 22, { size: 24, weight: 600, fam: F.mono, color: sr.now == null ? C.faint : colorFor(sr.now) });
      lx += w1 + w2 + 34;
    }
    const plot = { x: a.x, y: a.y + 42, w: a.w, h: a.h - 96 };
    const all = series.flatMap(s => s.pts.map(p => p.v));
    if (all.length < 4) { text(ctx, 'Waiting for SPY, QQQ and IWM data…', plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 24, color: C.dim, align: 'center' }); return; }
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const pad = (hi - lo) * 0.12 || 0.1; lo -= pad; hi += pad;
    const xt = (t) => plot.x + ((t - sess.open) / (sess.close - sess.open)) * plot.w;
    const yv = (v) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.setLineDash([5, 7]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(plot.x, yv(0)); ctx.lineTo(plot.x + plot.w, yv(0)); ctx.stroke(); ctx.setLineDash([]);
    for (const sr of series) {
      ctx.strokeStyle = cols[sr.sym]; ctx.lineWidth = 3.5; ctx.beginPath();
      sr.pts.forEach((p, k) => { const x = xt(p.t), y = yv(p.v); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    const ranked = series.filter(s => s.now != null).sort((x, y) => y.now - x.now);
    if (ranked.length === 3) {
      const leader = ranked[0], lagger = ranked[2];
      const spread = leader.now - lagger.now;
      const msg = spread < 0.15 ? 'Moving together, no clear leader' : `${leader.sym} leading ${lagger.sym} by ${spread.toFixed(2)}%`;
      text(ctx, msg, a.x + 4, a.y + a.h - 10, { size: 24, weight: 600, color: spread < 0.15 ? C.dim : cols[leader.sym], max: a.w - 8 });
    }
  }
}

// ---------------------------------------------------------------- GEX levels
export class Levels extends Panel {
  constructor(app) { super({ id: 'levels', title: 'GEX levels', w: 0.62, h: 0.34 }); this.app = app; }
  prepare() { this.title = `GEX levels · ${this.app.settings.main}`; }
  drawBody(ctx, a) {
    const app = this.app, sym = app.settings.main;
    const lv = app.levelsFor(sym);
    const q = app.feed.quote(sym);
    if (!lv) {
      text(ctx, `Loading levels for ${sym}…`, a.x + 4, a.y + 40, { size: 26, weight: 500, color: C.dim });
      text(ctx, 'From your morning GEX refresh, or live from the chain.', a.x + 4, a.y + 80, { size: 21, color: C.faint, max: a.w });
      return;
    }
    const rows = [['cw', 'Call wall', C.up], ['zg', 'Gamma flip', C.amber], ['pw', 'Put wall', C.down]]
      .filter(r => lv[r[0]] != null).map(r => ({ k: r[0], name: r[1], col: r[2], v: lv[r[0]] }));
    if (q) rows.push({ k: 'px', name: 'Price', col: C.sky, v: q.last });
    rows.sort((x, y) => y.v - x.v);
    const rh = Math.min(46, (a.h - 70) / rows.length);
    rows.forEach((r, i) => {
      const y = a.y + 8 + i * rh + rh / 2;
      if (r.k === 'px') { rrect(ctx, a.x - 6, y - rh / 2 + 3, a.w + 12, rh - 6, 12); ctx.fillStyle = 'rgba(110,195,242,0.08)'; ctx.fill(); }
      dot(ctx, a.x + 10, y - 2, 6, r.col, r.k === 'px');
      text(ctx, r.name, a.x + 30, y + 7, { size: 24, weight: 500, color: r.k === 'px' ? C.white : C.text });
      text(ctx, fmtPrice(r.v), a.x + a.w * 0.64, y + 7, { size: 25, weight: 500, fam: F.mono, color: C.white, align: 'right' });
      if (q && r.k !== 'px') {
        const d = ((r.v - q.last) / q.last) * 100;
        text(ctx, `${d >= 0 ? '+' : ''}${d.toFixed(2)}%`, a.x + a.w - 4, y + 7, { size: 22, weight: 600, fam: F.mono, color: Math.abs(d) < 0.15 ? C.amber : C.dim, align: 'right' });
      }
    });
    const regime = lv.zg != null && q ? (q.last >= lv.zg ? 'Positive gamma: moves tend to get dampened' : 'Negative gamma: moves tend to extend') : lv.regime ? `${lv.regime} gamma` : '';
    text(ctx, regime, a.x + 4, a.y + a.h - 34, { size: 19, weight: 500, color: C.dim, max: a.w });
    text(ctx, levelSourceLabel(lv) + (lv.near?.expiry ? ` · 0DTE walls ${lv.near.cw ?? '—'}/${lv.near.pw ?? '—'}` : ''), a.x + 4, a.y + a.h - 6, { size: 18, weight: 500, color: lv.source === 'demo' ? C.amber : C.faint, max: a.w });
  }
}

// ---------------------------------------------------------------- risk breaker
export class RiskBreaker extends Panel {
  constructor(app) { super({ id: 'risk', title: 'Risk breaker', w: 0.62, h: 0.80 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app, day = app.day, r = app.settings.risk, rs = app.riskState();
    this.accent = rs.state === 'tripped' ? C.down : rs.state === 'cooldown' ? C.amber : C.up;
    let y = a.y;
    const bcol = rs.state === 'tripped' ? C.down : rs.state === 'cooldown' ? C.amber : C.up;
    const blabel = rs.state === 'tripped' ? 'Done for today' : rs.state === 'cooldown' ? `Cooldown ${fmtMMSS(rs.cooldownLeft)}` : 'Armed · trading allowed';
    rrect(ctx, a.x, y, a.w, 62, 20); ctx.fillStyle = hexA(bcol, 0.14); ctx.fill(); ctx.strokeStyle = hexA(bcol, 0.6); ctx.lineWidth = 2; ctx.stroke();
    text(ctx, blabel, a.x + a.w / 2, y + 32, { size: 30, weight: 600, color: bcol, align: 'center', base: 'middle' });
    y += 80;
    text(ctx, 'Day P&L', a.x, y + 26, { size: 24, weight: 500, color: C.dim });
    text(ctx, fmtMoney(day.pnl, true), a.x + a.w, y + 44, { size: 56, weight: 500, fam: F.mono, color: colorFor(day.pnl), align: 'right' });
    text(ctx, `${day.trades.length} trade${day.trades.length === 1 ? '' : 's'}`, a.x, y + 58, { size: 21, color: C.faint });
    y += 76;
    const used = Math.min(1, rs.used / r.maxDailyLoss);
    rrect(ctx, a.x, y, a.w, 18, 9); ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    if (used > 0) { rrect(ctx, a.x, y, Math.max(18, a.w * used), 18, 9); ctx.fillStyle = used > 0.75 ? C.down : used > 0.5 ? C.amber : C.up; ctx.fill(); }
    text(ctx, `Loss limit ${fmtMoney(rs.used)} of ${fmtMoney(r.maxDailyLoss)} · ${fmtMoney(rs.room)} room`, a.x, y + 50, { size: 22, weight: 500, color: C.dim, max: a.w });
    y += 68;
    text(ctx, 'Losses in a row', a.x, y + 22, { size: 22, weight: 500, color: C.dim });
    for (let i = 0; i < r.maxConsecLosses; i++) dot(ctx, a.x + 210 + i * 32, y + 14, 10, i < day.consec ? C.down : 'rgba(255,255,255,0.14)', i < day.consec);
    text(ctx, `cooldown after ${r.maxConsecLosses}`, a.x + a.w, y + 22, { size: 19, color: C.faint, align: 'right' });
    y += 44;
    const amt = day.step;
    this.button('amt-', a.x, y, 68, 56, '−', { size: 32, onClick: () => app.setStep(-1) });
    rrect(ctx, a.x + 78, y, 140, 56, 16); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    text(ctx, fmtMoney(amt), a.x + 148, y + 29, { size: 28, weight: 500, fam: F.mono, color: C.white, align: 'center', base: 'middle' });
    this.button('amt+', a.x + 228, y, 68, 56, '+', { size: 32, onClick: () => app.setStep(1) });
    this.button('undo', a.x + a.w - 124, y, 124, 56, 'Undo', { size: 23, color: C.dim, disabled: !day.trades.length, onClick: () => app.undoTrade() });
    y += 68;
    const half = (a.w - 14) / 2;
    this.button('win', a.x, y, half, 64, `Win +${fmtMoney(amt)}`, { size: 26, color: C.up, tone: true, onClick: () => app.logTrade(amt) });
    this.button('loss', a.x + half + 14, y, half, 64, `Loss −${fmtMoney(amt)}`, { size: 26, color: C.down, tone: true, onClick: () => app.logTrade(-amt) });
    y += 84;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke();
    y += 10;
    text(ctx, `Position sizer · risk ${fmtMoney(rs.riskPerTrade)} (${r.riskPct}%) · stop ${r.stopPct}%`, a.x, y + 26, { size: 21, weight: 500, color: C.dim, max: a.w });
    y += 40;
    this.button('prem-', a.x, y, 62, 52, '−', { size: 30, onClick: () => app.setPremium(-1) });
    rrect(ctx, a.x + 70, y, 150, 52, 16); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    text(ctx, '$' + day.premium.toFixed(2), a.x + 145, y + 27, { size: 26, weight: 500, fam: F.mono, color: C.white, align: 'center', base: 'middle' });
    this.button('prem+', a.x + 228, y, 62, 52, '+', { size: 30, onClick: () => app.setPremium(1) });
    const sizeLabel = rs.state !== 'armed' ? 'Locked' : rs.checklistScore < 3 ? 'Wait' : `Max ${rs.contracts}`;
    const sizeSub = rs.state !== 'armed' ? 'breaker active' : rs.checklistScore < 3 ? `setup ${rs.checklistScore}/4` : rs.contracts === 1 ? 'contract' : 'contracts';
    const scol = rs.state !== 'armed' ? C.down : rs.checklistScore < 3 ? C.amber : C.gold;
    text(ctx, sizeLabel, a.x + a.w, y + 34, { size: 38, weight: 600, color: scol, align: 'right' });
    text(ctx, sizeSub, a.x + a.w, y + 60, { size: 19, weight: 500, color: C.faint, align: 'right' });
    y += 76;
    const items = ['Trend with EMA cloud', 'At a GEX level', 'Volume confirms', 'Calm, not revenge'];
    items.forEach((label, i) => {
      const cx = a.x + (i % 2) * (half + 14), cy = y + Math.floor(i / 2) * 60;
      const on = day.checklist[i];
      this.button('chk' + i, cx, cy, half, 50, (on ? '✓ ' : '') + label, { size: 21, active: on, color: C.up, onClick: () => app.toggleCheck(i) });
    });
  }
}
function fmtMMSS(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ---------------------------------------------------------------- INDAI (side panel)
export class IndaiPanel extends Panel {
  constructor(app) { super({ id: 'indai', title: 'INDAI', w: 0.70, h: 0.80 }); this.app = app; }
  drawBody(ctx, a) {
    const ind = this.app.indai, vs = ind.voice.state;
    const [st, col] = vs.listening ? ['Listening…', C.amber] : vs.transcribing ? ['Understanding…', C.violet] : ind.thinking ? [ind.thinking, C.violet] : vs.speaking ? ['Speaking', C.up] : ['Ready', C.dim];
    pill(ctx, this.W - 30, 14, st, col, { size: 20, align: 'right' });
    this.button('selftest', 150, 12, 150, 38, ind._testing ? 'Testing…' : 'Self-test', { size: 18, color: C.line, disabled: !!ind._testing, onClick: () => ind.selfTest() });
    this.button('gestures', 310, 12, 150, 38, 'Gestures', { size: 18, color: C.violet, active: !!this.app.tutorial, onClick: () => this.app.tutorial ? this.app.endTutorial(false) : this.app.startTutorial() });
    let y = a.y;
    if ((vs.listening || vs.transcribing) && vs.heard) {      // what she has heard so far, while you are still talking
      rrect(ctx, a.x, y, a.w, 44, 12); ctx.fillStyle = 'rgba(251,191,36,0.10)'; ctx.fill();
      text(ctx, '“' + vs.heard + '…', a.x + 14, y + 30, { size: 21, weight: 500, color: C.amber, max: a.w - 28 });
      y += 54;
    }
    const loads = [];
    if (vs.ttsLoad != null) loads.push(`voice ${vs.ttsLoad}%`);
    if (vs.sttLoad != null) loads.push(`listening model ${vs.sttLoad}%`);
    if (loads.length) { text(ctx, `Downloading ${loads.join(' · ')} (first time only)`, a.x, y + 20, { size: 19, weight: 500, color: C.amber, max: a.w }); y += 34; }
    const an = this.app.analysis, sig = this.app.signals?.[0];
    const showSig = sig && Date.now() - sig.at < 20 * 60e3 && (!an || sig.at > an.at);
    if (showSig) {
      const sc = sig.dir > 0 ? C.up : C.down;
      rrect(ctx, a.x, y, a.w, 214, 22); ctx.fillStyle = hexA(sc, 0.10); ctx.fill(); ctx.strokeStyle = hexA(sc, 0.5); ctx.lineWidth = 2; ctx.stroke();
      pill(ctx, a.x + 18, y + 16, `${sig.practice ? 'Practice · ' : ''}${sig.type === 'C' ? 'CALL' : 'PUT'} setup · ${sig.score}`, sc, { size: 22 });
      text(ctx, new Date(sig.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }), a.x + a.w - 18, y + 42, { size: 19, weight: 500, color: C.dim, align: 'right' });
      text(ctx, `${sig.sym} · ${sig.title}`, a.x + 18, y + 92, { size: 24, weight: 600, color: C.white, max: a.w - 36 });
      const k = sig.contract;
      text(ctx, k ? `${k.strike}${sig.type} ${k.expiry.slice(5)} ≈ $${k.premium.toFixed(2)} × ${k.qty} · stop ${sig.stop} · target ${sig.target}` : `stop ${sig.stop} · target ${sig.target}`, a.x + 18, y + 128, { size: 20, weight: 500, fam: F.mono, color: C.text, max: a.w - 36 });
      this.button('sig-an', a.x + 18, y + 158, 170, 44, 'Analyze', { size: 20, primary: true, onClick: () => this.app.indai.analyzeSignal(sig) });
      this.button('sig-skip', a.x + 198, y + 158, 130, 44, 'Skip', { size: 20, color: C.dim, onClick: () => { sig.at = 0; this.dirty = true; } });
      y += 232;
    } else if (an) {
      const rag = an.final?.rag || an.score.rag, rc = RAGC[rag] || C.dim;
      rrect(ctx, a.x, y, a.w, 214, 22); ctx.fillStyle = hexA(rc, 0.10); ctx.fill(); ctx.strokeStyle = hexA(rc, 0.5); ctx.lineWidth = 2; ctx.stroke();
      pill(ctx, a.x + 18, y + 16, rag, rc, { size: 26 });
      text(ctx, `${an.score.score}/100${an.final ? ' · with research' : an.pendingAI ? ' · researching…' : ''}`, a.x + a.w - 18, y + 46, { size: 20, weight: 500, color: C.dim, align: 'right' });
      text(ctx, ideaLabel(an.idea), a.x + 18, y + 98, { size: 25, weight: 600, color: C.white, max: a.w - 36 });
      const line = an.final?.headline || (an.score.gate ?? (an.score.cons[0] ? `Watch out: ${an.score.cons[0].name.toLowerCase()}` : an.score.pros[0] ? `Supporting: ${an.score.pros[0].name.toLowerCase()}` : ''));
      para(ctx, line, a.x + 18, y + 134, a.w - 36, { size: 21, color: C.text, maxLines: 1 });
      this.button('details', a.x + 18, y + 158, 170, 44, 'Details', { size: 20, color: rc, onClick: () => this.app.openFocus('analysis') });
      this.button('calc', a.x + 198, y + 158, 190, 44, 'Calculator', { size: 20, onClick: () => this.app.openFocus('calc') });
      y += 232;
    }
    const maxY = a.y + a.h - 40;
    const msgs = ind.log.slice(-14);
    const blocks = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const lines = wrap(ctx, m.text, a.w - 30, 22, F.hud, m.kind === 'you' ? 500 : 400).slice(0, 4);
      blocks.unshift({ m, lines });
      if (blocks.reduce((s, b) => s + b.lines.length * 29 + 18, 0) > maxY - y) { blocks.shift(); break; }
    }
    for (const b of blocks) {
      const you = b.m.kind === 'you';
      const c = b.m.kind === 'alert' ? C.amber : b.m.kind === 'risk' ? C.down : b.m.kind === 'good' ? C.up : you ? C.gold : C.text;
      if (you) { ctx.fillStyle = hexA(C.gold, 0.5); ctx.fillRect(a.x, y + 4, 3, b.lines.length * 29); }
      b.lines.forEach((ln, k) => text(ctx, ln, a.x + 14, y + 24 + k * 29, { size: 22, weight: you ? 500 : 400, color: c }));
      y += b.lines.length * 29 + 18;
    }
    text(ctx, ind.voice.canListen ? 'Hold A or X, tap Talk, or pinch the orb · “Hey INDAI, QQQ calls today, 665 strike”' : 'Voice input is not available here; use the buttons', a.x, a.y + a.h - 6, { size: 18, weight: 500, color: C.faint, max: a.w });
  }
}

// ---------------------------------------------------------------- Analysis (focus)
export class AnalysisPanel extends Panel {
  constructor(app) { super({ id: 'analysis', title: 'INDAI analysis', w: 1.30, h: 0.86 }); this.app = app; }
  prepare() { const an = this.app.analysis; this.title = an ? `INDAI analysis · ${ideaLabel(an.idea)}` : 'INDAI analysis'; }
  drawBody(ctx, a) {
    const app = this.app, an = app.analysis, W = this.W;
    this.button('close', W - 140, 10, 112, 40, 'Close', { size: 20, onClick: () => app.closeFocus() });
    if (!an) { text(ctx, 'Ask INDAI about a trade: “QQQ calls expiring today, 665 strike.”', a.x, a.y + 40, { size: 26, color: C.dim }); return; }
    const rag = an.final?.rag || an.score.rag, rc = RAGC[rag] || C.dim;
    const L = { x: a.x, w: 520 }, R = { x: a.x + 560, w: a.w - 560 };
    let y = a.y;
    rrect(ctx, L.x, y, L.w, 120, 10 * S); ctx.fillStyle = hexA(rc, 0.10); ctx.fill();
    ctx.strokeStyle = hexA(rc, 0.5); ctx.lineWidth = 2; ctx.stroke();
    text(ctx, rag, L.x + 30, y + 78, { size: 58, weight: 700, color: rc });
    text(ctx, `${an.score.score}/100`, L.x + L.w - 26, y + 54, { size: 30, weight: 600, fam: F.mono, color: C.white, align: 'right' });
    text(ctx, an.final ? `research ${an.final.confidence ?? '—'}% confident` : an.pendingAI ? 'researching news…' : 'quant read', L.x + L.w - 26, y + 90, { size: 19, weight: 500, color: C.dim, align: 'right' });
    y += 140;
    if (an.score.gate) { y += para(ctx, an.score.gate, L.x, y + 22, L.w, { size: 22, color: C.down, weight: 600 }) + 6; }
    const k = an.contract, qd = an.quant;
    const rowsL = [
      ['Underlying', `${fmtPrice(an.spot)}${an.delayed ? ' (delayed)' : ''}`],
      ['Option bid / ask', k ? `${k.bid.toFixed(2)} / ${k.ask.toFixed(2)}  (mid ${k.mid.toFixed(2)})` : `model ${qd.entry.toFixed(2)}`],
      ['IV · volume · OI', `${(qd.iv * 100).toFixed(1)}% · ${k ? fmtVol(k.vol) : '—'} · ${k ? fmtVol(k.oi) : '—'}`],
      ['Breakeven at expiry', `${fmtPrice(qd.breakeven)} (${qd.moveNeededSigma.toFixed(2)}σ away)`],
      ['Expected move', `±${qd.expectedMove.toFixed(2)} by expiry`],
      ['Chance of profit (expiry)', pct0(qd.popExpiry)],
      ['Chance finishes in the money', pct0(qd.probITM)],
      ['Chance price touches strike', pct0(qd.probTouch)],
      ['Hits +50% / +100% (Monte Carlo)', qd.mc ? `${pct0(qd.mc.probTouch50)} / ${pct0(qd.mc.probTouch100)}` : '—'],
      ['Δ · Γ · Θ per hour · ν', `${qd.delta.toFixed(2)} · ${qd.gamma.toFixed(3)} · −${(qd.thetaPctPerHour ?? 0).toFixed(1)}% · ${qd.vega.toFixed(2)}`],
      ['Time left', `${qd.hoursLeft.toFixed(1)} trading hours`],
    ];
    for (const [l, v] of rowsL) {
      if (y > a.y + a.h - 100) break;
      text(ctx, l, L.x, y + 26, { size: 20, weight: 500, color: C.dim, max: 270 });
      text(ctx, v, L.x + L.w, y + 26, { size: 21, weight: 500, fam: F.mono, color: C.white, align: 'right', max: 250 });
      y += 37;
    }
    this.button('tocalc', L.x, a.y + a.h - 50, 240, 48, 'Open calculator', { size: 21, color: C.line, onClick: () => app.openFocus('calc') });
    this.button('again', L.x + 256, a.y + a.h - 50, 200, 48, 'Say it again', { size: 21, onClick: () => app.indai.repeat() });
    y = a.y;
    if (an.final) {
      text(ctx, an.final.headline || '', R.x, y + 30, { size: 26, weight: 600, color: C.white, max: R.w });
      y += 46;
      for (const b of (an.final.summary || []).slice(0, 6)) { if (y > a.y + a.h - 160) break; ctx.fillStyle = rc; ctx.beginPath(); ctx.arc(R.x + 6, y + 15, 4, 0, 7); ctx.fill(); y += para(ctx, b, R.x + 20, y + 22, R.w - 20, { size: 21, maxLines: 2 }) + 6; }
      y += 6;
    }
    text(ctx, 'What drives the score', R.x, y + 26, { size: 21, weight: 600, color: C.dim }); y += 40;
    const factors = [...an.score.factors].sort((p, q) => Math.abs(q.weight * q.s) - Math.abs(p.weight * p.s));
    for (const f of factors) {
      if (y > a.y + a.h - (an.news?.length ? 130 : 30)) break;
      const fc = f.s > 0.15 ? C.up : f.s < -0.15 ? C.down : C.dim;
      text(ctx, f.name, R.x, y + 22, { size: 20, weight: 600, color: C.text, max: 300 });
      const bx = R.x + 310, bw = 150;
      rrect(ctx, bx, y + 8, bw, 14, 7); ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
      const mid = bx + bw / 2, len = (bw / 2) * Math.abs(f.s);
      ctx.fillStyle = fc; ctx.fillRect(f.s >= 0 ? mid : mid - len, y + 8, len, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(mid - 1, y + 4, 2, 22);
      y += para(ctx, f.note, R.x + 476, y + 22, R.w - 476, { size: 18, color: C.dim, maxLines: 2 }) + 8;
    }
    const news = an.final?.news?.length ? an.final.news : an.news || [];
    if (news.length && y < a.y + a.h - 70) {
      text(ctx, an.final?.news?.length ? 'News & sentiment (web research)' : 'Recent headlines', R.x, y + 24, { size: 20, weight: 600, color: C.dim }); y += 34;
      for (const n of news.slice(0, 3)) {
        if (y > a.y + a.h - 24) break;
        const nc = n.sentiment === 'positive' ? C.up : n.sentiment === 'negative' ? C.down : C.faint;
        dot(ctx, R.x + 6, y + 13, 5, nc, false);
        y += para(ctx, n.title + (n.source ? ` — ${n.source}` : ''), R.x + 20, y + 20, R.w - 20, { size: 18, color: C.text, maxLines: 1 }) + 4;
      }
    }
  }
}

// ---------------------------------------------------------------- Options calculator (focus)
export class CalcPanel extends Panel {
  constructor(app) { super({ id: 'calc', title: 'Options profit calculator', w: 1.30, h: 0.86 }); this.app = app; }
  prepare() { const c = this.app.calc; this.title = c && c.legs.length ? `Options calculator · ${c.sym} ${c.legs.map(l => `${l.side < 0 ? '−' : ''}${l.strike}${l.type}`).join(' / ')}` : 'Options calculator'; }
  drawBody(ctx, a) {
    const app = this.app, c = app.calc, W = this.W;
    this.button('close', W - 140, 10, 112, 40, 'Close', { size: 20, onClick: () => app.closeFocus() });
    if (!c || !c.legs.length) { text(ctx, 'Ask INDAI about a trade, or open the calculator from the dock.', a.x, a.y + 40, { size: 26, color: C.dim }); return; }
    const leg = c.legs[0], r = app.settings.rate ?? 0.04;
    const spot = app.feed.quote(c.sym)?.last ?? c.spot;
    const L = { x: a.x, w: 360 };
    let y = a.y;
    const ctl = (label, value, onMinus, onPlus, id) => {
      text(ctx, label, L.x, y + 22, { size: 19, weight: 500, color: C.dim });
      this.button(id + '-', L.x, y + 32, 56, 48, '−', { size: 28, onClick: onMinus });
      rrect(ctx, L.x + 64, y + 32, L.w - 128, 48, 14); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
      text(ctx, value, L.x + L.w / 2, y + 57, { size: 24, weight: 500, fam: F.mono, color: C.white, align: 'center', base: 'middle', max: L.w - 140 });
      this.button(id + '+', L.x + L.w - 56, y + 32, 56, 48, '+', { size: 28, onClick: onPlus });
      y += 92;
    };
    const half = (L.w - 10) / 2;
    this.button('tC', L.x, y, half, 44, 'Call', { size: 21, active: leg.type === 'C', color: C.up, onClick: () => app.calcSet({ type: 'C' }) });
    this.button('tP', L.x + half + 10, y, half, 44, 'Put', { size: 21, active: leg.type === 'P', color: C.down, onClick: () => app.calcSet({ type: 'P' }) });
    y += 52;
    this.button('sB', L.x, y, half, 44, 'Buy', { size: 21, active: leg.side > 0, color: C.line, onClick: () => app.calcSet({ side: 1 }) });
    this.button('sS', L.x + half + 10, y, half, 44, 'Sell', { size: 21, active: leg.side < 0, color: C.amber, onClick: () => app.calcSet({ side: -1 }) });
    y += 56;
    ctl('Strike', fmtPrice(leg.strike), () => app.calcStep('strike', -1), () => app.calcStep('strike', 1), 'k');
    ctl('Expiry', expLabel(leg.expiry), () => app.calcStep('expiry', -1), () => app.calcStep('expiry', 1), 'e');
    ctl('Entry price (per share)', '$' + leg.entry.toFixed(2), () => app.calcStep('entry', -1), () => app.calcStep('entry', 1), 'p');
    ctl('Implied volatility', (leg.iv * 100).toFixed(1) + '%', () => app.calcStep('iv', -1), () => app.calcStep('iv', 1), 'v');
    ctl('Contracts', String(leg.qty), () => app.calcStep('qty', -1), () => app.calcStep('qty', 1), 'q');
    this.button('mid', L.x, y, L.w, 44, c.loading ? 'Loading chain…' : 'Use live mid & IV', { size: 20, color: C.line, onClick: () => app.calcFromChain() });
    const G = { x: a.x + 400, y: a.y, w: a.w - 400, h: a.h - 150 };
    const grid = pnlGrid(c.legs, spot, r, { rows: 13 });
    const sum = positionSummary(c.legs, spot, r);
    if (!grid) return;
    const colW = (G.w - 120) / grid.cols.length, rowH = (G.h - 40) / grid.prices.length;
    const maxAbs = Math.max(1, ...grid.grid.flat().map(Math.abs));
    grid.cols.forEach((col, j) => text(ctx, col.label, G.x + 120 + colW * j + colW / 2, G.y + 26, { size: 19, weight: 600, color: C.dim, align: 'center', max: colW - 6 }));
    grid.prices.forEach((p, i) => {
      const yy = G.y + 40 + i * rowH;
      const isSpot = Math.abs(p - spot) <= grid.step / 2;
      text(ctx, fmtPrice(p), G.x + 104, yy + rowH / 2 + 7, { size: 19, weight: isSpot ? 700 : 500, fam: F.mono, color: isSpot ? C.line : C.dim, align: 'right' });
      grid.grid[i].forEach((v, j) => {
        const x = G.x + 120 + colW * j;
        const t = Math.min(1, Math.abs(v) / maxAbs);
        ctx.fillStyle = v >= 0 ? `rgba(52,211,153,${0.10 + 0.55 * t})` : `rgba(248,113,113,${0.10 + 0.55 * t})`;
        ctx.fillRect(x + 2, yy + 2, colW - 4, rowH - 4);
        text(ctx, fmtCell(v), x + colW / 2, yy + rowH / 2 + 7, { size: Math.min(19, rowH * 0.5), weight: 500, fam: F.mono, color: C.white, align: 'center', max: colW - 8 });
      });
      if (isSpot) { ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.strokeRect(G.x + 116, yy + 1, grid.cols.length * colW + 4, rowH - 2); }
    });
    const sy = a.y + a.h - 100;
    const stats = [
      ['Cost', fmtMoney(Math.abs(sum.netDebit)) + (sum.netDebit < 0 ? ' credit' : '')],
      ['Max profit', sum.unlimitedProfit ? 'Unlimited' : fmtMoney(sum.maxProfit)],
      ['Max loss', sum.unlimitedLoss ? 'Unlimited' : fmtMoney(sum.maxLoss)],
      ['Breakeven', sum.breakevens.map(b => fmtPrice(b)).join(' / ') || '—'],
      ['Chance of profit', pct0(sum.pop)],
      ['Δ / Θ per day', `${sum.greeks.delta.toFixed(0)} / ${fmtMoney(sum.greeks.theta)}`],
    ];
    const sw = G.w / 3;
    stats.forEach(([l, v], i) => {
      const x = G.x + (i % 3) * sw, yy = sy + Math.floor(i / 3) * 52;
      text(ctx, l, x, yy + 20, { size: 18, weight: 500, color: C.dim });
      text(ctx, v, x, yy + 46, { size: 23, weight: 600, fam: F.mono, color: C.white, max: sw - 10 });
    });
    text(ctx, `${c.sym} ${fmtPrice(spot)} · P&L in $ · Black-Scholes, r=${(r * 100).toFixed(1)}%`, a.x, a.y + a.h - 4, { size: 17, weight: 500, color: C.faint, max: 380 });
  }
}
function fmtCell(v) { const a = Math.abs(v); const s = a >= 10000 ? (a / 1000).toFixed(0) + 'K' : a >= 1000 ? (a / 1000).toFixed(1) + 'K' : a.toFixed(0); return (v < 0 ? '−' : '+') + s; }

// ---------------------------------------------------------------- Deep dive (focus, "explode")
export class DeepDivePanel extends Panel {
  constructor(app) { super({ id: 'deep', title: 'Deep dive', w: 1.20, h: 0.82 }); this.app = app; }
  prepare() { const d = this.app.deep; this.title = d ? `Deep dive · ${d.sym}` : 'Deep dive'; }
  drawBody(ctx, a) {
    const app = this.app, d = app.deep, W = this.W;
    this.button('close', W - 140, 10, 112, 40, 'Close', { size: 20, onClick: () => app.closeFocus() });
    if (!d) return;
    const q = app.feed.quote(d.sym) || d.quote;
    const half = a.w / 2 - 20;
    let y = a.y;
    text(ctx, q ? fmtPrice(q.last) : '—', a.x, y + 50, { size: 54, weight: 500, fam: F.mono, color: C.white });
    if (q) text(ctx, fmtPct(q.pct), a.x + 250, y + 46, { size: 30, weight: 600, fam: F.mono, color: colorFor(q.chg) });
    sparkline(ctx, d.bars, a.x + half + 40, y, half, 80, q?.base);
    y += 100;
    const t = d.tech, ch = d.chain, lv = app.levelsFor(d.sym);
    const rows = [];
    if (t) rows.push(['Trend', `${t.trend}, fast cloud ${t.emaFast}, slow ${t.emaSlow ?? '—'}`], ['VWAP', `${fmtPrice(t.vwap)} (${t.aboveVwap ? 'above' : 'below'}, ${t.vwapDistPct >= 0 ? '+' : ''}${t.vwapDistPct.toFixed(2)}%)`], ['MACD / RSI', `${t.macdHist > 0 ? 'positive' : 'negative'}, ${t.macdRising ? 'rising' : 'falling'} / RSI ${t.rsi?.toFixed(0)}`], ['Divergence', t.divergence ? `${t.divergence.type}: ${t.divergence.note}` : 'none'], ['Day range', `${fmtPrice(t.dayLow)} – ${fmtPrice(t.dayHigh)}`]);
    if (lv) rows.push(['GEX walls', `call ${lv.cw ?? '—'} · put ${lv.pw ?? '—'} · flip ${lv.zg ?? '—'}`]);
    if (ch) {
      rows.push(['Put/call (volume · OI)', `${ch.all?.pcVolume ?? '—'} · ${ch.all?.pcOI ?? '—'}`]);
      rows.push(['Premium today', `calls ${fmtBig(ch.all?.callPremium)} · puts ${fmtBig(ch.all?.putPremium)}`]);
      rows.push(['IV30', ch.meta?.iv30 ? `${ch.meta.iv30.toFixed(1)}%` : '—']);
    }
    for (const [l, v] of rows) { text(ctx, l, a.x, y + 24, { size: 20, weight: 500, color: C.dim }); text(ctx, v, a.x + 250, y + 24, { size: 20, weight: 500, color: C.white, max: half - 220 }); y += 38; }
    if (d.loading) text(ctx, 'Loading options and news…', a.x, y + 30, { size: 21, color: C.amber });
    let ry = a.y + 110; const rx = a.x + half + 40;
    if (ch?.unusual?.length) {
      text(ctx, 'Unusual options activity', rx, ry + 24, { size: 21, weight: 600, color: C.dim }); ry += 36;
      for (const u of ch.unusual.slice(0, 4)) { text(ctx, `${u.exp.slice(5)} ${u.strike}${u.type}  vol ${fmtVol(u.vol)} vs OI ${fmtVol(u.oi)}  ${fmtBig(u.premium)}`, rx, ry + 22, { size: 19, weight: 500, fam: F.mono, color: u.type === 'C' ? C.up : C.down, max: half }); ry += 32; }
      ry += 12;
    }
    if (d.news?.length) {
      text(ctx, 'Headlines', rx, ry + 24, { size: 21, weight: 600, color: C.dim }); ry += 34;
      for (const n of d.news.slice(0, 5)) { if (ry > a.y + a.h - 90) break; const nc = n.sentiment === 'positive' ? C.up : n.sentiment === 'negative' ? C.down : C.faint; dot(ctx, rx + 6, ry + 14, 5, nc, false); ry += para(ctx, n.title, rx + 20, ry + 20, half - 20, { size: 19, maxLines: 2 }) + 6; }
    }
    this.button('ac', a.x, a.y + a.h - 50, 220, 48, `Analyze ${d.sym} calls`, { size: 20, color: C.up, tone: true, onClick: () => app.indai.quickIdea(d.sym, 'C') });
    this.button('ap', a.x + 236, a.y + a.h - 50, 220, 48, `Analyze ${d.sym} puts`, { size: 20, color: C.down, tone: true, onClick: () => app.indai.quickIdea(d.sym, 'P') });
    this.button('main', a.x + 472, a.y + a.h - 50, 220, 48, 'Put on main chart', { size: 20, onClick: () => { app.selectSymbol(d.sym); app.closeFocus(); } });
  }
}

// ---------------------------------------------------------------- Summary (focus, "consolidate")
export class SummaryPanel extends Panel {
  constructor(app) { super({ id: 'summary', title: 'Everything at a glance', w: 1.20, h: 0.82 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app, W = this.W;
    this.button('close', W - 220, 10, 192, 40, 'Restore screens', { size: 20, onClick: () => app.restoreAll() });
    const ms = marketStatus();
    let y = a.y;
    text(ctx, `${fmtClock()} ET · ${ms.label.charAt(0) + ms.label.slice(1).toLowerCase()} · ${ms.nextEvent} in ${fmtDuration(ms.msToNext)}`, a.x, y + 28, { size: 24, weight: 500, color: C.dim });
    y += 50;
    const half = a.w / 2 - 20;
    for (const sym of app.settings.symbols) {
      const q = app.feed.quote(sym);
      text(ctx, sym, a.x, y + 28, { size: 28, weight: 600, color: sym === app.settings.main ? C.gold : C.white });
      text(ctx, q ? fmtPrice(q.last) : '—', a.x + 260, y + 28, { size: 26, weight: 500, fam: F.mono, color: C.white, align: 'right' });
      text(ctx, q ? fmtPct(q.pct) : '', a.x + 400, y + 28, { size: 24, weight: 600, fam: F.mono, color: q ? colorFor(q.chg) : C.faint, align: 'right' });
      const lv = app.levelsFor(sym); const n = q && lv ? nearestLevel(q.last, lv) : null;
      if (n) text(ctx, `${n.short} ${n.level}`, a.x + 420, y + 28, { size: 20, weight: 500, color: C.faint });
      y += 44;
    }
    let ry = a.y + 50; const rx = a.x + half + 40;
    const rs = app.riskState();
    const bcol = rs.state === 'tripped' ? C.down : rs.state === 'cooldown' ? C.amber : C.up;
    pill(ctx, rx, ry, rs.state === 'tripped' ? 'Breaker tripped' : rs.state === 'cooldown' ? 'Cooldown' : 'Breaker armed', bcol, { size: 22 });
    text(ctx, `Day P&L ${fmtMoney(app.day.pnl, true)} · ${fmtMoney(rs.room)} room`, rx, ry + 76, { size: 24, weight: 500, color: C.white });
    ry += 110;
    const an = app.analysis;
    if (an) {
      const rag = an.final?.rag || an.score.rag;
      pill(ctx, rx, ry, rag, RAGC[rag], { size: 22 });
      text(ctx, ideaLabel(an.idea), rx + 140, ry + 26, { size: 22, weight: 600, color: C.white, max: half - 140 });
      ry += 56;
      para(ctx, an.final?.headline || (an.score.cons[0]?.note ?? an.score.pros[0]?.note ?? ''), rx, ry + 20, half, { size: 20, color: C.dim, maxLines: 3 });
      ry += 90;
    }
    const lv = app.levelsFor(app.settings.main);
    if (lv) text(ctx, `${app.settings.main} walls: call ${lv.cw ?? '—'} · put ${lv.pw ?? '—'} · flip ${lv.zg ?? '—'}`, rx, ry + 24, { size: 21, weight: 500, color: C.dim, max: half });
    text(ctx, 'Pull your hands apart, or tap Restore, to bring the screens back.', a.x, a.y + a.h - 6, { size: 19, weight: 500, color: C.faint });
  }
}


// ---------------------------------------------------------------- Game plan (focus)
export class PlanPanel extends Panel {
  constructor(app) { super({ id: 'plan', title: "Today's game plan", w: 1.30, h: 0.86 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app, W = this.W, d = app.planDraft, tmp = app.temp;
    this.button('close', W - 140, 10, 112, 40, 'Close', { size: 20, onClick: () => app.closeFocus() });
    const L = { x: a.x, w: 500 }, R = { x: a.x + 540, w: a.w - 540 };
    // temperature
    let y = a.y;
    const tc = !tmp ? C.dim : tmp.label === 'Hot' ? C.down : tmp.label === 'Warm' ? C.amber : tmp.label === 'Calm' ? C.sky : C.up;
    rrect(ctx, L.x, y, L.w, a.h - 4, 24); ctx.fillStyle = hexA(tc, 0.07); ctx.fill(); ctx.strokeStyle = hexA(tc, 0.35); ctx.lineWidth = 2; ctx.stroke();
    text(ctx, 'Market temperature', L.x + 22, y + 40, { size: 22, weight: 600, color: C.dim });
    if (!tmp) { text(ctx, app.tempLoading ? 'Reading the market…' : 'Not checked yet', L.x + 22, y + 100, { size: 30, weight: 600, color: C.dim }); }
    else {
      text(ctx, tmp.label, L.x + 22, y + 108, { size: 60, weight: 700, color: tc });
      text(ctx, `bias ${tmp.bias}`, L.x + L.w - 22, y + 100, { size: 24, weight: 600, color: tmp.bias === 'bullish' ? C.up : tmp.bias === 'bearish' ? C.down : C.dim, align: 'right' });
      let ty = y + 150;
      for (const n of tmp.notes.slice(0, 6)) { dot(ctx, L.x + 30, ty + 8, 4, tc, false); ty += para(ctx, n, L.x + 46, ty + 14, L.w - 70, { size: 20, color: C.text, maxLines: 2 }) + 8; }
      ty += 8;
      para(ctx, tmp.advice, L.x + 22, ty + 20, L.w - 44, { size: 21, weight: 600, color: C.white, maxLines: 3 });
    }
    this.button('retemp', L.x + 22, a.y + a.h - 64, 200, 44, 'Re-check', { size: 20, onClick: () => app.checkTemperature(true) });
    // plan controls
    y = a.y;
    const ctl = (label, value, id, onMinus, onPlus) => {
      text(ctx, label, R.x, y + 24, { size: 20, weight: 500, color: C.dim });
      this.button(id + '-', R.x, y + 34, 60, 52, '−', { size: 30, onClick: onMinus });
      rrect(ctx, R.x + 70, y + 34, 220, 52, 16); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
      text(ctx, value, R.x + 180, y + 61, { size: 28, weight: 500, fam: F.mono, color: C.white, align: 'center', base: 'middle' });
      this.button(id + '+', R.x + 300, y + 34, 60, 52, '+', { size: 30, onClick: onPlus });
    };
    ctl('Starting with', fmtMoney(d.capital), 'cap', () => app.planStep('capital', -1), () => app.planStep('capital', 1));
    const gx = R.x + 400;
    text(ctx, 'Minimum goal', gx, y + 24, { size: 20, weight: 500, color: C.dim });
    this.button('goal-', gx, y + 34, 60, 52, '−', { size: 30, onClick: () => app.planStep('goal', -1) });
    rrect(ctx, gx + 70, y + 34, 200, 52, 16); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    text(ctx, fmtMoney(d.goal), gx + 170, y + 61, { size: 28, weight: 500, fam: F.mono, color: C.white, align: 'center', base: 'middle' });
    this.button('goal+', gx + 280, y + 34, 60, 52, '+', { size: 30, onClick: () => app.planStep('goal', 1) });
    y += 104;
    text(ctx, 'Aggressiveness', R.x, y + 24, { size: 20, weight: 500, color: C.dim });
    const bw = (R.w - 24) / 3;
    ['conservative', 'balanced', 'aggressive'].forEach((k, i) => this.button('ag-' + k, R.x + i * (bw + 12), y + 34, bw, 52, PROFILES[k].label, { size: 23, active: d.aggr === k, color: k === 'aggressive' ? C.down : k === 'balanced' ? C.amber : C.up, onClick: () => app.planSet({ aggr: k }) }));
    y += 100;
    text(ctx, 'Alert me on', R.x, y + 24, { size: 20, weight: 500, color: C.dim });
    const sw = (R.w - 36) / 4;
    Object.entries(STRATEGIES).forEach(([k, st], i) => this.button('st-' + k, R.x + i * (sw + 12), y + 34, sw, 48, st.short, { size: 20, active: d.strategies.includes(k), color: C.line, onClick: () => app.planToggleStrategy(k) }));
    y += 100;
    const p = buildPlan(d);
    rrect(ctx, R.x, y, R.w, 236, 20); ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
    const rows = [
      ['Risk per trade', `${fmtMoney(p.riskPerTrade)} (stop at −${p.stopPct}% of premium)`],
      ['Breaker trips at', `−${fmtMoney(p.maxLoss)} for the day, or ${p.consec} losses in a row`],
      ['To hit the goal', p.winsNeeded ? `about ${p.winsNeeded} winning trade${p.winsNeeded > 1 ? 's' : ''} at ${p.rr}:1` : '—'],
      ['Alerts', `setups scoring ${p.minScore}+ · up to ${p.perHour} an hour`],
      ['Contracts', p.aggr === 'conservative' ? '≈0.6 delta, next-day expiry' : p.aggr === 'balanced' ? '≈0.5 delta, 0DTE (1DTE after 1:30pm)' : '≈0.4 delta, 0DTE'],
    ];
    rows.forEach(([l, v], i) => { text(ctx, l, R.x + 20, y + 40 + i * 42, { size: 20, weight: 500, color: C.dim }); text(ctx, v, R.x + 240, y + 40 + i * 42, { size: 21, weight: 500, color: C.white, max: R.w - 260 }); });
    y += 252;
    const warn = p.warnings[0] || PROFILES[d.aggr].note;
    para(ctx, warn, R.x, y + 20, R.w, { size: 20, color: p.warnings[0] ? C.amber : C.dim, maxLines: 2 });
    const locked = app.day.plan && app.day.plan.capital === d.capital && app.day.plan.goal === d.goal && app.day.plan.aggr === d.aggr && app.day.plan.strategies.join() === d.strategies.join();
    this.button('lock', R.x, a.y + a.h - 64, 300, 56, locked ? '✓ Plan locked in' : 'Lock in plan', { size: 24, active: locked, primary: !locked, color: C.up, onClick: () => app.lockPlan() });
    this.button('voice', R.x + 316, a.y + a.h - 64, 300, 56, 'Set it by voice', { size: 22, color: C.line, onClick: () => app.indai.startDay({ voice: true, skipTemp: !!app.temp }) });
  }
}


// ---------------------------------------------------------------- Scenes (focus): passthrough or a virtual space
function drawSceneArt(ctx, id, x, y, w, h, sky) {
  ctx.save(); rrect(ctx, x, y, w, h, 18); ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  const r = (a) => (Math.sin(a * 12.9898) * 43758.5453) % 1;
  const skyline = (base, col, lit) => {
    ctx.fillStyle = col; let bx = x;
    for (let i = 0; bx < x + w; i++) { const bw = 18 + Math.abs(r(i + 1)) * 26, bh = h * (0.18 + Math.abs(r(i + 7)) * 0.32); ctx.fillRect(bx, y + h * base - bh, bw, bh + h); if (lit) { ctx.fillStyle = '#ffd77a'; for (let k = 0; k < 6; k++) ctx.fillRect(bx + 3 + (k % 2) * 8, y + h * base - bh + 6 + Math.floor(k / 2) * 9, 3, 3); ctx.fillStyle = col; } bx += bw + 2; }
  };
  if (id === 'passthrough') {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + h * 0.25); ctx.lineTo(x + w * 0.8, y + h * 0.25); ctx.lineTo(x + w * 0.8, y + h * 0.75); ctx.lineTo(x + w * 0.2, y + h * 0.75); ctx.closePath(); ctx.stroke();
    for (const [a, b] of [[[0, 0], [0.2, 0.25]], [[1, 0], [0.8, 0.25]], [[0, 1], [0.2, 0.75]], [[1, 1], [0.8, 0.75]]]) { ctx.beginPath(); ctx.moveTo(x + w * a[0], y + h * a[1]); ctx.lineTo(x + w * b[0], y + h * b[1]); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(x + w * 0.36, y + h * 0.58, w * 0.28, h * 0.1);
  } else if (id === 'loft') {
    skyline(0.82, 'rgba(150,170,195,0.9)', false);
    ctx.fillStyle = '#1d1f22'; for (let i = 0; i <= 6; i++) ctx.fillRect(x + i * w / 6 - 3, y, 6, h);
    ctx.fillRect(x, y + h * 0.45, w, 5); ctx.fillStyle = '#8a5a3a'; ctx.fillRect(x, y + h * 0.84, w, h * 0.16);
  } else if (id === 'midnight') {
    ctx.fillStyle = '#f2f0ff'; ctx.beginPath(); ctx.arc(x + w * 0.75, y + h * 0.22, 10, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; for (let i = 0; i < 25; i++) ctx.fillRect(x + Math.abs(r(i + 3)) * w, y + Math.abs(r(i + 9)) * h * 0.45, 2, 2);
    skyline(0.86, '#121320', true);
  } else if (id === 'ocean') {
    ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.arc(x + w * 0.5, y + h * 0.62, 22, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#1a2440'; ctx.fillRect(x, y + h * 0.62, w, h * 0.38);
    ctx.fillStyle = 'rgba(255,190,120,0.75)'; for (let i = 0; i < 6; i++) ctx.fillRect(x + w * 0.5 - 30 + i * 4, y + h * (0.66 + i * 0.05), 60 - i * 8, 3);
  } else if (id === 'orbit') {
    ctx.fillStyle = '#fff'; for (let i = 0; i < 40; i++) ctx.fillRect(x + Math.abs(r(i + 5)) * w, y + Math.abs(r(i + 2)) * h, 2, 2);
    const eg = ctx.createRadialGradient(x + w * 0.6, y + h * 1.6, h * 0.3, x + w * 0.6, y + h * 1.6, h * 1.05);
    eg.addColorStop(0, '#2d6fb0'); eg.addColorStop(0.92, '#1b4c86'); eg.addColorStop(1, 'rgba(120,180,255,0.9)');
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(x + w * 0.6, y + h * 1.6, h * 1.05, 0, 7); ctx.fill();
  } else if (id === 'deck') {
    ctx.strokeStyle = 'rgba(90,209,255,0.45)'; ctx.lineWidth = 2;
    for (let i = -6; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(x + w / 2 + i * 8, y + h * 0.55); ctx.lineTo(x + w / 2 + i * 60, y + h); ctx.stroke(); }
    for (let k = 0; k < 5; k++) { const yy = y + h * (0.58 + k * k * 0.03); ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
  }
  ctx.restore();
}
export class ScenesPanel extends Panel {
  constructor(app) { super({ id: 'scenes', title: 'Scenes', w: 1.12, h: 0.66 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app, W = this.W;
    this.button('close', W - 140, 10, 112, 40, 'Close', { size: 20, onClick: () => app.closeFocus() });
    const pt = app.passthroughAvailable();
    text(ctx, `Showing: ${sceneName(app.sceneShown)}`, W - 170, 40, { size: 20, weight: 500, color: C.dim, align: 'right' });
    const cols = 3, gap = 22, tw = (a.w - gap * (cols - 1)) / cols, th = (a.h - gap - 20) / 2;
    SCENES.forEach((sc, i) => {
      const x = a.x + (i % cols) * (tw + gap), y = a.y + Math.floor(i / cols) * (th + gap);
      const art = th - 74;
      const off = sc.id === 'passthrough' && !pt;
      const on = app.sceneShown === sc.id || (off && app.settings.scene === 'passthrough');
      const hov = this.hoverBtn === 'sc:' + sc.id;
      drawSceneArt(ctx, sc.id, x, y, tw, art, sc.sky);
      if (off) { rrect(ctx, x, y, tw, art, 18); ctx.fillStyle = 'rgba(6,10,18,0.55)'; ctx.fill(); text(ctx, 'Mixed reality only', x + tw / 2, y + art / 2 + 8, { size: 20, weight: 600, color: C.text, align: 'center' }); }
      rrect(ctx, x, y, tw, th, 20); ctx.lineWidth = on ? 4 : hov ? 3 : 1.5; ctx.strokeStyle = on ? C.gold : hov ? C.line : 'rgba(255,255,255,0.12)'; ctx.stroke();
      text(ctx, (on ? '✓ ' : '') + sc.name, x + 16, y + art + 34, { size: 25, weight: 600, color: on ? C.gold : C.white, max: tw - 32 });
      text(ctx, sc.note, x + 16, y + art + 62, { size: 18, weight: 500, color: C.dim, max: tw - 32 });
      this.buttons.push({ id: 'sc:' + sc.id, x, y, w: tw, h: th, onClick: () => app.setScene(sc.id) });
    });
    text(ctx, 'Say “switch to loft”, “passthrough”, or “next scene”', a.x, a.y + a.h + 4, { size: 18, weight: 500, color: C.faint });
  }
}


// ---------------------------------------------------------------- Gesture tutorial coach (floats beside the chart)
function drawHand(ctx, cx, cy, s, mode, flip = 1) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(flip, 1);
  ctx.strokeStyle = C.text; ctx.fillStyle = 'rgba(110,195,242,0.14)'; ctx.lineWidth = s * 0.09; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(0, s * 0.25, s * 0.34, s * 0.32, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const fingers = mode === 'spread' ? [-60, -28, -4, 20, 46] : mode === 'fist' ? null : [-70, -14, -2, 10, 22];
  if (mode === 'point') {
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.arc(-s * 0.06 + k * s * 0.12, -s * 0.04, s * 0.065, Math.PI, 0); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-s * 0.16, 0); ctx.lineTo(-s * 0.16, -s * 0.7); ctx.stroke();                                   // index finger out
    ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.2); ctx.quadraticCurveTo(-s * 0.5, s * 0.02, -s * 0.36, -s * 0.12); ctx.stroke(); // thumb
  } else if (mode === 'fist') { for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(-s * 0.2 + k * s * 0.135, -s * 0.06, s * 0.07, Math.PI, 0); ctx.stroke(); } }
  else if (mode === 'pinch') {
    for (const [a, l] of [[-2, 0.62], [10, 0.58], [22, 0.5]]) { const r = a * Math.PI / 180; ctx.beginPath(); ctx.moveTo(Math.sin(r) * s * 0.25, -Math.cos(r) * s * 0.05); ctx.lineTo(Math.sin(r) * s * l, -Math.cos(r) * s * l); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-s * 0.12, -s * 0.02); ctx.quadraticCurveTo(-s * 0.32, -s * 0.38, -s * 0.18, -s * 0.5); ctx.stroke();      // index curls
    ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.2); ctx.quadraticCurveTo(-s * 0.48, -s * 0.2, -s * 0.2, -s * 0.5); ctx.stroke();     // thumb meets it
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(-s * 0.19, -s * 0.5, s * 0.07, 0, 7); ctx.fill();
  } else {
    fingers.forEach((deg, k) => { const r = deg * Math.PI / 180, len = k === 0 ? 0.5 : k === 4 ? 0.52 : 0.66; const bx = Math.sin(r) * s * 0.24, by = -Math.cos(r) * s * 0.0 + (k === 0 ? s * 0.2 : 0); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.sin(r) * s * len, by - Math.cos(r) * s * len); ctx.stroke(); });
  }
  ctx.restore();
}
function arrow(ctx, x1, y1, x2, y2, col) {
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 18 * Math.cos(a - 0.5), y2 - 18 * Math.sin(a - 0.5)); ctx.lineTo(x2 - 18 * Math.cos(a + 0.5), y2 - 18 * Math.sin(a + 0.5)); ctx.closePath(); ctx.fill();
}
function miniScreen(ctx, x, y, w, h, col = C.dim, dashed = false) {
  rrect(ctx, x, y, w, h, 8); ctx.lineWidth = 3; ctx.strokeStyle = col; if (dashed) ctx.setLineDash([8, 7]); ctx.stroke(); ctx.setLineDash([]);
  if (!dashed) { ctx.fillStyle = C.gold; rrect(ctx, x + w * 0.3, y + 5, w * 0.4, 7, 3.5); ctx.fill(); }
}
// One frame of a gesture: phase 'start' or 'finish'.
function drawGestureFrame(ctx, icon, phase, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2 + 8, s = Math.min(w, h) * 0.5;
  const fin = phase === 'finish';
  if (icon === 'hands') {
    if (!fin) {
      for (const side of [-1, 1]) {   // two Touch controllers: a round face with a thumbstick, a grip below
        const ox = cx + side * s * 0.36, oy = cy - s * 0.12;
        ctx.save(); ctx.translate(ox, oy); ctx.rotate(side * 0.22);
        ctx.lineWidth = 4; ctx.strokeStyle = C.text; ctx.fillStyle = 'rgba(110,195,242,0.10)';
        rrect(ctx, -s * 0.09, s * 0.08, s * 0.18, s * 0.5, s * 0.09); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.24, s * 0.19, 0, 0, 7); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-side * s * 0.08, -s * 0.01, s * 0.075, 0, 7); ctx.stroke();          // thumbstick ring
        ctx.fillStyle = C.text; ctx.beginPath(); ctx.arc(-side * s * 0.08, -s * 0.01, s * 0.025, 0, 7); ctx.fill();
        ctx.fillStyle = C.gold; for (const [bx, by] of [[0.1, 0.06], [0.14, -0.05]]) { ctx.beginPath(); ctx.arc(side * s * bx, s * by, s * 0.03, 0, 7); ctx.fill(); }
        ctx.restore();
      }
      text(ctx, 'controllers in hand', cx, y + h - 10, { size: 18, weight: 500, color: C.dim, align: 'center' });
    }
    else { drawHand(ctx, cx, cy + s * 0.2, s * 0.95, 'open'); ctx.fillStyle = C.line; for (const [dx, dy] of [[-0.47, -0.25], [-0.2, -0.62], [0.02, -0.66], [0.2, -0.6], [0.36, -0.48]]) { ctx.beginPath(); ctx.arc(cx + dx * s * 0.95, cy + s * 0.2 + dy * s * 0.95, 5, 0, 7); ctx.fill(); } }
  } else if (icon === 'pinch') {
    drawHand(ctx, cx, cy + s * 0.25, s * 1.0, fin ? 'pinch' : 'point');
    if (!fin) { ctx.strokeStyle = 'rgba(110,195,242,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(cx - s * 0.16, cy - s * 0.48); ctx.lineTo(cx - s * 0.16, y + 14); ctx.stroke(); ctx.setLineDash([]); }
  } else if (icon === 'drag') {
    if (!fin) { miniScreen(ctx, x + w * 0.12, y + h * 0.16, w * 0.46, h * 0.34); drawHand(ctx, x + w * 0.38, y + h * 0.66, s * 0.62, 'pinch'); }
    else { miniScreen(ctx, x + w * 0.12, y + h * 0.16, w * 0.46, h * 0.34, 'rgba(255,255,255,0.18)', true); miniScreen(ctx, x + w * 0.46, y + h * 0.26, w * 0.46, h * 0.34, C.line); drawHand(ctx, x + w * 0.74, y + h * 0.76, s * 0.62, 'open'); }
  } else if (icon === 'explode') {
    drawHand(ctx, cx, cy + s * 0.2, s * (fin ? 1.0 : 0.9), fin ? 'spread' : 'fist');
    if (fin) { ctx.strokeStyle = C.gold; ctx.lineWidth = 3; for (let k = 0; k < 7; k++) { const a = -Math.PI * 0.9 + k * Math.PI * 0.8 / 6; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * s * 0.85, cy + Math.sin(a) * s * 0.85); ctx.lineTo(cx + Math.cos(a) * s * 1.0, cy + Math.sin(a) * s * 1.0); ctx.stroke(); } }
  } else if (icon === 'together') {
    if (!fin) { drawHand(ctx, x + w * 0.2, cy + 10, s * 0.62, 'open', -1); drawHand(ctx, x + w * 0.8, cy + 10, s * 0.62, 'open'); text(ctx, '40 cm +', cx, y + h - 12, { size: 18, weight: 600, color: C.dim, align: 'center' }); }
    else { drawHand(ctx, cx - s * 0.32, cy + 10, s * 0.62, 'open', -1); drawHand(ctx, cx + s * 0.32, cy + 10, s * 0.62, 'open'); miniScreen(ctx, cx - s * 0.28, y + 10, s * 0.56, s * 0.34, C.gold); text(ctx, 'almost touching', cx, y + h - 12, { size: 18, weight: 600, color: C.dim, align: 'center' }); }
  } else if (icon === 'apart') {
    if (!fin) { drawHand(ctx, cx - s * 0.32, cy + 10, s * 0.62, 'open', -1); drawHand(ctx, cx + s * 0.32, cy + 10, s * 0.62, 'open'); text(ctx, 'hands together', cx, y + h - 12, { size: 18, weight: 600, color: C.dim, align: 'center' }); }
    else { drawHand(ctx, x + w * 0.16, cy + 10, s * 0.62, 'open', -1); drawHand(ctx, x + w * 0.84, cy + 10, s * 0.62, 'open'); for (let k = 0; k < 3; k++) miniScreen(ctx, x + w * (0.3 + k * 0.14), y + 12, w * 0.12, h * 0.16, C.line); text(ctx, 'wider than shoulders', cx, y + h - 12, { size: 18, weight: 600, color: C.dim, align: 'center' }); }
  } else if (icon === 'resize') {
    const k = fin ? 1 : 0.62, sw = w * 0.5 * k, sh = h * 0.42 * k;
    miniScreen(ctx, cx - sw / 2, cy - sh / 2 - 6, sw, sh, fin ? C.gold : C.dim);
    drawHand(ctx, cx - sw / 2 - 6, cy + sh / 2 + 18, s * 0.5, 'pinch', -1); drawHand(ctx, cx + sw / 2 + 6, cy + sh / 2 + 18, s * 0.5, 'pinch');
    if (fin) { arrow(ctx, cx - sw * 0.2, y + 18, cx - sw / 2 + 4, y + 18, C.gold); arrow(ctx, cx + sw * 0.2, y + 18, cx + sw / 2 - 4, y + 18, C.gold); }
  } else if (icon === 'max') {
    if (!fin) { miniScreen(ctx, x + w * 0.1, y + h * 0.18, w * 0.34, h * 0.3); miniScreen(ctx, x + w * 0.56, y + h * 0.18, w * 0.34, h * 0.3, C.line); drawHand(ctx, x + w * 0.73, y + h * 0.72, s * 0.55, 'pinch'); text(ctx, '× 2', x + w * 0.88, y + h * 0.66, { size: 22, weight: 700, color: C.gold, align: 'center' }); }
    else miniScreen(ctx, x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.62, C.gold);
  } else if (icon === 'pan' || icon === 'trend') {
    const bx0 = x + w * 0.1, bw0 = w * 0.8, by0 = y + h * 0.12, bh0 = h * 0.5, sh2 = icon === 'pan' && fin ? -w * 0.16 : 0;
    ctx.save(); ctx.beginPath(); ctx.rect(bx0, by0, bw0, bh0); ctx.clip();
    const ys = [0.6, 0.5, 0.55, 0.4, 0.45, 0.3, 0.35, 0.2, 0.28, 0.15, 0.22, 0.1];
    ys.forEach((v, k) => { const cx2 = bx0 + 14 + k * (bw0 / 9) + sh2, cy2 = by0 + bh0 * v, up = k % 2 === 0; ctx.fillStyle = up ? C.up : C.down; ctx.fillRect(cx2 - 5, cy2, 10, bh0 * 0.16); ctx.fillRect(cx2 - 1, cy2 - 8, 2, bh0 * 0.16 + 16); });
    ctx.restore();
    rrect(ctx, bx0, by0, bw0, bh0, 6); ctx.strokeStyle = C.hair2; ctx.lineWidth = 2; ctx.stroke();
    if (icon === 'trend') {
      const ax = bx0 + 20, ay = by0 + bh0 * 0.75, ex = fin ? bx0 + bw0 - 20 : bx0 + 26, ey = fin ? by0 + bh0 * 0.18 : ay - 4;
      ctx.strokeStyle = C.violet; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = C.violet; ctx.beginPath(); ctx.arc(ax, ay, 7, 0, 7); ctx.fill();
      drawHand(ctx, ex + 10, ey + h * 0.38, s * 0.5, 'pinch');
    } else {
      drawHand(ctx, cx + (fin ? -w * 0.16 : 0), y + h * 0.82, s * 0.5, 'pinch');
      if (fin) arrow(ctx, cx + w * 0.12, y + h * 0.66, cx - w * 0.12, y + h * 0.66, C.gold);
    }
  } else if (icon === 'palm') {
    drawHand(ctx, cx, cy + s * 0.25, s * (fin ? 1.0 : 0.8), 'open');
    if (!fin) { text(ctx, 'palm toward you', cx, y + h - 10, { size: 18, weight: 600, color: C.dim, align: 'center' }); }
    else { ctx.strokeStyle = C.gold; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy + s * 0.5, s * 0.36, 0, 7); ctx.stroke(); pill(ctx, cx, y + 6, 'Listening…', C.amber, { size: 18, align: 'center' }); }
  } else if (icon === 'orb') {
    const ox = cx + s * 0.1, oy = y + h * 0.28;
    ctx.fillStyle = hexA(C.gold, 0.18); ctx.beginPath(); ctx.arc(ox, oy, s * 0.36, 0, 7); ctx.fill(); ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(ox, oy, s * 0.12, 0, 7); ctx.fill();
    drawHand(ctx, cx - s * 0.3, y + h * 0.78, s * 0.6, fin ? 'pinch' : 'point');
    if (!fin) { ctx.strokeStyle = 'rgba(110,195,242,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(cx - s * 0.4, y + h * 0.58); ctx.lineTo(ox - 8, oy + 10); ctx.stroke(); ctx.setLineDash([]); }
    else { rrect(ctx, x + w * 0.52, y + h * 0.58, w * 0.44, 40, 14); ctx.fillStyle = 'rgba(220,191,110,0.12)'; ctx.fill(); text(ctx, '“brief me”', x + w * 0.74, y + h * 0.58 + 27, { size: 19, weight: 600, color: C.gold, align: 'center' }); }
  }
}
// START -> FINISH, with the start lit once INDAI sees you in position and the finish lit when the gesture lands.
function drawGestureArt(ctx, icon, x, y, w, h, { started = false, done = false, guide = false } = {}) {
  const gap = 56, bw = (w - gap) / 2;
  for (const [i, phase] of [[0, 'start'], [1, 'finish']]) {
    const bx = x + i * (bw + gap);
    const lit = phase === 'start' ? started || done : done, col = phase === 'start' ? C.gold : C.up;
    rrect(ctx, bx, y, bw, h, 18); ctx.fillStyle = lit ? hexA(col, 0.12) : guide ? hexA(col, 0.05) : 'rgba(255,255,255,0.035)'; ctx.fill();
    ctx.lineWidth = lit ? 3 : 1.5; ctx.strokeStyle = lit ? hexA(col, 0.85) : guide ? hexA(col, 0.4) : 'rgba(255,255,255,0.14)'; ctx.stroke();
    text(ctx, (lit ? '✓ ' : '') + (phase === 'start' ? 'START' : 'FINISH'), bx + 14, y + 28, { size: 18, weight: 700, color: lit || guide ? col : C.dim, spacing: 3 });
    ctx.save(); rrect(ctx, bx, y, bw, h, 18); ctx.clip();
    drawGestureFrame(ctx, icon, phase, bx, y + 18, bw, h - 18);
    ctx.restore();
  }
  arrow(ctx, x + bw + 12, y + h / 2, x + bw + gap - 12, y + h / 2, done ? C.up : C.gold);
}
export class CoachPanel extends Panel {
  constructor(app) { super({ id: 'coach', title: 'Gesture tutorial', w: 0.68, h: 0.56 }); this.app = app; }
  prepare() { const t = this.app.tutorial; this.title = t ? `Gesture tutorial · ${t.i + 1} of ${this.app.tutorialSteps.length}` : 'Gesture tutorial'; }
  drawBody(ctx, a) {
    const app = this.app, t = app.tutorial, W = this.W;
    this.button('exit', W - 120, 10, 96, 40, 'Exit', { size: 19, color: C.dim, onClick: () => app.endTutorial(false) });
    if (!t) return;
    const st = app.tutorialSteps[t.i];
    const done = !!t.doneAt;
    drawGestureArt(ctx, st.icon, a.x, a.y, a.w, 236, { started: !!t.started, done, guide: !app.inXR });
    let y = a.y + 278;
    if (done) pill(ctx, a.x + a.w, y - 30, '✓ Got it', C.up, { size: 22, align: 'right' });
    else if (t.started) pill(ctx, a.x + a.w, y - 30, 'Now finish it', C.gold, { size: 20, align: 'right' });
    text(ctx, st.title, a.x, y, { size: 32, weight: 600, color: done ? C.up : C.white, max: a.w });
    y += 14;
    for (const ln of st.lines) y += para(ctx, ln, a.x, y + 26, a.w, { size: 22, color: C.text, maxLines: 2 }) + 4;
    // what the headset sees right now
    const hi = app.handInfo || {};
    const fresh = hi.at && performance.now() - hi.at < 600 && (hi.left || hi.right);
    const name = (p) => p ? ({ pinch: 'pinch', fist: 'fist', spread: 'fingers wide', open: 'open', relaxed: 'relaxed' }[p] || p) : 'not seen';
    const line = !app.inXR ? 'Live hand tracking works in the headset.' : fresh ? `Left: ${name(hi.left)} · Right: ${name(hi.right)}${hi.dist != null ? ` · ${Math.round(hi.dist * 100)} cm apart` : ''}` : 'No hands seen yet. Set the controllers down.';
    rrect(ctx, a.x, a.y + a.h - 108, a.w, 46, 14); ctx.fillStyle = 'rgba(110,195,242,0.08)'; ctx.fill();
    text(ctx, line, a.x + 16, a.y + a.h - 77, { size: 20, weight: 500, fam: F.mono, color: fresh ? C.sky : C.dim, max: a.w - 32 });
    const bw = (a.w - 24) / 3, by = a.y + a.h - 50;
    this.button('back', a.x, by, bw, 48, 'Back', { size: 21, disabled: t.i === 0, onClick: () => app.tutorialGo(-1) });
    this.button('again', a.x + bw + 12, by, bw, 48, 'Say it again', { size: 21, onClick: () => app.indai.say(`${st.title}. ${st.lines.join(' ')}`, 'info', { log: false }) });
    this.button('next', a.x + (bw + 12) * 2, by, bw, 48, t.i === app.tutorialSteps.length - 1 ? 'Finish' : app.inXR ? 'Skip' : 'Next', { size: 21, primary: true, onClick: () => app.tutorialGo(1) });
  }
}

// ---------------------------------------------------------------- dock
export class Dock extends Panel {
  constructor(app) { super({ id: 'dock', w: 1.36, h: 0.11, header: false }); this.app = app; }
  drawBody(ctx) {
    const app = this.app, W = this.W, H = this.H, vs = app.indai.voice.state;
    const y = 20, h = H - 40;
    const items = [
      ['talk', vs.listening ? 'Listening… tap to stop' : 'Talk to INDAI', 2.0, { color: C.line, active: vs.listening, primary: !vs.listening, onClick: () => app.talk(), disabled: !app.indai.voice.canListen }],
      ['brief', 'Brief me', 1.05, { color: C.gold, onClick: () => app.brief() }],
      ['plan', app.day.plan ? 'Plan' : 'Start day', 1.0, { color: app.day.plan ? C.text : C.up, active: !app.day.plan, onClick: () => app.openPlan() }],
      ['calc', 'Calculator', 1.15, { onClick: () => app.openCalc() }],
      ['summary', app.consolidated ? 'Restore' : 'Summary', 1.05, { onClick: () => app.consolidated ? app.restoreAll() : app.consolidate() }],
      ['scene', 'Scene', 0.95, { color: C.violet, active: app.focus === 'scenes', onClick: () => app.focus === 'scenes' ? app.closeFocus() : app.openFocus('scenes') }],
      ['recenter', 'Recenter', 1.05, { onClick: () => app.recenter() }],
      ['mute', app.indai.muted ? 'Unmute' : 'Mute', 0.85, { color: C.dim, active: app.indai.muted, onClick: () => app.toggleMute() }],
      app.inXR ? ['exit', 'Exit', 0.75, { color: C.down, onClick: () => app.exitXR() }] : ['settings', 'Settings', 0.95, { color: C.dim, onClick: () => app.openSettings() }],
    ];
    const total = items.reduce((s, it) => s + it[2], 0);
    const gap = 12, avail = W - 40 - gap * (items.length - 1);
    let x = 20;
    for (const [id, label, wt, opts] of items) {
      const w = avail * wt / total;
      this.button(id, x, y, w, h, label, { size: 23, ...opts });
      x += w + gap;
    }
  }
}

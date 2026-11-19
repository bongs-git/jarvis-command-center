// The command-center screens.
import { Panel, C, F, text, rrect, fmtPrice, fmtPct, fmtMoney, colorFor, hexA } from './hud.js';
import { ema, vwap, fmtClock, fmtDuration, fmtHM, marketStatus, chartSession, INTERVAL_LABEL } from './market.js';
import { LEADLAG } from './feeds.js';
import { pnlGrid, positionSummary } from './options.js';
import { STRATEGIES, PROFILES, buildPlan } from './signals.js';

export const RAGC = { GREEN: C.up, AMBER: C.amber, RED: C.down };

function wrap(ctx, str, maxW, size, fam = F.hud, weight = 400) {
  ctx.font = `${weight} ${size}px ${fam}`;
  const words = String(str).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function para(ctx, str, x, y, maxW, { size = 22, lh = 1.35, color = C.text, weight = 400, maxLines = 99 } = {}) {
  const lines = wrap(ctx, str, maxW, size, F.hud, weight).slice(0, maxLines);
  lines.forEach((l, i) => text(ctx, l, x, y + i * size * lh, { size, color, weight }));
  return lines.length * size * lh;
}
function dot(ctx, x, y, r, color, glow = true) {
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}
function pill(ctx, x, y, label, color, { size = 20, align = 'left' } = {}) {
  ctx.font = `600 ${size}px ${F.hud}`;
  const w = ctx.measureText(label).width + size * 1.2, h = size * 1.6;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  rrect(ctx, x0, y, w, h, h / 2); ctx.fillStyle = hexA(color, 0.16); ctx.fill();
  ctx.strokeStyle = hexA(color, 0.55); ctx.lineWidth = 1.5; ctx.stroke();
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
  const grad = ctx.createLinearGradient(0, y, 0, y + h); grad.addColorStop(0, hexA(col, 0.25)); grad.addColorStop(1, hexA(col, 0));
  ctx.beginPath(); bars.forEach((b, k) => { const xx = x + (k / (bars.length - 1)) * w; k ? ctx.lineTo(xx, yv(b.c)) : ctx.moveTo(xx, yv(b.c)); });
  ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath();
  bars.forEach((b, k) => { const xx = x + (k / (bars.length - 1)) * w; k ? ctx.lineTo(xx, yv(b.c)) : ctx.moveTo(xx, yv(b.c)); });
  ctx.stroke();
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

// ---------------------------------------------------------------- top bar
export class TopBar extends Panel {
  constructor(app) { super({ id: 'top', w: 1.30, h: 0.13, header: false }); this.app = app; }
  drawBody(ctx) {
    const { W, app } = this;
    const ms = marketStatus();
    dot(ctx, 44, 62, 11, C.line);
    text(ctx, 'INDAI', 68, 76, { size: 46, weight: 600, color: C.white, spacing: 2 });
    text(ctx, `Command Center · ${app.settings.name || ''}`, 70, 112, { size: 21, weight: 500, color: C.dim, max: 360 });
    text(ctx, fmtClock() + ' ET', W / 2, 66, { size: 44, weight: 500, fam: F.mono, color: C.white, align: 'center' });
    const stColor = ms.state === 'open' ? C.up : ms.state === 'closed' ? C.down : C.amber;
    const label = ms.label.charAt(0) + ms.label.slice(1).toLowerCase();
    const sub = `${label} · ${ms.nextEvent} in ${fmtDuration(ms.msToNext)}`;
    ctx.font = `500 22px ${F.hud}`;
    const sw = Math.min(470, ctx.measureText(sub).width);
    dot(ctx, W / 2 - sw / 2 - 16, 102, 6, stColor);
    text(ctx, sub, W / 2, 109, { size: 22, weight: 500, color: stColor, align: 'center', max: 470 });
    const st = app.feed.status;
    const bridge = app.feed.bridgeLive;
    const [badge, bcol] = st.mode === 'demo' ? ['Demo data', C.amber] : bridge ? ['Live · TradingView', C.up] : st.mode === 'live' ? ['Live', C.up] : ['Delayed ~15 min', C.line];
    pill(ctx, W - 34, 26, badge, bcol, { size: 22, align: 'right' });
    const src = st.mode === 'demo' ? 'Simulated prices' : bridge ? 'TradingView bridge · options from CBOE' : st.mode === 'live' ? `Finnhub ${st.finnhubWs === 'live' ? 'streaming' : st.finnhubWs} · CBOE` : `CBOE ${st.cboe === 'ok' ? 'connected' : st.cboe}`;
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
export class MainChart extends Panel {
  constructor(app) { super({ id: 'chart', title: 'Chart', w: 1.30, h: 0.76 }); this.app = app; this.wantsHoverRedraw = true; this.titleColor = C.gold; }
  prepare() { const s = this.app.settings; this.title = `${s.main} · ${INTERVAL_LABEL[s.interval]}`; }
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

    const q = app.feed.quote(sym);
    const bars = app.feed.getBars(sym, iv);
    const iy = a.y + 36;
    text(ctx, q ? fmtPrice(q.last) : '—', a.x + 4, iy + 6, { size: 50, weight: 500, fam: F.mono, color: C.white });
    if (q) {
      text(ctx, `${q.chg >= 0 ? '+' : ''}${q.chg.toFixed(2)}  ${fmtPct(q.pct)}`, a.x + 240, iy, { size: 28, weight: 600, fam: F.mono, color: colorFor(q.chg) });
      text(ctx, `H ${fmtPrice(q.high)}  L ${fmtPrice(q.low)}${q.ext != null ? `  ·  ext ${fmtPrice(q.ext)}` : ''}`, a.x + 540, iy, { size: 22, weight: 500, fam: F.mono, color: C.dim, max: 520 });
    }
    const plot = { x: a.x, y: a.y + 68, w: a.w - 118, h: a.h - 108 };
    if (bars.length < 2) {
      text(ctx, 'Loading market data…', plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 28, color: C.dim, align: 'center' });
      if (app.feed.status.note) text(ctx, app.feed.status.note, plot.x + plot.w / 2, plot.y + plot.h / 2 + 42, { size: 21, color: C.faint, align: 'center', max: plot.w - 40 });
      return;
    }
    const sess = chartSession();
    const closes = bars.map(b => b.c);
    const e5 = ema(closes, 5), e12 = ema(closes, 12), e34 = ema(closes, 34), e50 = ema(closes, 50);
    const vw = vwap(bars);
    let lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h));
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
    const yv = (v) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;
    const ivMs = { '1min': 60e3, '5min': 300e3, '15min': 900e3 }[iv];
    const slots = Math.max(bars.length, Math.ceil((sess.close - sess.open) / ivMs));
    const cw = plot.w / slots;
    const xi = (i) => plot.x + (i + 0.5) * cw;
    const idxOf = (b) => Math.round((b.t - sess.open) / ivMs);
    const step = niceStep((hi - lo) / 6);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = yv(v);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      text(ctx, fmtPrice(v), plot.x + plot.w + 10, y + 7, { size: 20, weight: 500, fam: F.mono, color: C.faint });
    }
    for (let h = 10; h <= 16; h++) {
      const t = sess.open + (h - 9.5) * 3600e3;
      if (t > sess.close) break;
      const x = plot.x + ((t - sess.open) / ivMs) * cw;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      text(ctx, fmtHM(t).replace(':00', '').replace(' ', '').toLowerCase(), x, plot.y + plot.h + 30, { size: 20, weight: 500, color: C.faint, align: 'center' });
    }
    const pts = bars.map((b) => ({ b, i: idxOf(b) }));
    if (s.show.ema) {
      const cloud = (fa, fb, upCol, dnCol) => {
        for (let k = 0; k < pts.length - 1; k++) {
          const A = fa[k], B = fb[k], A2 = fa[k + 1], B2 = fb[k + 1];
          if (A == null || B == null || A2 == null || B2 == null) continue;
          ctx.fillStyle = A >= B ? upCol : dnCol;
          ctx.beginPath(); ctx.moveTo(xi(pts[k].i), yv(A)); ctx.lineTo(xi(pts[k + 1].i), yv(A2)); ctx.lineTo(xi(pts[k + 1].i), yv(B2)); ctx.lineTo(xi(pts[k].i), yv(B)); ctx.closePath(); ctx.fill();
        }
      };
      cloud(e34, e50, 'rgba(90,209,255,0.12)', 'rgba(251,146,60,0.12)');
      cloud(e5, e12, 'rgba(52,211,153,0.20)', 'rgba(248,113,113,0.20)');
    }
    const bw = Math.max(1.5, cw * 0.66);
    for (const p of pts) {
      const b = p.b, x = xi(p.i), up = b.c >= b.o;
      const col = up ? C.up : C.down;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, Math.min(2.5, cw * 0.15));
      ctx.beginPath(); ctx.moveTo(x, yv(b.h)); ctx.lineTo(x, yv(b.l)); ctx.stroke();
      const y1 = yv(Math.max(b.o, b.c)), y2 = yv(Math.min(b.o, b.c));
      ctx.fillStyle = up ? hexA(C.up, 0.9) : hexA(C.down, 0.9);
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1.5, y2 - y1));
    }
    if (s.show.vwap) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5; ctx.setLineDash([10, 6]); ctx.beginPath();
      pts.forEach((p, k) => { const x = xi(p.i), y = yv(vw[k]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
      text(ctx, 'VWAP', xi(pts[pts.length - 1].i) - 10, yv(vw[vw.length - 1]) + 26, { size: 19, weight: 600, color: C.gold, align: 'right' });
    }
    if (lv) {
      for (const l of lines) {
        if (l.v > hi || l.v < lo) { if (l.w > 2) offscreen.push(`${l.name} ${fmtPrice(l.v)} ${l.v > hi ? '↑' : '↓'}`); continue; }
        const y = yv(l.v);
        ctx.strokeStyle = l.col; ctx.lineWidth = l.w; ctx.setLineDash(l.dotted ? [3, 7] : [14, 9]);
        ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke(); ctx.setLineDash([]);
        text(ctx, `${l.name} ${fmtPrice(l.v)}`, l.dotted ? plot.x + plot.w - 12 : plot.x + 12, y - 8, { size: l.w > 2 ? 20 : 17, weight: 600, color: l.col, align: l.dotted ? 'right' : 'left' });
      }
      if (offscreen.length) text(ctx, offscreen.join('   '), plot.x + plot.w - 12, plot.y + 28, { size: 19, weight: 500, color: C.dim, align: 'right' });
      text(ctx, levelSourceLabel(lv), plot.x + plot.w - 12, plot.y + plot.h - 12, { size: 17, weight: 500, color: lv.source === 'demo' ? C.amber : C.faint, align: 'right' });
    }
    const last = q ? q.last : bars[bars.length - 1].c;
    const ly = yv(Math.min(hi, Math.max(lo, last)));
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(xi(pts[pts.length - 1].i), ly); ctx.lineTo(plot.x + plot.w, ly); ctx.stroke(); ctx.setLineDash([]);
    rrect(ctx, plot.x + plot.w + 2, ly - 17, 110, 34, 10); ctx.fillStyle = C.line; ctx.fill();
    text(ctx, fmtPrice(last), plot.x + plot.w + 57, ly + 1, { size: 21, weight: 600, fam: F.mono, color: '#04121c', align: 'center', base: 'middle' });
    const h = this.hover;
    if (h && h.x > plot.x && h.x < plot.x + plot.w && h.y > plot.y && h.y < plot.y + plot.h) {
      const slot = Math.floor((h.x - plot.x) / cw);
      let best = null; for (const p of pts) if (!best || Math.abs(p.i - slot) < Math.abs(best.i - slot)) best = p;
      if (best && Math.abs(best.i - slot) <= 2) {
        const x = xi(best.i);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(plot.x, h.y); ctx.lineTo(plot.x + plot.w, h.y); ctx.stroke();
        const b = best.b;
        const line = `${fmtHM(b.t)}  O ${fmtPrice(b.o)}  H ${fmtPrice(b.h)}  L ${fmtPrice(b.l)}  C ${fmtPrice(b.c)}  V ${fmtVol(b.v)}`;
        rrect(ctx, plot.x + 8, plot.y + 8, plot.w * 0.74, 40, 12); ctx.fillStyle = 'rgba(6,10,18,0.9)'; ctx.fill();
        text(ctx, line, plot.x + 22, plot.y + 36, { size: 21, weight: 500, fam: F.mono, color: C.white, max: plot.w * 0.72 - 24 });
        const pv = lo + ((plot.y + plot.h - h.y) / plot.h) * (hi - lo);
        rrect(ctx, plot.x + plot.w + 2, h.y - 15, 110, 30, 10); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
        text(ctx, fmtPrice(pv), plot.x + plot.w + 57, h.y + 1, { size: 19, weight: 600, fam: F.mono, color: '#04121c', align: 'center', base: 'middle' });
      }
    }
    if (app.feed.status.mode === 'demo') text(ctx, 'Demo data, not real prices', a.x + a.w - 118, iy + 4, { size: 20, weight: 600, color: C.amber, align: 'right' });
    else if (app.feed.status.mode === 'delayed' && !app.feed.bridgeLive) text(ctx, 'Delayed ~15 min', a.x + a.w - 118, iy + 4, { size: 19, weight: 500, color: C.faint, align: 'right' });
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
    if (q) rows.push({ k: 'px', name: 'Price', col: C.line, v: q.last });
    rows.sort((x, y) => y.v - x.v);
    const rh = Math.min(46, (a.h - 70) / rows.length);
    rows.forEach((r, i) => {
      const y = a.y + 8 + i * rh + rh / 2;
      if (r.k === 'px') { rrect(ctx, a.x - 6, y - rh / 2 + 3, a.w + 12, rh - 6, 12); ctx.fillStyle = 'rgba(90,209,255,0.10)'; ctx.fill(); }
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
    this.button('win', a.x, y, half, 64, `Win +${fmtMoney(amt)}`, { size: 26, color: C.up, onClick: () => app.logTrade(amt) });
    this.button('loss', a.x + half + 14, y, half, 64, `Loss −${fmtMoney(amt)}`, { size: 26, color: C.down, onClick: () => app.logTrade(-amt) });
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
    const [st, col] = vs.listening ? ['Listening…', C.amber] : vs.transcribing ? ['Understanding…', C.violet] : ind.thinking ? [ind.thinking, C.line] : vs.speaking ? ['Speaking', C.up] : ['Ready', C.dim];
    pill(ctx, this.W - 30, 14, st, col, { size: 20, align: 'right' });
    this.button('selftest', 150, 12, 150, 38, ind._testing ? 'Testing…' : 'Self-test', { size: 18, color: C.line, disabled: !!ind._testing, onClick: () => ind.selfTest() });
    let y = a.y;
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
      this.button('sig-an', a.x + 18, y + 158, 170, 44, 'Analyze', { size: 20, color: sc, onClick: () => this.app.indai.analyzeSignal(sig) });
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
    ctx.shadowColor = rc; ctx.shadowBlur = 30;
    rrect(ctx, L.x, y, L.w, 120, 26); ctx.fillStyle = hexA(rc, 0.16); ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = hexA(rc, 0.7); ctx.lineWidth = 2.5; ctx.stroke();
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
    this.button('ac', a.x, a.y + a.h - 50, 220, 48, `Analyze ${d.sym} calls`, { size: 20, color: C.up, onClick: () => app.indai.quickIdea(d.sym, 'C') });
    this.button('ap', a.x + 236, a.y + a.h - 50, 220, 48, `Analyze ${d.sym} puts`, { size: 20, color: C.down, onClick: () => app.indai.quickIdea(d.sym, 'P') });
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
    const tc = !tmp ? C.dim : tmp.label === 'Hot' ? C.down : tmp.label === 'Warm' ? C.amber : tmp.label === 'Calm' ? C.line : C.up;
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
    this.button('lock', R.x, a.y + a.h - 64, 300, 56, locked ? '✓ Plan locked in' : 'Lock in plan', { size: 24, active: locked, color: C.up, onClick: () => app.lockPlan() });
    this.button('voice', R.x + 316, a.y + a.h - 64, 300, 56, 'Set it by voice', { size: 22, color: C.line, onClick: () => app.indai.startDay({ voice: true, skipTemp: !!app.temp }) });
  }
}

// ---------------------------------------------------------------- dock
export class Dock extends Panel {
  constructor(app) { super({ id: 'dock', w: 1.24, h: 0.11, header: false }); this.app = app; }
  drawBody(ctx) {
    const app = this.app, W = this.W, H = this.H, vs = app.indai.voice.state;
    const y = 20, h = H - 40;
    const items = [
      ['talk', vs.listening ? 'Listening… tap to stop' : 'Talk to INDAI', 2.0, { color: C.line, active: vs.listening, onClick: () => app.talk(), disabled: !app.indai.voice.canListen }],
      ['brief', 'Brief me', 1.05, { color: C.gold, onClick: () => app.brief() }],
      ['plan', app.day.plan ? 'Plan' : 'Start day', 1.0, { color: app.day.plan ? C.text : C.up, active: !app.day.plan, onClick: () => app.openPlan() }],
      ['calc', 'Calculator', 1.15, { onClick: () => app.openCalc() }],
      ['summary', app.consolidated ? 'Restore' : 'Summary', 1.05, { onClick: () => app.consolidated ? app.restoreAll() : app.consolidate() }],
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

// The command-center screens.
import { Panel, C, F, text, rrect, fmtPrice, fmtPct, fmtMoney, colorFor, hexA } from './hud.js';
import { ema, vwap, fmtClock, fmtDuration, fmtHM, marketStatus, chartSession, INTERVAL_LABEL } from './market.js';
import { LEADLAG } from './feeds.js';

function wrap(ctx, str, maxW, size, fam = F.hud, weight = 500) {
  ctx.font = `${weight} ${size}px ${fam}`;
  const words = str.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function dot(ctx, x, y, r, color, glow = true) {
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}
function fmtVol(v) { if (!v) return '0'; if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'; return String(Math.round(v)); }

// ---------------------------------------------------------------- top bar
export class TopBar extends Panel {
  constructor(app) { super({ id: 'top', w: 1.30, h: 0.13, header: false }); this.app = app; }
  drawBody(ctx) {
    const { W, app } = this;
    const ms = marketStatus();
    text(ctx, 'J.A.R.V.I.S.', 34, 70, { size: 50, weight: 700, color: C.line, spacing: 6 });
    text(ctx, `COMMAND CENTER · ${String(app.settings.name || '').toUpperCase()}`, 36, 110, { size: 22, weight: 600, color: C.gold, spacing: 3, max: 400 });
    // clock + session
    text(ctx, fmtClock() + ' ET', W / 2 - 10, 66, { size: 46, weight: 600, fam: F.mono, color: C.white, align: 'center' });
    const stColor = ms.state === 'open' ? C.up : ms.state === 'closed' ? C.down : C.amber;
    const sub = `${ms.label} · ${ms.nextEvent.toUpperCase()} IN ${fmtDuration(ms.msToNext).toUpperCase()}`;
    ctx.font = `700 23px ${F.hud}`;
    const sw = Math.min(470, ctx.measureText(sub).width);
    dot(ctx, W / 2 - 10 - sw / 2 - 18, 102, 7, stColor);
    text(ctx, sub, W / 2 - 10, 110, { size: 23, weight: 700, color: stColor, align: 'center', spacing: 1, max: 470 });
    // data mode + feeds
    const st = app.feed.status;
    const live = st.mode === 'live';
    const bx = W - 34;
    const badge = live ? 'LIVE DATA' : 'DEMO DATA';
    ctx.font = `700 26px ${F.hud}`;
    const bw = ctx.measureText(badge).width + 40;
    rrect(ctx, bx - bw, 22, bw, 44, 10);
    ctx.fillStyle = hexA(live ? C.up : C.amber, 0.18); ctx.fill();
    ctx.strokeStyle = live ? C.up : C.amber; ctx.lineWidth = 2.5; ctx.stroke();
    text(ctx, badge, bx - bw / 2, 45, { size: 26, weight: 700, color: live ? C.up : C.amber, align: 'center', base: 'middle', spacing: 3 });
    if (live) {
      const feeds = [['TWELVE', st.twelve], ['FINNHUB', st.finnhubWs === 'live' ? 'ok' : st.finnhubRest]];
      let x = bx;
      for (const [name, s] of feeds) {
        const col = s === 'ok' || s === 'live' ? C.up : s === 'off' ? C.faint : s === 'err' ? C.down : C.amber;
        const w = text(ctx, name, x, 112, { size: 21, weight: 700, color: col, align: 'right', spacing: 2 });
        dot(ctx, x - w - 14, 105, 6, col);
        x -= w + 44;
      }
    } else {
      text(ctx, 'ADD FREE KEYS IN SETTINGS', bx, 110, { size: 19, weight: 600, color: C.dim, align: 'right', spacing: 1, max: 330 });
    }
  }
}

// ---------------------------------------------------------------- watchlist
export class Watchlist extends Panel {
  constructor(app) { super({ id: 'watch', title: 'WATCHLIST', w: 0.62, h: 0.80 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app; const syms = app.settings.symbols;
    const rowH = Math.min(100, Math.floor(a.h / Math.max(syms.length, 1)));
    syms.forEach((sym, i) => {
      const y = a.y + i * rowH;
      const q = app.feed.quote(sym);
      const sel = sym === app.settings.main;
      const hov = this.hoverBtn === 'row:' + sym;
      rrect(ctx, a.x - 6, y + 4, a.w + 12, rowH - 8, 12);
      ctx.fillStyle = sel ? hexA(C.gold, 0.14) : hov ? 'rgba(53,216,255,0.10)' : 'rgba(255,255,255,0.025)';
      ctx.fill();
      if (sel || hov) { ctx.lineWidth = 2.5; ctx.strokeStyle = sel ? C.gold : C.line; ctx.stroke(); }
      this.buttons.push({ id: 'row:' + sym, x: a.x - 6, y: y + 4, w: a.w + 12, h: rowH - 8, onClick: () => app.selectSymbol(sym) });
      const mid = y + rowH / 2;
      text(ctx, sym, a.x + 14, mid - 4, { size: 36, weight: 700, color: sel ? C.gold : C.white, spacing: 1 });
      // level tag
      const lv = app.levelsFor(sym);
      if (q && lv) {
        const near = nearestLevel(q.last, lv);
        if (near) text(ctx, `${near.key.toUpperCase()} ${near.dist >= 0 ? '+' : ''}${near.dist.toFixed(2)}%`, a.x + 14, mid + 28, { size: 20, weight: 700, fam: F.mono, color: Math.abs(near.dist) < 0.15 ? C.amber : C.faint, max: 175 });
      }
      // sparkline
      const bars = app.feed.getBars(sym, '5min');
      const sx = a.x + 200, sw = 150, sh = rowH * 0.5, sy = mid - sh / 2;
      if (bars.length > 1) {
        const lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h));
        const base = q ? q.base : bars[0].o;
        const yv = (v) => sy + sh - ((v - lo) / ((hi - lo) || 1)) * sh;
        if (base >= lo && base <= hi) { ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, yv(base)); ctx.lineTo(sx + sw, yv(base)); ctx.stroke(); ctx.setLineDash([]); }
        ctx.strokeStyle = q ? colorFor(q.chg) : C.line; ctx.lineWidth = 3; ctx.beginPath();
        bars.forEach((b, k) => { const x = sx + (k / (bars.length - 1)) * sw; k ? ctx.lineTo(x, yv(b.c)) : ctx.moveTo(x, yv(b.c)); });
        ctx.stroke();
      }
      text(ctx, q ? fmtPrice(q.last) : '—', a.x + a.w - 12, mid - 4, { size: 34, weight: 600, fam: F.mono, color: C.white, align: 'right' });
      text(ctx, q ? fmtPct(q.pct) : 'waiting…', a.x + a.w - 12, mid + 28, { size: 24, weight: 700, fam: F.mono, color: q ? colorFor(q.chg) : C.faint, align: 'right' });
    });
  }
}

export function nearestLevel(price, lv) {
  const names = { cw: 'CALL WALL', pw: 'PUT WALL', zg: 'ZERO Γ' };
  let best = null;
  for (const k of ['cw', 'pw', 'zg']) {
    if (lv[k] == null) continue;
    const dist = ((lv[k] - price) / price) * 100;
    if (!best || Math.abs(dist) < Math.abs(best.dist)) best = { key: k, name: names[k], level: lv[k], dist };
  }
  return best;
}

// ---------------------------------------------------------------- main chart
export class MainChart extends Panel {
  constructor(app) { super({ id: 'chart', title: 'CHART', w: 1.30, h: 0.76 }); this.app = app; this.wantsHoverRedraw = true; this.titleColor = C.gold; }
  prepare() { const s = this.app.settings; this.title = `${s.main}  ·  ${INTERVAL_LABEL[s.interval]}`; }
  drawBody(ctx, a) {
    const app = this.app, s = app.settings, sym = s.main, iv = s.interval;
    const W = this.W;
    // header buttons
    let bx = W - 30;
    const btn = (id, label, w, opts) => { bx -= w; this.button(id, bx, 12, w, 42, label, { size: 22, ...opts }); bx -= 8; };
    btn('gex', 'GEX', 70, { active: s.show.gex, color: C.amber, onClick: () => app.toggleShow('gex') });
    btn('vwap', 'VWAP', 80, { active: s.show.vwap, color: C.gold, onClick: () => app.toggleShow('vwap') });
    btn('ema', 'EMA', 70, { active: s.show.ema, color: C.up, onClick: () => app.toggleShow('ema') });
    bx -= 14;
    for (const ivx of ['15min', '5min', '1min']) btn('iv' + ivx, INTERVAL_LABEL[ivx], 62, { active: iv === ivx, onClick: () => app.setTimeframe(ivx) });
    bx -= 14;
    btn('next', '▶', 52, { onClick: () => app.cycleSymbol(1) });
    btn('prev', '◀', 52, { onClick: () => app.cycleSymbol(-1) });

    const q = app.feed.quote(sym);
    const bars = app.feed.getBars(sym, iv);
    // info row
    const iy = a.y + 38;
    text(ctx, q ? fmtPrice(q.last) : '—', a.x + 6, iy + 6, { size: 52, weight: 600, fam: F.mono, color: C.white });
    if (q) {
      text(ctx, `${q.chg >= 0 ? '+' : ''}${q.chg.toFixed(2)}  ${fmtPct(q.pct)}`, a.x + 250, iy, { size: 30, weight: 700, fam: F.mono, color: colorFor(q.chg) });
      text(ctx, `H ${fmtPrice(q.high)}   L ${fmtPrice(q.low)}`, a.x + 560, iy, { size: 24, weight: 500, fam: F.mono, color: C.dim });
    }
    const plot = { x: a.x, y: a.y + 70, w: a.w - 120, h: a.h - 110 };
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1.5;
    rrect(ctx, plot.x, plot.y, plot.w, plot.h, 6); ctx.stroke();
    if (bars.length < 2) {
      const msg = app.feed.status.mode === 'live' ? 'Waiting for data… charts fill in as trades arrive.' : 'Loading…';
      text(ctx, msg, plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 30, color: C.dim, align: 'center' });
      if (app.feed.status.note) text(ctx, app.feed.status.note, plot.x + plot.w / 2, plot.y + plot.h / 2 + 44, { size: 22, color: C.faint, align: 'center', max: plot.w - 40 });
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
    if (lv) for (const k of ['cw', 'pw', 'zg']) {
      const v = lv[k]; if (v == null) continue;
      if (v > hi && v - hi < span0 * 0.6) hi = v; else if (v < lo && lo - v < span0 * 0.6) lo = v;
    }
    const pad = (hi - lo) * 0.08 || 0.1; lo -= pad; hi += pad;
    const yv = (v) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;
    // slots: full session width so the chart grows left-to-right during the day
    const ivMs = { '1min': 60e3, '5min': 300e3, '15min': 900e3 }[iv];
    const slots = Math.max(bars.length, Math.ceil((sess.close - sess.open) / ivMs));
    const cw = plot.w / slots;
    const xi = (i) => plot.x + (i + 0.5) * cw;
    const idxOf = (b) => Math.round((b.t - sess.open) / ivMs);
    // grid + price axis
    const step = niceStep((hi - lo) / 6);
    ctx.font = `500 22px ${F.mono}`;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = yv(v);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      text(ctx, fmtPrice(v), plot.x + plot.w + 10, y + 7, { size: 21, weight: 500, fam: F.mono, color: C.faint });
    }
    // time axis (hourly)
    for (let h = 10; h <= 16; h++) {
      const t = sess.open + (h - 9.5) * 3600e3;
      if (t > sess.close) break;
      const x = plot.x + ((t - sess.open) / ivMs) * cw;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      text(ctx, fmtHM(t).replace(':00', '').replace(' ', ''), x, plot.y + plot.h + 30, { size: 21, weight: 600, color: C.faint, align: 'center' });
    }
    const pts = bars.map((b, i) => ({ b, i: idxOf(b), k: i }));
    // EMA clouds
    if (s.show.ema) {
      const cloud = (fa, fb, upCol, dnCol) => {
        for (let k = 0; k < pts.length - 1; k++) {
          const A = fa[k], B = fb[k], A2 = fa[k + 1], B2 = fb[k + 1];
          if (A == null || B == null || A2 == null || B2 == null) continue;
          ctx.fillStyle = A >= B ? upCol : dnCol;
          ctx.beginPath(); ctx.moveTo(xi(pts[k].i), yv(A)); ctx.lineTo(xi(pts[k + 1].i), yv(A2)); ctx.lineTo(xi(pts[k + 1].i), yv(B2)); ctx.lineTo(xi(pts[k].i), yv(B)); ctx.closePath(); ctx.fill();
        }
      };
      cloud(e34, e50, 'rgba(53,216,255,0.13)', 'rgba(255,140,60,0.13)');
      cloud(e5, e12, 'rgba(47,229,159,0.22)', 'rgba(255,79,109,0.22)');
    }
    // candles
    const bw = Math.max(1.5, cw * 0.66);
    for (const p of pts) {
      const b = p.b, x = xi(p.i), up = b.c >= b.o;
      const col = up ? C.up : C.down;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, Math.min(2.5, cw * 0.15));
      ctx.beginPath(); ctx.moveTo(x, yv(b.h)); ctx.lineTo(x, yv(b.l)); ctx.stroke();
      const y1 = yv(Math.max(b.o, b.c)), y2 = yv(Math.min(b.o, b.c));
      ctx.fillStyle = up ? hexA(C.up, 0.85) : hexA(C.down, 0.9);
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1.5, y2 - y1));
    }
    // VWAP
    if (s.show.vwap) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.setLineDash([10, 6]); ctx.beginPath();
      pts.forEach((p, k) => { const x = xi(p.i), y = yv(vw[k]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
      text(ctx, 'VWAP', xi(pts[pts.length - 1].i) - 10, yv(vw[vw.length - 1]) + 26, { size: 20, weight: 700, color: C.gold, align: 'right' });
    }
    // GEX levels
    if (lv) {
      const defs = [['cw', 'CALL WALL', C.up], ['zg', 'ZERO GAMMA', C.amber], ['pw', 'PUT WALL', C.down]];
      for (const [k, name, col] of defs) {
        const v = lv[k]; if (v == null) continue;
        if (v > hi || v < lo) { offscreen.push(`${name} ${fmtPrice(v)} ${v > hi ? '▲' : '▼'}`); continue; }
        const y = yv(v);
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([16, 10]);
        ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke(); ctx.setLineDash([]);
        text(ctx, `${name} ${fmtPrice(v)}`, plot.x + 12, y - 9, { size: 22, weight: 700, color: col, spacing: 1 });
      }
      if (offscreen.length) text(ctx, offscreen.join('   '), plot.x + plot.w - 12, plot.y + 30, { size: 20, weight: 700, color: C.dim, align: 'right' });
      if (lv.source === 'demo') text(ctx, 'DEMO LEVELS', plot.x + plot.w - 12, plot.y + plot.h - 14, { size: 18, weight: 700, color: C.amber, align: 'right', spacing: 2 });
    }
    // last price tag
    const last = q ? q.last : bars[bars.length - 1].c;
    const ly = yv(Math.min(hi, Math.max(lo, last)));
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(xi(pts[pts.length - 1].i), ly); ctx.lineTo(plot.x + plot.w, ly); ctx.stroke(); ctx.setLineDash([]);
    rrect(ctx, plot.x + plot.w + 2, ly - 18, 112, 36, 6); ctx.fillStyle = C.line; ctx.fill();
    text(ctx, fmtPrice(last), plot.x + plot.w + 58, ly + 1, { size: 22, weight: 700, fam: F.mono, color: '#021018', align: 'center', base: 'middle' });
    // hover crosshair
    const h = this.hover;
    if (h && h.x > plot.x && h.x < plot.x + plot.w && h.y > plot.y && h.y < plot.y + plot.h) {
      const slot = Math.floor((h.x - plot.x) / cw);
      let best = null; for (const p of pts) if (!best || Math.abs(p.i - slot) < Math.abs(best.i - slot)) best = p;
      if (best && Math.abs(best.i - slot) <= 2) {
        const x = xi(best.i);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(plot.x, h.y); ctx.lineTo(plot.x + plot.w, h.y); ctx.stroke();
        const b = best.b;
        const line = `${fmtHM(b.t)}  O ${fmtPrice(b.o)}  H ${fmtPrice(b.h)}  L ${fmtPrice(b.l)}  C ${fmtPrice(b.c)}  V ${fmtVol(b.v)}`;
        rrect(ctx, plot.x + 8, plot.y + 8, plot.w * 0.72, 40, 8); ctx.fillStyle = 'rgba(2,8,16,0.88)'; ctx.fill();
        text(ctx, line, plot.x + 20, plot.y + 36, { size: 22, weight: 500, fam: F.mono, color: C.white, max: plot.w * 0.7 - 20 });
        const pv = lo + ((plot.y + plot.h - h.y) / plot.h) * (hi - lo);
        rrect(ctx, plot.x + plot.w + 2, h.y - 16, 112, 32, 6); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
        text(ctx, fmtPrice(pv), plot.x + plot.w + 58, h.y + 1, { size: 20, weight: 700, fam: F.mono, color: '#021018', align: 'center', base: 'middle' });
      }
    }
    if (app.feed.status.mode === 'demo') text(ctx, 'DEMO — NOT REAL PRICES', a.x + a.w - 120, iy, { size: 21, weight: 700, color: C.amber, align: 'right', spacing: 2 });
  }
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

// ---------------------------------------------------------------- lead / lag
export class LeadLag extends Panel {
  constructor(app) { super({ id: 'leadlag', title: 'LEAD / LAG · SINCE OPEN', w: 0.62, h: 0.42 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app; const cols = { SPY: C.white, QQQ: C.violet, IWM: C.gold };
    const sess = chartSession();
    const series = LEADLAG.map(sym => {
      const bars = app.feed.getBars(sym, '5min');
      const q = app.feed.quote(sym);
      const base = bars.length ? bars[0].o : null;
      const pts = base ? bars.map(b => ({ t: b.t + 150e3, v: (b.c / base - 1) * 100 })) : [];
      if (base && q && q.last != null && pts.length) pts.push({ t: Math.min(Date.now(), sess.close), v: (q.last / base - 1) * 100 });
      return { sym, pts, now: pts.length ? pts[pts.length - 1].v : null };
    });
    // legend
    let lx = a.x + 4;
    for (const sr of series) {
      const w1 = text(ctx, sr.sym, lx, a.y + 22, { size: 28, weight: 700, color: cols[sr.sym] });
      const w2 = text(ctx, sr.now == null ? '—' : fmtPct(sr.now), lx + w1 + 10, a.y + 22, { size: 26, weight: 700, fam: F.mono, color: sr.now == null ? C.faint : colorFor(sr.now) });
      lx += w1 + w2 + 36;
    }
    const plot = { x: a.x, y: a.y + 42, w: a.w, h: a.h - 96 };
    const all = series.flatMap(s => s.pts.map(p => p.v));
    if (all.length < 4) { text(ctx, 'Waiting for SPY / QQQ / IWM data…', plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 26, color: C.dim, align: 'center' }); return; }
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const pad = (hi - lo) * 0.12 || 0.1; lo -= pad; hi += pad;
    const xt = (t) => plot.x + ((t - sess.open) / (sess.close - sess.open)) * plot.w;
    const yv = (v) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([5, 7]); ctx.lineWidth = 1.5;
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
      const msg = spread < 0.15 ? 'Moving together — no clear leader' : `${leader.sym} leading ${lagger.sym} by ${spread.toFixed(2)}%`;
      text(ctx, msg, a.x + 4, a.y + a.h - 10, { size: 26, weight: 700, color: spread < 0.15 ? C.dim : cols[leader.sym], max: a.w - 8 });
    }
  }
}

// ---------------------------------------------------------------- GEX levels
export class Levels extends Panel {
  constructor(app) { super({ id: 'levels', title: 'GEX LEVELS', w: 0.62, h: 0.34 }); this.app = app; }
  prepare() { this.title = `GEX LEVELS · ${this.app.settings.main}`; }
  drawBody(ctx, a) {
    const app = this.app, sym = app.settings.main;
    const lv = app.levelsFor(sym);
    const q = app.feed.quote(sym);
    if (!lv) {
      text(ctx, `No levels for ${sym} yet.`, a.x + 4, a.y + 40, { size: 28, weight: 600, color: C.dim });
      text(ctx, 'Paste your morning GEX levels in Settings,', a.x + 4, a.y + 84, { size: 24, color: C.faint });
      text(ctx, `e.g.  ${sym} CW 250 PW 240 ZG 245`, a.x + 4, a.y + 118, { size: 24, fam: F.mono, color: C.faint });
      return;
    }
    const rows = [['cw', 'CALL WALL', C.up], ['zg', 'ZERO GAMMA', C.amber], ['pw', 'PUT WALL', C.down]]
      .filter(r => lv[r[0]] != null).map(r => ({ k: r[0], name: r[1], col: r[2], v: lv[r[0]] }));
    if (q) rows.push({ k: 'px', name: 'PRICE', col: C.line, v: q.last });
    rows.sort((x, y) => y.v - x.v);
    const rh = Math.min(52, (a.h - 50) / rows.length);
    rows.forEach((r, i) => {
      const y = a.y + 18 + i * rh + rh / 2;
      if (r.k === 'px') { rrect(ctx, a.x - 4, y - rh / 2 + 3, a.w + 8, rh - 6, 8); ctx.fillStyle = 'rgba(53,216,255,0.12)'; ctx.fill(); }
      dot(ctx, a.x + 12, y - 2, 7, r.col, r.k === 'px');
      text(ctx, r.name, a.x + 34, y + 8, { size: 26, weight: 700, color: r.col, spacing: 1 });
      text(ctx, fmtPrice(r.v), a.x + a.w * 0.62, y + 8, { size: 28, weight: 600, fam: F.mono, color: C.white, align: 'right' });
      if (q && r.k !== 'px') {
        const d = ((r.v - q.last) / q.last) * 100;
        text(ctx, `${d >= 0 ? '+' : ''}${d.toFixed(2)}%`, a.x + a.w - 4, y + 8, { size: 24, weight: 700, fam: F.mono, color: Math.abs(d) < 0.15 ? C.amber : C.dim, align: 'right' });
      }
    });
    text(ctx, lv.source === 'demo' ? 'DEMO LEVELS — paste real ones in Settings' : 'From your pasted levels', a.x + 4, a.y + a.h - 6, { size: 20, weight: 600, color: lv.source === 'demo' ? C.amber : C.faint });
  }
}

// ---------------------------------------------------------------- risk breaker
export class RiskBreaker extends Panel {
  constructor(app) { super({ id: 'risk', title: 'RISK BREAKER', w: 0.62, h: 0.80 }); this.app = app; }
  drawBody(ctx, a) {
    const app = this.app, day = app.day, r = app.settings.risk, rs = app.riskState();
    this.accent = rs.state === 'tripped' ? C.down : rs.state === 'cooldown' ? C.amber : C.line;
    let y = a.y;
    // banner
    const bcol = rs.state === 'tripped' ? C.down : rs.state === 'cooldown' ? C.amber : C.up;
    const blabel = rs.state === 'tripped' ? 'DONE FOR TODAY' : rs.state === 'cooldown' ? `COOLDOWN  ${fmtMMSS(rs.cooldownLeft)}` : 'ARMED · TRADING ALLOWED';
    rrect(ctx, a.x, y, a.w, 64, 12); ctx.fillStyle = hexA(bcol, 0.2); ctx.fill(); ctx.strokeStyle = bcol; ctx.lineWidth = 3; ctx.stroke();
    text(ctx, blabel, a.x + a.w / 2, y + 33, { size: 32, weight: 700, color: bcol, align: 'center', base: 'middle', spacing: 3 });
    y += 82;
    text(ctx, 'DAY P&L', a.x, y + 26, { size: 24, weight: 700, color: C.dim, spacing: 2 });
    text(ctx, fmtMoney(day.pnl, true), a.x + a.w, y + 44, { size: 60, weight: 600, fam: F.mono, color: colorFor(day.pnl), align: 'right' });
    text(ctx, `${day.trades.length} trade${day.trades.length === 1 ? '' : 's'}`, a.x, y + 58, { size: 22, color: C.faint });
    y += 76;
    // loss bar
    const used = Math.min(1, rs.used / r.maxDailyLoss);
    rrect(ctx, a.x, y, a.w, 22, 11); ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    if (used > 0) { rrect(ctx, a.x, y, Math.max(22, a.w * used), 22, 11); ctx.fillStyle = used > 0.75 ? C.down : used > 0.5 ? C.amber : C.up; ctx.fill(); }
    text(ctx, `Loss limit: ${fmtMoney(rs.used)} of ${fmtMoney(r.maxDailyLoss)}  ·  ${fmtMoney(rs.room)} room`, a.x, y + 54, { size: 23, weight: 600, color: C.dim, max: a.w });
    y += 72;
    // consecutive losses
    text(ctx, 'LOSSES IN A ROW', a.x, y + 22, { size: 22, weight: 700, color: C.dim, spacing: 2 });
    for (let i = 0; i < r.maxConsecLosses; i++) dot(ctx, a.x + 230 + i * 34, y + 14, 11, i < day.consec ? C.down : 'rgba(255,255,255,0.15)', i < day.consec);
    text(ctx, `cooldown after ${r.maxConsecLosses}`, a.x + a.w, y + 22, { size: 20, color: C.faint, align: 'right' });
    y += 44;
    // amount + log
    const amt = day.step;
    this.button('amt-', a.x, y, 70, 58, '−', { size: 34, onClick: () => app.setStep(-1) });
    rrect(ctx, a.x + 80, y, 140, 58, 10); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    text(ctx, fmtMoney(amt), a.x + 150, y + 30, { size: 30, weight: 600, fam: F.mono, color: C.white, align: 'center', base: 'middle' });
    this.button('amt+', a.x + 230, y, 70, 58, '+', { size: 34, onClick: () => app.setStep(1) });
    this.button('undo', a.x + a.w - 130, y, 130, 58, 'UNDO', { size: 24, color: C.dim, disabled: !day.trades.length, onClick: () => app.undoTrade() });
    y += 70;
    const half = (a.w - 14) / 2;
    this.button('win', a.x, y, half, 66, `WIN +${fmtMoney(amt)}`, { size: 28, color: C.up, onClick: () => app.logTrade(amt) });
    this.button('loss', a.x + half + 14, y, half, 66, `LOSS −${fmtMoney(amt)}`, { size: 28, color: C.down, onClick: () => app.logTrade(-amt) });
    y += 86;
    // position sizer
    ctx.strokeStyle = C.lineFaint; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); ctx.stroke();
    y += 10;
    text(ctx, `POSITION SIZER · risk ${fmtMoney(rs.riskPerTrade)} (${r.riskPct}%) · stop ${r.stopPct}%`, a.x, y + 26, { size: 22, weight: 700, color: C.dim, max: a.w, spacing: 1 });
    y += 40;
    this.button('prem-', a.x, y, 64, 54, '−', { size: 32, onClick: () => app.setPremium(-1) });
    rrect(ctx, a.x + 72, y, 150, 54, 10); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    text(ctx, '$' + day.premium.toFixed(2), a.x + 147, y + 28, { size: 28, weight: 600, fam: F.mono, color: C.white, align: 'center', base: 'middle' });
    this.button('prem+', a.x + 230, y, 64, 54, '+', { size: 32, onClick: () => app.setPremium(1) });
    const sizeLabel = rs.state !== 'armed' ? 'LOCKED' : rs.checklistScore < 3 ? 'WAIT' : `MAX ${rs.contracts}`;
    const sizeSub = rs.state !== 'armed' ? 'breaker active' : rs.checklistScore < 3 ? `setup ${rs.checklistScore}/4` : rs.contracts === 1 ? 'contract' : 'contracts';
    const scol = rs.state !== 'armed' ? C.down : rs.checklistScore < 3 ? C.amber : C.gold;
    text(ctx, sizeLabel, a.x + a.w, y + 34, { size: 40, weight: 700, color: scol, align: 'right', spacing: 2 });
    text(ctx, sizeSub, a.x + a.w, y + 60, { size: 20, weight: 600, color: C.faint, align: 'right' });
    y += 76;
    // checklist
    const items = ['Trend w/ EMA cloud', 'At a GEX level', 'Volume confirms', 'Calm, not revenge'];
    items.forEach((label, i) => {
      const cx = a.x + (i % 2) * (half + 14), cy = y + Math.floor(i / 2) * 60;
      const on = day.checklist[i];
      this.button('chk' + i, cx, cy, half, 52, (on ? '✓ ' : '○ ') + label, { size: 22, active: on, color: C.up, onClick: () => app.toggleCheck(i) });
    });
  }
}
function fmtMMSS(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ---------------------------------------------------------------- Jarvis log
export class JarvisLog extends Panel {
  constructor(app) { super({ id: 'jarvis', title: 'JARVIS', w: 0.62, h: 0.80 }); this.app = app; }
  drawBody(ctx, a) {
    const j = this.app.jarvis;
    const st = j.listening ? ['LISTENING…', C.amber] : j.speaking ? ['SPEAKING', C.line] : ['STANDING BY', C.dim];
    dot(ctx, a.x + 12, a.y + 16, 9, st[1]);
    text(ctx, st[0], a.x + 34, a.y + 26, { size: 26, weight: 700, color: st[1], spacing: 3 });
    text(ctx, j.muted ? 'VOICE MUTED' : (j.canListen ? 'say: "show IWM", "brief me", "log loss 50"' : 'voice input not supported here — use buttons'), a.x + a.w, a.y + 26, { size: 19, weight: 600, color: C.faint, align: 'right', max: a.w - 240 });
    let y = a.y + 62;
    const maxY = a.y + a.h;
    for (const m of j.log) {
      const col = m.kind === 'alert' ? C.amber : m.kind === 'risk' ? C.down : m.kind === 'you' ? C.gold : m.kind === 'good' ? C.up : C.text;
      const lines = wrap(ctx, m.text, a.w - 110, 24);
      const need = lines.length * 30 + 16;
      if (y + need > maxY) break;
      text(ctx, fmtHM(m.t).replace(' ', '').toLowerCase(), a.x, y + 22, { size: 19, weight: 600, fam: F.mono, color: C.faint });
      lines.forEach((ln, k) => text(ctx, ln, a.x + 100, y + 24 + k * 30, { size: 24, weight: m.kind === 'you' ? 600 : 500, color: col }));
      y += need;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, y - 6); ctx.lineTo(a.x + a.w, y - 6); ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------- dock
export class Dock extends Panel {
  constructor(app) { super({ id: 'dock', w: 0.95, h: 0.11, header: false }); this.app = app; }
  drawBody(ctx) {
    const app = this.app, W = this.W, H = this.H;
    const y = 22, h = H - 44;
    const items = [
      ['talk', app.jarvis.listening ? 'LISTENING…' : 'TALK TO JARVIS', 2.0, { color: C.line, active: app.jarvis.listening, onClick: () => app.talk(), disabled: !app.jarvis.canListen }],
      ['brief', 'BRIEF ME', 1.2, { color: C.gold, onClick: () => app.brief() }],
      ['recenter', 'RECENTER', 1.2, { onClick: () => app.recenter() }],
      ['mute', app.jarvis.muted ? 'UNMUTE' : 'MUTE', 1.0, { color: C.dim, active: app.jarvis.muted, onClick: () => app.toggleMute() }],
      app.inXR ? ['exit', 'EXIT', 0.9, { color: C.down, onClick: () => app.exitXR() }] : ['settings', 'SETTINGS', 1.1, { color: C.dim, onClick: () => app.openSettings() }],
    ];
    const total = items.reduce((s, it) => s + it[2], 0);
    const gap = 14, avail = W - 48 - gap * (items.length - 1);
    let x = 24;
    for (const [id, label, wt, opts] of items) {
      const w = avail * wt / total;
      this.button(id, x, y, w, h, label, { size: 28, ...opts });
      x += w + gap;
    }
  }
}

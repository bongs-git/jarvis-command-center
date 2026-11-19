// Server copy of the headset scanner and its indicator math. Keep scoring in sync with js/signals.js.
const TZ = 'America/New_York';
const fmtParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function etParts(ms = Date.now()) {
  const o = {};
  for (const p of fmtParts.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second,
    dow: DOW[o.weekday], ymd: `${o.year}-${o.month}-${o.day}`,
  };
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out[i] = i >= Math.min(period - 1, values.length - 1) ? prev : null;
  }
  return out;
}

function vwap(bars) {
  let pv = 0, vol = 0;
  return bars.map(b => {
    const tp = (b.h + b.l + b.c) / 3;
    const v = b.v > 0 ? b.v : 1;
    pv += tp * v; vol += v;
    return pv / vol;
  });
}

function macd(closes, f = 12, s = 26, sig = 9) {
  const ef = ema(closes, f), es = ema(closes, s);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const valid = line.map(v => v ?? 0);
  const signal = ema(valid, sig);
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}
function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (i <= n) { g += Math.max(0, d); l += Math.max(0, -d); if (i === n) out[i] = 100 - 100 / (1 + (g / n) / ((l / n) || 1e-9)); continue; }
    g = (g * (n - 1) + Math.max(0, d)) / n; l = (l * (n - 1) + Math.max(0, -d)) / n;
    out[i] = 100 - 100 / (1 + g / (l || 1e-9));
  }
  return out;
}
export const STRATEGIES = {
  ema: { name: 'EMA cloud trend', short: 'EMA clouds' },
  vwap: { name: 'VWAP reclaim / reject', short: 'VWAP' },
  gex: { name: 'GEX wall bounce / break', short: 'GEX walls' },
  orb: { name: 'Opening range breakout', short: 'Opening range' },
};

export const PROFILES = {
  conservative: { label: 'Conservative', riskPct: 1, lossPct: 3, minScore: 75, perHour: 2, consec: 2, cool: 20, rr: 2.0, delta: 0.6, stopPct: 40, afterGoal: 'stop', note: 'A-plus setups only, in-the-money contracts with a day or more to expiry, stop for the day at the goal.' },
  balanced: { label: 'Balanced', riskPct: 2, lossPct: 5, minScore: 64, perHour: 4, consec: 2, cool: 15, rr: 1.5, delta: 0.5, stopPct: 50, afterGoal: 'aplus', note: 'Solid setups, at-the-money contracts, only A-plus setups once the goal is hit.' },
  aggressive: { label: 'Aggressive', riskPct: 3, lossPct: 8, minScore: 54, perHour: 6, consec: 3, cool: 10, rr: 1.2, delta: 0.4, stopPct: 50, afterGoal: 'protect', note: 'More setups, slightly out-of-the-money 0DTE contracts, keep going after the goal but protect most of the gains.' },
};

const minsET = (t) => { const p = etParts(t); return p.h * 60 + p.mi; };

function cloudState(closes) {
  const e5 = ema(closes, 5), e12 = ema(closes, 12), e34 = ema(closes, 34), e50 = ema(closes, 50);
  const n = closes.length - 1;
  const fast = (i) => e5[i] != null && e12[i] != null ? (e5[i] >= e12[i] ? 1 : -1) : 0;
  const slow = (i) => e34[i] != null && e50[i] != null ? (e34[i] >= e50[i] ? 1 : -1) : 0;
  return { e5, e12, e34, e50, fastNow: fast(n), fastPrev: fast(n - 1), slowNow: slow(n), n };
}

// bars: completed 5-minute bars for today (oldest first). Returns candidate setups for this bar.
export function scanSetups(sym, bars, { levels, leadDir = 0, now = Date.now(), enabled = Object.keys(STRATEGIES) } = {}) {
  if (!bars || bars.length < 6) return [];
  const out = [];
  const closes = bars.map(b => b.c), n = bars.length - 1, b = bars[n], pb = bars[n - 1];
  const vw = vwap(bars), m = macd(closes), r = rsi(closes);
  const cl = cloudState(closes);
  const avgV = bars.slice(Math.max(0, n - 20), n).reduce((a, x) => a + (x.v || 0), 0) / Math.max(1, Math.min(20, n));
  const volR = avgV ? (b.v || 0) / avgV : 1;
  const hist = m.hist[n], histPrev = m.hist[n - 1];
  const ctx = { sym, bar: b, vwap: vw[n], volR, hist, histRising: hist != null && histPrev != null && hist > histPrev, rsi: r[n], cl, levels, leadDir, now };
  const push = (strat, dir, title, why, base) => out.push(rate({ strat, dir, title, why, base, ...ctx, bars }));
  // 1. EMA cloud trend: fast cloud flips with the slow cloud, or a pullback into the fast cloud holds
  if (enabled.includes('ema') && bars.length >= 14) {
    for (const d of [1, -1]) {
      const flip = cl.fastNow === d && cl.fastPrev === -d && (cl.slowNow === d || cl.slowNow === 0);
      const lo = Math.min(cl.e5[n], cl.e12[n]), hi = Math.max(cl.e5[n], cl.e12[n]);
      const pull = cl.fastNow === d && cl.slowNow === d && (d > 0 ? (b.l <= hi && b.c > hi) : (b.h >= lo && b.c < lo)) && (d > 0 ? b.c > b.o : b.c < b.o);
      if (flip) push('ema', d, `fast EMA cloud flipped ${d > 0 ? 'bullish' : 'bearish'}`, [`5/12 cloud turned ${d > 0 ? 'green' : 'red'}`, cl.slowNow === d ? `34/50 cloud agrees` : '34/50 cloud still flat'], 58);
      else if (pull) push('ema', d, `pullback held the fast cloud`, [`dipped into the 5/12 cloud and closed back ${d > 0 ? 'above' : 'below'}`, 'both clouds aligned'], 60);
    }
  }
  // 2. VWAP reclaim / reject
  if (enabled.includes('vwap')) {
    const v = vw[n], vp = vw[n - 1];
    if (pb.c < vp && b.c > v && volR >= 1.1) push('vwap', 1, 'VWAP reclaim', [`closed back above VWAP ${v.toFixed(2)}`, `volume ${volR.toFixed(1)}x average`], 56);
    if (pb.c > vp && b.c < v && volR >= 1.1) push('vwap', -1, 'lost VWAP', [`closed below VWAP ${v.toFixed(2)}`, `volume ${volR.toFixed(1)}x average`], 56);
    if (b.h >= v && b.c < v && pb.c < vp && b.c < b.o && (b.h - Math.max(b.o, b.c)) > Math.abs(b.c - b.o)) push('vwap', -1, 'VWAP rejection', [`wicked into VWAP ${v.toFixed(2)} and got rejected`], 54);
    if (b.l <= v && b.c > v && pb.c > vp && b.c > b.o && (Math.min(b.o, b.c) - b.l) > Math.abs(b.c - b.o)) push('vwap', 1, 'VWAP bounce', [`tested VWAP ${v.toFixed(2)} and held`], 54);
  }
  // 3. GEX walls: bounce off the put wall, rejection at the call wall, or a break through
  if (enabled.includes('gex') && levels) {
    const tol = b.c * 0.0012;
    if (levels.pw && b.l <= levels.pw + tol && b.c > levels.pw && b.c > b.o) push('gex', 1, `bounce off the put wall ${levels.pw}`, ['tagged the put wall and closed green'], 57);
    if (levels.cw && b.h >= levels.cw - tol && b.c < levels.cw && b.c < b.o) push('gex', -1, `rejected at the call wall ${levels.cw}`, ['tagged the call wall and closed red'], 57);
    if (levels.cw && pb.c <= levels.cw && b.c > levels.cw + tol * 0.5 && volR > 1.3) push('gex', 1, `broke the call wall ${levels.cw}`, ['closed through the wall on volume', levels.cw2 ? `next wall ${levels.cw2}` : 'open air above'], 55);
    if (levels.pw && pb.c >= levels.pw && b.c < levels.pw - tol * 0.5 && volR > 1.3) push('gex', -1, `broke the put wall ${levels.pw}`, ['closed through the wall on volume', levels.pw2 ? `next wall ${levels.pw2}` : 'open air below'], 55);
    if (levels.zg && (pb.c - levels.zg) * (b.c - levels.zg) < 0) push('gex', b.c > levels.zg ? 1 : -1, `crossed the gamma flip ${levels.zg}`, [b.c > levels.zg ? 'back into positive gamma' : 'into negative gamma, moves can extend'], 52);
  }
  // 4. Opening range (first 15 minutes) breakout, after 9:45
  if (enabled.includes('orb')) {
    const t0 = minsET(bars[0].t);
    const or = bars.filter(x => minsET(x.t) < t0 + 15);
    if (or.length >= 3 && n >= 3 && minsET(b.t) >= 585 && minsET(b.t) <= 690) {
      const hi = Math.max(...or.map(x => x.h)), lo = Math.min(...or.map(x => x.l));
      const priorAbove = bars.slice(or.length, n).some(x => x.c > hi), priorBelow = bars.slice(or.length, n).some(x => x.c < lo);
      if (b.c > hi && pb.c <= hi && !priorAbove && volR > 1.2) push('orb', 1, `broke the opening range high ${hi.toFixed(2)}`, [`volume ${volR.toFixed(1)}x average`], 57);
      if (b.c < lo && pb.c >= lo && !priorBelow && volR > 1.2) push('orb', -1, `broke the opening range low ${lo.toFixed(2)}`, [`volume ${volR.toFixed(1)}x average`], 57);
    }
  }
  return out;
}

function rate(x) {
  const d = x.dir, b = x.bar, why = [...x.why], against = [];
  let s = x.base;
  const trend = x.cl.slowNow * d;
  if (trend > 0) { s += 8; why.push('with the 34/50 trend'); } else if (trend < 0 && x.strat !== 'gex') { s -= 10; against.push('against the 34/50 trend'); }
  if ((b.c >= x.vwap ? 1 : -1) === d) s += 5; else if (x.strat !== 'vwap') { s -= 6; against.push(`${d > 0 ? 'below' : 'above'} VWAP`); }
  if (x.hist != null) { if (Math.sign(x.hist) === d && x.histRising === (d > 0)) { s += 7; why.push('MACD agrees'); } else if (Math.sign(x.hist) === -d && x.histRising !== (d > 0)) { s -= 7; against.push('MACD disagrees'); } }
  if (x.rsi != null) { if ((d > 0 && x.rsi > 75) || (d < 0 && x.rsi < 25)) { s -= 9; against.push(`RSI stretched (${x.rsi.toFixed(0)})`); } else if ((d > 0 && x.rsi > 50 && x.rsi < 68) || (d < 0 && x.rsi < 50 && x.rsi > 32)) s += 3; }
  if (x.volR >= 1.5) { s += 6; why.push(`volume ${x.volR.toFixed(1)}x`); } else if (x.volR < 0.7) { s -= 5; against.push('light volume'); }
  if (x.leadDir === d) { s += 6; why.push('SPY and QQQ agree'); } else if (x.leadDir === -d) { s -= 6; against.push('SPY and QQQ moving the other way'); }
  // room to the next wall, stop and target
  const lv = x.levels || {};
  const recent = x.bars.slice(-4);
  const swingLo = Math.min(...recent.map(k => k.l)), swingHi = Math.max(...recent.map(k => k.h));
  // stop: the nearest protective level behind price (recent swing, VWAP, fast cloud), at least 0.12% away
  const minGap = b.c * 0.0012;
  const fastEdge = d > 0 ? Math.min(x.cl.e5[x.cl.n], x.cl.e12[x.cl.n]) : Math.max(x.cl.e5[x.cl.n], x.cl.e12[x.cl.n]);
  const prot = [d > 0 ? swingLo : swingHi, x.vwap, fastEdge].filter(v => v != null && (d > 0 ? v <= b.c - minGap : v >= b.c + minGap));
  let stop = prot.length ? (d > 0 ? Math.max(...prot) : Math.min(...prot)) : b.c - d * b.c * 0.0015;
  stop -= d * b.c * 0.0003; // a little buffer beyond the level
  const walls = [lv.cw, lv.cw2, lv.pw, lv.pw2, lv.zg].filter(v => v != null);
  const dayHi = Math.max(...x.bars.map(k => k.h)), dayLo = Math.min(...x.bars.map(k => k.l));
  const ahead = walls.filter(w => d > 0 ? w > b.c * 1.0008 : w < b.c * 0.9992).sort((p, q) => d > 0 ? p - q : q - p);
  let target = ahead[0] ?? null;
  if (target == null) target = d > 0 ? Math.max(dayHi, b.c * 1.004) : Math.min(dayLo, b.c * 0.996);
  if (Math.abs(target - b.c) < b.c * 0.0015) target = ahead[1] ?? b.c + d * b.c * 0.003;
  const risk = Math.abs(b.c - stop), reward = Math.abs(target - b.c), rr = reward / (risk || 1e-9);
  if (rr >= 2) s += 5; else if (rr < 1) { s -= 10; against.push(`only ${rr.toFixed(1)}:1 reward to risk`); }
  const block = ahead[0] != null && Math.abs(ahead[0] - b.c) / b.c < 0.0015;
  if (block && x.strat !== 'gex') { s -= 8; against.push('a GEX wall sits right in front'); }
  // time of day
  const mn = minsET(x.now);
  if (mn >= 705 && mn < 810) { s -= 6; against.push('lunch chop window'); }
  if (mn >= 940) { s -= 10; against.push('last 20 minutes'); }
  if ((mn >= 585 && mn < 690) || (mn >= 840 && mn < 930)) s += 3;
  return { sym: x.sym, strat: x.strat, dir: d, type: d > 0 ? 'C' : 'P', title: x.title, why, against, score: Math.max(0, Math.min(100, Math.round(s))), price: b.c, stop: +stop.toFixed(2), target: +target.toFixed(2), rr: +rr.toFixed(2), barT: b.t, at: Date.now() };
}

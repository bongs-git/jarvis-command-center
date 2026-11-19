// Options math: Black-Scholes pricing and Greeks, implied volatility, probabilities,
// Monte Carlo odds, and the price x time P&L grid used by the calculator.
import { etToMs, etParts, isTradingDay, nextTradingDay, sessionTimes, EARLY_CLOSE } from './market.js';

const SQ2PI = Math.sqrt(2 * Math.PI);
export const YEAR_MS = 365 * 24 * 3600e3;

export function normPdf(x) { return Math.exp(-0.5 * x * x) / SQ2PI; }
export function normCdf(x) {
  // Abramowitz-Stegun 7.1.26 via erf, accurate to ~1e-7
  const s = x < 0 ? -1 : 1; const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

// type: 'C' | 'P'. T in years. Returns per-share price; theta per calendar day; vega per 1 vol point.
export function bs(S, K, T, r, sigma, type) {
  if (!(S > 0) || !(K > 0)) return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, d1: 0, d2: 0 };
  if (T <= 0 || sigma <= 0) {
    const intrinsic = type === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
    const itm = type === 'C' ? S > K : S < K;
    return { price: intrinsic, delta: itm ? (type === 'C' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, d1: 0, d2: 0 };
  }
  const sq = Math.sqrt(T), v = sigma * sq;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / v, d2 = d1 - v;
  const disc = Math.exp(-r * T), pdf = normPdf(d1);
  const price = type === 'C' ? S * normCdf(d1) - K * disc * normCdf(d2) : K * disc * normCdf(-d2) - S * normCdf(-d1);
  const delta = type === 'C' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * v);
  const thetaYr = type === 'C'
    ? -S * pdf * sigma / (2 * sq) - r * K * disc * normCdf(d2)
    : -S * pdf * sigma / (2 * sq) + r * K * disc * normCdf(-d2);
  return { price, delta, gamma, theta: thetaYr / 365, vega: S * pdf * sq / 100, d1, d2 };
}

export function impliedVol(price, S, K, T, r, type) {
  if (!(price > 0) || T <= 0) return null;
  const intrinsic = type === 'C' ? Math.max(0, S - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S);
  if (price <= intrinsic + 1e-6) return 0.01;
  let lo = 0.005, hi = 6;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bs(S, K, T, r, mid, type).price > price) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// Market close (ms) for an expiry date string YYYY-MM-DD.
export function expiryCloseMs(exp) {
  const [y, m, d] = exp.split('-').map(Number);
  return etToMs(y, m, d, EARLY_CLOSE[exp] ? 13 : 16, 0);
}
export function yearsTo(exp, now = Date.now()) { return Math.max(0, expiryCloseMs(exp) - now) / YEAR_MS; }

// Probability that the underlying finishes beyond `level` at expiry (lognormal, drift r).
export function probAbove(S, level, T, r, sigma) {
  if (T <= 0 || sigma <= 0) return S > level ? 1 : 0;
  const d2 = (Math.log(S / level) + (r - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normCdf(d2);
}

export function legValue(leg, S, now, r) {
  const T = yearsTo(leg.expiry, now);
  return bs(S, leg.strike, T, r, leg.iv, leg.type).price;
}

// P&L in dollars for the whole position at underlying price S and time `at` (ms).
export function positionPnl(legs, S, at, r) {
  let pnl = 0;
  for (const l of legs) pnl += l.side * (legValue(l, S, at, r) - l.entry) * 100 * l.qty;
  return pnl;
}

export function positionGreeks(legs, S, now, r) {
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0, value: 0, cost: 0 };
  for (const l of legs) {
    const b = bs(S, l.strike, yearsTo(l.expiry, now), r, l.iv, l.type);
    const m = l.side * 100 * l.qty;
    g.delta += b.delta * m; g.gamma += b.gamma * m; g.theta += b.theta * m; g.vega += b.vega * m;
    g.value += b.price * m; g.cost += l.entry * m;
  }
  return g;
}

// Summary at the latest expiry: breakevens, max profit/loss, probability of profit.
export function positionSummary(legs, spot, r, now = Date.now()) {
  if (!legs.length) return null;
  const lastExp = legs.map(l => l.expiry).sort().pop();
  const atExp = expiryCloseMs(lastExp);
  const strikes = legs.map(l => l.strike);
  const lo = Math.min(spot, ...strikes) * 0.5, hi = Math.max(spot, ...strikes) * 1.6;
  const N = 1200, pts = [];
  for (let i = 0; i <= N; i++) { const S = lo + (hi - lo) * i / N; pts.push([S, positionPnl(legs, S, atExp, r)]); }
  const breakevens = [];
  for (let i = 1; i < pts.length; i++) {
    const [s0, p0] = pts[i - 1], [s1, p1] = pts[i];
    if ((p0 < 0 && p1 >= 0) || (p0 > 0 && p1 <= 0)) breakevens.push(s0 + (s1 - s0) * (0 - p0) / (p1 - p0));
  }
  const vals = pts.map(p => p[1]);
  let maxProfit = Math.max(...vals), maxLoss = Math.min(...vals);
  // Unbounded checks: slope at the far ends.
  const slopeHi = vals[N] - vals[N - 10], slopeLo = vals[0] - vals[10];
  const unlimitedProfit = slopeHi > 1e-6 && vals[N] === maxProfit;
  const unlimitedLoss = (slopeHi < -1e-6 && vals[N] === maxLoss) || (slopeLo < -1e-6 && vals[0] === maxLoss && legs.some(l => l.side < 0 && l.type === 'P' && false));
  // Probability of profit at expiry using the average IV (lognormal).
  const ivAvg = legs.reduce((s, l) => s + l.iv, 0) / legs.length;
  const T = yearsTo(lastExp, now);
  let pop = 0;
  const M = 400;
  for (let i = 0; i < M; i++) {
    const a = lo + (hi - lo) * i / M, b = lo + (hi - lo) * (i + 1) / M, mid = (a + b) / 2;
    if (positionPnl(legs, mid, atExp, r) > 0) pop += probAbove(spot, a, T, r, ivAvg) - probAbove(spot, b, T, r, ivAvg);
  }
  const g = positionGreeks(legs, spot, now, r);
  return { lastExp, breakevens, maxProfit, maxLoss, unlimitedProfit, unlimitedLoss, pop: Math.max(0, Math.min(1, pop)), greeks: g, netDebit: g.cost };
}

// Grid of P&L by underlying price (rows) and time (columns), like optionsprofitcalculator.com.
export function pnlGrid(legs, spot, r, { rows = 15, now = Date.now(), maxCols = 8 } = {}) {
  if (!legs.length) return null;
  const lastExp = legs.map(l => l.expiry).sort().pop();
  const end = expiryCloseMs(lastExp);
  const ivAvg = legs.reduce((s, l) => s + l.iv, 0) / legs.length;
  const T = Math.max(1 / 365 / 6.5 / 4, yearsTo(lastExp, now));
  const em = spot * ivAvg * Math.sqrt(T);
  const strikes = legs.map(l => l.strike);
  const halfRange = Math.max(em * 2.2, spot * 0.012, (Math.max(...strikes) - Math.min(...strikes)) * 0.75 + em);
  const rawStep = (2 * halfRange) / (rows - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= rawStep) ?? rawStep;
  const center = Math.round(spot / step) * step;
  const prices = [];
  for (let i = 0; i < rows; i++) prices.push(+(center + (Math.floor(rows / 2) - i) * step).toFixed(4));
  // Columns: intraday checkpoints for same-day expiries, otherwise trading days.
  const cols = [];
  const span = end - now;
  if (span <= 0) cols.push({ t: end, label: 'Exp' });
  else if (span < 7 * 3600e3) {
    cols.push({ t: now, label: 'Now' });
    const p = etParts(now);
    let h = p.h + (p.mi >= 30 ? 1 : 0.5);
    const minutesLeft = span / 60e3;
    const stepH = minutesLeft > 240 ? 1 : 0.5;
    for (let x = Math.ceil(h / stepH) * stepH; ; x += stepH) {
      const t = etToMs(p.y, p.m, p.d, Math.floor(x), Math.round((x % 1) * 60));
      if (t >= end - 60e3) break;
      if (t > now + 10 * 60e3) cols.push({ t, label: fmtHour(x) });
    }
    cols.push({ t: end, label: 'Close' });
  } else {
    cols.push({ t: now, label: 'Now' });
    let p = etParts(now), [y, m, d] = [p.y, p.m, p.d];
    const days = [];
    for (let i = 0; i < 400; i++) {
      [y, m, d] = nextTradingDay(y, m, d);
      const s = sessionTimes(y, m, d);
      if (s.close > end + 1000) break;
      days.push({ t: s.close, label: `${m}/${d}` });
    }
    if (!days.length || days[days.length - 1].t !== end) days.push({ t: end, label: 'Exp' });
    const keep = Math.min(maxCols - 1, days.length);
    for (let i = 0; i < keep; i++) cols.push(days[Math.round(i * (days.length - 1) / Math.max(1, keep - 1))]);
  }
  const uniq = [];
  for (const c of cols) if (!uniq.find(u => u.t === c.t)) uniq.push(c);
  const grid = prices.map(S => uniq.map(c => positionPnl(legs, S, c.t, r)));
  const cost = legs.reduce((s, l) => s + l.side * l.entry * 100 * l.qty, 0);
  return { prices, cols: uniq, grid, cost, step, expectedMove: em };
}
function fmtHour(x) {
  const h = Math.floor(x), mi = Math.round((x % 1) * 60);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(mi).padStart(2, '0')}`;
}

// Monte Carlo of the underlying (GBM) from now to expiry for a single long or short option.
// Returns odds of profit at expiry and of the option touching +50% / +100% before expiry.
export function monteCarlo({ S, K, exp, type, side = 1, entry, iv, r = 0.04, drift = 0, paths = 2500, steps = 26, now = Date.now(), seed = 7 }) {
  const T = yearsTo(exp, now);
  if (T <= 0 || !(entry > 0)) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const dt = T / steps, mu = (r + drift - 0.5 * iv * iv) * dt, sd = iv * Math.sqrt(dt);
  let win = 0, hit50 = 0, hit100 = 0, sumPnl = 0;
  const finals = new Float64Array(paths);
  for (let p = 0; p < paths; p++) {
    let x = S, best = -Infinity;
    for (let k = 1; k <= steps; k++) {
      x *= Math.exp(mu + sd * gauss());
      if (k < steps && (k % 2 === 0)) {
        const v = bs(x, K, T - k * dt, r, iv, type).price;
        if (v > best) best = v;
      }
    }
    const payoff = type === 'C' ? Math.max(0, x - K) : Math.max(0, K - x);
    if (payoff > best) best = payoff;
    const pnl = side * (payoff - entry);
    finals[p] = pnl;
    sumPnl += pnl;
    if (pnl > 0) win++;
    if (side > 0) { if (best >= entry * 1.5) hit50++; if (best >= entry * 2) hit100++; }
  }
  const sorted = Array.from(finals).sort((a, b) => a - b);
  const q = (f) => sorted[Math.min(paths - 1, Math.floor(f * paths))] * 100;
  return {
    probProfitAtExpiry: win / paths,
    probTouch50: side > 0 ? hit50 / paths : null,
    probTouch100: side > 0 ? hit100 / paths : null,
    expectedPnl: (sumPnl / paths) * 100,
    p10: q(0.1), p50: q(0.5), p90: q(0.9),
  };
}

// Pick a sensible expiry from words like "today", "tomorrow", "friday", "next week", "11/21", "nov 21".
export function resolveExpiry(text, now = Date.now()) {
  const t = text.toLowerCase();
  const p = etParts(now);
  const fmt = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayOk = isTradingDay(p.y, p.m, p.d) && now < etToMs(p.y, p.m, p.d, 16, 0);
  const next = () => nextTradingDay(p.y, p.m, p.d);
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  let m;
  if (/\b(today|0 ?dte|zero ?dte|same day|this afternoon)\b/.test(t)) return todayOk ? fmt(p.y, p.m, p.d) : fmt(...next());
  if (/\b(tomorrow|1 ?dte|one ?dte)\b/.test(t)) { const [a, b, c] = todayOk ? next() : nextTradingDay(...next()); return fmt(a, b, c); }
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : p.y;
    if (!m[3] && (Number(m[1]) < p.m || (Number(m[1]) === p.m && Number(m[2]) < p.d))) y++;
    return fmt(y, Number(m[1]), Number(m[2]));
  }
  if ((m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/))) {
    const mo = months[m[1]]; let y = p.y;
    if (mo < p.m || (mo === p.m && Number(m[2]) < p.d)) y++;
    return fmt(y, mo, Number(m[2]));
  }
  const dows = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const nextWeek = /\bnext (week|friday|monday|tuesday|wednesday|thursday)\b/.test(t);
  for (let i = 1; i <= 5; i++) {
    if (new RegExp(`\\b${dows[i]}\\b`).test(t) || (i === 5 && /\b(this week|weekly|weeklies|end of (the )?week)\b/.test(t)) || (i === 5 && /\bnext week\b/.test(t))) {
      let add = (i - p.dow + 7) % 7;
      if (add === 0 && !todayOk) add = 7;
      if (nextWeek) add += 7;
      const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + add));
      return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
  }
  if ((m = t.match(/\bin (\d{1,2}) (day|days|week|weeks)\b/))) {
    const add = Number(m[1]) * (m[2].startsWith('week') ? 7 : 1);
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + add));
    return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  return null;
}

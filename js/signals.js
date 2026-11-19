// INDAI's own setup alerts and the daily game plan.
//   Plan:     starting capital + minimum goal + aggressiveness -> risk per trade, loss limit, alert bar, contract style
//   Signals:  scans the watchlist on 5-minute bars with your playbook (EMA clouds, VWAP, GEX walls, opening range)
//   Temperature: a quick read of how hot the market is before you start
import { ema, vwap, etParts, etToMs } from './market.js';
import { macd, rsi } from './analysis.js';
import { bs } from './options.js';

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

// Turn the morning answers into numbers the breaker and the alerts use.
export function buildPlan({ capital, goal, aggr = 'balanced', strategies = Object.keys(STRATEGIES) }) {
  const p = PROFILES[aggr] || PROFILES.balanced;
  const riskPerTrade = Math.max(10, Math.round(capital * p.riskPct / 100));
  const maxLoss = Math.max(riskPerTrade * 2, Math.round(capital * p.lossPct / 100));
  const winR = riskPerTrade * p.rr;
  const winsNeeded = goal > 0 ? Math.max(1, Math.ceil(goal / winR)) : null;
  const warnings = [];
  if (goal > capital * 0.1) warnings.push(`A ${Math.round(goal / capital * 100)}% day is a big ask. Expect more risk and more losing days at that target.`);
  if (goal > maxLoss * 2) warnings.push('Your goal is more than twice your loss limit, so you need a high win rate.');
  if (goal > 0 && goal < riskPerTrade * 0.5) warnings.push('Your goal is smaller than one trade\'s risk; one good trade should do it.');
  return { capital, goal, aggr, strategies, riskPerTrade, maxLoss, rr: p.rr, winsNeeded, minScore: p.minScore, perHour: p.perHour, consec: p.consec, cool: p.cool, delta: p.delta, stopPct: p.stopPct, afterGoal: p.afterGoal, label: p.label, note: p.note, warnings };
}

// ---------------------------------------------------------------- market temperature
export function temperature({ quotes, vix, gex, preMarket }) {
  // quotes: {SPY:{pct, extPct}, ...}; vix: {last, pct}; gex: {SPY: {zg, spot}, ...}
  let heat = 0; const notes = [];
  const moves = ['SPY', 'QQQ', 'IWM'].map(s => ({ s, m: quotes[s] ? (preMarket && quotes[s].extPct != null ? quotes[s].extPct : quotes[s].pct) : null })).filter(x => x.m != null);
  const avg = moves.length ? moves.reduce((a, b) => a + b.m, 0) / moves.length : 0;
  const big = moves.length ? Math.max(...moves.map(x => Math.abs(x.m))) : 0;
  if (big > 1.2) { heat += 2; notes.push(`big move: ${moves.map(x => `${x.s} ${x.m >= 0 ? '+' : ''}${x.m.toFixed(2)}%`).join(', ')}`); }
  else if (big > 0.6) { heat += 1; notes.push(`active tape: ${moves.map(x => `${x.s} ${x.m >= 0 ? '+' : ''}${x.m.toFixed(2)}%`).join(', ')}`); }
  else if (moves.length) notes.push(`quiet so far: ${moves.map(x => `${x.s} ${x.m >= 0 ? '+' : ''}${x.m.toFixed(2)}%`).join(', ')}`);
  if (vix && vix.last) {
    if (vix.last >= 25) { heat += 2; notes.push(`VIX ${vix.last.toFixed(1)}, fear is high`); }
    else if (vix.last >= 20) { heat += 1; notes.push(`VIX ${vix.last.toFixed(1)}, elevated`); }
    else if (vix.last < 15) notes.push(`VIX ${vix.last.toFixed(1)}, calm`);
    else notes.push(`VIX ${vix.last.toFixed(1)}, normal`);
    if (vix.pct > 8) { heat += 1; notes.push(`VIX up ${vix.pct.toFixed(0)}% today`); }
  }
  const neg = Object.entries(gex || {}).filter(([, g]) => g && g.zg && g.spot && g.spot < g.zg).map(([s]) => s);
  const pos = Object.entries(gex || {}).filter(([, g]) => g && g.zg && g.spot && g.spot >= g.zg).map(([s]) => s);
  if (neg.length) { heat += neg.length >= 2 ? 1 : 0.5; notes.push(`negative gamma on ${neg.join(', ')}: moves can run`); }
  if (pos.length) notes.push(`positive gamma on ${pos.join(', ')}: dealers dampen moves, walls tend to hold`);
  const bias = avg > 0.25 ? 'bullish' : avg < -0.25 ? 'bearish' : 'mixed';
  const label = heat >= 3.5 ? 'Hot' : heat >= 2 ? 'Warm' : heat >= 1 ? 'Normal' : 'Calm';
  const advice = label === 'Hot' ? 'Fast, wide swings. Smaller size, wider stops, take profits quickly.'
    : label === 'Warm' ? 'Moving well. Trend setups should work; respect the walls.'
    : label === 'Calm' ? 'Likely range-bound. Fade the GEX walls, and skip chasing breakouts.' : 'A normal day. Trade the plan.';
  return { heat, label, bias, notes, advice };
}

// ---------------------------------------------------------------- setup scanner
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

// Suggest a contract for a setup given the plan (delta target, expiry by time of day, size from risk per trade).
export function suggestContract(sig, plan, { iv = 0.22, r = 0.04, strikeStep = 1, now = Date.now(), nextExpiry }) {
  const p = etParts(now);
  const mn = p.h * 60 + p.mi;
  const late = mn >= 13 * 60 + 30;
  const useNext = plan.aggr === 'conservative' || (plan.aggr === 'balanced' && late);
  const expiry = useNext ? nextExpiry.next : nextExpiry.today;
  const close = etToMs(...expiry.split('-').map(Number), 16, 0);
  const T = Math.max(1 / (365 * 6.5 * 4), (close - now) / (365 * 24 * 3600e3));
  const opts = [];
  for (let i = -20; i <= 20; i++) {
    const K = Math.round(sig.price / strikeStep) * strikeStep + i * strikeStep;
    if (K <= 0) continue;
    const o = bs(sig.price, K, T, r, iv, sig.type);
    opts.push({ K, o, dd: Math.abs(Math.abs(o.delta) - plan.delta) });
  }
  opts.sort((a, b) => a.dd - b.dd);
  const perC = (x) => Math.max(0.05, x.o.price) * 100 * plan.stopPct / 100;
  let best = opts[0];
  // If one contract at the target delta risks more than the plan allows, step further out of the money (down to 0.25 delta).
  if (perC(best) > plan.riskPerTrade) {
    const cheaper = opts.filter(x => Math.abs(x.o.delta) >= 0.25 && Math.abs(x.o.delta) < Math.abs(best.o.delta) && perC(x) <= plan.riskPerTrade).sort((a, b) => Math.abs(b.o.delta) - Math.abs(a.o.delta))[0];
    if (cheaper) best = cheaper;
  }
  const prem = Math.max(0.05, best.o.price);
  const perContract = perC(best);
  const qty = Math.max(1, Math.floor(plan.riskPerTrade / perContract));
  const overBudget = perContract > plan.riskPerTrade * 1.05;
  return { strike: +best.K.toFixed(2), expiry, premium: +prem.toFixed(2), delta: +best.o.delta.toFixed(2), qty, risk: Math.round(qty * perContract), stopPct: plan.stopPct, overBudget };
}

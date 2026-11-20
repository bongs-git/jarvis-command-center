/* INDAI Atlas Engine — reasoning layer for The Market Pattern Atlas (Corrected Direction Edition).
 * Works in the browser, Deno (Supabase edge functions) and Node. Load atlas_kb.json and pass it to createAtlas(kb).
 * ESM: import createAtlas from './index.mjs'.  CommonJS: const createAtlas = require('./indai_atlas_engine.js').
 * Source: The Market Pattern Atlas, Corrected Direction Edition (rev 1.1), (c) 2026 Ini Akpabio / INDAI. All rights reserved.
 *
 *   const atlas = createAtlas(kb);
 *   atlas.lookup({ rule: 'hammer', trend: 'below', vol: 'high', horizon: 5 });
 *   atlas.contextFromBars(dailyBars)          // -> { trend, vol } exactly as the study binned it
 *   atlas.read({ rule: 'hammer', bars, vix: 27, sequence: 'Three lower closes' })  // six-hat read + RAG
 *   atlas.combine(['doji', 'long-legged doji', 'hammer'], ctx)                    // honest combination
 *   atlas.enumerate()                         // every tested permutation in the atlas
 *   atlas.f.bsm({ S:100, K:100, T:30/365, r:0.04, q:0, sigma:0.2 })              // formula desk
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // Node require()
  if (typeof globalThis !== 'undefined') globalThis.createAtlas = api;      // browser, Deno, Node ESM (see index.mjs)
})(function () {
  'use strict';

  // Candles that fire on the same bar for the same reason (atlas p.066: not independent confirmations)
  const OVERLAP_FAMILIES = [
    ['CDLDOJI', 'CDLLONGLEGGEDDOJI', 'CDLRICKSHAWMAN', 'CDLHIGHWAVE', 'CDLSPINNINGTOP', 'CDLSHORTLINE', 'CDLDRAGONFLYDOJI', 'CDLGRAVESTONEDOJI', 'CDLTAKURI'],
    ['CDLHAMMER', 'CDLHANGINGMAN', 'CDLTAKURI', 'CDLDRAGONFLYDOJI'],
    ['CDLINVERTEDHAMMER', 'CDLSHOOTINGSTAR', 'CDLGRAVESTONEDOJI'],
    ['CDLMARUBOZU', 'CDLCLOSINGMARUBOZU', 'CDLLONGLINE', 'CDLBELTHOLD'],
    ['CDLENGULFING', 'CDL3OUTSIDE', 'TRAPFLAG'],
    ['CDLHARAMI', 'CDLHARAMICROSS', 'CDL3INSIDE', 'CDLHIKKAKE', 'CDLHIKKAKEMOD'],
    ['CDLMORNINGSTAR', 'CDLMORNINGDOJISTAR', 'CDLDOJISTAR', 'CDLABANDONEDBABY'],
    ['CDLEVENINGSTAR', 'CDLEVENINGDOJISTAR', 'CDLDOJISTAR', 'CDLABANDONEDBABY'],
    ['CDLKICKING', 'CDLKICKINGBYLENGTH'],
    ['CDL3BLACKCROWS', 'CDLIDENTICAL3CROWS'],
    ['BULLFLAG', 'CHANNEL20', 'CUPHANDLE'],
    ['BEARFLAG', 'CHANNEL20', 'INVERSECUP'],
  ];
  const VOL_NAMES = { low: 'low', l: 'low', mid: 'mid', middle: 'mid', m: 'mid', high: 'high', h: 'high' };

  // ---------------- formula desk (atlas pp.070-079) ----------------
  const SQ2PI = Math.sqrt(2 * Math.PI);
  const pdf = (x) => Math.exp(-0.5 * x * x) / SQ2PI;
  function cdf(x) { // Abramowitz-Stegun 7.1.26 via erf, |err| < 1.5e-7
    const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * y);
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  function fact(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }

  const f = {
    candle({ O, H, L, C }) { const B = Math.abs(C - O); return { body: B, upper: H - Math.max(O, C), lower: Math.min(O, C) - L, range: H - L, green: C > O }; },
    trueRange(H, L, prevC) { return Math.max(H - L, Math.abs(H - prevC), Math.abs(L - prevC)); },
    atrWilder(bars, n = 14) { // bars: [{H,L,C}], returns array aligned to bars
      const out = Array(bars.length).fill(null); const tr = bars.map((b, i) => i ? f.trueRange(b.H, b.L, bars[i - 1].C) : b.H - b.L);
      if (bars.length <= n) return out; let a = mean(tr.slice(1, n + 1)); out[n] = a;
      for (let i = n + 1; i < bars.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; } return out;
    },
    sma(xs, n) { return xs.map((_, i) => i + 1 < n ? null : mean(xs.slice(i + 1 - n, i + 1))); },
    ema(xs, n) { const a = 2 / (n + 1); const out = []; let e = null; xs.forEach((x, i) => { e = e === null ? x : a * x + (1 - a) * e; out.push(i + 1 < n ? null : e); }); return out; },
    rsiWilder(closes, n = 14) {
      const out = Array(closes.length).fill(null); let g = 0, l = 0;
      for (let i = 1; i <= n && i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
      g /= n; l /= n; if (closes.length > n) out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
      return out;
    },
    macd(closes, fast = 12, slow = 26, sig = 9) {
      const ef = f.ema(closes, fast), es = f.ema(closes, slow);
      const M = closes.map((_, i) => ef[i] !== null && es[i] !== null ? ef[i] - es[i] : null);
      const start = M.findIndex((x) => x !== null); const S = Array(closes.length).fill(null);
      if (start >= 0) { const e = f.ema(M.slice(start), sig); e.forEach((v, j) => (S[start + j] = v)); }
      return { M, S, H: M.map((m, i) => (m !== null && S[i] !== null ? m - S[i] : null)) };
    },
    vwap(prices, vols) { let pv = 0, v = 0; prices.forEach((p, i) => { pv += p * vols[i]; v += vols[i]; }); return pv / v; },
    relVol(v, priorVols) { return v / mean(priorVols); },
    bollinger(closes, n = 20, k = 2) { const i = closes.length - 1, w = closes.slice(i + 1 - n); const m = mean(w), s = Math.sqrt(w.reduce((a, x) => a + (x - m) ** 2, 0) / n); return { mid: m, upper: m + k * s, lower: m - k * s, width: (2 * k * s) / m }; },
    fibLevels(A, B, ratios = [0.382, 0.5, 0.618, 0.786, 0.886]) { return ratios.map((r) => ({ ratio: r, level: B - r * (B - A) })); },
    trendline(P1, t1, P2, t2) { const m = (P2 - P1) / (t2 - t1); return { slope: m, at: (t) => P1 + m * (t - t1), logSlope: (Math.log(P2) - Math.log(P1)) / (t2 - t1) }; },
    heightTarget(breakout, height, side = 1) { return breakout + side * height; },
    netReturn(entryOpen, exitClose, side = 1, cost = 0.001) { return side * (exitClose / entryOpen - 1) - cost; },
    lift(win, base) { return win - base; },
    expectancy(p, avgWin, avgLoss, cost = 0) { return p * avgWin - (1 - p) * avgLoss - cost; },
    breakEven(W, L, cost = 0) { return (L + cost) / (W + L); },
    sharesForRisk({ riskBudget, entry, stop, costPerShare = 0 }) { const per = Math.abs(entry - stop) + costPerShare; const n = Math.floor(riskBudget / per); return { shares: n, plannedLoss: +(n * per).toFixed(2), notional: +(n * entry).toFixed(2), perShareRisk: per }; },
    gapStress({ shares, entry, gapExit, costPerShare = 0, side = 1 }) { return +(shares * (side * (entry - gapExit) + costPerShare)).toFixed(2); },
    futuresContracts({ riskBudget, stopPoints, pointValue, costPerContract = 0 }) { return Math.floor(riskBudget / (stopPoints * pointValue + costPerContract)); },
    drawdown(values) { let peak = -Infinity; return values.map((v) => { peak = Math.max(peak, v); return v / peak - 1; }); },
    recoveryNeeded(dd) { return 1 / (1 + dd) - 1; },
    sharpe(excess, periodsPerYear = 252) { return (mean(excess) / sd(excess)) * Math.sqrt(periodsPerYear); },
    profitFactor(rets) { const g = rets.filter((x) => x > 0).reduce((a, b) => a + b, 0), l = -rets.filter((x) => x < 0).reduce((a, b) => a + b, 0); return l ? g / l : Infinity; },
    omega(rets, L = 0) { const up = rets.reduce((a, r) => a + Math.max(r - L, 0), 0), dn = rets.reduce((a, r) => a + Math.max(L - r, 0), 0); return dn ? up / dn : Infinity; },
    alphaBeta(rp, rm, rf = 0) { const x = rm.map((v) => v - rf), y = rp.map((v) => v - rf); const mx = mean(x), my = mean(y); let c = 0, v = 0; x.forEach((xi, i) => { c += (xi - mx) * (y[i] - my); v += (xi - mx) ** 2; }); const beta = c / v; return { alpha: my - beta * mx, beta }; },
    zscore(x, priorMean, priorSd) { return (x - priorMean) / priorSd; },
    ouHalfLife(k) { return Math.log(2) / k; },
    yoy(x, x12) { return 100 * (x / x12 - 1); },
    sahm(u3avg, prior12min) { return u3avg - prior12min >= 0.5; },
    vixDailyMove(spot, vix) { return (spot * (vix / 100)) / Math.sqrt(252); },
    sentimentSpread(bull, bear) { return 100 * (bull - bear); },
    tone(pos, neg, total) { return (pos - neg) / total; },
    putCall(putVol, callVol) { return putVol / callVol; },
    bayes(pSgivenU, pU, pS) { return (pSgivenU * pU) / pS; },
    chain(pA, pBgivenA) { return pA * pBgivenA; },
    permutations(n, k, repeat = false) { return repeat ? n ** k : fact(n) / fact(n - k); },
    combinations(n, k) { return fact(n) / (fact(k) * fact(n - k)); },
    bonferroni(alpha, m) { return alpha / m; },
    bsm({ S, K, T, r = 0, q = 0, sigma }) {
      const sT = sigma * Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / sT, d2 = d1 - sT;
      const eq = Math.exp(-q * T), er = Math.exp(-r * T), Nd1 = cdf(d1), Nd2 = cdf(d2), n1 = pdf(d1);
      const call = S * eq * Nd1 - K * er * Nd2, put = K * er * cdf(-d2) - S * eq * cdf(-d1);
      const A = (-S * eq * n1 * sigma) / (2 * Math.sqrt(T));
      const g = {
        d1, d2, call, put,
        deltaCall: eq * Nd1, deltaPut: eq * (Nd1 - 1),
        gamma: (eq * n1) / (S * sT),
        vega: (S * eq * n1 * Math.sqrt(T)) / 100,                        // per 1 vol point
        thetaCall: (A - r * K * er * Nd2 + q * S * eq * Nd1) / 365,      // per calendar day
        thetaPut: (A + r * K * er * cdf(-d2) - q * S * eq * cdf(-d1)) / 365,
        rhoCall: (K * T * er * Nd2) / 100, rhoPut: (-K * T * er * cdf(-d2)) / 100,
        vanna: (-eq * n1 * d2) / sigma,                                 // dDelta/dSigma (per 1.00 vol)
        volga: (S * eq * n1 * Math.sqrt(T) * d1 * d2) / sigma,          // dVega/dSigma (raw)
        charmCall: -eq * n1 * (2 * (r - q) * T - d2 * sT) / (2 * T * sT) + q * eq * Nd1, // dDelta/dt (annual)
        probITM_riskNeutral: Nd2,
      };
      g.lambdaCall = (S / call) * g.deltaCall; g.lambdaPut = (S / put) * g.deltaPut;
      g.note = 'Delta is a hedge ratio, not a win probability. N(d2) is risk-neutral, not real-world.';
      return g;
    },
    black76({ F, K, T, r = 0, sigma }) { const sT = sigma * Math.sqrt(T), d1 = (Math.log(F / K) + sigma * sigma * T / 2) / sT, d2 = d1 - sT, df = Math.exp(-r * T); return { call: df * (F * cdf(d1) - K * cdf(d2)), put: df * (K * cdf(-d2) - F * cdf(-d1)) }; },
    impliedVol({ price, S, K, T, r = 0, q = 0, type = 'call' }) {
      let lo = 1e-4, hi = 5; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2, p = f.bsm({ S, K, T, r, q, sigma: mid })[type]; if (p > price) hi = mid; else lo = mid; } return (lo + hi) / 2;
    },
    pnlApprox({ delta = 0, gamma = 0, vega = 0, theta = 0, rho = 0, dS = 0, dVolPts = 0, dDays = 0, dRatePts = 0 }) { return delta * dS + 0.5 * gamma * dS * dS + vega * dVolPts + theta * dDays + rho * dRatePts; },
    gex1pct(positions, S) { // positions: [{gamma, oi, sign:+1 dealer long / -1 dealer short, multiplier=100}]
      return positions.reduce((a, p) => a + p.sign * p.gamma * p.oi * (p.multiplier || 100) * S * S * 0.01, 0);
    },
    cdf, pdf,
  };

  function grade(later, early, ci) {
    if (!later || later.n === 0) return ['GREY', 'No events: not estimable.'];
    if (later.n < 30) return ['GREY', `Sparse (n=${later.n} < 30): an anecdote, not a rate.`];
    const eOk = early && early.n >= 30 && early.lift != null && early.lift > 0;
    if (later.lift > 0 && later.net > 0 && eOk && ci && ci[0] > 0) return ['GREEN', 'Positive lift and net in both eras with an interval above zero.'];
    if (later.lift > 0 && later.net > 0 && eOk) return ['AMBER', 'Beat its matched baseline in both eras with positive mean net, but uncertainty spans zero: a lean, not an edge.'];
    const why = [];
    if (later.lift <= 0) why.push('did not beat comparable days (later sample)');
    if (later.net <= 0) why.push('mean net return <= 0 after costs');
    if (!eOk) why.push(early && early.n >= 30 ? 'the early-era result went the other way' : 'early era too sparse to confirm');
    return ['RED', 'No tested edge: ' + why.join('; ') + '.'];
  }

  function createAtlas(kb) {
    const rules = kb.rules;
    const byName = {};
    Object.values(rules).forEach((r) => { byName[norm(r.code)] = r.code; byName[norm(r.name)] = r.code; byName[norm(r.code.replace(/^CDL/, ''))] = r.code; });
    const alias = { 'bullishengulfing': 'CDLENGULFING', 'bearishengulfing': 'CDLENGULFING', 'engulfing': 'CDLENGULFING', 'harami': 'CDLHARAMI', 'bullflag': 'BULLFLAG', 'bearflag': 'BEARFLAG', 'cupandhandle': 'CUPHANDLE', 'cuphandle': 'CUPHANDLE', 'invertedcup': 'INVERSECUP', 'inversecupandhandle': 'INVERSECUP', 'failedbearflag': 'TRAPFLAG', 'donchian': 'CHANNEL20', 'channelbreakout': 'CHANNEL20', '20daybreakout': 'CHANNEL20', 'threewhitesoldiers': 'CDL3WHITESOLDIERS', 'kicker': 'CDLKICKING', 'threemethods': 'CDLRISEFALL3METHODS' };
    function norm(s) { return String(s).toLowerCase().replace(/&/g, ' ').replace(/\band\b/g, ' ').replace(/[^a-z0-9]/g, ''); }
    function resolve(q) {
      if (!q) return null; const k = norm(q); if (rules[q]) return q; if (byName[k]) return byName[k]; if (alias[k]) return alias[k];
      const hit = Object.keys(byName).find((n) => n.includes(k) || k.includes(n)); return hit ? byName[hit] : null;
    }
    const chart = (q) => {
      const k = norm(q), exact = kb.charts.find((c) => norm(c.name) === k); if (exact) return exact;
      const hits = kb.charts.filter((c) => norm(c.name).includes(k) || k.includes(norm(c.name)));
      return hits.sort((a, b) => Math.abs(norm(a.name).length - k.length) - Math.abs(norm(b.name).length - k.length))[0] || null;
    };

    // Bin today's context exactly as the study did (p.062): trend = prior close vs prior SMA50;
    // vol = prior ATR14/close vs terciles of the 126 ratios ending t-2.
    function contextFromBars(bars) {
      const C = bars.map((b) => b.C), t = bars.length - 1; if (t < 180) return { error: 'Need ~180 daily bars (50 SMA + 126 ATR history + warm-up).' };
      const sma = f.sma(C, 50), atr = f.atrWilder(bars, 14), ratio = atr.map((a, i) => (a === null ? null : a / C[i]));
      const trend = C[t - 1] >= sma[t - 1] ? 'above' : 'below';
      const hist = ratio.slice(t - 2 - 125, t - 1).filter((x) => x !== null).sort((a, b) => a - b);
      const qt = (p) => { const pos = (hist.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos); return hist[lo] + (hist[hi] - hist[lo]) * (pos - lo); };
      const v = ratio[t - 1], vol = v > qt(2 / 3) ? 'high' : v > qt(1 / 3) ? 'mid' : 'low';
      return { trend, vol, sma50: sma[t - 1], atrPct: v, q1: qt(1 / 3), q2: qt(2 / 3) };
    }

    function lookup({ rule, trend, vol, horizon = 5, era = 'later' } = {}) {
      const code = resolve(rule); if (!code) return { found: false, note: `"${rule}" is not one of the 67 tested rules. Use read() for the chart card (no numeric win rate).` };
      const r = rules[code], h = String(horizon), out = { found: true, code, name: r.name, side: r.side, sideRule: r.side_rule, grade: r.grade, gradeReason: r.grade_reason, pooled: { later: r.pooled.later[h], early: r.pooled.early[h] } };
      if (trend && vol) {
        const key = `${trend}/${VOL_NAMES[vol] || vol}`; out.cellKey = `${key}/${h}`;
        out.cell = { later: r.matrix.later[key] && r.matrix.later[key][h], early: r.matrix.early[key] && r.matrix.early[key][h] };
        const cg = grade(out.cell.later, out.cell.early); out.cellGrade = cg[0]; out.cellGradeReason = cg[1];
        const c = out.cell[era]; if (c && c.n < 30) out.warning = c.n === 0 ? 'No events in this cell.' : `Sparse cell (n=${c.n}).`;
      }
      out.bracket = kb.brackets.find((b) => b.rule === code) || null;
      out.directionSplit = kb.direction_split.filter((d) => d.rule === code);
      return out;
    }

    function vixState(v) { return v < 15 ? 'VIX <15' : v < 25 ? 'VIX 15–25' : 'VIX ≥25'; }
    function aaiiState(spreadPts) { return spreadPts <= -10 ? 'Bears lead ≥10 pp' : spreadPts >= 10 ? 'Bulls lead ≥10 pp' : 'Within 10 pp'; }
    function sentimentLookup({ vix, aaiiSpread, umichTrend, sequence = 'All sessions', sample = 'full' } = {}) {
      const res = [];
      const pick = (state, seqs) => { const seq = seqs.find((s) => norm(s) === norm(sequence)) || seqs[0]; const row = kb.sentiment.find((x) => x.state === state && x.sequence === seq && x.sample === sample); if (row) res.push(row); };
      if (vix != null) pick(vixState(vix), ['All sessions', 'Three lower closes', 'Down → bull engulf', 'Floor break → reclaim']);
      if (aaiiSpread != null) pick(aaiiState(aaiiSpread), ['All reports', 'Three lower closes', 'Latest close rose']);
      if (umichTrend) pick(umichTrend === 'rising' ? 'Survey rising' : 'Survey falling', ['All months', 'Two falling months', 'Two rising months']);
      return res;
    }

    // Honest combination: overlapping detectors collapse to one event; untested joints get no number.
    function combine(signals, ctx = {}) {
      const codes = [...new Set(signals.map(resolve).filter(Boolean))], unknown = signals.filter((s) => !resolve(s));
      const groups = []; const used = new Set();
      codes.forEach((c) => { if (used.has(c)) return; const fam = OVERLAP_FAMILIES.find((F) => F.includes(c)); const g = fam ? codes.filter((x) => fam.includes(x)) : [c]; g.forEach((x) => used.add(x)); groups.push(g); });
      const parts = groups.map((g) => {
        const best = g.map((c) => lookup({ rule: c, trend: ctx.trend, vol: ctx.vol, horizon: ctx.horizon || 5 })).sort((a, b) => ((b.cell && b.cell.later && b.cell.later.n) || b.pooled.later.n) - ((a.cell && a.cell.later && a.cell.later.n) || a.pooled.later.n))[0];
        return { overlapping: g.map((c) => rules[c].name), counted_as: 'one event', reference: best };
      });
      const sides = new Set(parts.map((p) => p.reference.side).filter((s) => s !== 'long+short'));
      const tested = [];
      const has = (c) => codes.includes(c);
      if (has('CDLENGULFING') && signals.some((s) => /macd/i.test(s))) tested.push(...kb.macd.filter((m) => m.rule.startsWith('Engulf')));
      return {
        independentSignals: parts.length, parts, unknown,
        conflict: sides.size > 1 ? 'Signals point opposite ways; the atlas has no tested rule for this mix.' : null,
        testedJoint: tested.length ? tested : null,
        joint: tested.length ? 'A tested compound exists (see testedJoint).' : (parts.length > 1 ? 'UNTESTED joint: no win rate exists for this combination. Do not multiply or average the parts. Use P(A then B) = P(A) x P(B|A) only with a measured conditional.' : 'Single independent signal.'),
      };
    }

    function verdictFromGrade(g, reason, extraCaution) {
      const tail = extraCaution ? ' ' + extraCaution : '';
      if (g === 'GREEN') return { light: 'GREEN', grade: g, text: reason + tail };
      if (g === 'AMBER') return { light: 'AMBER', grade: g, text: reason + tail };
      if (g === 'GREY') return { light: 'AMBER', grade: g, text: (reason || 'Not in the tested set.') + ' Treat as untested.' + tail };
      return { light: 'RED', grade: g, text: reason + tail };
    }

    function treeFor(code) { // outcome branches with measured shares where the atlas has them
      const b = kb.brackets.find((x) => x.rule === code); if (!b) return null;
      return { exit: '1 ATR stop / 2 ATR target, 20 sessions', target_first: b.target / b.n, stop_first: b.stop / b.n, ambiguous: b.ambiguous / b.n, timeout: b.timeout / b.n, net_win_stop_first: b.win_rate, matched_base: b.base_rate };
    }

    // Full six-hat read for one scenario.
    function read({ rule, bars, trend, vol, horizon = 5, vix, aaiiSpread, sequence, instrument = 'daily US stock', intraday = false, options = false } = {}) {
      let ctx = { trend, vol }; if (bars && (!trend || !vol)) ctx = contextFromBars(bars);
      const L = lookup({ rule, trend: ctx.trend, vol: ctx.vol, horizon });
      const card = L.found ? null : chart(rule);
      const sent = sentimentLookup({ vix, aaiiSpread, sequence: sequence || undefined });
      const pct = (x) => (x == null ? '—' : (100 * x).toFixed(1) + '%');
      const pct2 = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (100 * x).toFixed(2) + '%');
      const pp = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (100 * x).toFixed(2) + ' pp');
      const transfer = [];
      if (intraday) transfer.push('The atlas tested DAILY bars; on intraday charts the shape logic carries over but the percentages do not.');
      if (options) transfer.push('An options trade wins on premium, not direction: theta, IV and strike choice decide the profit rate. Delta is not a win probability.');
      if (!/stock|equity|spy/i.test(instrument)) transfer.push(`Stock-sample numbers were not tested on ${instrument}.`);
      const hats = {};
      if (L.found) {
        const p = L.pooled.later, c = L.cell && L.cell.later;
        hats.white = `${L.name} (${L.side}). Pooled later sample, ${horizon} sessions: ${pct(p.win)} win vs ${pct(p.base)} base (${pp(p.lift)}), mean net ${pct2(p.net)}, n=${p.n}${p.ci ? `, 95% lift ${pp(p.ci[0])} to ${pp(p.ci[1])}` : ''}.` + (c ? ` Your cell ${L.cellKey}: ${pct(c.win)} vs ${pct(c.base)} (n=${c.n}).` : '');
        const r = rules[L.code]; hats.yellow = (r.confirm_fail || '') + (L.grade === 'AMBER' ? ' Evidence: a lean in both eras.' : '');
        hats.black = [L.gradeReason, L.warning, ...transfer, 'Overlapping signals are not extra confirmation; intervals are not multiple-test adjusted.'].filter(Boolean).join(' ');
        const t = treeFor(L.code); hats.green = t ? `Bracket view (1 ATR stop / 2 ATR target): target first ${pct(t.target_first)}, stop first ${pct(t.stop_first)}, timeout ${pct(t.timeout)}; net win ${pct(t.net_win_stop_first)} vs base ${pct(t.matched_base)}. Same setup, different exit, different win rate.` : 'Branches: confirmation -> objective; failure -> invalidation; no resolution -> time exit. No measured branch shares for this rule.';
      } else if (card) {
        hats.white = `${card.name} (${card.family}, ${card.bias}). ${card.shape} No numeric win rate in the atlas${card.proxy ? '' : ' (discretionary picture)'}.`;
        hats.yellow = `Confirmation: ${card.confirm}${card.measure ? ' Objective: ' + card.measure : ''}`;
        hats.black = `Failure path: ${card.fail} ${transfer.join(' ')}`.trim();
        hats.green = 'Branches: confirmation, failure, chop. Price both before entry.';
      } else {
        hats.white = `"${rule}" is not in the atlas.`;
      }
      hats.red = sent.length ? sent.map((s) => `${s.state} / ${s.sequence}: SPY 5-session win ${pct(s.win_rate)} (n=${s.n}); sentiment improved ${pct(s.sentiment_up_rate)}.`).join(' ') + ' Joint with the pattern: untested.' : 'No crowd reading supplied (VIX / AAII / survey).';
      hats.blue = 'Before the next bar: name instrument, bar length, session, larger trend. Write trigger, invalidation, objective, time exit, size from the risk budget (stop distance + costs), gap stress, and a no-trade condition. Journal before and after.';
      const useCell = L.found && L.cellGrade;
      const v = verdictFromGrade(L.found ? (useCell ? L.cellGrade : L.grade) : 'GREY', L.found ? (useCell ? `Cell ${L.cellKey}: ${L.cellGradeReason}` : L.gradeReason) : (card ? 'Chart picture with no numeric test in the atlas.' : null), transfer.join(' '));
      return { verdict: v, context: ctx, lookup: L.found ? L : null, chart: card || null, sentiment: sent, hats };
    }

    function enumerate() { // every tested permutation in the atlas
      const out = [];
      Object.values(rules).forEach((r) => ['early', 'later'].forEach((era) => Object.entries(r.matrix[era]).forEach(([key, hz]) => Object.entries(hz).forEach(([h, c]) => { const [trend, vol] = key.split('/'); out.push({ study: 'stock', rule: r.code, name: r.name, era, trend, vol, horizon: +h, ...c, grade: era === 'later' ? r.cell_grades[`${key}/${h}`] : undefined }); }))));
      kb.sentiment.forEach((s) => out.push({ study: 'sentiment', ...s }));
      kb.macd.forEach((m) => out.push({ study: 'macd', ...m }));
      kb.brackets.forEach((b) => out.push({ study: 'bracket', ...b }));
      kb.cross_market.forEach((c) => out.push({ study: 'cross-market', ...c }));
      return out;
    }

    return { kb, resolve, lookup, contextFromBars, sentimentLookup, combine, read, enumerate, vixState, aaiiState, f };
  }
  createAtlas.f = f; createAtlas.grade = grade;
  return createAtlas;
});

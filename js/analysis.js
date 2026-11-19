// INDAI's analysis engine: parses a spoken trade idea, reads the chart (MACD, RSI, divergence,
// EMA clouds, VWAP, trend), the options chain (P/C, premium flow, unusual activity, GEX), the
// option itself (Black-Scholes Greeks, probabilities, Monte Carlo) and scores it RED/AMBER/GREEN.
import { ema, vwap, marketStatus, etParts, chartSession } from './market.js';
import { bs, yearsTo, probAbove, monteCarlo, resolveExpiry, impliedVol, expiryCloseMs } from './options.js';

// ---------------------------------------------------------------- indicators
export function macd(closes, f = 12, s = 26, sig = 9) {
  const ef = ema(closes, f), es = ema(closes, s);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const valid = line.map(v => v ?? 0);
  const signal = ema(valid, sig);
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}
export function rsi(closes, n = 14) {
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
function swings(vals, kind, w = 3) {
  const idx = [];
  for (let i = w; i < vals.length - 1; i++) {
    let ok = true;
    for (let j = Math.max(0, i - w); j <= Math.min(vals.length - 1, i + w); j++) {
      if (j === i) continue;
      if (kind === 'high' ? vals[j] > vals[i] : vals[j] < vals[i]) { ok = false; break; }
    }
    if (ok) idx.push(i);
  }
  return idx;
}
// Regular divergence between price and RSI over the recent window.
export function divergence(bars, rsiVals, lookback = 40) {
  const n = bars.length; if (n < 20) return null;
  const s = Math.max(0, n - lookback);
  const highs = bars.slice(s).map(b => b.h), lows = bars.slice(s).map(b => b.l), rv = rsiVals.slice(s);
  const hi = swings(highs, 'high'), lo = swings(lows, 'low');
  if (hi.length >= 2) {
    const [a, b] = hi.slice(-2);
    if (highs[b] > highs[a] && rv[b] != null && rv[a] != null && rv[b] < rv[a] - 2) return { type: 'bearish', note: 'price made a higher high while RSI made a lower high' };
  }
  if (lo.length >= 2) {
    const [a, b] = lo.slice(-2);
    if (lows[b] < lows[a] && rv[b] != null && rv[a] != null && rv[b] > rv[a] + 2) return { type: 'bullish', note: 'price made a lower low while RSI made a higher low' };
  }
  return null;
}

export function technicals(bars) {
  if (!bars || bars.length < 15) return null;
  const closes = bars.map(b => b.c), n = closes.length, last = closes[n - 1];
  const e5 = ema(closes, 5), e12 = ema(closes, 12), e34 = ema(closes, 34), e50 = ema(closes, 50);
  const vw = vwap(bars);
  const m = macd(closes), r = rsi(closes);
  const h = m.hist, hN = h[n - 1], hP = h[n - 2];
  let cross = null;
  for (let i = n - 1; i > Math.max(1, n - 8); i--) {
    if (h[i] != null && h[i - 1] != null && Math.sign(h[i]) !== Math.sign(h[i - 1])) { cross = { dir: h[i] > 0 ? 'bullish' : 'bearish', barsAgo: n - 1 - i }; break; }
  }
  const slope34 = e34[n - 1] != null && e34[Math.max(0, n - 7)] != null ? (e34[n - 1] - e34[Math.max(0, n - 7)]) / last * 100 : 0;
  const fast = e5[n - 1] >= e12[n - 1] ? 'bullish' : 'bearish';
  const slow = e34[n - 1] != null && e50[n - 1] != null ? (e34[n - 1] >= e50[n - 1] ? 'bullish' : 'bearish') : null;
  const vols = bars.map(b => b.v || 0), avgV = vols.reduce((a, b) => a + b, 0) / n, recV = vols.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const back = Math.min(6, n - 1);
  return {
    last, vwap: vw[n - 1], aboveVwap: last >= vw[n - 1], vwapDistPct: (last / vw[n - 1] - 1) * 100,
    emaFast: fast, emaSlow: slow, trendSlopePct: slope34,
    trend: slope34 > 0.03 && fast === 'bullish' ? 'up' : slope34 < -0.03 && fast === 'bearish' ? 'down' : 'sideways',
    macd: m.line[n - 1], macdSignal: m.signal[n - 1], macdHist: hN, macdRising: hN != null && hP != null && hN > hP, macdCross: cross,
    rsi: r[n - 1], divergence: divergence(bars, r),
    momentumPct: (last / closes[n - 1 - back] - 1) * 100,
    volumeRatio: avgV ? recV / avgV : 1,
    dayHigh: Math.max(...bars.map(b => b.h)), dayLow: Math.min(...bars.map(b => b.l)),
  };
}

export function realizedVol(daily, n = 20) {
  if (!daily || daily.length < n + 1) return null;
  const c = daily.slice(-(n + 1)).map(d => d[4]);
  const rets = c.slice(1).map((v, i) => Math.log(v / c[i]));
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}

// ---------------------------------------------------------------- idea parsing
const NAME_TO_SYM = { tesla: 'TSLA', amazon: 'AMZN', microsoft: 'MSFT', nvidia: 'NVDA', apple: 'AAPL', meta: 'META', google: 'GOOGL', netflix: 'NFLX', 'the spy': 'SPY', spy: 'SPY', spiders: 'SPY', cues: 'QQQ', queues: 'QQQ', 'triple q': 'QQQ', 'q q q': 'QQQ', qqq: 'QQQ', nasdaq: 'QQQ', iwm: 'IWM', 'i w m': 'IWM', russell: 'IWM', 'small caps': 'IWM', amd: 'AMD', palantir: 'PLTR', coinbase: 'COIN' };
const NOT_TICKERS = new Set(['I', 'A', 'AT', 'THE', 'TO', 'OF', 'ON', 'IN', 'AND', 'FOR', 'IS', 'IT', 'BE', 'MY', 'WANT', 'TAKE', 'BUY', 'SELL', 'CALL', 'CALLS', 'PUT', 'PUTS', 'HEY', 'DTE', 'ET', 'AM', 'PM', 'OK', 'SO', 'GO', 'ME', 'UP', 'DO', 'AN', 'OR', 'IF', 'WE', 'US', 'BY', 'NO', 'STRIKE', 'PRICE', 'TODAY', 'INDAI', 'INDY', 'ANDY', 'INDIA', 'LONG', 'SHORT', 'THIS', 'NEXT', 'WEEK']);

export function stripWake(text) {
  return text.replace(/^\s*(hey|hi|okay|ok|yo)?[\s,]*(in ?dai|indy|indie|india|in die|andy|endai|inday|in day|en die|indai)[\s,.:!]*/i, '').trim();
}

export function parseIdea(raw, { symbols = [], spotOf = () => null } = {}) {
  const text = ' ' + raw.toLowerCase().replace(/[^a-z0-9.$/ ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const joined = text.replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');
  const idea = { raw };
  if (/\bputs?\b|\bp\b(?= )/.test(text) && !/\bcalls?\b/.test(text)) idea.type = 'P';
  else if (/\bcalls?\b/.test(text)) idea.type = 'C';
  else if (/\b(bearish|short it|downside)\b/.test(text)) idea.type = 'P';
  else if (/\b(bullish|upside)\b/.test(text)) idea.type = 'C';
  idea.side = /\b(sell|selling|write|writing|short) (the )?(calls?|puts?)\b/.test(text) ? -1 : 1;
  // ticker
  for (const [k, v] of Object.entries(NAME_TO_SYM).sort((a, b) => b[0].length - a[0].length)) if (joined.includes(' ' + k + ' ')) { idea.sym = v; break; }
  if (!idea.sym) {
    const upperWords = raw.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
    idea.sym = upperWords.find(w => symbols.includes(w)) || upperWords.find(w => /^[A-Z]{2,5}$/.test(w) && !NOT_TICKERS.has(w) && raw.includes(w));
  }
  // numbers
  const qty = text.match(/\b(\d{1,3}) (contracts?|lots?|of them)\b/);
  if (qty) idea.qty = Number(qty[1]);
  const spot = idea.sym ? spotOf(idea.sym) : null;
  const nums = [...text.matchAll(/\$?(\d{1,5}(?:\.\d{1,2})?)/g)].map(m => ({ v: Number(m[1]), i: m.index }));
  const strikeHint = text.match(/(?:strike|struck|strikes)(?: price)?(?: of| at| is)? \$?(\d{1,5}(?:\.\d+)?)/) || text.match(/\$?(\d{1,5}(?:\.\d+)?) ?(?:strike|calls?|puts?|c|p)\b/) || text.match(/\bat (?:the )?\$?(\d{2,5}(?:\.\d+)?)\b/);
  if (strikeHint) idea.strike = Number(strikeHint[1]);
  if (spot) {
    const plausible = nums.filter(n => n.v > spot * 0.6 && n.v < spot * 1.4);
    if (!idea.strike || idea.strike < spot * 0.6 || idea.strike > spot * 1.4) idea.strike = plausible.length ? plausible[0].v : undefined;
    const prem = text.match(/\b(?:for|paying|pay|premium of|premium|cost|at) \$?(\d{1,3}\.\d{1,2})\b/);
    if (prem && Number(prem[1]) < spot * 0.2) idea.premium = Number(prem[1]);
  }
  idea.expiry = resolveExpiry(text) || null;
  idea.expiryWords = idea.expiry ? null : 'nearest';
  return idea;
}
export function looksLikeTradeIdea(raw) {
  const t = raw.toLowerCase();
  return /\b(calls?|puts?)\b/.test(t) && (/\d/.test(t) || /\b(today|tomorrow|friday|expir|strike|dte)\b/.test(t));
}

// ---------------------------------------------------------------- scoring
export function scoreTrade(x) {
  // x: { idea, spot, contract, quant, tech, chain, levels, leadlag, news, risk, now }
  const f = [];
  const add = (name, weight, s, note) => { if (s == null || !isFinite(s)) return; f.push({ name, weight, s: Math.max(-1, Math.min(1, s)), note }); };
  const dir = x.idea.type === 'C' ? 1 : -1;
  const side = x.idea.side || 1;
  const want = dir * side; // +1 wants price up
  const t = x.tech;
  if (t) {
    const trendS = (t.trend === 'up' ? 1 : t.trend === 'down' ? -1 : 0) * 0.5 + (t.emaFast === 'bullish' ? 0.25 : -0.25) + (t.emaSlow === 'bullish' ? 0.15 : t.emaSlow ? -0.15 : 0) + (t.aboveVwap ? 0.2 : -0.2);
    add('Trend & EMA clouds', 22, want * trendS, `${t.trend} trend, fast cloud ${t.emaFast}${t.emaSlow ? `, slow cloud ${t.emaSlow}` : ''}, price ${t.aboveVwap ? 'above' : 'below'} VWAP (${t.vwapDistPct >= 0 ? '+' : ''}${t.vwapDistPct.toFixed(2)}%)`);
    let mom = (t.macdHist > 0 ? 0.5 : -0.5) + (t.macdRising ? 0.3 : -0.3);
    if (t.macdCross && t.macdCross.barsAgo <= 3) mom += t.macdCross.dir === 'bullish' ? 0.3 : -0.3;
    if (t.rsi != null) { if (t.rsi > 72) mom -= 0.35; else if (t.rsi < 28) mom += 0.35; }
    add('Momentum (MACD/RSI)', 12, want * mom, `MACD histogram ${t.macdHist > 0 ? 'positive' : 'negative'} and ${t.macdRising ? 'rising' : 'falling'}${t.macdCross && t.macdCross.barsAgo <= 3 ? `, fresh ${t.macdCross.dir} cross` : ''}, RSI ${t.rsi?.toFixed(0)}`);
    if (t.divergence) add('Divergence', 8, want * (t.divergence.type === 'bullish' ? 1 : -1), `${t.divergence.type} divergence: ${t.divergence.note}`);
  }
  const lv = x.levels, S = x.spot, em = x.quant?.expectedMove;
  if (lv && S) {
    let s = 0; const notes = [];
    if (want > 0 && lv.cw) { const room = lv.cw - S; s += room > (em || S * 0.005) ? 0.4 : room > 0 ? -0.1 : -0.3; notes.push(`call wall ${lv.cw} is ${room >= 0 ? '+' : ''}${(room / S * 100).toFixed(2)}% away`); if (x.idea.strike > lv.cw) { s -= 0.4; notes.push('strike sits beyond the call wall'); } }
    if (want < 0 && lv.pw) { const room = S - lv.pw; s += room > (em || S * 0.005) ? 0.4 : room > 0 ? -0.1 : -0.3; notes.push(`put wall ${lv.pw} is ${(-room / S * 100).toFixed(2)}% away`); if (x.idea.strike < lv.pw) { s -= 0.4; notes.push('strike sits beyond the put wall'); } }
    if (lv.zg) { const above = S >= lv.zg; s += (above ? -0.15 : 0.25) * (side > 0 ? 1 : -1); notes.push(`${above ? 'positive' : 'negative'} gamma (flip ${lv.zg}) favours ${above ? 'range/pinning' : 'bigger moves'}`); }
    add('GEX levels', 15, s, notes.join('; '));
  }
  const c = x.chain;
  if (c) {
    const st = c.expiryStats?.callVol ? c.expiryStats : c.all;
    if (st && st.callPremium + st.putPremium > 0) {
      const skew = (st.callPremium - st.putPremium) / (st.callPremium + st.putPremium);
      add('Options flow', 10, want * skew * 1.6, `call premium ${fmtMoney(st.callPremium)} vs put ${fmtMoney(st.putPremium)}, P/C volume ${st.pcVolume ?? '—'}`);
    }
    const near = (c.unusual || []).filter(u => Math.abs(u.strike - x.idea.strike) / S < 0.012);
    if (near.length) {
      const sameSide = near.filter(u => u.type === x.idea.type).reduce((a, u) => a + u.premium, 0), other = near.reduce((a, u) => a + u.premium, 0) - sameSide;
      add('Unusual activity near strike', 5, side * (sameSide - other) / (sameSide + other || 1), `${near.length} unusual prints near ${x.idea.strike}`);
    }
  }
  const q = x.quant;
  if (q) {
    const pop = q.popExpiry ?? 0, t50 = q.mc?.probTouch50 ?? null;
    let s = side > 0 ? (pop - 0.3) * 2.2 + (t50 != null ? (t50 - 0.35) * 1.5 : 0) : (pop - 0.6) * 3;
    add('Odds (Black-Scholes & Monte Carlo)', 15, s, `chance of profit at expiry ${(pop * 100).toFixed(0)}%${t50 != null ? `, chance to hit +50% before expiry ${(t50 * 100).toFixed(0)}%` : ''}, needs a ${q.moveNeededSigma?.toFixed(2)}σ move`);
    if (q.hoursLeft != null && side > 0) {
      let s2 = 0;
      if (q.hoursLeft < 2.5 && Math.abs(q.delta) < 0.35) s2 = -0.8; else if (q.hoursLeft < 4 && Math.abs(q.delta) < 0.25) s2 = -0.5; else if (q.thetaPctPerHour > 6) s2 = -0.4; else s2 = 0.1;
      add('Time decay', 7, s2, `${q.hoursLeft.toFixed(1)} trading hours left, theta ≈ ${q.thetaPctPerHour?.toFixed(1)}% of premium per hour`);
    }
  }
  const k = x.contract;
  if (k && k.ask > 0 && k.bid >= 0) {
    const spr = (k.ask - k.bid) / ((k.ask + k.bid) / 2 || 1) * 100;
    add('Liquidity', 5, spr < 3 ? 0.6 : spr < 8 ? 0.2 : spr < 15 ? -0.3 : -0.8, `bid/ask spread ${spr.toFixed(1)}%, volume ${k.vol}, open interest ${k.oi}`);
  }
  if (x.leadlag && x.idea.sym && x.leadlag[x.idea.sym] != null && x.leadlag.SPY != null && x.idea.sym !== 'SPY') {
    const rel = x.leadlag[x.idea.sym] - x.leadlag.SPY;
    add('Relative strength vs SPY', 5, want * Math.max(-1, Math.min(1, rel / 0.5)), `${x.idea.sym} ${rel >= 0 ? 'outperforming' : 'lagging'} SPY by ${Math.abs(rel).toFixed(2)}% today`);
  }
  if (x.news && x.news.score != null) add('Headline sentiment', 5, want * x.news.score, x.news.note);
  const totalW = f.reduce((a, b) => a + b.weight, 0) || 1;
  let score = Math.round(50 + 50 * f.reduce((a, b) => a + b.weight * b.s, 0) / totalW);
  let rag = score >= 62 ? 'GREEN' : score >= 45 ? 'AMBER' : 'RED';
  let gate = null;
  if (x.risk?.state === 'tripped') { rag = 'RED'; gate = 'Your risk breaker is tripped for today.'; }
  else if (x.risk?.state === 'cooldown') { rag = 'RED'; gate = 'You are on a cooldown after losses in a row.'; }
  const pros = f.filter(a => a.s > 0.15).sort((a, b) => b.weight * b.s - a.weight * a.s);
  const cons = f.filter(a => a.s < -0.15).sort((a, b) => a.weight * a.s - b.weight * b.s);
  return { score, rag, gate, factors: f, pros, cons };
}
function fmtMoney(v) { if (!v) return '$0'; const a = Math.abs(v); return (v < 0 ? '-' : '') + (a >= 1e9 ? '$' + (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? '$' + (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? '$' + (a / 1e3).toFixed(0) + 'K' : '$' + a.toFixed(0)); }

// Simple finance headline sentiment (used when the AI research key isn't set).
const POS = ['beat', 'beats', 'surge', 'surges', 'rally', 'rallies', 'jumps', 'soar', 'soars', 'record', 'upgrade', 'upgraded', 'strong', 'gains', 'rises', 'climbs', 'bullish', 'optimism', 'raises', 'outperform', 'boost', 'rebound', 'tops'];
const NEG = ['miss', 'misses', 'plunge', 'plunges', 'falls', 'drops', 'slump', 'tumbles', 'downgrade', 'downgraded', 'weak', 'losses', 'bearish', 'fears', 'cuts', 'probe', 'lawsuit', 'selloff', 'sell-off', 'slides', 'warning', 'recession', 'inflation', 'underwater', 'crash'];
export function headlineSentiment(items = []) {
  let s = 0, n = 0;
  const scored = items.slice(0, 12).map(it => {
    const t = it.title.toLowerCase(); let v = 0;
    for (const w of POS) if (t.includes(w)) v += 1;
    for (const w of NEG) if (t.includes(w)) v -= 1;
    if (v) { s += Math.sign(v); n++; }
    return { ...it, sentiment: v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral' };
  });
  return { score: n ? s / Math.max(n, 3) : 0, items: scored, note: n ? `${scored.filter(i => i.sentiment === 'positive').length} positive / ${scored.filter(i => i.sentiment === 'negative').length} negative of ${scored.length} recent headlines` : 'headlines look neutral' };
}

// ---------------------------------------------------------------- quant read of one option
export function quantRead({ spot, strike, type, side = 1, expiry, contract, ivFallback, r = 0.04, now = Date.now() }) {
  const T = yearsTo(expiry, now);
  const mid = contract && contract.mid > 0 ? contract.mid : null;
  let iv = contract && contract.iv > 0.01 ? contract.iv : null;
  if (!iv && mid) iv = impliedVol(mid, spot, strike, T, r, type);
  if (!iv) iv = ivFallback || 0.25;
  const b = bs(spot, strike, T, r, iv, type);
  const entry = mid || b.price;
  const be = type === 'C' ? strike + entry : strike - entry;
  const sdMove = spot * iv * Math.sqrt(Math.max(T, 1e-6));
  const pAbove = probAbove(spot, be, T, r, iv);
  const popExpiry = side > 0 ? (type === 'C' ? pAbove : 1 - pAbove) : (type === 'C' ? 1 - pAbove : pAbove);
  const pAboveK = probAbove(spot, strike, T, r, iv);
  const itm = type === 'C' ? pAboveK : 1 - pAboveK;
  const close = expiryCloseMs(expiry);
  const hoursLeft = Math.max(0, tradingHoursBetween(now, close));
  const mc = monteCarlo({ S: spot, K: strike, exp: expiry, type, side, entry, iv, r, now });
  return {
    T, iv, entry, fair: b.price, delta: b.delta, gamma: b.gamma, theta: b.theta, vega: b.vega,
    breakeven: be, expectedMove: sdMove, moveNeededSigma: Math.abs(be - spot) / (sdMove || 1),
    popExpiry, probITM: itm, probTouch: itm >= 0.5 ? 1 : Math.min(1, 2 * itm),
    hoursLeft, thetaPctPerHour: b.price > 0 ? (b.price - bs(spot, strike, Math.max(0, T - 1 / 8760), r, iv, type).price) / b.price * 100 : null,
    mc,
  };
}
function tradingHoursBetween(a, b) {
  // rough: count only regular-session hours between now and the expiry close
  let h = 0; const step = 15 * 60e3;
  for (let t = a; t < b && h < 400; t += step) {
    const p = etParts(t);
    if (p.dow > 0 && p.dow < 6) { const m = p.h * 60 + p.mi; if (m >= 570 && m < 960) h += 0.25; }
  }
  return h;
}

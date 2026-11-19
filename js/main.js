import * as THREE from 'three';
import { loadSettings, saveSettings, loadDay, saveDay, freshDay, todayET, loadLayout, saveLayout, clearLayout, parseLevels } from './store.js';
import { MarketFeed, LEADLAG } from './feeds.js';
import { marketStatus, fmtDuration, etParts, INTERVAL_LABEL, isTradingDay, nextTradingDay, prevTradingDay, etToMs } from './market.js';
import { TopBar, Watchlist, MainChart, LeadLag, Levels, RiskBreaker, IndaiPanel, AnalysisPanel, CalcPanel, DeepDivePanel, SummaryPanel, PlanPanel, Dock, nearestLevel } from './panels.js';
import { STRATEGIES, PROFILES, buildPlan, temperature, scanSetups, suggestContract } from './signals.js';
import { Indai } from './indai.js';
import { relay } from './relay.js';
import { bs, yearsTo } from './options.js';
import { handPose, GestureTracker } from './gestures.js';
import { fmtPrice, fmtMoney } from './hud.js';
import { initUI } from './ui.js';

const STEPS = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const R = 1.4;            // arc radius (m)
const RF = 1.2;           // focus cards float a little closer
const BASE_Y = -0.06;     // chart centre relative to eye height
const LAYOUT = {
  top: [0, 0.47], chart: [0, 0], dock: [0, -0.485],
  watch: [-40, 0], risk: [40, 0],
  leadlag: [-72, 0.19], levels: [-72, -0.215], indai: [72, 0],
};
const FOCUS = ['analysis', 'calc', 'deep', 'summary', 'plan'];
const COLLAPSIBLE = ['watch', 'chart', 'risk', 'leadlag', 'levels', 'indai'];
const ETFS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'XLF', 'XLE', 'SMH', 'TLT', 'GLD']);

// ------------------------------------------------------------------ app state
const app = {
  settings: loadSettings(),
  day: loadDay(),
  panels: {},
  inXR: false,
  xrMode: null,
  dirty: new Set(),
  focus: null,
  consolidated: false,
  analysis: null,
  calc: null,
  deep: null,
  morningGex: {},
  liveGex: {},
  tvLevels: {},
  tvAlerts: [],
  signals: [],
  temp: null,
  markDirty(id) { if (id === 'all') Object.keys(this.panels).forEach(k => this.dirty.add(k)); else this.dirty.add(id); },
};
app.levels = parseLevels(app.settings.levelsText);
app.feed = new MarketFeed(app.settings);
app.indai = new Indai(app);
app.saveSettings = () => saveSettings(app.settings);
const say = (...a) => app.indai.say(...a);

// ------------------------------------------------------------------ GEX levels
// Priority: levels you pasted > this morning's GEX refresh > live from the options chain > an older morning refresh > demo.
const num = (v) => v == null || v === '' ? null : Number(v);
function fromMorning(a, n, source) {
  return {
    cw: num(a.call_wall), pw: num(a.put_wall), zg: num(a.gamma_flip), cw2: num(a.call_wall2), pw2: num(a.put_wall2),
    near: n ? { expiry: n.expiry, cw: num(n.call_wall), pw: num(n.put_wall), zg: num(n.gamma_flip) } : null,
    source, asof: a.asof_et, netGexM: num(a.net_gex_m),
  };
}
function fromLive(c) {
  const g = c.gex || {}, n = c.gexNear;
  return {
    cw: g.callWall ?? null, pw: g.putWall ?? null, zg: g.zeroGamma ?? null, cw2: g.callWall2 ?? null, pw2: g.putWall2 ?? null, regime: g.regime,
    near: n ? { expiry: n.expiry, cw: n.callWall ?? null, pw: n.putWall ?? null, zg: n.zeroGamma ?? null } : null,
    source: 'live', asof: c.timestamp,
  };
}
app.levelsFor = (sym) => {
  const m = app.morningGex[sym], live = app.liveGex[sym];
  if (app.levels[sym]) return { ...app.levels[sym], source: 'manual', near: m?.N ? fromMorning(m.N, m.N, 'x').near : live ? fromLive(live).near : null };
  const tv = app.tvLevels[sym];
  if (tv && tv.day === todayET() && (tv.cw != null || tv.pw != null)) {
    const base = m?.A ? fromMorning(m.A, m.N, 'x') : live ? fromLive(live) : {};
    return { ...base, ...tv, source: 'tradingview', asof: tv.asof };
  }
  if (m?.A && String(m.A.asof_et || '').slice(0, 10) === todayET()) return fromMorning(m.A, m.N, 'morning');
  if (live?.gex && (live.gex.callWall || live.gex.putWall)) return fromLive(live);
  if (m?.A) return fromMorning(m.A, m.N, 'morning-stale');
  if (app.feed.status.mode === 'demo' && app.feed.demoLevels[sym]) return { ...app.feed.demoLevels[sym], source: 'demo' };
  return null;
};
app.noteChainGex = (sym, chain) => {
  if (!chain || !chain.gex) return;
  app.liveGex[sym] = { gex: chain.gex, gexNear: chain.gexNear, timestamp: chain.timestamp, spot: chain.spot, at: Date.now() };
  ['levels', 'chart', 'watch', 'summary'].forEach(id => app.markDirty(id));
};
async function loadMorningGex() {
  try { app.morningGex = await relay.morningGex(); app.markDirty('all'); } catch (e) { console.warn('morning GEX', e); }
}
// TradingView alerts (webhook -> indai-tv -> here). Your Pine alerts are spoken and can update GEX levels.
let tvSeen = null;
async function pollTradingView() {
  let res;
  try { res = await relay.tvAlerts(); } catch { return; }
  const rows = (res.alerts || []).slice().reverse();   // oldest first
  const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
  const etTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const first = tvSeen === null;
  if (first) tvSeen = 0;
  for (const a of rows) {
    if (a.id <= tvSeen) continue;
    tvSeen = a.id;
    app.tvAlerts.unshift(a); app.tvAlerts.length = Math.min(app.tvAlerts.length, 30);
    if (a.levels && a.ticker) {
      const lv = {}; for (const k of ['cw', 'pw', 'zg', 'cw2', 'pw2']) if (a.levels[k] != null) lv[k] = Number(a.levels[k]);
      app.tvLevels[a.ticker] = { ...(app.tvLevels[a.ticker]?.day === etDay(a.received_at) ? app.tvLevels[a.ticker] : {}), ...lv, day: etDay(a.received_at), asof: `${etDay(a.received_at)} ${etTime(a.received_at)}` };
      ['levels', 'chart', 'watch'].forEach(id => app.markDirty(id));
    }
    const recent = Date.now() - Date.parse(a.received_at) < 3 * 60e3;
    if (first && !recent) continue;
    say(`TradingView${a.ticker ? ` · ${a.ticker}` : ''}: ${a.text}`, 'alert', { speak: recent && app.settings.alerts.tradingview !== false });
    if (a.ticker && app.settings.symbols.includes(a.ticker)) { flash('watch'); if (a.ticker === app.settings.main) flash('chart'); }
  }
  if (first && rows.length) say(`${rows.length} TradingView alert${rows.length === 1 ? '' : 's'} in the last two days. The newest: ${rows[rows.length - 1].text}`, 'info', { speak: false });
}
// Live candles from the INDAI Bridge indicator running in your TradingView account.
let bridgeSince = 0;
async function pollBridge() {
  if (app.feed.status.mode === 'demo') return;
  let j; try { j = await relay.tvBars(bridgeSince); } catch { return; }
  const rows = j.bars || [];
  for (const b of rows) {
    const sym = b.ticker; if (!sym) continue;
    app.feed.applyBridgeBar(sym, { t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v }, b.tf || '1');
    bridgeSince = Math.max(bridgeSince, +b.t - 1);
  }
  if (rows.length && !app.bridgeAnnounced && app.feed.bridgeLive) { app.bridgeAnnounced = true; say('TradingView bridge connected. Charts and setup alerts are now on your live TradingView candles.', 'good', { speak: false }); }
}
app.openTradingView = (sym) => {
  sym = (sym || app.settings.main).toUpperCase();
  if (app.inXR) { say('TradingView opens in the browser, so exit the headset view first, then tap Open in TradingView.', 'info'); return; }
  window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`, '_blank', 'noopener');
};

let gexQueue = [], lastGexSweep = 0;
function gexTick() {
  if (app.feed.status.mode === 'demo') return;
  const now = Date.now();
  if (!gexQueue.length && now - lastGexSweep > (marketStatus().state === 'open' ? 12 * 60e3 : 45 * 60e3)) {
    lastGexSweep = now;
    const syms = [app.settings.main, ...app.settings.symbols.filter(s => s !== app.settings.main)];
    gexQueue = syms.filter(s => { const lv = app.levelsFor(s); return !lv || lv.source === 'live' || lv.source === 'morning-stale' || lv.source === 'demo' || lv.source === 'manual'; });
  }
  const sym = gexQueue.shift();
  if (sym) relay.chain(sym, '', 0.03).then(c => app.noteChainGex(sym, c)).catch(() => {});
}

// ------------------------------------------------------------------ symbols / chart
app.selectSymbol = (sym, { announce = false } = {}) => {
  sym = sym.toUpperCase();
  if (!app.settings.symbols.includes(sym)) {
    if (!/^[A-Z.]{1,6}$/.test(sym)) { say(`I don't know the ticker ${sym}.`); return; }
    app.settings.symbols = [...app.settings.symbols, sym].slice(-12);
    app.settings.main = sym; app.saveSettings();
    say(`Adding ${sym} to your watchlist.`);
    restartFeed();
    return;
  }
  app.settings.main = sym; app.saveSettings();
  app.feed.requestInterval(sym, app.settings.interval);
  if (app.feed.status.mode !== 'demo' && !app.liveGex[sym]) relay.chain(sym, '', 0.03).then(c => app.noteChainGex(sym, c)).catch(() => {});
  app.markDirty('all');
  if (announce) {
    const q = app.feed.quote(sym);
    say(q ? `${sym}, ${fmtPrice(q.last)}, ${q.pct >= 0 ? 'up' : 'down'} ${Math.abs(q.pct).toFixed(2)} percent.` : `${sym} on the main screen.`);
  }
};
app.cycleSymbol = (dir) => {
  const s = app.settings.symbols, i = s.indexOf(app.settings.main);
  app.selectSymbol(s[(i + dir + s.length) % s.length]);
};
app.setTimeframe = (iv) => {
  if (!INTERVAL_LABEL[iv]) return;
  app.settings.interval = iv; app.saveSettings();
  app.feed.requestInterval(app.settings.main, iv);
  app.markDirty('chart');
};
app.toggleShow = (k) => app.setShow(k, !app.settings.show[k]);
app.setShow = (k, v) => { app.settings.show[k] = v; app.saveSettings(); app.markDirty('chart'); say(`${k.toUpperCase()} ${v ? 'on' : 'off'}.`, 'info', { speak: false }); };

// ------------------------------------------------------------------ risk breaker
app.riskState = () => {
  const r = app.settings.risk, d = app.day, now = Date.now();
  const used = Math.max(0, -d.pnl);
  const room = Math.max(0, r.maxDailyLoss - used);
  const state = d.tripped ? 'tripped' : d.cooldownUntil > now ? 'cooldown' : 'armed';
  const riskPerTrade = Math.min(r.account * r.riskPct / 100, room);
  const perContract = Math.max(0.01, d.premium * 100 * (r.stopPct / 100));
  return {
    state, used, room, riskPerTrade,
    contracts: Math.max(0, Math.floor(riskPerTrade / perContract)),
    cooldownLeft: d.cooldownUntil - now,
    checklistScore: d.checklist.filter(Boolean).length,
  };
};
function persistDay() { saveDay(app.day); app.markDirty('risk'); app.markDirty('summary'); }
app.logTrade = (amt) => {
  const d = app.day, r = app.settings.risk;
  d.trades.push({ t: Date.now(), amt });
  d.pnl = +(d.pnl + amt).toFixed(2);
  d.checklist = [false, false, false, false];
  if (amt < 0) d.consec++; else d.consec = 0;
  const pnlTxt = `Day P&L ${d.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(d.pnl))}.`;
  if (!d.tripped && -d.pnl >= r.maxDailyLoss) {
    d.tripped = true;
    say(`Logged a loss of ${fmtMoney(-amt)}. That's your daily loss limit, so the breaker is tripped and you're done for today. Protect the account.`, 'risk');
    flash('risk');
  } else if (amt < 0 && d.consec >= r.maxConsecLosses) {
    d.cooldownUntil = Date.now() + r.cooldownMin * 60e3;
    d.consec = 0;
    say(`Logged a loss of ${fmtMoney(-amt)}. That's ${r.maxConsecLosses} in a row, so take a ${r.cooldownMin} minute cooldown. No revenge trades. ${pnlTxt}`, 'risk');
    flash('risk');
  } else if (amt < 0) {
    const left = r.maxConsecLosses - d.consec;
    say(`Logged a loss of ${fmtMoney(-amt)}. ${pnlTxt} ${left === 1 ? 'One more loss and you go on cooldown.' : ''}`.trim(), 'risk');
  } else {
    say(`Logged a win of ${fmtMoney(amt)}. ${pnlTxt}`, 'good');
  }
  persistDay();
};
app.undoTrade = () => {
  const d = app.day, r = app.settings.risk;
  const t = d.trades.pop();
  if (!t) return;
  d.pnl = +d.trades.reduce((s, x) => s + x.amt, 0).toFixed(2);
  let trailing = 0; for (let i = d.trades.length - 1; i >= 0 && d.trades[i].amt < 0; i--) trailing++;
  d.consec = trailing % r.maxConsecLosses;
  d.tripped = -d.pnl >= r.maxDailyLoss;
  say(`Removed the last trade (${t.amt >= 0 ? '+' : '−'}${fmtMoney(Math.abs(t.amt))}). Day P&L ${fmtMoney(d.pnl, true)}.`, 'info', { speak: false });
  persistDay();
};
app.setStep = (dir) => {
  const i = STEPS.indexOf(app.day.step);
  app.day.step = STEPS[Math.max(0, Math.min(STEPS.length - 1, (i < 0 ? 2 : i) + dir))];
  persistDay();
};
app.setPremium = (dir) => {
  const p = app.day.premium;
  const step = p < 1 ? 0.05 : p < 5 ? 0.1 : 0.25;
  app.day.premium = Math.max(0.05, +(p + dir * step).toFixed(2));
  persistDay();
};
app.toggleCheck = (i) => { app.day.checklist[i] = !app.day.checklist[i]; persistDay(); };
app.resetDay = () => { app.day = freshDay(); persistDay(); say("Today's P&L and breaker were reset.", 'info', { speak: false }); };

// ------------------------------------------------------------------ INDAI actions
app.talk = () => app.indai.talk();
app.toggleMute = (force) => {
  const m = typeof force === 'boolean' ? force : !app.indai.muted;
  app.indai.setMuted(m);
  app.settings.voice = !m; app.saveSettings();
  if (!m) say('Voice on.');
  app.markDirty('dock');
};
app.openDeepDive = (sym) => app.indai.deepDive((sym || app.settings.main).toUpperCase());
app.brief = () => {
  const ms = marketStatus();
  const h = ms.et.h;
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const parts = [];
  if (app.feed.status.mode === 'demo') parts.push('Demo mode, prices are simulated.');
  parts.push(`${greet}, ${app.settings.name}.`);
  if (ms.state === 'open') parts.push(`Market's open, closing in ${fmtDuration(ms.msToNext)}.`);
  else if (ms.state === 'pre') parts.push(`Pre-market. The bell rings in ${fmtDuration(ms.msToNext)}.`);
  else parts.push(`${ms.label.toLowerCase().replace('·', ',')}. Next open in ${fmtDuration(ms.msToNext)}.`);
  const sym = app.settings.main, q = app.feed.quote(sym);
  if (q) {
    parts.push(`${sym} is ${fmtPrice(q.last)}, ${q.pct >= 0 ? 'up' : 'down'} ${Math.abs(q.pct).toFixed(2)} percent.`);
    const lv = app.levelsFor(sym);
    if (lv) {
      const n = nearestLevel(q.last, lv);
      if (n) parts.push(`Nearest level is the ${n.name.toLowerCase()} at ${fmtPrice(n.level)}, ${Math.abs(n.dist).toFixed(2)} percent ${n.dist >= 0 ? 'above' : 'below'}.`);
    }
  }
  const ll = LEADLAG.map(s => ({ s, q: app.feed.quote(s) })).filter(x => x.q).sort((a, b) => b.q.pct - a.q.pct);
  if (ll.length === 3 && ll[0].q.pct - ll[2].q.pct >= 0.15) parts.push(`${ll[0].s} is leading, ${ll[2].s} is lagging.`);
  const rs = app.riskState();
  if (rs.state === 'tripped') parts.push('The risk breaker is tripped. No more trades today.');
  else if (rs.state === 'cooldown') parts.push(`You're on cooldown for ${fmtDuration(rs.cooldownLeft)}.`);
  else parts.push(`Day P&L ${app.day.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(app.day.pnl))}, with ${fmtMoney(rs.room)} of room before the breaker.`);
  if (ms.upcoming.length) parts.push(`Heads up: ${ms.upcoming[0].text} on ${new Date(ms.upcoming[0].date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}.`);
  say(parts.join(' '));
};

// ------------------------------------------------------------------ options calculator state
const fmtYMD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function nearestExpiry() {
  const p = etParts();
  if (isTradingDay(p.y, p.m, p.d) && Date.now() < etToMs(p.y, p.m, p.d, 16, 0)) return fmtYMD(p.y, p.m, p.d);
  return fmtYMD(...nextTradingDay(p.y, p.m, p.d));
}
function strikeStep(sym, spot) { return ETFS.has(sym) ? 1 : spot < 30 ? 0.5 : spot < 100 ? 1 : spot < 300 ? 2.5 : 5; }
function calcSpot() { const c = app.calc; return app.feed.quote(c.sym)?.last ?? c.spot; }
function repriceModel(leg) {
  const c = app.calc, S = calcSpot();
  if (!S) return;
  leg.entry = Math.max(0.01, +bs(S, leg.strike, yearsTo(leg.expiry), app.settings.rate ?? 0.04, leg.iv, leg.type).price.toFixed(2));
}
function calcChanged({ chain = true } = {}) {
  app.markDirty('calc');
  app.onCalcChange?.();
  if (chain) { clearTimeout(calcChanged.t); calcChanged.t = setTimeout(() => app.calcFromChain({ quiet: true }), 700); }
}
app.calcReprice = (leg) => repriceModel(leg);
app.strikeStep = strikeStep;
app.loadCalc = ({ sym, spot, legs, expirations, strikes }) => {
  app.calc = { sym, spot, legs: legs.map(l => ({ ...l })), expirations: expirations || null, strikes: strikes || null, loading: false };
  calcChanged({ chain: false });
};
app.ensureCalc = (sym) => {
  sym = (sym || app.calc?.sym || app.settings.main).toUpperCase();
  if (app.calc && app.calc.sym === sym && app.calc.legs.length) return app.calc;
  const q = app.feed.quote(sym);
  const spot = q?.last ?? 100;
  const step = strikeStep(sym, spot);
  const leg = { type: 'C', side: 1, strike: Math.round(spot / step) * step, qty: 1, entry: 1, iv: q?.iv30 ? q.iv30 / 100 : 0.2, expiry: nearestExpiry() };
  app.calc = { sym, spot, legs: [leg], expirations: null, strikes: null, loading: false };
  repriceModel(leg);
  app.calcFromChain({ quiet: true });
  return app.calc;
};
app.calcSet = (patch) => {
  const c = app.ensureCalc(); const leg = c.legs[0];
  Object.assign(leg, patch);
  if ('type' in patch || 'strike' in patch || 'expiry' in patch) repriceModel(leg);
  calcChanged({ chain: 'type' in patch || 'strike' in patch || 'expiry' in patch });
};
app.calcStep = (field, dir) => {
  const c = app.ensureCalc(); const leg = c.legs[0];
  if (field === 'strike') {
    const ks = (c.strikes || []).filter((k, i, a) => a.indexOf(k) === i).sort((a, b) => a - b);
    const i = ks.indexOf(leg.strike);
    if (i >= 0 && ks[i + dir] != null) leg.strike = ks[i + dir];
    else leg.strike = +(leg.strike + dir * strikeStep(c.sym, calcSpot() || leg.strike)).toFixed(2);
    repriceModel(leg); return calcChanged();
  }
  if (field === 'expiry') {
    const ex = c.expirations;
    const i = ex ? ex.indexOf(leg.expiry) : -1;
    if (ex && i >= 0 && ex[i + dir]) leg.expiry = ex[i + dir];
    else {
      const [y, m, d] = leg.expiry.split('-').map(Number);
      const nd = dir > 0 ? nextTradingDay(y, m, d) : prevTradingDay(y, m, d);
      const cand = fmtYMD(...nd);
      if (cand >= nearestExpiry()) leg.expiry = cand;
    }
    repriceModel(leg); return calcChanged();
  }
  if (field === 'entry') { const p = leg.entry, st = p < 3 ? 0.05 : p < 10 ? 0.1 : 0.25; leg.entry = Math.max(0.01, +(p + dir * st).toFixed(2)); return calcChanged({ chain: false }); }
  if (field === 'iv') { leg.iv = Math.max(0.01, +(leg.iv + dir * 0.01).toFixed(4)); return calcChanged({ chain: false }); }
  if (field === 'qty') { leg.qty = Math.max(1, Math.min(500, leg.qty + dir)); return calcChanged({ chain: false }); }
};
// Fill entry prices and IVs from the live (delayed) chain.
app.calcFromChain = async ({ quiet = false } = {}) => {
  const c = app.calc; if (!c) return;
  c.loading = true; app.markDirty('calc'); app.onCalcChange?.();
  const exps = [...new Set(c.legs.map(l => l.expiry))];
  try {
    for (const exp of exps) {
      const ch = await relay.chain(c.sym, exp, 0.12);
      if (app.calc !== c) return;
      if (!ch || !ch.spot) throw new Error(ch?.error || 'no chain');
      c.expirations = ch.expirations; c.spot = ch.spot;
      c.strikes = [...new Set(ch.chain.map(o => o.strike))].sort((a, b) => a - b);
      for (const leg of c.legs.filter(l => l.expiry === exp)) {
        if (ch.expiry !== exp) leg.expiry = ch.expiry;
        const row = ch.chain.find(o => o.type === leg.type && o.strike === leg.strike);
        if (row) { if (row.mid > 0) leg.entry = row.mid; if (row.iv > 0.01) leg.iv = row.iv; }
      }
    }
    if (!quiet) say(`Calculator updated from the ${c.sym} chain.`, 'info', { speak: false });
  } catch (e) { if (!quiet) say(`Couldn't load the ${c.sym} chain: ${e.message}`, 'info', { speak: false }); }
  c.loading = false; app.markDirty('calc'); app.onCalcChange?.();
};
app.openCalc = () => { if (!app.inXR && app.openCalcModal) { app.ensureCalc(); app.openCalcModal(); } else { app.ensureCalc(); app.openFocus('calc'); } };


// ------------------------------------------------------------------ daily game plan
const roundTo = (v, st) => Math.max(st, Math.round(v / st) * st);
function defaultDraft() {
  const p = app.day.plan;
  if (p) return { capital: p.capital, goal: p.goal, aggr: p.aggr, strategies: [...p.strategies] };
  const cap = app.settings.risk.account || 2000;
  return { capital: cap, goal: roundTo(cap * 0.03, 10), aggr: app.settings.lastAggr || 'balanced', strategies: app.settings.strategies?.length ? [...app.settings.strategies] : Object.keys(STRATEGIES) };
}
app.planDraft = defaultDraft();
app.activePlan = () => app.day.plan ? buildPlan(app.day.plan) : buildPlan({ capital: app.settings.risk.account, goal: 0, aggr: app.settings.lastAggr || 'balanced', strategies: app.settings.strategies?.length ? app.settings.strategies : Object.keys(STRATEGIES) });
app.planSet = (patch) => { Object.assign(app.planDraft, patch); app.markDirty('plan'); };
app.planStep = (field, dir) => {
  const d = app.planDraft;
  if (field === 'capital') { const st = d.capital < 1000 ? 100 : d.capital < 10000 ? 250 : 1000; d.capital = Math.max(100, d.capital + dir * st); }
  if (field === 'goal') { const st = d.goal < 100 ? 10 : d.goal < 1000 ? 25 : 100; d.goal = Math.max(10, d.goal + dir * st); }
  app.markDirty('plan');
};
app.planToggleStrategy = (k) => {
  const d = app.planDraft; const on = d.strategies.includes(k);
  if (on && d.strategies.length === 1) return;
  d.strategies = on ? d.strategies.filter(x => x !== k) : [...d.strategies, k];
  app.markDirty('plan');
};
app.lockPlan = ({ quiet = false } = {}) => {
  const d = app.planDraft, p = buildPlan(d);
  app.day.plan = { capital: d.capital, goal: d.goal, aggr: d.aggr, strategies: [...d.strategies], at: Date.now() };
  app.day.goalHit = false;
  const r = app.settings.risk;
  r.account = d.capital; r.maxDailyLoss = p.maxLoss; r.riskPct = PROFILES[d.aggr].riskPct; r.stopPct = p.stopPct; r.maxConsecLosses = p.consec; r.cooldownMin = p.cool;
  app.settings.lastAggr = d.aggr; app.settings.strategies = [...d.strategies];
  app.saveSettings(); persistDay();
  ['plan', 'risk', 'dock', 'indai', 'summary'].forEach(id => app.markDirty(id));
  if (!quiet) say(`Plan locked: starting with ${fmtMoney(d.capital)}, goal ${fmtMoney(d.goal)}, ${p.label.toLowerCase()}. About ${fmtMoney(p.riskPerTrade)} risk per trade, and the breaker trips at minus ${fmtMoney(p.maxLoss)}. ${p.winsNeeded ? `That's roughly ${p.winsNeeded} good trade${p.winsNeeded > 1 ? 's' : ''} at ${p.rr} to 1.` : ''} I'll call out ${d.strategies.map(k => STRATEGIES[k].short).join(', ')} setups scoring ${p.minScore} or better.${p.warnings[0] ? ' ' + p.warnings[0] : ''}`, 'good');
};
app.openPlan = () => { app.planDraft = defaultDraft(); app.openFocus('plan'); if (!app.temp) app.checkTemperature(); };
app.checkTemperature = async (force = false) => {
  if (app.tempLoading) return app.temp;
  if (app.temp && !force && Date.now() - app.temp.at < 10 * 60e3) return app.temp;
  app.tempLoading = true; app.markDirty('plan');
  const quotes = {}; for (const s of ['SPY', 'QQQ', 'IWM']) { const q = app.feed.quote(s); if (q) quotes[s] = q; }
  let vix = null;
  try { const j = await relay.snapshot(['VIX']); const v = (j.quotes || [])[0]; if (v && v.ok) vix = { last: v.price || v.close, pct: v.changePct ?? (v.prevClose ? ((v.price || v.close) / v.prevClose - 1) * 100 : 0) }; } catch {}
  const gex = {};
  for (const s of ['SPY', 'QQQ', 'IWM']) { const lv = app.levelsFor(s), q = app.feed.quote(s); if (lv && q) gex[s] = { zg: lv.zg, spot: q.ext ?? q.last }; }
  const st = marketStatus().state;
  app.temp = { ...temperature({ quotes, vix, gex, preMarket: st !== 'open' }), vix, at: Date.now(), demo: app.feed.status.mode === 'demo' };
  app.tempLoading = false; app.markDirty('plan');
  return app.temp;
};

// ------------------------------------------------------------------ INDAI's own setup alerts
const sigMem = { lastBar: {}, last: {}, hour: [], pausedNote: 0 };
function nextExpiries() {
  const p = etParts(), todayOk = isTradingDay(p.y, p.m, p.d) && Date.now() < etToMs(p.y, p.m, p.d, 16, 0);
  const today = todayOk ? fmtYMD(p.y, p.m, p.d) : fmtYMD(...nextTradingDay(p.y, p.m, p.d));
  const [y, m, d] = today.split('-').map(Number);
  return { today, next: fmtYMD(...nextTradingDay(y, m, d)) };
}
function completedBars(sym) {
  const bars = app.feed.getBars(sym, '5min');
  const one = app.feed.getBars(sym, '1min');
  const latest = one.length ? one[one.length - 1].t + 60e3 : (app.feed.syms.get(sym)?.lastTradeAt || Date.now());
  return bars.filter(b => b.t + 300e3 <= latest + 1000);
}
function leadDirection() {
  const dirs = ['SPY', 'QQQ'].map(s => { const b = completedBars(s); if (b.length < 4) return 0; const ch = b[b.length - 1].c - b[b.length - 4].c; return Math.abs(ch) / b[b.length - 1].c < 0.0005 ? 0 : Math.sign(ch); });
  return dirs[0] === dirs[1] ? dirs[0] : 0;
}
function scanTick() {
  const ms = marketStatus();
  const demo = app.feed.status.mode === 'demo';
  if (ms.state !== 'open' && !(demo && app.settings.demoSignals)) return;
  const plan = app.activePlan();
  const rs = app.riskState();
  if (rs.state !== 'armed') { if (Date.now() - sigMem.pausedNote > 30 * 60e3) { sigMem.pausedNote = Date.now(); say(`Setup alerts are paused while the breaker is ${rs.state === 'tripped' ? 'tripped' : 'on cooldown'}.`, 'risk', { speak: false }); } return; }
  let minScore = plan.minScore;
  if (app.day.plan && app.day.goalHit) { if (plan.afterGoal === 'stop') return; if (plan.afterGoal === 'aplus') minScore = Math.max(minScore, 80); }
  const now = Date.now();
  sigMem.hour = sigMem.hour.filter(t => now - t < 3600e3);
  const lead = leadDirection();
  for (const sym of app.settings.symbols) {
    const bars = completedBars(sym);
    if (bars.length < 6) continue;
    const lastT = bars[bars.length - 1].t;
    if (sigMem.lastBar[sym] === lastT) continue;
    sigMem.lastBar[sym] = lastT;
    if (now - (lastT + 300e3) > (app.feed.status.mode === 'live' || app.feed.bridgeLive ? 6 * 60e3 : 25 * 60e3)) continue; // stale bar
    const lv = app.levelsFor(sym);
    const cands = scanSetups(sym, bars, { levels: lv, leadDir: ['SPY', 'QQQ'].includes(sym) ? 0 : lead, now, enabled: plan.strategies })
      .filter(c => c.score >= minScore).sort((a, b) => b.score - a.score);
    const sig = cands.find(c => now - (sigMem.last[sym + c.strat + c.dir] || 0) > 20 * 60e3);
    if (!sig || sigMem.hour.length >= plan.perHour) continue;
    sigMem.last[sym + sig.strat + sig.dir] = now; sigMem.hour.push(now);
    const q = app.feed.quote(sym);
    sig.contract = suggestContract(sig, plan, { iv: q?.iv30 ? q.iv30 / 100 : 0.22, r: app.settings.rate ?? 0.04, strikeStep: strikeStep(sym, sig.price), nextExpiry: nextExpiries() });
    fireSignal(sig, plan);
  }
}
function fireSignal(sig, plan) {
  app.signals.unshift(sig); if (app.signals.length > 30) app.signals.length = 30;
  app.day.signals = (app.day.signals || 0) + 1; saveDay(app.day);
  const k = sig.contract, side = sig.type === 'C' ? 'call' : 'put';
  const delayed = app.feed.status.mode === 'demo' ? ' Demo data.' : app.feed.status.mode === 'delayed' && !app.feed.bridgeLive ? ' Heads up, this is on delayed data.' : '';
  const grade = sig.score >= 80 ? 'A-plus' : sig.score >= 70 ? 'strong' : 'decent';
  const text = `${sig.sym} ${side} setup, ${grade}, score ${sig.score}: ${sig.title}. Idea: the ${k.strike} ${side} ${k.expiry === nextExpiries().today ? 'for today' : 'for ' + new Date(k.expiry + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}, about ${k.premium.toFixed(2)}, ${k.qty} contract${k.qty > 1 ? 's' : ''}, risking about ${fmtMoney(k.risk)}${k.overBudget ? `, which is over your ${fmtMoney(plan.riskPerTrade)} per-trade risk, so size down or skip` : ''}. Out if ${sig.sym} ${sig.dir > 0 ? 'loses' : 'gets back above'} ${fmtPrice(sig.stop)}; target ${fmtPrice(sig.target)}.${sig.against.length ? ' Watch: ' + sig.against.slice(0, 2).join(', ') + '.' : ''}${delayed}`;
  say(text, sig.dir > 0 ? 'good' : 'risk');
  flash('watch'); if (sig.sym === app.settings.main) flash('chart');
  app.markDirty('indai'); app.markDirty('summary');
  try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(`INDAI · ${sig.sym} ${side} setup (${sig.score})`, { body: `${sig.title}. ${k.strike}${sig.type} ≈ $${k.premium.toFixed(2)} × ${k.qty}. Stop ${fmtPrice(sig.stop)}, target ${fmtPrice(sig.target)}.`, icon: './icons/icon-192.png', tag: 'indai-' + sig.sym }); } catch {}
}
app.fireSignal = fireSignal;

// ------------------------------------------------------------------ three.js scene
const canvasHost = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
try { renderer.xr.setFoveation(0.25); } catch {}
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.03, 200);
camera.position.set(0, 1.6, 0);
scene.add(camera);

// environment (hidden in mixed reality so you see your room)
const env = new THREE.Group();
scene.add(env);
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#0a1424') }, bottom: { value: new THREE.Color('#02050b') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y*0.5+0.5; gl_FragColor = vec4(mix(bottom, top, smoothstep(0.35,1.0,h)),1.0); }',
  }));
  env.add(sky);
  const grid = new THREE.GridHelper(40, 80, 0x1f4f6b, 0x0c1d2b);
  grid.material.transparent = true; grid.material.opacity = 0.4;
  env.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.015, 96), new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; env.add(ring);
  const n = 600, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 4 + Math.random() * 18, th = Math.random() * Math.PI * 2, y = Math.random() * 10 - 1;
    pos.set([Math.cos(th) * r, y, Math.sin(th) * r], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fdcff, size: 0.025, transparent: true, opacity: 0.5 }));
  pts.name = 'dust'; env.add(pts);
}

// the HUD rig: everything you see floats in here, placed around your head on recenter
const rig = new THREE.Group();
scene.add(rig);

// INDAI orb (tap or pinch it to talk)
const orb = new THREE.Group();
{
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.95 }));
  core.name = 'core'; orb.add(core);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.name = 'glow'; orb.add(glow);
  const ringMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  [[0.07, 0x5ad1ff, 0.75], [0.085, 0xf0c674, 0.6], [0.1, 0xa78bfa, 0.4]].forEach(([r, c, o], i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0022, 8, 96), ringMat(c, o));
    m.name = 'ring' + i; m.rotation.x = Math.PI / 2 + i * 0.5; orb.add(m);
  });
  rig.add(orb);
}
const orbHit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
orbHit.userData.orb = true;
orb.add(orbHit);

// panels
const P = app.panels;
P.top = new TopBar(app); P.chart = new MainChart(app); P.dock = new Dock(app);
P.watch = new Watchlist(app); P.risk = new RiskBreaker(app);
P.leadlag = new LeadLag(app); P.levels = new Levels(app); P.indai = new IndaiPanel(app);
P.analysis = new AnalysisPanel(app); P.calc = new CalcPanel(app); P.deep = new DeepDivePanel(app); P.summary = new SummaryPanel(app); P.plan = new PlanPanel(app);
const panelMeshes = [];
const maxAniso = renderer.capabilities.getMaxAnisotropy();
for (const [id, p] of Object.entries(P)) {
  p.setAnisotropy(maxAniso); rig.add(p.mesh); panelMeshes.push(p.mesh);
  if (FOCUS.includes(id)) { p.mesh.visible = false; p.mesh.renderOrder = 3; p.focus = true; p.solid = true; }
}
const home = {};   // where each screen lives when not collapsed

function placeDefault(id) {
  const [deg, dy] = LAYOUT[id];
  const th = THREE.MathUtils.degToRad(deg);
  const m = P[id].mesh;
  m.position.set(Math.sin(th) * R, BASE_Y + dy, -Math.cos(th) * R);
  m.rotation.set(0, -th, 0);
}
function placeFocus(id) {
  const m = P[id].mesh;
  m.position.set(0, BASE_Y + 0.075, -RF);
  m.rotation.set(0, 0, 0);
}
function applyLayout() {
  const saved = loadLayout();
  for (const id of Object.keys(P)) {
    if (FOCUS.includes(id)) { placeFocus(id); continue; }
    const s = saved[id];
    if (s && Array.isArray(s.p) && Array.isArray(s.q)) { P[id].mesh.position.fromArray(s.p); P[id].mesh.quaternion.fromArray(s.q); }
    else placeDefault(id);
    P[id].mesh.scale.setScalar(1);
    home[id] = P[id].mesh.position.clone();
  }
  orb.position.set(0, BASE_Y + 0.64, -R);
}
function persistLayout() {
  if (app.consolidated) return;
  const out = {};
  for (const id of Object.keys(P)) {
    if (FOCUS.includes(id)) continue;
    out[id] = { p: P[id].mesh.position.toArray(), q: P[id].mesh.quaternion.toArray() };
    home[id] = P[id].mesh.position.clone();
  }
  saveLayout(out);
}
app.resetLayout = () => { clearLayout(); app.consolidated = false; for (const id of COLLAPSIBLE) P[id].mesh.visible = true; applyLayout(); say('Layout reset.', 'info', { speak: false }); };
applyLayout();

// ------------------------------------------------------------------ focus cards + consolidate / restore
const anims = new Map();
function animate(mesh, { to = null, scale = 1, dur = 300, after = null }) {
  anims.set(mesh, { p0: mesh.position.clone(), p1: to ? to.clone() : mesh.position.clone(), s0: mesh.scale.x, s1: scale, t0: performance.now(), dur, after });
}
function stepAnims(now) {
  for (const [mesh, a] of anims) {
    const t = Math.min(1, (now - a.t0) / a.dur), e = 1 - Math.pow(1 - t, 3);
    mesh.position.lerpVectors(a.p0, a.p1, e);
    mesh.scale.setScalar(a.s0 + (a.s1 - a.s0) * e);
    if (t >= 1) { anims.delete(mesh); a.after && a.after(); }
  }
}
app.openFocus = (id) => {
  if (!FOCUS.includes(id)) return;
  if (id === 'calc') app.ensureCalc();
  if (app.focus && app.focus !== id) { const old = P[app.focus].mesh; anims.delete(old); old.visible = false; }
  const m = P[id].mesh;
  if (!m.visible) { placeFocus(id); m.scale.setScalar(0.82); m.visible = true; animate(m, { scale: 1, dur: 260 }); }
  app.focus = id;
  P[id].dirty = true;
  app.markDirty('dock');
};
app.closeFocus = () => {
  const id = app.focus; if (!id) return;
  if (id === 'summary' && app.consolidated) { app.restoreAll(); return; }
  const m = P[id].mesh;
  animate(m, { scale: 0.85, dur: 150, after: () => { m.visible = false; m.scale.setScalar(1); } });
  app.focus = null;
  if (app.consolidated) app.openFocus('summary');
};
app.consolidate = () => {
  if (app.consolidated) { app.openFocus('summary'); return; }
  app.consolidated = true;
  const target = new THREE.Vector3(0, BASE_Y + 0.075, -RF - 0.05);
  for (const id of COLLAPSIBLE) {
    const m = P[id].mesh;
    home[id] = home[id] || m.position.clone();
    animate(m, { to: target, scale: 0.05, dur: 380, after: () => { m.visible = false; } });
  }
  setTimeout(() => { if (app.consolidated && !app.focus) app.openFocus('summary'); }, 200);
  say('Everything in one view. Pull your hands apart or tap Restore to bring the screens back.', 'info', { speak: false });
  app.markDirty('dock');
};
app.restoreAll = () => {
  if (app.focus) { const m = P[app.focus].mesh; m.visible = false; app.focus = null; }
  if (!app.consolidated) return;
  app.consolidated = false;
  for (const id of COLLAPSIBLE) {
    const m = P[id].mesh;
    m.visible = true;
    animate(m, { to: home[id], scale: 1, dur: 380 });
    P[id].dirty = true;
  }
  app.markDirty('dock');
};

// ------------------------------------------------------------------ recenter
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
let pendingRecenter = false;
app.recenter = () => {
  if (app.inXR) {
    const xrCam = renderer.xr.getCamera();
    xrCam.getWorldPosition(_v); xrCam.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, 'YXZ');
    rig.position.copy(_v);
    rig.rotation.set(0, _e.y, 0);
  } else {
    rig.position.set(0, 1.6, 0); rig.rotation.set(0, 0, 0);
    view.yaw = 0; view.pitch = 0; updateView();
  }
};

// ------------------------------------------------------------------ 2D (non-headset) view
const view = { yaw: 0, pitch: 0, dist: 0.5 };
function fit2D() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.fov = aspect < 0.8 ? 72 : 60;
  const needW = aspect < 0.8 ? 1.35 : aspect < 1.4 ? 2.0 : 2.7;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
  view.dist = Math.max(0.2, Math.min(3.2, needW / 2 / Math.tan(hfov / 2) - R * 0.82));
  updateView();
}
function updateView() {
  if (app.inXR) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  camera.position.set(0, 1.6 + BASE_Y * 0.5, view.dist);
  camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
}
window.addEventListener('resize', () => { if (!app.inXR) { renderer.setSize(window.innerWidth, window.innerHeight); fit2D(); } });

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let mouseHoverPanel = null;
function targets() { const t = panelMeshes.filter(m => m.visible && m.scale.x > 0.5); t.push(orbHit); return t; }
function resolveHit(hit) {
  if (!hit) return null;
  if (hit.object.userData.orb) return { orb: true, point: hit.point, distance: hit.distance };
  const panel = hit.object.userData.panel;
  return { panel, px: panel.toPx(hit.uv), point: hit.point, distance: hit.distance };
}
function pick2D(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return resolveHit(ray.intersectObjects(targets(), false)[0]);
}
function firstGesture() { app.indai.voice.unlock(); if (!firstGesture.done) { firstGesture.done = true; if (!app.indai.muted) app.indai.voice.preload({ tts: true }); maybeCheckIn(false); } }
// Each trading day, the first time you come in, INDAI reads the market and asks for the day's plan.
function maybeCheckIn(xr) {
  if (app.day.plan || app.checkInStarted) return;
  const p = etParts();
  if (!isTradingDay(p.y, p.m, p.d) || p.h < 6 || p.h >= 16) return;
  app.checkInStarted = true;
  setTimeout(() => app.indai.startDay({ voice: xr }), xr ? 2500 : 600);
}
app.maybeCheckIn = maybeCheckIn;
const pointers = new Map();
let dragView = null, pinch = null;
renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (app.inXR) return;
  firstGesture();
  renderer.domElement.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.dist }; dragView = null; return;
  }
  const h = pick2D(ev);
  dragView = { x: ev.clientX, y: ev.clientY, yaw: view.yaw, pitch: view.pitch, moved: false, hit: h };
  if (h && h.panel) { const b = h.panel.buttonAt(h.px); if (b && !b.disabled) { h.panel.pressed = b.id; h.panel.dirty = true; } }
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (app.inXR) return;
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    view.dist = Math.max(-0.6, Math.min(3.5, pinch.dist * (pinch.d / d))); updateView(); return;
  }
  if (dragView) {
    const dx = ev.clientX - dragView.x, dy = ev.clientY - dragView.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragView.moved = true;
    if (dragView.moved) {
      view.yaw = Math.max(-1.6, Math.min(1.6, dragView.yaw + dx * 0.004));
      view.pitch = Math.max(-0.9, Math.min(0.9, dragView.pitch + dy * 0.004));
      updateView();
      if (dragView.hit && dragView.hit.panel) { dragView.hit.panel.pressed = null; dragView.hit.panel.dirty = true; }
    }
    return;
  }
  const h = pick2D(ev);
  const hp = h && h.panel ? h.panel : null;
  if (mouseHoverPanel && mouseHoverPanel !== hp) mouseHoverPanel.setHover(null);
  if (hp) { hp.setHover(h.px); mouseHoverPanel = hp; } else mouseHoverPanel = null;
  renderer.domElement.style.cursor = (h && h.orb) || (hp && hp.buttonAt(h.px)) ? 'pointer' : 'grab';
});
const endPointer = (ev) => {
  pointers.delete(ev.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (!dragView) return;
  const d = dragView; dragView = null;
  if (d.hit && d.hit.panel) { d.hit.panel.pressed = null; d.hit.panel.dirty = true; }
  if (!d.moved && d.hit && ev.type === 'pointerup') {
    const h = pick2D(ev);
    if (h && h.orb && d.hit.orb) { app.talk(); return; }
    if (h && h.panel && h.panel === d.hit.panel) {
      const b = h.panel.buttonAt(h.px);
      if (b && !b.disabled && b.onClick) { b.onClick(); h.panel.dirty = true; }
    }
  }
};
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);
renderer.domElement.addEventListener('pointerleave', () => { if (mouseHoverPanel) { mouseHoverPanel.setHover(null); mouseHoverPanel = null; } });
renderer.domElement.addEventListener('wheel', (ev) => {
  if (app.inXR) return;
  ev.preventDefault();
  view.dist = Math.max(-0.6, Math.min(3.5, view.dist + ev.deltaY * 0.0015)); updateView();
}, { passive: false });
// keyboard push-to-talk for desktop testing: hold the space bar
window.addEventListener('keydown', (ev) => { if (ev.code === 'Space' && !ev.repeat && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { ev.preventDefault(); firstGesture(); if (!app.indai.listening) app.talk(); } });
window.addEventListener('keyup', (ev) => { if (ev.code === 'Space' && app.indai.voice.state.listening) app.indai.voice.stop(); });

// ------------------------------------------------------------------ XR input: controllers + hands
const xrPointers = [];
const cursorGeo = new THREE.RingGeometry(0.006, 0.011, 24);
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.6 }));
  line.visible = false;
  ctrl.add(line);
  const cursor = new THREE.Mesh(cursorGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
  cursor.renderOrder = 10; cursor.visible = false; scene.add(cursor);
  const ptr = { i, ctrl, line, cursor, source: null, hit: null, press: null, drag: null, hoverPanel: null, talkBtn: false, talkAt: 0 };
  xrPointers.push(ptr);
  ctrl.addEventListener('connected', (e) => { ptr.source = e.data; line.visible = true; });
  ctrl.addEventListener('disconnected', () => { ptr.source = null; line.visible = false; cursor.visible = false; endDrag(ptr); if (ptr.hoverPanel) ptr.hoverPanel.setHover(null); ptr.hoverPanel = null; });
  ctrl.addEventListener('selectstart', () => onPress(ptr, false));
  ctrl.addEventListener('selectend', () => onRelease(ptr));
  ctrl.addEventListener('squeezestart', () => onPress(ptr, true));
  ctrl.addEventListener('squeezeend', () => endDrag(ptr));
  scene.add(ctrl);
  const hand = renderer.xr.getHand(i);
  scene.add(hand);
}
const jointGeo = new THREE.SphereGeometry(0.0055, 10, 8);
const jointMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.8 });
function updateHandVisuals() {
  for (let i = 0; i < 2; i++) {
    const hand = renderer.xr.getHand(i);
    for (const j of Object.values(hand.joints || {})) {
      if (!j.userData.vis) { const m = new THREE.Mesh(jointGeo, jointMat); j.add(m); j.userData.vis = m; }
    }
  }
}
function haptic(ptr, v = 0.35, ms = 25) {
  try { const h = ptr.source && ptr.source.gamepad && ptr.source.gamepad.hapticActuators && ptr.source.gamepad.hapticActuators[0]; if (h && h.pulse) h.pulse(v, ms); } catch {}
}
function castXR(ptr) {
  ray.setFromXRController(ptr.ctrl);
  return resolveHit(ray.intersectObjects(targets(), false)[0]);
}
function onPress(ptr, isSqueeze) {
  const h = ptr.hit;
  if (!h) return;
  if (h.orb) { if (!isSqueeze) { app.talk(); haptic(ptr, 0.5, 30); } return; }
  const b = isSqueeze ? null : h.panel.buttonAt(h.px);
  if (b && !b.disabled) { ptr.press = { panel: h.panel, id: b.id }; h.panel.pressed = b.id; h.panel.dirty = true; haptic(ptr, 0.3, 20); return; }
  if (isSqueeze || h.panel.inHeader(h.px)) {
    const m = h.panel.mesh;
    m.getWorldPosition(_v);
    ptr.drag = { panel: h.panel, dist: h.distance, offset: _v.clone().sub(h.point) };
    haptic(ptr, 0.5, 30);
  }
}
function onRelease(ptr) {
  if (ptr.drag) { endDrag(ptr); return; }
  const p = ptr.press; ptr.press = null;
  if (!p) return;
  p.panel.pressed = null; p.panel.dirty = true;
  const h = castXR(ptr);
  if (h && h.panel === p.panel) {
    const b = h.panel.buttonAt(h.px);
    if (b && b.id === p.id && b.onClick) { b.onClick(); haptic(ptr, 0.6, 35); }
  }
}
function endDrag(ptr) {
  if (!ptr.drag) return;
  const wasFocus = ptr.drag.panel.focus;
  ptr.drag = null;
  if (!wasFocus) persistLayout();
}
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _head = new THREE.Vector3();
function updateXRPointers() {
  renderer.xr.getCamera().getWorldPosition(_head);
  for (const ptr of xrPointers) {
    if (!ptr.source) continue;
    // A / X held = push-to-talk (controllers only)
    const gp = ptr.source.gamepad;
    const pressed = !!(gp && !ptr.source.hand && gp.buttons && gp.buttons[4] && gp.buttons[4].pressed);
    if (pressed && !ptr.talkBtn) { ptr.talkAt = performance.now(); if (!app.indai.listening) { app.talk(); haptic(ptr, 0.4, 30); } }
    if (!pressed && ptr.talkBtn && performance.now() - ptr.talkAt > 450 && app.indai.voice.state.listening) app.indai.voice.stop();
    ptr.talkBtn = pressed;
    if (ptr.drag) {
      ray.setFromXRController(ptr.ctrl);
      _o.copy(ray.ray.origin); _d.copy(ray.ray.direction);
      const target = _o.addScaledVector(_d, ptr.drag.dist).add(ptr.drag.offset);
      const m = ptr.drag.panel.mesh;
      rig.worldToLocal(target);
      m.position.copy(target);
      const headLocal = rig.worldToLocal(_head.clone());
      m.lookAt(rig.localToWorld(new THREE.Vector3(headLocal.x, m.position.y, headLocal.z)));
      ptr.cursor.visible = false;
      ptr.line.scale.z = ptr.drag.dist;
      continue;
    }
    const h = castXR(ptr);
    ptr.hit = h;
    const hp = h && h.panel ? h.panel : null;
    if (ptr.hoverPanel && ptr.hoverPanel !== hp) { ptr.hoverPanel.setHover(null); ptr.hoverPanel = null; }
    if (h) {
      if (hp) { hp.setHover(h.px); ptr.hoverPanel = hp; }
      ptr.cursor.visible = true;
      ptr.cursor.position.copy(h.point);
      if (hp) hp.mesh.getWorldQuaternion(ptr.cursor.quaternion); else ptr.cursor.lookAt(_head);
      ptr.cursor.translateZ(0.002);
      ptr.line.scale.z = h.distance;
      const overBtn = h.orb || hp.buttonAt(h.px) || hp.inHeader(h.px);
      ptr.cursor.material.color.set(overBtn ? 0xf0c674 : 0xffffff);
    } else {
      ptr.cursor.visible = false;
      ptr.line.scale.z = 3;
    }
  }
}

// ------------------------------------------------------------------ hand gestures
const JOINTS = ['wrist', 'middle-finger-metacarpal', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const gestures = new GestureTracker({
  onExplode: (sym) => { say(`Exploding ${sym || app.settings.main}.`, 'info', { speak: false }); app.openDeepDive(sym || app.settings.main); },
  onConsolidate: () => app.consolidate(),
  onExpand: () => app.restoreAll(),
});
function symbolUnder(ptr) {
  const h = ptr.hit;
  if (!h || !h.panel) return null;
  const b = h.panel.buttonAt(h.px);
  if (b && b.sym) return b.sym;
  if (h.panel.id === 'chart') return app.settings.main;
  if (h.panel.id === 'deep' && app.deep) return app.deep.sym;
  return null;
}
function updateGestures(now) {
  const poses = { left: null, right: null }, tgt = { left: null, right: null };
  for (const ptr of xrPointers) {
    const src = ptr.source;
    if (!src || !src.hand) continue;
    const hand = renderer.xr.getHand(ptr.i);
    const joints = {};
    for (const n of JOINTS) { const j = hand.joints && hand.joints[n]; if (!j || !j.visible) break; j.getWorldPosition(_v); joints[n] = { x: _v.x, y: _v.y, z: _v.z }; }
    const side = src.handedness === 'left' ? 'left' : 'right';
    poses[side] = handPose(joints);
    tgt[side] = symbolUnder(ptr);
  }
  if (poses.left || poses.right) gestures.update(now, poses, tgt);
}

// ------------------------------------------------------------------ entering / leaving the headset
app.enterXR = async (mode) => {
  if (!navigator.xr) return;
  const sessionMode = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
  firstGesture();
  try {
    const session = await navigator.xr.requestSession(sessionMode, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    app.xrMode = mode;
    env.visible = mode !== 'ar';
    renderer.setClearColor(0x000000, mode === 'ar' ? 0 : 1);
    await renderer.xr.setSession(session);
    app.inXR = true;
    pendingRecenter = 3;
    document.body.classList.add('in-xr');
    app.markDirty('all');
    session.addEventListener('end', () => {
      app.inXR = false; app.xrMode = null; env.visible = true;
      renderer.setClearColor(0x000000, 0);
      document.body.classList.remove('in-xr');
      for (const p of xrPointers) { p.cursor.visible = false; p.drag = null; }
      rig.position.set(0, 1.6, 0); rig.rotation.set(0, 0, 0);
      renderer.setSize(window.innerWidth, window.innerHeight); fit2D();
      app.markDirty('all');
      if (app.onXREnd) app.onXREnd();
    });
    say(`INDAI online. Hold A or X, or pinch the orb, and talk to me.`, 'info');
    maybeCheckIn(true);
  } catch (err) {
    say(`Couldn't start ${mode === 'ar' ? 'mixed reality' : 'VR'}: ${err.message || err}`, 'info', { speak: false });
    throw err;
  }
};
app.exitXR = () => { const s = renderer.xr.getSession(); if (s) s.end(); };

// Ask for the microphone in 2D (before the headset view) so the permission prompt is easy to answer.
app.primeMic = async () => {
  if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' }).catch(() => null);
    if (st && st.state !== 'prompt') return st.state;
  } catch {}
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return 'granted-now'; }
  catch { return 'denied'; }
};

// ------------------------------------------------------------------ alerts
const alertMem = { last: {}, at: {}, hod: {}, lod: {}, mkt: null, warned5: null };
function flash(id) { if (P[id]) { P[id].flash = 1; P[id].dirty = true; } }
function canAlert(key, ms) { const now = Date.now(); if (now - (alertMem.at[key] || 0) < ms) return false; alertMem.at[key] = now; return true; }
function checkAlerts() {
  const s = app.settings, now = Date.now();
  const ms = marketStatus(now);
  const demo = app.feed.status.mode === 'demo';
  const tag = demo ? ' (demo)' : '';
  if (s.alerts.bells) {
    if (alertMem.mkt && alertMem.mkt !== ms.state) {
      if (ms.state === 'open') say('Opening bell. Market is open. Trade your plan and size from the breaker.', 'alert');
      if (alertMem.mkt === 'open' && ms.state !== 'open') say(`Closing bell. Day P&L ${app.day.pnl >= 0 ? 'plus' : 'minus'} ${fmtMoney(Math.abs(app.day.pnl))}.`, 'alert');
    }
    if (ms.state === 'open' && ms.msToNext < 5 * 60e3 && alertMem.warned5 !== ms.et.ymd) { alertMem.warned5 = ms.et.ymd; say('Five minutes to the close. Zero-day options decay fast here.', 'alert'); }
  }
  alertMem.mkt = ms.state;
  for (const sym of s.symbols) {
    const q = app.feed.quote(sym);
    if (!q) continue;
    const prev = alertMem.last[sym];
    alertMem.last[sym] = q.last;
    if (prev == null) { alertMem.hod[sym] = q.high; alertMem.lod[sym] = q.low; continue; }
    const lv = app.levelsFor(sym);
    if (s.alerts.levels && lv && prev !== q.last && ms.state === 'open') {
      for (const [k, name] of [['cw', 'call wall'], ['pw', 'put wall'], ['zg', 'gamma flip']]) {
        const L = lv[k]; if (L == null) continue;
        if ((prev - L) * (q.last - L) <= 0 && canAlert(sym + k, 10 * 60e3)) {
          say(`${sym} crossing ${q.last >= L ? 'above' : 'below'} the ${name} at ${fmtPrice(L)}${tag}.`, 'alert');
          if (sym === s.main) flash('chart'); flash('watch');
        }
      }
    }
    if (s.alerts.hod && ms.state === 'open' && ms.et.h >= 10) {
      if (q.high != null && alertMem.hod[sym] != null && q.high > alertMem.hod[sym] && canAlert(sym + 'hod', 15 * 60e3)) { say(`${sym} new high of day, ${fmtPrice(q.high)}${tag}.`, 'alert'); flash('watch'); }
      if (q.low != null && alertMem.lod[sym] != null && q.low < alertMem.lod[sym] && canAlert(sym + 'lod', 15 * 60e3)) { say(`${sym} new low of day, ${fmtPrice(q.low)}${tag}.`, 'alert'); flash('watch'); }
    }
    alertMem.hod[sym] = q.high; alertMem.lod[sym] = q.low;
  }
  const d = app.day;
  if (d.plan && d.plan.goal > 0 && !d.goalHit && d.pnl >= d.plan.goal) {
    d.goalHit = true; saveDay(d);
    const after = PROFILES[d.plan.aggr]?.afterGoal;
    say(`Goal hit: you're up ${fmtMoney(d.pnl)} against a ${fmtMoney(d.plan.goal)} goal. ${after === 'stop' ? "That's the plan, so I'm turning setup alerts off. Great day to walk away." : after === 'aplus' ? "From here I'll only flag A-plus setups. Don't give it back." : "If you keep going, protect at least 70 percent of today's gains."}`, 'good');
  }
  if (d.cooldownUntil && now >= d.cooldownUntil && !d.cooldownAnnounced) {
    d.cooldownAnnounced = true; saveDay(d);
    say('Cooldown over. Only take A-plus setups, and run the checklist first.', 'good');
  }
  if (d.cooldownUntil > now) d.cooldownAnnounced = false;
  if (todayET() !== d.date) { app.day = freshDay(); persistDay(); }
}

// ------------------------------------------------------------------ feed lifecycle
function restartFeed() {
  app.feed.stop();
  app.feed = new MarketFeed(app.settings);
  app.feed.start();
  alertMem.last = {}; alertMem.hod = {}; alertMem.lod = {};
  lastGexSweep = 0;
  app.markDirty('all');
}
app.applySettings = (prev) => {
  app.levels = parseLevels(app.settings.levelsText);
  app.saveSettings();
  const changed = !prev || prev.f !== app.settings.finnhubKey || prev.syms !== app.settings.symbols.join(',') || prev.mode !== app.settings.dataMode;
  if (changed) restartFeed();
  app.indai.setMuted(!app.settings.voice);
  app.markDirty('all');
};

// ------------------------------------------------------------------ render loop
const FEED_PANELS = ['watch', 'chart', 'leadlag', 'levels', 'top', 'summary', 'deep', 'calc'];
const lastDraw = {};
let lastFeedRev = -1, lastSecond = 0, lastAlert = 0, lastGex = 0, lastTV = 0, lastScan = 0, lastBridge = 0;
const clock = new THREE.Timer();
function loop(time, frame) {
  clock.update(time); const dt = Math.min(0.1, clock.getDelta());
  const now = Date.now(), pnow = performance.now();
  if (app.inXR) {
    if (pendingRecenter && frame) { pendingRecenter--; if (pendingRecenter === 0) app.recenter(); }
    updateXRPointers();
    updateHandVisuals();
    try { updateGestures(pnow); } catch (e) { console.warn(e); }
  }
  stepAnims(pnow);
  // orb
  const ind = app.indai, vs = ind.voice.state;
  const level = Math.min(1, (ind.voice.level || 0) * 12);
  const pulse = vs.speaking ? 1 + Math.sin(time * 0.018) * 0.14 : vs.listening ? 1 + level * 0.35 + Math.sin(time * 0.012) * 0.05 : ind.thinking || vs.transcribing ? 1 + Math.sin(time * 0.008) * 0.1 : 1 + Math.sin(time * 0.002) * 0.04;
  orb.scale.setScalar(pulse);
  orb.getObjectByName('core').material.color.set(vs.listening ? 0xfbbf24 : vs.transcribing || ind.thinking ? 0xa78bfa : vs.speaking ? 0x34d399 : 0x9fe6ff);
  const spin = ind.thinking || vs.transcribing ? 3 : 1;
  for (let i = 0; i < 3; i++) { const r = orb.getObjectByName('ring' + i); r.rotation.z += dt * spin * (0.4 + i * 0.35) * (i % 2 ? -1 : 1); r.rotation.y += dt * 0.2 * (i + 1); }
  const dust = env.getObjectByName('dust'); if (dust) dust.rotation.y += dt * 0.004;

  if (app.feed.rev !== lastFeedRev) { lastFeedRev = app.feed.rev; FEED_PANELS.forEach(id => app.dirty.add(id)); }
  const sec = Math.floor(now / 1000);
  if (sec !== lastSecond) {
    lastSecond = sec; app.dirty.add('top');
    if (app.focus === 'summary') app.dirty.add('summary');
    if (app.riskState().state === 'cooldown') app.dirty.add('risk');
  }
  if (vs.listening || vs.transcribing || ind.thinking) app.dirty.add('indai');
  for (const [id, p] of Object.entries(P)) {
    if (p.flash > 0) { p.flash = Math.max(0, p.flash - dt * 0.6); if (Math.floor(time / 250) % 2 === 0 || p.flash === 0) p.dirty = true; }
    if (app.dirty.has(id)) p.dirty = true;
  }
  app.dirty.clear();
  // redraw at most 3 visible panels per frame, each at most ~5x/second (keeps the headset smooth)
  let budget = 3;
  const order = app.focus ? [app.focus, ...Object.keys(P).filter(k => k !== app.focus)] : Object.keys(P);
  for (const id of order) {
    const p = P[id];
    if (!p.dirty || budget <= 0 || !p.mesh.visible) continue;
    const minGap = p.pressed || p.hoverBtn !== p._lastHoverBtn ? 0 : id === 'chart' || id === 'calc' ? 220 : 180;
    if (now - (lastDraw[id] || 0) < minGap) continue;
    try { p.draw(); } catch (e) { console.warn('draw', id, e); p.dirty = false; }
    p._lastHoverBtn = p.hoverBtn; lastDraw[id] = now; budget--;
  }
  if (now - lastAlert > 1000) { lastAlert = now; try { checkAlerts(); } catch (e) { console.warn(e); } }
  if (now - lastGex > 8000) { lastGex = now; try { gexTick(); } catch (e) { console.warn(e); } }
  if (now - lastTV > 12000) { lastTV = now; pollTradingView(); }
  if (now - lastBridge > (marketStatus().state === 'closed' ? 60000 : 8000)) { lastBridge = now; pollBridge(); }
  if (now - lastScan > 15000) { lastScan = now; try { scanTick(); } catch (e) { console.warn('scan', e); } }
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    await Promise.race([
      Promise.all(["600 30px Geist", "500 30px Geist", "400 30px Geist", "700 30px Geist", "500 30px 'Geist Mono'", "600 30px 'Geist Mono'"].map(f => document.fonts.load(f))),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch {}
  app.recenter();
  fit2D();
  app.feed.start();
  loadMorningGex();
  setInterval(loadMorningGex, 10 * 60e3);
  app.markDirty('all');
  renderer.setAnimationLoop(loop);
  const st = app.feed.status;
  say(st.mode === 'demo'
    ? `Hi ${app.settings.name}, I'm INDAI. Running on demo data right now.`
    : `Hi ${app.settings.name}, I'm INDAI. Market data is connecting (delayed about 15 minutes).`, 'info', { speak: false });
  say('Ask me about a trade, like “QQQ calls expiring today, 665 strike”. Tap Talk, hold A or X, or pinch the orb.', 'info', { speak: false });
  initUI(app);
  document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => app.markDirty('all'));
  window.__indai = window.__jarvis = { app, renderer, scene, camera, rig, P, THREE, orb, gestures };
}
boot();

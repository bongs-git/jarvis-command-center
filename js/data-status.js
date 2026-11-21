// Retain provider metadata at the website's relay boundary. Shared feed modules stay byte-identical.
import { relay } from './relay.js';
import { etToMs } from './market.js';

const timeET = (at) => new Date(at).toLocaleTimeString('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
});
const timestamp = (value) => typeof value === 'number' ? value : Date.parse(value || '');

export function unavailableReason(error) {
  const message = String(error?.message || error || '');
  if (/403|forbidden|refus/i.test(message)) return 'The options provider is refusing the request.';
  if (/429|rate/i.test(message)) return 'The options provider has reached its request limit.';
  if (/abort|timeout/i.test(message)) return 'The options provider took too long to respond.';
  if (/offline|fetch|network/i.test(message)) return 'The options service could not be reached.';
  if (/empty|no chain|no contracts/i.test(message)) return 'The provider returned no option contracts for this ticker.';
  return 'The options service could not return prices for this ticker.';
}

export function initDataStatus(app) {
  const quotes = new Map(), candles = new Map(), options = new Map();
  let levelsError = '', levelsLoaded = false, revision = 0;
  const changed = () => {
    revision++;
    for (const view of ['top', 'chart', 'watch', 'levels', 'analysis', 'deep', 'calc', 'ideas', 'settings']) app.markDirty(view);
  };
  const snapshot = relay.snapshot.bind(relay);
  relay.snapshot = async (...args) => {
    const result = await snapshot(...args);
    for (const q of result.quotes || []) {
      if (!q.ok) continue;
      quotes.set(q.symbol, { source: q.source || result.source || 'CBOE', delay: q.delay ?? result.delay ?? 900,
        at: timestamp(q.timestamp), prevClose: q.prevClose });
    }
    changed();
    return result;
  };
  const bars = relay.bars.bind(relay);
  relay.bars = async (...args) => {
    const result = await bars(...args);
    for (const [sym, row] of Object.entries(result.bars || {})) {
      if (!row?.bars?.length || !row.session) continue;
      const [y, m, d] = row.session.split('-').map(Number);
      const latest = Math.max(...row.bars.map(b => Number(b[0])));
      const at = etToMs(y, m, d, 0, 0) + (latest - 1) * 60000;
      candles.set(sym, { source: row.source || result.source || 'CBOE', delay: row.delay ?? result.delay ?? 900, at, end: at + 60000 });
    }
    changed();
    return result;
  };
  const bridge = relay.tvBars.bind(relay);
  relay.tvBars = async (...args) => {
    const result = await bridge(...args);
    for (const row of result.bars || []) {
      if (!row.ticker || !Number.isFinite(+row.t) || !['1', '1min'].includes(String(row.tf || '1'))) continue;
      if (+row.t < (candles.get(row.ticker)?.at || 0)) continue;
      candles.set(row.ticker, { source: 'TradingView bridge', delay: 0, at: +row.t, end: +row.t + 60000 });
    }
    changed();
    return result;
  };
  const chain = relay.chain.bind(relay);
  relay.chain = async (sym, ...args) => {
    const pending = { state: 'loading', reason: '' };
    options.set(sym, pending); changed();
    try {
      const result = await chain(sym, ...args);
      if (!result?.chain?.length) throw new Error(result?.error || 'no contracts');
      if (options.get(sym) === pending) options.set(sym, { state: 'ready', reason: '', source: result.source, at: result.timestamp });
      return result;
    } catch (error) {
      if (options.get(sym) === pending) options.set(sym, { state: 'error', reason: unavailableReason(error) });
      throw error;
    } finally { changed(); }
  };
  const morning = relay.morningGex.bind(relay);
  relay.morningGex = async () => {
    try { const result = await morning(); levelsError = ''; levelsLoaded = true; return result; }
    catch (error) { levelsError = unavailableReason(error); throw error; }
    finally { changed(); }
  };

  app.marketData = {
    get revision() { return revision; },
    option(sym) { return options.get(sym); },
    optionNote(sym) {
      const state = options.get(sym);
      return state?.state === 'error' ? `Option prices are unavailable right now. ${state.reason}` : '';
    },
    levelNote(sym) {
      return this.optionNote(sym) || (levelsError ? `Option prices are unavailable right now. ${levelsError}`
        : levelsLoaded ? 'Option prices are unavailable right now. No current GEX levels were returned for this ticker.'
        : 'Loading option prices and GEX levels…');
    },
    changeKnown(sym) {
      if (app.feed.status.mode === 'demo') return true;
      return quotes.get(sym)?.prevClose !== 0 && app.feed.quote(sym)?.prevClose > 0;
    },
    label(sym, kind = 'quote', now = Date.now()) {
      if (app.feed.status.mode === 'demo') return { text: 'Demo data', live: false, note: 'Simulated prices for practice.' };
      const q = quotes.get(sym), b = candles.get(sym);
      const direct = app.feed.syms.get(sym);
      let meta = kind === 'bars' ? b || q : q || b;
      if (kind === 'quote' && b?.source === 'TradingView bridge' && direct?.tvAt && b.at >= (q?.at || 0) - (q?.delay || 0) * 1000) meta = b;
      if (kind === 'quote' && app.feed.status.mode === 'live' && app.feed.status.finnhubWs === 'live' && now - (direct?.lastTradeAt || 0) < 30000) {
        return { text: 'Finnhub, live', live: true, note: `${sym} price is streaming from Finnhub.` };
      }
      if (!meta) return { text: 'Waiting for prices', live: false, note: `Waiting for the price source for ${sym}.` };
      if (/TradingView/i.test(meta.source)) {
        const live = Number.isFinite(meta.at) && now >= meta.at && now - meta.at < 120000;
        const text = live ? 'TradingView, live' : Number.isFinite(meta.at) ? `TradingView, last candle ${timeET(meta.end || meta.at)}` : 'TradingView, waiting for candles';
        const day = Number.isFinite(meta.at) ? new Date(meta.at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : '';
        return { text, live, note: `${sym} · ${text}${day ? ` · ${day} ET` : ''}. Prices come from your TradingView bridge.` };
      }
      const delay = Number(meta.delay);
      const live = delay === 0 && Number.isFinite(meta.at) && now >= meta.at && now - meta.at < 120000;
      const text = delay > 0 ? `${meta.source}, delayed ${Math.round(delay / 60)} min` : live ? `${meta.source}, live` : `${meta.source}, last update`;
      return { text, live, note: `${sym} · ${text}${Number.isFinite(meta.at) ? ` at ${timeET(meta.at)} ET` : ''}.` };
    },
  };
}

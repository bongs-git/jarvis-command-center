// The owner's own market data. When his passcode is saved on this device, every request to INDAI's price service
// carries it, and the server may then answer from his Schwab account (live quotes, option chains, candles) instead
// of the public sources. Schwab's data is for the account holder only, so the server gives it to nobody else.
// Without a saved passcode nothing here changes anything. The passcode is added to requests for the price service
// and to nothing else.
// With Schwab connected, his browser also opens Schwab's live stream (js/schwab-stream.js) and every trade moves the
// price and the forming candle, the way the Finnhub stream does: through the feed's applyTrade.
import { RELAY_URL, RELAY_ANON } from './relay.js';
import { marketStatus } from './market.js';
import { schwabStream } from './schwab-stream.js';

const MARKET = `${RELAY_URL}/functions/v1/indai-market?`;

export function initOwnerFeed(app) {
  const plain = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const pass = app.settings && app.settings.researchPass;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : '';
    if (!pass || !url.startsWith(MARKET)) return plain(input, init);
    const headers = new Headers((init && init.headers) || {});
    headers.set('x-indai-pass', pass);
    return plain(input, { ...(init || {}), headers });
  };
  startLive(app, plain);
}

// Schwab's live stream into the feed. app.schwabLive = { state, detail, at, ticks, lastAt } is there for a status line.
function startLive(app, plain) {
  if (new URLSearchParams(location.search).has('demo')) return;
  const live = app.schwabLive = { state: 'off', detail: '', at: 0, ticks: 0, lastAt: 0 };
  const pass = () => (app.settings && app.settings.researchPass) || '';
  const symbols = () => [...new Set([app.settings.main, ...(app.feed.trackedSymbols || app.settings.symbols || [])].filter(Boolean))];
  const total = new Map();   // each symbol's volume for the day so far, as Schwab last gave it
  const stream = schwabStream({
    symbols,
    info: async () => {
      const r = await plain(`${RELAY_URL}/functions/v1/indai-schwab`, { method: 'POST', headers: { apikey: RELAY_ANON, Authorization: `Bearer ${RELAY_ANON}`, 'Content-Type': 'application/json', 'x-indai-pass': pass() }, body: JSON.stringify({ op: 'stream' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
      return j;
    },
    onState: (s) => { Object.assign(live, s); },
    onQuote: (q) => {
      // Volume traded since the last message: the day's total as it is now, less what it was.
      const was = total.get(q.symbol), sum = Number(q.volume);
      if (sum >= 0) total.set(q.symbol, sum);
      if (!q.traded || app.feed.status.mode === 'demo') return;
      const s = app.feed.syms && app.feed.syms.get(q.symbol);
      if (!s) return;
      // Only a trade that has just happened moves the chart. The first message after subscribing repeats the last
      // price, which may be hours old; an index carries no trade time, so its price counts during the session only.
      const now = Date.now(), at = Number(q.tradeTime) > 1e11 ? Number(q.tradeTime) : 0;
      if (at ? now - at > 120e3 : marketStatus(now).state !== 'open') return;
      live.ticks++; live.lastAt = now;
      // The Finnhub stream, when it is also live, already counts the volume: Schwab's ticks then move the price only.
      const vol = app.feed.status.finnhubWs === 'live' || !(was >= 0) || !(sum > was) ? 0 : sum - was;
      app.feed.applyTrade(q.symbol, q.last, vol, at ? Math.min(at, now) : now, s.cboeBars ? { updateIntervals: ['1min'] } : undefined);
      s.tvAt = now;   // a fresher price than the next snapshot's, which then leaves it alone (js/feeds.js, js/ext.js)
    },
  });
  let running = false, watched = '';
  const tend = () => {
    const want = !!pass() && document.visibilityState !== 'hidden';
    if (want && !running) { running = true; stream.start(); }
    else if (!want && running) { running = false; stream.stop(); }
    const now = symbols().join(',');
    if (running && now !== watched) { watched = now; stream.setSymbols(); }
  };
  document.addEventListener('visibilitychange', tend);
  setInterval(tend, 5000);
  setTimeout(tend, 1500);
}

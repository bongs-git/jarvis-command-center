// PAP-1 and PAP-2 on the headset: his Schwab prices, tick by tick, and saying "live" when they are.
// Schwab's stream and INDAI's back end are stand-ins and the clock is set (ported from the website's tests/stream-test.js).
const { chromium } = require('playwright') /* run from a folder where Playwright is installed */;
const BASE = 'http://localhost:8765/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
const TOKEN = 'access-TOKEN-never-on-screen', SOCKET = 'wss://streamer-api.schwab.com/ws', PASS = 'open sesame';
const NOON = Date.parse('2026-11-20T12:00:00-05:00');      // Friday, market open
const EIGHT = Date.parse('2026-11-20T08:00:00-05:00');     // Friday, pre-market

async function streamer(page, s) {
  Object.assign(s, { sockets: 0, closed: 0, logins: [], subs: [], say: () => {} });
  await page.routeWebSocket(SOCKET, (ws) => {
    s.sockets++;
    const send = (o) => { try { ws.send(JSON.stringify(o)); } catch { } };
    s.say = send;
    ws.onClose(() => { s.closed++; });
    ws.onMessage(async (text) => {
      for (const r of JSON.parse(text).requests) {
        if (r.command === 'LOGIN') { s.logins.push(r); send({ response: [{ service: 'ADMIN', command: 'LOGIN', requestid: r.requestid, content: { code: 0, msg: 'ok' } }] }); }
        else if (r.command === 'SUBS') {
          s.subs.push(r.parameters);
          send({ response: [{ service: r.service, command: 'SUBS', requestid: r.requestid, content: { code: 0, msg: 'SUBS command succeeded' } }] });
          const t = await page.evaluate(() => Date.now());
          // the first picture repeats an old last trade
          send({ data: [{ service: 'LEVELONE_EQUITIES', command: 'SUBS', content: r.parameters.keys.split(',').map((key, i) => ({ key, 1: 700.4 + i, 2: 700.44 + i, 3: 700.42 + i, 8: 5000000, 9: 100, 34: t - 20, 35: t - 3600e3 })) }] });
        }
      }
    });
  });
}
async function backend(page, b) {
  Object.assign(b, { calls: [], headers: [] });
  await page.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    b.headers.push({ host: u.host, path: u.pathname, pass: !!req.headers()['x-indai-pass'] });
    if (u.host === 'localhost:8765') return route.continue();
    if (u.host !== 'zptjziewsfuvfcogrikz.supabase.co') return route.abort();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (j, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.endsWith('/indai-schwab')) {
      const body = JSON.parse(req.postData() || '{}'), pass = req.headers()['x-indai-pass'] || '';
      b.calls.push({ op: body.op });
      if (pass !== PASS) return json({ error: 'passcode', message: 'Wrong or missing INDAI passcode.' }, 401);
      if (body.op === 'stream') return b.streamOff ? json({ error: 'not_connected', message: 'Schwab is not connected. Sign in on the Connect Schwab page first.' }, 409)
        : json({ socket: SOCKET, customer: 'CUST', correl: 'CORREL', channel: 'N9', fn: 'APIAPP', token: TOKEN });
      return json({ error: 'bad_request' }, 400);
    }
    if (u.pathname.endsWith('/indai-market')) {
      const q = u.searchParams, syms = (q.get('symbols') || q.get('symbol') || '').split(',').filter(Boolean), now = b.now || NOON;
      if (q.get('kind') === 'snapshot') return json(b.cboe
        ? { source: 'CBOE delayed quotes', delay: 900, quotes: syms.map((s) => ({ symbol: s, ok: true, price: 699, close: 699, prevClose: 695, open: 696, high: 701, low: 694, volume: 4e6, timestamp: new Date(now - 900e3).toISOString() })) }
        : { source: 'Schwab', delay: 0, quotes: syms.map((s) => ({ symbol: s, ok: true, price: 699, close: 699, prevClose: 695, open: 696, high: 701, low: 694, volume: 4e6, timestamp: new Date(now).toISOString() })) });
      if (q.get('kind') === 'bars') return json({ source: b.cboe ? 'CBOE' : 'Schwab', delay: b.cboe ? 900 : 0, bars: Object.fromEntries(syms.map((s) => [s, { session: '2026-11-20', bars: Array.from({ length: 150 }, (_, i) => [571 + i, 698, 699.5, 697.5, 699, 1000]) }])) });
      return json({ error: 'unavailable', message: 'not in this test' }, 503);
    }
    if (u.pathname.endsWith('/indai-brain')) return json(req.method() === 'GET' ? { configured: false, passcode: false, memory: true } : { error: 'not_configured', message: 'off' }, req.method() === 'GET' ? 200 : 503);
    if (u.pathname.endsWith('/indai-voice')) { b.voiceCalls = (b.voiceCalls || 0) + 1; return json({ configured: false, ready: false }); }
    if (u.pathname.includes('/rest/v1/')) return json([]);
    if (u.pathname.endsWith('/indai-tv')) return json(u.searchParams.get('bars') ? { bars: [], live: [], now: NOON } : { alerts: [] });
    return json({ error: 'not_found' }, 404);
  });
}
const settings = (page, pass) => page.addInitScript((p) => { const s = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); s.researchPass = p; s.voice = false; s.voiceEngine = 'system'; s.main = 'SPY'; s.interval = '1min'; s.symbols = ['SPY', 'QQQ', 'IWM']; s.gestureTutorialOffered = true; localStorage.setItem('jarvis.settings.v1', JSON.stringify(s)); }, pass);
const ready = (page, geo = true) => page.waitForFunction((g) => window.__indai && window.__indai.P && window.__indai.P.chart && (!g || window.__indai.P.chart.geo) && window.__indai.app.feed.syms.has('SPY'), geo, { timeout: 40000 });

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const fresh = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); return { ctx, page, errors }; };
  try {
    // ---------------------------------------------------------------- market open, passcode saved, Schwab live
    {
      const { ctx, page, errors } = await fresh(), b = {}, s = {};
      await page.clock.install({ time: new Date(NOON) });
      await settings(page, PASS); await backend(page, b); await streamer(page, s);
      await page.goto(BASE); await ready(page);
      await page.clock.fastForward(3000);
      await page.waitForFunction(() => window.__indai.app.schwabLive && window.__indai.app.schwabLive.state === 'live', null, { timeout: 12000 }).catch(() => {});
      const st = await page.evaluate(() => { const a = window.__indai.app; return { live: a.schwabLive && a.schwabLive.state, tracked: a.feed.trackedSymbols, last: a.feed.quote('SPY').last }; });
      check('[open] with the passcode the headset opens Schwab\'s stream and subscribes to what it tracks', st.live === 'live' && s.logins.length === 1 && s.logins[0].parameters.Authorization === TOKEN && s.subs.length >= 1 && s.subs[0].keys.split(',').includes('SPY'), { st, subs: s.subs });
      const mk = b.headers.filter(h => h.path.endsWith('/indai-market')), other = b.headers.filter(h => !h.path.endsWith('/indai-market') && !h.path.endsWith('/indai-schwab') && !h.path.endsWith('/indai-voice'));   // her hosted voice needs it too (PAP-3)
      check('[open] every price request carries the passcode, and nothing else gets it (besides her own voice service)', mk.length > 0 && mk.every(h => h.pass) && other.every(h => !h.pass), { market: mk.length, leaks: other.filter(h => h.pass) });
      await sleep(300);
      const first = await page.evaluate(() => ({ ticks: window.__indai.app.schwabLive.ticks, last: window.__indai.app.feed.quote('SPY').last }));
      check('[open] the first message after subscribing (an old trade) is not a trade', first.ticks === 0 && first.last === 699, first);
      const now = await page.evaluate(() => Date.now()), minute = Math.floor(now / 60e3) * 60e3;
      s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 3: 700.9, 8: 5000400, 9: 400, 35: now - 150 }] }] });
      await page.waitForFunction(() => window.__indai.app.feed.quote('SPY').last === 700.9, null, { timeout: 5000 }).catch(() => {});
      s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 3: 701.3, 8: 5000900, 35: now - 50 }] }] });
      await page.waitForFunction(() => window.__indai.app.feed.quote('SPY').last === 701.3, null, { timeout: 5000 }).catch(() => {});
      s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 1: 701.29 }] }] });   // bid only
      await sleep(300);
      const t = await page.evaluate((m) => { const a = window.__indai.app, bars = a.feed.syms.get('SPY').bars['1min'], bar = bars[bars.length - 1]; return { last: a.feed.quote('SPY').last, bar, ticks: a.schwabLive.ticks, isMinute: bar.t === m }; }, minute);
      check('[open] a trade moves the price and the forming one-minute candle; a bid-only update does not', t.last === 701.3 && t.isMinute && t.bar.c === 701.3 && t.bar.h >= 701.3 && t.ticks === 2, t);
      // PAP-2: everything says live
      await page.evaluate(() => { window.__indai.P.top.draw(); window.__indai.P.chart.draw(); });
      const ps = await page.evaluate(() => ({ ps: window.__indai.app.priceStatus(), note: window.__indai.app.indai.liveContext().dataNote }));
      check('[open] the badge reads "Live · Schwab" and INDAI is told the prices are live', ps.ps.text === 'Live · Schwab' && ps.ps.kind === 'live' && ps.note === 'Prices are live (Schwab).', ps);
      // settings line
      await page.evaluate(() => window.__indai.app.openSettings()); await sleep(200);
      const line = await page.textContent('#schwab-status');
      check('[open] Settings says "Live prices: Schwab stream"', /^Live prices: Schwab stream/.test(line) && /Live · Schwab/.test(line), line);
      check('[open] the token is never on screen', !(await page.evaluate(() => document.documentElement.outerHTML)).includes(TOKEN));
      // hidden page closes the stream, visible opens it again
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(400);
      check('[open] a hidden page closes the stream', s.closed === 1 && (await page.evaluate(() => window.__indai.app.schwabLive.state)) === 'off', { closed: s.closed });
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => window.__indai.app.schwabLive.state === 'live', null, { timeout: 8000 }).catch(() => {});
      check('[open] back on screen it opens again', s.sockets === 2 && s.logins.length === 2, { sockets: s.sockets });
      check('[open] no script errors', errors.length === 0, errors);
      await ctx.close();
    }
    // ---------------------------------------------------------------- pre-market: a tick moves the extended price, not the close
    {
      const { ctx, page, errors } = await fresh(), b = { now: EIGHT }, s = {};
      await page.clock.install({ time: new Date(EIGHT) });
      await settings(page, PASS); await backend(page, b); await streamer(page, s);
      await page.goto(BASE); await ready(page, false);
      await page.clock.fastForward(3000);
      await page.waitForFunction(() => window.__indai.app.schwabLive && window.__indai.app.schwabLive.state === 'live', null, { timeout: 12000 }).catch(() => {});
      const tick = async (px) => { const now = await page.evaluate(() => Date.now()); s.say({ data: [{ service: 'LEVELONE_EQUITIES', content: [{ key: 'SPY', 3: px, 8: 5001000 + px, 35: now - 100 }] }] }); await sleep(400); return page.evaluate(() => { const q = window.__indai.app.feed.quote('SPY'); return { last: q.last, ext: q.ext }; }); };
      const before = await page.evaluate(() => window.__indai.app.feed.quote('SPY').last);
      const q1 = await tick(703.25);
      check('[8:00] a pre-market tick moves the extended-hours price and leaves the close alone', q1.ext === 703.25 && q1.last === before, { before, q1 });
      await page.evaluate(() => window.__indai.app.applySettings({ f: '__changed__', syms: '', mode: '' }));   // restartFeed()
      await page.clock.fastForward(3000); await sleep(500);
      const before2 = await page.evaluate(() => window.__indai.app.feed.quote('SPY') && window.__indai.app.feed.quote('SPY').last);
      const q2 = await tick(704.5);
      check('[8:00] still true after the feed restarts', q2.ext === 704.5 && q2.last === before2, { before2, q2 });
      check('[8:00] no script errors', errors.length === 0, errors);
      await ctx.close();
    }
    // ---------------------------------------------------------------- public delayed prices: everything reads as before
    {
      const { ctx, page } = await fresh(), b = { cboe: true }, s = {};
      await page.clock.install({ time: new Date(NOON) });
      await settings(page, ''); await backend(page, b); await streamer(page, s);
      await page.goto(BASE); await ready(page);
      await page.clock.fastForward(4000); await sleep(500);
      const ps = await page.evaluate(() => ({ ps: window.__indai.app.priceStatus(), note: window.__indai.app.indai.liveContext().dataNote }));
      check('[delayed] with CBOE delayed prices the badge still reads "Delayed ~15 min" and INDAI is told so', ps.ps.text === 'Delayed ~15 min' && /delayed 15 min/.test(ps.note), ps);
      check('[delayed] without a passcode: no header, no stream asked for', b.headers.every(h => !h.pass) && !b.calls.length && s.sockets === 0, { calls: b.calls, sockets: s.sockets });
      await page.evaluate(() => window.__indai.app.openSettings()); await sleep(200);
      check('[delayed] Settings asks for the passcode to use Schwab', /save your INDAI passcode/.test(await page.textContent('#schwab-status')));
      await ctx.close();
    }
    // ---------------------------------------------------------------- demo mode and "Schwab not connected"
    {
      const { ctx, page } = await fresh(), b = {}, s = {};
      await page.clock.install({ time: new Date(NOON) });
      await settings(page, PASS); await backend(page, b); await streamer(page, s);
      await page.goto(BASE + '?demo=1'); await ready(page);
      await page.clock.fastForward(12000); await sleep(400);
      check('[demo] in demo mode not one request to indai-schwab, and no stream', !b.calls.length && s.sockets === 0, { calls: b.calls });
      await ctx.close();
    }
    {
      const { ctx, page } = await fresh(), b = { streamOff: true }, s = {};
      await page.clock.install({ time: new Date(NOON) });
      await settings(page, PASS); await backend(page, b); await streamer(page, s);
      await page.goto(BASE); await ready(page);
      await page.clock.fastForward(3000); await sleep(600);
      await page.evaluate(() => window.__indai.app.openSettings()); await sleep(200);
      const html = await page.innerHTML('#schwab-status');
      check('[not connected] Settings says why and links to Connect Schwab', /Schwab is not connected/.test(html) && html.includes('https://bongs-git.github.io/indai/schwab.html') && s.sockets === 0, html);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();

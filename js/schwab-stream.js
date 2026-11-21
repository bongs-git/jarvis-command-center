// Schwab's live stream, opened by the owner's own browser. Prices arrive several times a second, pre-market and
// after hours included. INDAI's server hands over what the stream needs (its address, the account's stream
// identifiers and a short-lived access token) only to a request that carries the owner's passcode; nothing here
// stores any of it.
// Schwab allows one stream per person. When another device opens one, Schwab closes this one: it then waits five
// minutes and does not fight for it (stopping and starting, as the page does when it comes back into view, takes it
// back at once).
//   const s = schwabStream({ info, symbols, onQuote, onState });  s.start();  s.setSymbols([...]);  s.stop();
// onQuote({ symbol, last, bid, ask, size, volume, tradeTime, quoteTime, traded }) - `traded` is true when this
// message carried a new last price or trade time, false when only the bid or ask moved.
const INDEX = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX', 'OEX']);
const theirs = (s) => (INDEX.has(s) ? '$' + s : s);
const ours = (k) => String(k || '').replace(/^\$/, '');
const FIELDS = '0,1,2,3,8,9,34,35';   // symbol, bid, ask, last, total volume, last size, quote time, trade time
const WAITS = [2000, 5000, 15000, 30000, 60000, 120000, 300000];   // a stream that keeps failing is tried less and less often
const ELSEWHERE = 300000;

export function schwabStream({ info, symbols, onQuote, onState = () => {}, Socket = (typeof WebSocket !== 'undefined' ? WebSocket : null), now = () => Date.now(), timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) } }) {
  let ws = null, creds = null, wanted = false, live = false, tries = 0, n = 0, retry = null, watchdog = null, lastAt = 0, subscribed = '', kicked = false;
  const known = new Map();   // the last full picture of each symbol: the stream sends only what changed
  const state = (name, detail = '') => { try { onState({ state: name, detail, at: now() }); } catch { /* the listener's business */ } };
  const keys = () => [...new Set((symbols() || []).map((s) => String(s).toUpperCase()).filter(Boolean))].slice(0, 60);
  const send = (service, command, parameters) => ws && ws.readyState === 1 && ws.send(JSON.stringify({ requests: [{ requestid: String(++n), service, command, SchwabClientCustomerId: creds.customer, SchwabClientCorrelId: creds.correl, parameters }] }));
  function subscribe() {
    const list = keys().map(theirs).join(',');
    if (!live || !list || list === subscribed) return;
    subscribed = list;
    send('LEVELONE_EQUITIES', 'SUBS', { keys: list, fields: FIELDS });
  }
  function again(reason, wait, name) {
    live = false; subscribed = '';
    timers.clear(watchdog); watchdog = null;
    if (ws) { const old = ws; ws = null; old.onopen = old.onmessage = old.onclose = old.onerror = null; try { old.close(); } catch { /* already closed */ } }
    if (!wanted) return;
    const ms = wait ?? WAITS[Math.min(tries++, WAITS.length - 1)];
    state(name || (kicked ? 'elsewhere' : 'waiting'), reason); kicked = false;
    timers.clear(retry); retry = timers.set(open, ms);
  }
  function watch() {
    timers.clear(watchdog);
    watchdog = timers.set(() => { if (now() - lastAt > 45000) again('Schwab went quiet'); else watch(); }, 15000);
  }
  function message(text) {
    lastAt = now();
    let m; try { m = JSON.parse(text); } catch { return; }
    for (const r of m.response || []) {
      const code = r.content && r.content.code, msg = (r.content && r.content.msg) || '';
      if (code === 12) { kicked = true; again('The stream was opened on another device', ELSEWHERE); return; }
      if (r.service === 'ADMIN' && r.command === 'LOGIN') {
        if (code === 0) { live = true; tries = 0; state('live', msg); subscribe(); }
        else { again(`Schwab refused the stream (${code}): ${msg}`, 60000, 'refused'); return; }
      } else if (code != null && code !== 0 && code !== 26 && code !== 27 && code !== 28 && code !== 29) state(live ? 'live' : 'waiting', `${r.service} ${r.command}: ${code} ${msg}`);
    }
    for (const d of m.data || []) {
      if (d.service !== 'LEVELONE_EQUITIES') continue;
      for (const row of d.content || []) {
        const symbol = ours(row.key), was = known.get(symbol) || {};
        const q = { symbol, last: row['3'] ?? was.last, bid: row['1'] ?? was.bid, ask: row['2'] ?? was.ask, size: row['9'] ?? 0, volume: row['8'] ?? was.volume, tradeTime: row['35'] ?? was.tradeTime, quoteTime: row['34'] ?? was.quoteTime, delayed: row.delayed ?? was.delayed ?? false };
        q.traded = row['3'] != null || row['35'] != null;
        known.set(symbol, q);
        if (q.last > 0) { try { onQuote(q); } catch { /* the listener's business */ } }
      }
    }
  }
  async function open() {
    timers.clear(retry); retry = null;
    if (!wanted || ws) return;
    if (!Socket) { state('off', 'This browser cannot open a live stream.'); return; }
    state('connecting');
    try { creds = await info(); } catch (e) {
      // not connected, not set up, wrong passcode: nothing to stream until that changes, so look again in five minutes
      const quiet = e && (e.status === 409 || e.status === 503 || e.status === 401 || e.status === 403 || e.status === 404);
      if (!wanted) return;
      state(quiet ? 'off' : 'waiting', (e && e.message) || 'INDAI could not be reached');
      timers.clear(retry); retry = timers.set(open, quiet ? 300000 : WAITS[Math.min(tries++, WAITS.length - 1)]);
      return;
    }
    if (!wanted || ws) return;
    let sock;
    try { sock = new Socket(creds.socket); } catch (e) { again('The stream could not be opened'); return; }
    ws = sock; lastAt = now();
    sock.onopen = () => { send('ADMIN', 'LOGIN', { Authorization: creds.token, SchwabClientChannel: creds.channel, SchwabClientFunctionId: creds.fn }); watch(); };
    sock.onmessage = (ev) => message(typeof ev.data === 'string' ? ev.data : '');
    sock.onerror = () => {};
    sock.onclose = (ev) => { if (ws === sock) { ws = null; again(`The stream closed${ev && ev.code ? ' (' + ev.code + ')' : ''}`); } };
  }
  return {
    start() { if (wanted) return; wanted = true; kicked = false; tries = 0; open(); },
    stop() { wanted = false; timers.clear(retry); retry = null; again('stopped'); state('off', 'stopped'); },
    setSymbols() { subscribe(); },
    get live() { return live; },
  };
}

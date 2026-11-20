import assert from "node:assert/strict";
import { HttpError } from "../_shared/http.ts";
import { appRecognised, authorizeUrl, codeFrom, OAUTH, schwabApp, schwabSession, SIGN_IN_MS, streamerInfo, type Tokens } from "../_shared/schwab.ts";
import { chainAsks, chainFrom, dailyFrom, minutesFrom, quoteFrom } from "../indai-market/schwab.ts";

// The owner's Schwab sign-in (supabase/_shared/schwab.ts) and the shapes Schwab's data is turned into
// (supabase/indai-market/schwab.ts). Schwab itself is a stand-in here: no network, no real keys.
const APP = { key: "app-key-TEST", secret: "app-secret-TEST", callback: "https://127.0.0.1" };
const T0 = Date.parse("2026-11-20T21:30:00Z"), MIN = 60_000;

function world(start: Tokens | null = null) {
  const w = { stored: start, now: T0, calls: [] as { url: string; auth: string; form: Record<string, string> }[], reads: 0, answer: (_form: Record<string, string>): Response => Response.json({}) , n: 0 };
  const instance = (app: typeof APP | null = APP) => schwabSession({
    app, now: () => w.now,
    store: { read: () => { w.reads++; return Promise.resolve(w.stored && { ...w.stored }); }, write: (t) => { w.stored = { ...t }; return Promise.resolve(); }, clear: () => { w.stored = null; return Promise.resolve(); } },
    fetch: (url, init) => {
      const form = Object.fromEntries(new URLSearchParams(String(init.body)));
      w.calls.push({ url, auth: String((init.headers as Record<string, string>).Authorization), form });
      return Promise.resolve(w.answer(form));
    },
  });
  const issue = () => Response.json({ expires_in: 1800, token_type: "Bearer", scope: "api", refresh_token: "refresh-1", access_token: "access-" + (++w.n), id_token: "x" });
  return { w, instance, issue };
}

Deno.test("the app's keys come from the secrets, and the sign-in address is Schwab's", () => {
  assert.equal(schwabApp(() => undefined), null);
  assert.equal(schwabApp((n) => (n === "SCHWAB_APP_KEY" ? "k" : undefined)), null);
  assert.deepEqual(schwabApp((n) => ({ SCHWAB_APP_KEY: " k ", SCHWAB_APP_SECRET: "s" } as Record<string, string>)[n]), { key: "k", secret: "s", callback: "https://127.0.0.1" });
  assert.equal(schwabApp((n) => ({ SCHWAB_APP_KEY: "k", SCHWAB_APP_SECRET: "s", SCHWAB_CALLBACK: "https://example.com/cb" } as Record<string, string>)[n])!.callback, "https://example.com/cb");
  assert.equal(authorizeUrl(APP), "https://api.schwabapi.com/v1/oauth/authorize?response_type=code&client_id=app-key-TEST&redirect_uri=https%3A%2F%2F127.0.0.1");
});

Deno.test("the one-time code is found in whatever the owner pastes", () => {
  const code = "C0.b2F1dGgyLmJkYy5zY2h3YWIuY29t.AbCdEf123_-xyz@";
  for (const pasted of [
    "https://127.0.0.1/?code=C0.b2F1dGgyLmJkYy5zY2h3YWIuY29t.AbCdEf123_-xyz%40&session=11111111-2222",
    "  https://127.0.0.1/?session=1&code=C0.b2F1dGgyLmJkYy5zY2h3YWIuY29t.AbCdEf123_-xyz%40  ",
    "?code=C0.b2F1dGgyLmJkYy5zY2h3YWIuY29t.AbCdEf123_-xyz%40&session=1",
    "code=C0.b2F1dGgyLmJkYy5zY2h3YWIuY29t.AbCdEf123_-xyz%40&session=1",
    "C0.b2F1dGgyLmJkYy5zY2h3YWIuY29t.AbCdEf123_-xyz%40",
    code,
  ]) assert.equal(codeFrom(pasted), code, pasted);
  for (const not of ["", "   ", "https://127.0.0.1/", "https://127.0.0.1/?session=1", "https://api.schwabapi.com/v1/oauth/authorize?client_id=k", "short", "two words here", "%E0%A4%A", 7, null, undefined, "x".repeat(2001)]) assert.equal(codeFrom(not), null, String(not));
});

Deno.test("signing in keeps the tokens, and a token is handed out without asking Schwab again", async () => {
  const { w, instance, issue } = world();
  w.answer = issue;
  const s = instance();
  assert.equal(await s.token(), null);                       // nobody has signed in
  assert.equal(await s.connect("the-code@"), "access-1");
  assert.deepEqual(w.calls[0], { url: OAUTH + "/token", auth: "Basic " + btoa("app-key-TEST:app-secret-TEST"), form: { grant_type: "authorization_code", code: "the-code@", redirect_uri: "https://127.0.0.1" } });
  assert.deepEqual(w.stored, { refresh_token: "refresh-1", signed_in_at: new Date(T0).toISOString(), access_token: "access-1", access_until: new Date(T0 + 30 * MIN).toISOString() });
  for (const later of [1, 10, 27]) { w.now = T0 + later * MIN; assert.equal(await s.token(), "access-1"); assert.equal(await instance().token(), "access-1"); }
  assert.equal(w.calls.length, 1);
  assert.deepEqual(await s.status(), { configured: true, connected: true, signed_in_at: new Date(T0).toISOString(), sign_in_by: new Date(T0 + SIGN_IN_MS).toISOString(), days_left: 7 });
});

Deno.test("a token about to run out is renewed once, however many requests are waiting", async () => {
  const { w, instance, issue } = world();
  w.answer = issue;
  const s = instance();
  await s.connect("code-12345");
  w.now = T0 + 28 * MIN + 1000;                              // under two minutes left
  assert.deepEqual(await Promise.all([s.token(), s.token(), s.token(), s.token()]), Array(4).fill("access-2"));
  assert.equal(w.calls.length, 2);
  assert.deepEqual(w.calls[1].form, { grant_type: "refresh_token", refresh_token: "refresh-1" });
  assert.equal(w.stored!.signed_in_at, new Date(T0).toISOString(), "renewing does not move the seven days");
  const other = instance();                                 // another instance finds the renewed token in the table
  assert.equal(await other.token(), "access-2");
  assert.equal(w.calls.length, 2);
});

Deno.test("two instances renewing at once both end with a working token", async () => {
  const { w, instance, issue } = world({ refresh_token: "refresh-1", signed_in_at: new Date(T0).toISOString(), access_token: "old", access_until: new Date(T0 + MIN).toISOString() });
  w.answer = issue;
  const [a, b] = await Promise.all([instance().token(), instance().token()]);
  assert.ok(a && b && a !== "old" && b !== "old");
  assert.ok(w.stored!.access_token === a || w.stored!.access_token === b);
});

Deno.test("when Schwab refuses the refresh token the sign-in is over; a passing error keeps it", async () => {
  const stale = (): Tokens => ({ refresh_token: "refresh-1", signed_in_at: new Date(T0).toISOString(), access_token: "old", access_until: new Date(T0 - MIN).toISOString() });
  for (const status of [500, 502, 429]) {
    const { w, instance } = world(stale());
    w.answer = () => new Response("{}", { status });
    assert.equal(await instance().token(), null);
    assert.equal(w.stored!.refresh_token, "refresh-1", "kept after " + status);
  }
  for (const status of [400, 401]) {
    const { w, instance } = world(stale());
    w.answer = () => Response.json({ error: "invalid_grant" }, { status });
    const s = instance();
    assert.equal(await s.token(), null);
    assert.equal(w.stored, null, "cleared after " + status);
    assert.deepEqual([(await s.status()).connected, (await s.status()).sign_in_by], [false, null]);
  }
});

Deno.test("after seven days nothing is asked of Schwab until he signs in again", async () => {
  const { w, instance, issue } = world({ refresh_token: "refresh-1", signed_in_at: new Date(T0).toISOString(), access_token: "a", access_until: new Date(T0 + 30 * MIN).toISOString() });
  w.answer = issue;
  w.now = T0 + SIGN_IN_MS - MIN;
  assert.equal((await instance().status()).days_left, 0);
  assert.ok(await instance().token());                        // the last minute still works
  const before = w.calls.length;
  w.now = T0 + SIGN_IN_MS;
  assert.equal(await instance().token(), null);
  assert.deepEqual([(await instance().status()).connected, w.calls.length], [false, before]);
  assert.equal(await instance().connect("new-code-1"), "access-" + w.n);
  assert.equal(w.stored!.signed_in_at, new Date(w.now).toISOString());
});

Deno.test("without the app's keys nothing is read and nothing is asked", async () => {
  const { w, instance } = world({ refresh_token: "r", signed_in_at: new Date(T0).toISOString(), access_token: "a", access_until: new Date(T0 + 30 * MIN).toISOString() });
  const s = instance(null);
  assert.equal(await s.token(), null);
  assert.deepEqual(await s.status(), { configured: false, connected: false, signed_in_at: null, sign_in_by: null, days_left: null });
  assert.deepEqual([w.reads, w.calls.length], [0, 0]);
  await assert.rejects(() => s.connect("code-12345"), (e: unknown) => e instanceof HttpError && e.status === 503);
});

Deno.test("a code Schwab rejects is explained; an outage is not blamed on the code", async () => {
  const { w, instance } = world();
  w.answer = () => Response.json({ error: "invalid_grant" }, { status: 400 });
  await assert.rejects(() => instance().connect("expired-code"), (e: unknown) => e instanceof HttpError && e.status === 400 && e.code === "code_rejected" && /30 seconds/.test(e.message));
  w.answer = () => new Response("", { status: 503 });
  await assert.rejects(() => instance().connect("fine-code-1"), (e: unknown) => e instanceof HttpError && e.status === 502 && e.code === "schwab");
  assert.equal(w.stored, null);
});

Deno.test("the app check tells a key Schwab does not know from one it does", async () => {
  const sent: Record<string, string>[] = [];
  const ask = (response: () => Response) => appRecognised(APP, (_url, init) => { sent.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return Promise.resolve(response()); });
  assert.deepEqual(await ask(() => Response.json({ error: "invalid_client", error_description: "Unauthorized" }, { status: 401 })), { recognised: false, status: 401, error: "invalid_client" });
  assert.deepEqual(await ask(() => Response.json({ error: "invalid_client" }, { status: 400 })), { recognised: false, status: 400, error: "invalid_client" });
  assert.deepEqual(await ask(() => Response.json({ error: "refresh_token_authentication_error", error_description: "Failed refresh token authentication [tokenDigest=abc]" }, { status: 400 })), { recognised: true, status: 400, error: "refresh_token_authentication_error" });
  assert.deepEqual(await ask(() => new Response("", { status: 503 })), { recognised: null, status: 503, error: null });
  assert.deepEqual(await appRecognised(APP, () => Promise.reject(new Error("network"))), { recognised: null, status: 0, error: null });
  assert.ok(sent.every((f) => f.grant_type === "refresh_token" && f.refresh_token === "indai-check-not-a-token"));
});

Deno.test("the live stream details come from Schwab's own answer, and only a Schwab address is passed on", async () => {
  const info = { streamerSocketUrl: "wss://streamer-api.schwab.com/ws", schwabClientCustomerId: "c".repeat(64), schwabClientCorrelId: "11111111-2222-3333-4444-555555555555", schwabClientChannel: "N9", schwabClientFunctionId: "APIAPP" };
  const seen: string[] = [];
  const ask = (body: unknown, status = 200) => streamerInfo("access-1", (url, init) => { seen.push(url + " " + (init.headers as Record<string, string>).Authorization); return Promise.resolve(new Response(JSON.stringify(body), { status })); });
  assert.deepEqual(await ask({ accounts: [{ accountNumber: "SECRET-ACCOUNT" }], streamerInfo: [info], offers: [] }), { socket: "wss://streamer-api.schwab.com/ws", customer: "c".repeat(64), correl: "11111111-2222-3333-4444-555555555555", channel: "N9", fn: "APIAPP" });
  assert.deepEqual(seen, ["https://api.schwabapi.com/trader/v1/userPreference Bearer access-1"]);
  for (const bad of [{}, { streamerInfo: [] }, { streamerInfo: [{ ...info, streamerSocketUrl: "wss://evil.example/ws" }] }, { streamerInfo: [{ ...info, streamerSocketUrl: "wss://schwab.com.evil.example/ws" }] }, { streamerInfo: [{ ...info, streamerSocketUrl: "https://streamer-api.schwab.com/ws" }] }, { streamerInfo: [{ ...info, schwabClientCustomerId: "" }] }]) {
    await assert.rejects(() => ask(bad), (e: unknown) => e instanceof HttpError && e.status === 502 && e.code === "schwab");
  }
  await assert.rejects(() => ask({ message: "no" }, 401), (e: unknown) => e instanceof HttpError && e.status === 502 && /401/.test(e.message));
});

Deno.test("the access token for the stream is the current one, renewed when it is about to run out", async () => {
  const { w, instance, issue } = world();
  w.answer = issue;
  const s = instance();
  assert.equal(await s.access(), null);
  await s.connect("code-12345");
  assert.deepEqual(await s.access(), { token: "access-1", until: new Date(T0 + 30 * MIN).toISOString() });
  w.now = T0 + 29 * MIN;
  assert.deepEqual(await s.access(), { token: "access-2", until: new Date(T0 + 59 * MIN).toISOString() });
  w.now = T0 + SIGN_IN_MS + MIN;
  assert.equal(await instance().access(), null);
});

// ---- the data shapes
const at = Date.parse("2026-11-20T19:31:00Z");   // 14:31 in New York
Deno.test("a quote: live or delayed as Schwab marks it, and -999 means nothing", () => {
  const q = quoteFrom("SPY", { realtime: true, quote: { lastPrice: 712.4, netChange: -3.42, netPercentChange: -0.478, openPrice: 710.1, highPrice: 713, lowPrice: 708.2, closePrice: 715.82, totalVolume: 41234567, tradeTime: at, quoteTime: at + 500 } });
  assert.deepEqual([q.symbol, q.ok, q.price, q.change, q.changePct, q.open, q.high, q.low, q.prevClose, q.volume, q.timestamp, q.delay, q.source],
    ["SPY", true, 712.4, -3.42, -0.478, 710.1, 713, 708.2, 715.82, 41234567, "2026-11-20T19:31:00.000Z", 0, "Schwab"]);
  assert.equal(quoteFrom("SPY", { realtime: false, quote: { lastPrice: 712.4 } }).delay, 900);
  assert.equal(quoteFrom("SPY", { quote: { lastPrice: 712.4 } }).delay, 900, "not marked live is not called live");
  assert.equal(quoteFrom("SPX", { realtime: true, quote: { lastPrice: -999, mark: 0, closePrice: 7100.5 } }).price, 7100.5);
  for (const row of [undefined, null, {}, { quote: {} }, { quote: { lastPrice: 0, closePrice: -999 } }]) assert.throws(() => quoteFrom("NOPE", row), /no quote/);
});

Deno.test("candles: minutes of the latest session in New York time, and daily rows by date", () => {
  const m = (iso: string, c: number) => ({ open: c - 0.2, high: c + 0.3, low: c - 0.4, close: c, volume: 1000, datetime: Date.parse(iso) });
  const body = { symbol: "SPY", empty: false, candles: [m("2026-11-19T20:59:00Z", 715.8), m("2026-11-20T14:30:00Z", 710), m("2026-11-20T14:31:00Z", 710.5), { close: 0, datetime: 1 }, null] };
  const out = minutesFrom(body, true);
  assert.deepEqual([out.session, out.bars.length, out.bars[0][0], out.bars[1][0], out.bars[1][4], out.timestamp, out.delay, out.source], ["2026-11-20", 2, 570, 571, 710.5, "2026-11-20T14:31:00.000Z", 0, "Schwab"]);
  assert.equal(minutesFrom(body, false).delay, 900);
  assert.throws(() => minutesFrom({ candles: [] }, true), /no candles/);
  const d = (iso: string, c: number) => ({ open: c, high: c + 1, low: c - 1, close: c, volume: 5, datetime: Date.parse(iso) });
  const daily = dailyFrom({ candles: [d("2026-07-01T05:00:00Z", 1), d("2026-11-18T06:00:00Z", 2), d("2026-11-19T06:00:00Z", 3)] }, 2);   // Schwab stamps a day at midnight Chicago time
  assert.deepEqual(daily, [["2026-11-18", 2, 3, 1, 2, 5], ["2026-11-19", 3, 4, 2, 3, 5]]);
  assert.equal(dailyFrom({ candles: [d("2026-07-01T05:00:00Z", 1)] }, 5)[0][0], "2026-07-01");
});

Deno.test("an option chain becomes what the chain reader expects", () => {
  const c = (symbol: string, more: Record<string, unknown> = {}) => ({ symbol, bid: 1.2, ask: 1.3, last: 1.25, totalVolume: 900, openInterest: 4321, volatility: 23.4, delta: 0.51, gamma: 0.02, theta: -0.4, vega: 0.11, multiplier: 100, ...more });
  const quote = { timestamp: "2026-11-20T19:31:00.000Z", price: 712.4, prevClose: 715.82, open: 710.1, high: 713, low: 708.2, close: 712.4, volume: 1, change: -3.42, changePct: -0.478 };
  const first = { underlyingPrice: 712.55, callExpDateMap: { "2026-11-20:0": { "712.0": [c("SPY   261120C00712000")], "713.0": [c("SPY   261120C00713000", { volatility: -999, delta: -999 })] }, "2026-11-23:3": { "712.0": c("SPY   261123C00712000") } },
    putExpDateMap: { "2026-11-20:0": { "712.0": [c("SPY   261120P00712000", { bid: undefined, ask: undefined, last: undefined, bidPrice: 2, askPrice: 2.2, lastPrice: 2.1 })], "700.0": [c("SPY   261120P00700000", { multiplier: 10 }), c("SPY   261120P00700000X", { nonStandard: true })] } } };
  const second = { callExpDateMap: { "2026-11-20:0": { "712.0": [c("SPY   261120C00712000", { openInterest: 5000 })] }, "2026-12-18:28": { "720.0": [c("SPY   261218C00720000", { volatility: 18 })] } }, putExpDateMap: {} };
  const raw = chainFrom([first, second], quote);
  assert.deepEqual(raw.data.options.map((o) => o.option).sort(), ["SPY261120C00712000", "SPY261120C00713000", "SPY261120P00712000", "SPY261123C00712000", "SPY261218C00720000"]);
  const by = Object.fromEntries(raw.data.options.map((o) => [o.option, o]));
  assert.deepEqual(by.SPY261120C00712000, { option: "SPY261120C00712000", bid: 1.2, ask: 1.3, last_trade_price: 1.25, volume: 900, open_interest: 5000, iv: 0.23399999999999999, delta: 0.51, gamma: 0.02, theta: -0.4, vega: 0.11 });
  assert.deepEqual([by.SPY261120C00713000.iv, by.SPY261120C00713000.delta, by.SPY261120P00712000.bid, by.SPY261120P00712000.ask, by.SPY261120P00712000.last_trade_price, by.SPY261218C00720000.iv], [0, 0, 2, 2.2, 2.1, 0.18]);
  assert.deepEqual([raw.timestamp, raw.data.current_price, raw.data.prev_day_close], ["2026-11-20T19:31:00.000Z", 712.55, 715.82]);
  // a chain that already comes in fractions is left alone
  assert.equal(chainFrom([{ callExpDateMap: { "2026-11-20:0": { "712.0": [c("SPY   261120C00712000", { volatility: 0.234 })] } } }], quote).data.options[0].iv, 0.234);
  assert.equal(chainFrom([{ callExpDateMap: { "2026-11-20:0": { "712.0": [c("SPY   261120C00712000")] } } }], quote).data.current_price, 712.4);
  assert.throws(() => chainFrom([{ callExpDateMap: {}, putExpDateMap: {} }, {}], quote), /empty option chain/);
});

Deno.test("a chain is asked for the next 46 days, whole or in four parts, and further when the app wants a later expiry", () => {
  const a = chainAsks("2026-11-20", null);
  assert.deepEqual(a.whole, [{ contractType: "ALL", strategy: "SINGLE", includeUnderlyingQuote: "true", strikeCount: "120", fromDate: "2026-11-20", toDate: "2027-01-05" }]);
  assert.deepEqual(a.parts.map((p) => [p.fromDate, p.toDate]), [["2026-11-20", "2026-11-23"], ["2026-11-24", "2026-11-30"], ["2026-12-01", "2026-12-14"], ["2026-12-15", "2027-01-05"]]);
  assert.equal(chainAsks("2026-11-20", "2026-12-18").whole[0].toDate, "2027-01-05");
  assert.deepEqual([chainAsks("2026-11-20", "2027-03-19").whole[0].toDate, chainAsks("2026-11-20", "2027-03-19").parts[3].toDate], ["2027-03-19", "2027-03-19"]);
});

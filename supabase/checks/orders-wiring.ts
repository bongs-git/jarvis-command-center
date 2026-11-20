// The real indai-orders function, served locally. Schwab and the database are stand-ins that record every call.
// deno run -A supabase/checks/orders-wiring.ts "$PWD/supabase/indai-orders/index.ts"   (not part of `deno test`: it serves on port 8000)
import assert from "node:assert/strict";
const real = globalThis.fetch;
const OWNER = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const H1 = "HASHAAAA1111", H2 = "HASHBBBB2222";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(Date.now()), yy = today.slice(2, 4) + today.slice(5, 7) + today.slice(8, 10);
const SPY = `SPY   ${yy}C00695000`, QQQ = `QQQ   ${yy}P00600000`, SPXW = `SPXW  ${yy}C07000000`, SPX = `SPX   ${yy}C07000000`;
let connected = true, refuse: { status: number; body: unknown } | null = null, hang = false, mark = 1.445, nextId = 9000;
const sent: { method: string; path: string; body: any }[] = [], asked: string[] = [], buckets: string[] = [];
const audit: any[] = []; let devs: any[] = [];
let orders: any[] = [], positions: any[] = [];
const optLeg = (instruction: string, symbol: string, quantity: number) => ({ instruction, quantity, instrument: { assetType: "OPTION", symbol, description: symbol.trim() } });
const reset = () => {
  positions = [{ longQuantity: 2, shortQuantity: 0, averageLongPrice: 1.24, averagePrice: 1.24, marketValue: 289, longOpenProfitLoss: 41, currentDayProfitLoss: 41, instrument: { assetType: "OPTION", symbol: SPY, description: "SPY 695 C" } },
    { longQuantity: 1, shortQuantity: 0, averageLongPrice: 2, marketValue: 180, instrument: { assetType: "OPTION", symbol: QQQ, description: "QQQ 600 P" } }];
  orders = [{ orderId: 1, status: "FILLED", orderType: "LIMIT", price: 1.25, quantity: 2, filledQuantity: 2, orderStrategyType: "TRIGGER", enteredTime: new Date().toISOString(), orderLegCollection: [optLeg("BUY_TO_OPEN", SPY, 2)],
    childOrderStrategies: [{ orderId: 2, status: "WORKING", orderType: "STOP", stopPrice: 1, stopType: "MARK", quantity: 2, cancelable: true, enteredTime: new Date().toISOString(), orderLegCollection: [optLeg("SELL_TO_CLOSE", SPY, 2)] }] }];
};
reset();
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input)), method = init.method ?? "GET";
  if (url.host === "127.0.0.1:8000") return real(input, init);
  const head = new Headers(init.headers), body = init.body ? JSON.parse(String(init.body)) : null;
  if (url.host === "api.schwabapi.com") {
    assert.equal(head.get("Authorization"), "Bearer access-SECRET-1");
    assert.ok(!url.href.includes("+"), "a space goes out as %20: " + url.href);
    asked.push(method + " " + url.pathname);
    const p = url.pathname;
    if (p === "/trader/v1/accounts/accountNumbers") return Response.json([{ accountNumber: "11111234", hashValue: H1 }, { accountNumber: "22225678", hashValue: H2 }]);
    if (p === "/marketdata/v1/quotes") {
      const out: Record<string, unknown> = {};
      for (const s of url.searchParams.get("symbols")!.split(",")) out[s] = { assetMainType: "OPTION", realtime: true, symbol: s, quote: { bidPrice: mark - 0.005, askPrice: mark + 0.005, mark, lastPrice: 1.46, delta: 0.41, underlyingPrice: 695.2 } };
      return Response.json(out);
    }
    if (p === "/marketdata/v1/chains") {
      const k = url.searchParams.get("strike"), day = url.searchParams.get("fromDate")!, idx = url.searchParams.get("symbol") === "$SPX";
      assert.equal(url.searchParams.get("toDate"), day);
      const c = (symbol: string) => ({ symbol, description: symbol.trim(), bid: 1.44, ask: 1.45, mark: 1.445, last: 1.46, delta: 0.41 });
      if (k === "999") return Response.json({ status: "FAILED", callExpDateMap: {}, putExpDateMap: {} });
      return Response.json({ status: "SUCCESS", callExpDateMap: { [day + ":0"]: { [k + ".0"]: idx ? [c(SPX), c(SPXW)] : [c(SPY)] } }, putExpDateMap: {} });
    }
    if (p === "/marketdata/v1/pricehistory") { assert.equal(url.searchParams.get("symbol"), SPY); return Response.json({ symbol: SPY, empty: false, candles: [{ open: 1, high: 1.2, low: 0.9, close: 1.1, volume: 10, datetime: Date.now() - 120000 }, { open: 1.1, high: 1.5, low: 1.1, close: 1.4, volume: 20, datetime: Date.now() - 60000 }] }); }
    const m = p.match(/^\/trader\/v1\/accounts\/(HASH[A-Z0-9]+)(\/.*)?$/);
    if (m) {
      const rest = m[2] ?? "";
      if (method === "GET" && rest === "") return Response.json({ securitiesAccount: { accountNumber: "11111234", type: "MARGIN", currentBalances: { buyingPower: 54321.99 }, positions: m[1] === H1 ? positions : [] } });
      if (method === "GET" && rest === "/orders") return Response.json(m[1] === H1 ? orders : []);
      sent.push({ method, path: m[1] + rest, body });
      if (hang) throw new DOMException("timed out", "TimeoutError");
      if (refuse) return new Response(JSON.stringify(refuse.body), { status: refuse.status });
      if (rest === "/previewOrder") return Response.json({ orderValidationResult: { rejects: [], warns: [{ message: "This option expires today." }] } });
      if (method === "DELETE") return new Response(null, { status: 200 });
      return new Response(null, { status: 201, headers: { Location: "https://api.schwabapi.com/trader/v1/accounts/" + m[1] + "/orders/" + (++nextId) } });
    }
    throw new Error("unexpected Schwab call: " + method + " " + url);
  }
  if (url.pathname === "/auth/v1/user") return head.get("Authorization") === "Bearer other-token" ? Response.json({ id: OTHER }) : new Response("{}", { status: 401 });
  if (url.pathname === "/rest/v1/indai_owner") return Response.json([{ user_id: OWNER }]);
  if (url.pathname === "/rest/v1/rpc/indai_take_request") { buckets.push(body.p_bucket + "/" + body.p_limit); return Response.json(true); }
  if (url.pathname === "/rest/v1/indai_schwab") return Response.json(connected ? [{ refresh_token: "refresh-SECRET", signed_in_at: new Date().toISOString(), access_token: "access-SECRET-1", access_until: new Date(Date.now() + 20 * 60_000).toISOString() }] : []);
  if (url.pathname === "/rest/v1/indai_trade_devices") {
    const hash = (url.searchParams.get("key_hash") ?? "").replace("eq.", "");
    if (method === "GET") return Response.json(devs);
    if (method === "POST") { assert.match(body.key_hash, /^[0-9a-f]{64}$/); devs.push({ ...body, added_at: new Date(Date.now() + devs.length).toISOString() }); return new Response(null, { status: 201 }); }
    if (method === "PATCH") { Object.assign(devs.find((d) => d.key_hash === hash), body); return new Response(null, { status: 204 }); }
    if (method === "DELETE") { devs = devs.filter((d) => d.key_hash !== hash || (url.searchParams.get("approved") === "is.false" && d.approved)); return new Response(null, { status: 204 }); }
  }
  if (url.pathname === "/rest/v1/indai_orders") {
    if (method === "POST") { assert.match(url.search, /on_conflict=nonce/); assert.match(head.get("Prefer") ?? "", /ignore-duplicates/); if (audit.some((a) => a.nonce === body.nonce)) return Response.json([]); audit.push({ ...body, status: null, order_id: null, message: null }); return Response.json([body], { status: 201 }); }
    const row = audit.find((a) => "eq." + a.nonce === url.searchParams.get("nonce"));
    if (method === "PATCH") { Object.assign(row, body); return new Response(null, { status: 204 }); }
    return Response.json(row ? [row] : []);
  }
  throw new Error("unexpected outside call: " + method + " " + url);
}) as typeof fetch;
Deno.env.set("SUPABASE_URL", "http://rest.invalid"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service"); Deno.env.set("SUPABASE_ANON_KEY", "public-key"); Deno.env.set("INDAI_PASSCODE", "open sesame");
Deno.env.set("SCHWAB_APP_KEY", "app-key-TEST"); Deno.env.set("SCHWAB_APP_SECRET", "app-secret-TEST");
await import(Deno.args[0]);
await new Promise((r) => setTimeout(r, 300));
let n = 0; const ok = (name: string) => console.log(`ok ${++n} ${name}`);
const KEY = "k".repeat(43), KEY2 = "m".repeat(43);
const pass: Record<string, string> = { "x-indai-pass": "open sesame", "x-indai-device": KEY }, bare = { "x-indai-pass": "open sesame" }, pub = { Authorization: "Bearer public-key", apikey: "public-key" };
const post = async (body: unknown, headers: Record<string, string> = pass, method = "POST") => { sent.length = 0; asked.length = 0; buckets.length = 0; const r = await real("http://127.0.0.1:8000/", { method, headers: { ...pub, ...headers, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }); const text = await r.text(); assert.ok(!/SECRET|HASH|11111234|22225678|54321|kkkkk|mmmmm/.test(text), "nothing private in an answer: " + text.slice(0, 200)); return { status: r.status, j: JSON.parse(text || "{}"), text, cache: r.headers.get("cache-control") }; };
const uuid = () => crypto.randomUUID();
const buy = { symbol: SPY, qty: 2, limit: 1.25, stop: 1 };
const stopJson = (qty: number, stop: number) => ({ orderType: "STOP", session: "NORMAL", stopPrice: stop, stopType: "MARK", duration: "DAY", orderStrategyType: "SINGLE", orderLegCollection: [{ instruction: "SELL_TO_CLOSE", quantity: qty, instrument: { symbol: SPY, assetType: "OPTION" } }] });

let r = await post({ op: "book" }, {}); assert.deepEqual([r.status, r.j.error, asked.length], [401, "passcode", 0]);
r = await post({ op: "enroll" }, { "x-indai-device": KEY }); assert.deepEqual([r.status, devs.length], [401, 0]);
// the devices that may send
r = await post({ op: "place", account: "1234", nonce: crypto.randomUUID(), order: { symbol: SPY, qty: 1, limit: 1 } }); assert.deepEqual([r.status, r.j.error, sent.length, asked.length], [403, "device", 0, 0]);
r = await post({ op: "enroll" }, bare); assert.equal(r.status, 400);
r = await post({ op: "enroll", label: "iPhone <script>" }); assert.deepEqual([r.status, r.j.enrolled, r.j.first, /^[0-9A-F]{6}$/.test(r.j.code), devs[0].label, devs[0].approved], [200, true, true, true, "iPhone script", true]);
const code1 = r.j.code;
r = await post({ op: "enroll" }); assert.deepEqual([r.j.enrolled, r.j.first, devs.length], [true, false, 1]);
r = await post({ op: "enroll", label: "Mac" }, { ...bare, "x-indai-device": KEY2 }); assert.deepEqual([r.j.enrolled, r.j.first, devs.length], [false, false, 2]);
const code2 = r.j.code;
for (const op of ["place", "stop", "close", "cancel"]) { r = await post({ op, account: "1234", nonce: crypto.randomUUID(), symbol: SPY, stop: 1, limit: 1, order_id: "2", order: { symbol: SPY, qty: 1, limit: 1 } }, { ...bare, "x-indai-device": KEY2 }); assert.deepEqual([r.status, r.j.error, sent.length, asked.length], [403, "device", 0, 0], op); }
for (const op of ["devices", "approve", "forget"]) { r = await post({ op, code: code2 }, { ...bare, "x-indai-device": KEY2 }); assert.deepEqual([r.status, r.j.error], [403, "device"], op); r = await post({ op, code: code2 }, bare); assert.equal(r.status, 403, op); }
r = await post({ op: "devices" }); assert.deepEqual(r.j.devices.map((d: any) => [d.code, d.label, d.approved, d.this]), [[code1, "iPhone script", true, true], [code2, "Mac", false, false]]);
r = await post({ op: "approve", code: "ZZZZZZ" }); assert.equal(r.status, 404);
r = await post({ op: "approve", code: code2.toLowerCase() }); assert.deepEqual(r.j.devices.map((d: any) => d.approved), [true, true]);
r = await post({ op: "devices" }, { ...bare, "x-indai-device": KEY2 }); assert.deepEqual([r.status, r.j.devices[1].this], [200, true]);
r = await post({ op: "forget", code: code2 }); assert.deepEqual([r.j.devices.length, devs.length], [1, 1]);
for (let i = 0; i < 7; i++) await post({ op: "enroll" }, { ...bare, "x-indai-device": String(i).repeat(43) });
assert.deepEqual([devs.length, devs.filter((d) => d.approved).length], [6, 1], "at most five devices wait at a time, and the approved one stays");
ok("sending needs an approved device: the first to ask is approved, later ones wait for an approved device, and the passcode alone cannot send or approve");
r = await post({ op: "place", account: "1234", nonce: uuid(), order: buy }, { "x-indai-pass": "guess" }); assert.deepEqual([r.status, sent.length, audit.length], [401, 0, 0]);
r = await post({ op: "place", account: "1234", nonce: uuid(), order: buy }, { Authorization: "Bearer other-token" }); assert.deepEqual([r.status, r.j.error, sent.length, audit.length], [403, "forbidden", 0, 0]);
r = await post(null, pass, "GET"); assert.equal(r.status, 405);
r = await post({ op: "sell_everything" }); assert.deepEqual([r.status, asked.length], [400, 0]);
ok("only the owner is answered, and only the listed operations exist");

connected = false; r = await post({ op: "place", account: "1234", nonce: uuid(), order: buy }); assert.deepEqual([r.status, r.j.error, sent.length], [409, "not_connected", 0]); connected = true;
r = await post({ op: "accounts" }); assert.deepEqual([r.status, r.j, r.cache, buckets], [200, { accounts: [{ tail: "1234" }, { tail: "5678" }], max_order_usd: 5000 }, "no-store", ["orders/1500"]]);
r = await post({ op: "book" }); assert.deepEqual([r.status, r.j.error], [400, "choose_account"]);
r = await post({ op: "book", account: "0000" }); assert.equal(r.j.error, "choose_account");
ok("accounts go by their last four digits; with two of them one must be chosen");

r = await post({ op: "quote", underlying: "SPY", expiry: today, type: "C", strike: 695 });
assert.deepEqual([r.status, r.j.symbol, r.j.bid, r.j.ask, r.j.mark, r.j.contract.strike, r.j.choices], [200, SPY, 1.44, 1.45, 1.445, 695, []]);
r = await post({ op: "quote", underlying: "SPX", expiry: today, type: "C", strike: 7000 });
assert.deepEqual([r.status, r.j.contract, r.j.choices.map((c: any) => c.root)], [200, null, ["SPX", "SPXW"]]);
r = await post({ op: "quote", underlying: "SPX", expiry: today, type: "C", strike: 7000, root: "SPXW" }); assert.equal(r.j.symbol, SPXW);
r = await post({ op: "quote", underlying: "SPY", expiry: today, type: "C", strike: 999 }); assert.deepEqual([r.status, r.j.error], [404, "no_contract"]);
r = await post({ op: "quote", symbol: SPY }); assert.deepEqual([r.status, r.j.mark, r.j.delta], [200, 1.445, 0.41]);
for (const bad of [{ underlying: "SPY", expiry: "11/20/2026", type: "C", strike: 695 }, { underlying: "spy; drop", expiry: today, type: "C", strike: 695 }, { underlying: "SPY", expiry: today, type: "X", strike: 695 }, { underlying: "SPY", expiry: "2020-01-17", type: "C", strike: 695 }, { symbol: "SPY" }]) { r = await post({ op: "quote", ...bad }); assert.equal(r.status, 400, JSON.stringify(bad)); }
r = await post({ op: "history", symbol: SPY }); assert.deepEqual([r.status, r.j.bars.length, r.j.bars[1].slice(1)], [200, 2, [1.1, 1.5, 1.1, 1.4, 20]]);
ok("a contract is found by its parts or its name; an index with two contracts on one day asks which");

r = await post({ op: "book", account: "1234" });
assert.deepEqual([r.status, r.j.account, r.j.positions.map((p: any) => [p.symbol, p.qty, p.avg, p.quote.mark, p.stop && p.stop.id, p.stop && p.stop.stop, p.sells])], [200, "1234", [[QQQ, 1, 2, 1.445, null, null, 0], [SPY, 2, 1.24, 1.445, "2", 1, 1]]]);
assert.deepEqual([r.j.orders.map((o: any) => o.id).sort(), sent.length, buckets], [["1", "2"], 0, ["orders/1500"]]);
r = await post({ op: "book", account: "5678" }); assert.deepEqual([r.j.positions, r.j.orders], [[], []]);
ok("the book: his long options with live quotes and the stop working on each, his orders, and nothing private");

r = await post({ op: "preview", account: "1234", order: buy });
assert.deepEqual([r.status, r.j, sent.map((s) => s.method + " " + s.path)], [200, { cost: 250, checked: true, ok: true, rejects: [], warns: ["This option expires today."] }, ["POST " + H1 + "/previewOrder"]]);
refuse = { status: 404, body: {} }; r = await post({ op: "preview", account: "1234", order: buy }); assert.deepEqual([r.status, r.j.checked, r.j.ok], [200, false, null]); refuse = null;
assert.equal(audit.length, 0);
ok("preview asks Schwab's own check and sends nothing");

const first = uuid();
r = await post({ op: "place", account: "1234", nonce: first, order: buy });
assert.deepEqual([r.status, r.j, buckets], [200, { ok: true, order_id: "9001" }, ["orders-send/60"]]);
assert.deepEqual(sent, [{ method: "POST", path: H1 + "/orders", body: { orderType: "LIMIT", session: "NORMAL", price: 1.25, duration: "DAY", complexOrderStrategyType: "NONE", orderStrategyType: "TRIGGER", orderLegCollection: [{ instruction: "BUY_TO_OPEN", quantity: 2, instrument: { symbol: SPY, assetType: "OPTION" } }], childOrderStrategies: [stopJson(2, 1)] } }]);
assert.deepEqual(audit.map((a) => [a.nonce, a.op, a.account_tail, a.request, a.status, a.order_id, a.message]), [[first, "place", "1234", { symbol: SPY, qty: 2, limit: 1.25, stop: 1, cost: 250 }, 201, "9001", "accepted"]]);
r = await post({ op: "place", account: "1234", nonce: first, order: buy });
assert.deepEqual([r.status, r.j.duplicate, r.j.order_id, sent.length, audit.length], [200, true, "9001", 0, 1]);
r = await post({ op: "place", account: "5678", nonce: uuid(), order: { ...buy, stop: null } }); assert.deepEqual([sent[0].path, sent[0].body.orderStrategyType, "childOrderStrategies" in sent[0].body], [H2 + "/orders", "SINGLE", false]);
ok("a buy is sent once, exactly as written, to the chosen account, with its stop; the same tap twice is sent once");

const before = audit.length;
for (const [order, code] of [[{ ...buy, qty: 50, limit: 1.01 }, "over_cap"], [{ ...buy, limit: 50.01, qty: 1 }, "over_cap"], [{ ...buy, stop: 1.3 }, "bad_stop"], [{ ...buy, qty: 0 }, "bad_quantity"], [{ ...buy, symbol: "AAPL" }, "bad_contract"], [{ ...buy, symbol: "SPY   200117C00300000" }, "expired"], [null, "bad_contract"]] as [unknown, string][]) {
  r = await post({ op: "place", account: "1234", nonce: uuid(), order }); assert.deepEqual([r.status, r.j.error, sent.length], [400, code, 0], JSON.stringify(order));
}
r = await post({ op: "place", account: "1234", nonce: "not-a-uuid", order: buy }); assert.deepEqual([r.status, sent.length], [400, 0]);
r = await post({ op: "place", account: "1234", order: buy }); assert.deepEqual([r.status, sent.length], [400, 0]);
r = await post({ op: "place", account: "9999", nonce: uuid(), order: buy }); assert.deepEqual([r.j.error, sent.length], ["choose_account", 0]);
assert.equal(audit.length, before);
ok("over $5,000, a stop above the price, a bad quantity or contract, no nonce, an unknown account: refused, nothing sent");

refuse = { status: 400, body: { message: "Insufficient buying power." } }; const refused = uuid();
r = await post({ op: "place", account: "1234", nonce: refused, order: buy });
assert.deepEqual([r.status, r.j.error, r.j.message], [422, "schwab_refused", "Schwab refused it: Insufficient buying power. (Schwab 400)"]);
assert.deepEqual([audit.at(-1).status, audit.at(-1).message, audit.at(-1).order_id], [400, "Insufficient buying power. (Schwab 400)", null]); refuse = null;
hang = true; r = await post({ op: "place", account: "1234", nonce: uuid(), order: buy }); assert.deepEqual([r.status, r.j.error, audit.at(-1).status], [502, "schwab", 0]); assert.match(r.j.message, /look at your orders/); hang = false;
ok("Schwab's refusal is passed on in its own words and recorded; no answer is said to be unknown");

r = await post({ op: "stop", account: "1234", nonce: uuid(), symbol: SPY, stop: 1.1 });
assert.deepEqual([r.status, r.j.ok, sent], [200, true, [{ method: "PUT", path: H1 + "/orders/2", body: stopJson(2, 1.1) }]]);
assert.deepEqual(audit.at(-1).request, { symbol: SPY, qty: 2, stop: 1.1, replaces: "2" });
for (const stop of [1.45, 1.5, 99]) { r = await post({ op: "stop", account: "1234", nonce: uuid(), symbol: SPY, stop }); assert.deepEqual([r.status, r.j.error, sent.length], [400, "stop_above_price", 0]); }
assert.match(r.j.message, /would sell at once/);
for (const stop of [0, -1, "x", null, 1.234]) { r = await post({ op: "stop", account: "1234", nonce: uuid(), symbol: SPY, stop }); assert.deepEqual([r.status, r.j.error, sent.length], [400, "bad_stop", 0]); }
r = await post({ op: "stop", account: "1234", nonce: uuid(), symbol: QQQ, stop: 1 });
assert.deepEqual(sent, [{ method: "POST", path: H1 + "/orders", body: { ...stopJson(1, 1), orderLegCollection: [{ instruction: "SELL_TO_CLOSE", quantity: 1, instrument: { symbol: QQQ, assetType: "OPTION" } }] } }]);
r = await post({ op: "stop", account: "1234", nonce: uuid(), symbol: `IWM   ${yy}C00250000`, stop: 1 }); assert.deepEqual([r.status, r.j.error, sent.length], [409, "no_position", 0]);
r = await post({ op: "stop", account: "5678", nonce: uuid(), symbol: SPY, stop: 1 }); assert.deepEqual([r.j.error, sent.length], ["no_position", 0]);
ok("moving a stop replaces the one resting at Schwab for the whole position; a stop at or above the price is refused; no stop yet places one");

r = await post({ op: "close", account: "1234", nonce: uuid(), symbol: SPY, limit: 1.44 });
assert.deepEqual(sent, [{ method: "PUT", path: H1 + "/orders/2", body: { orderType: "LIMIT", session: "NORMAL", price: 1.44, duration: "DAY", complexOrderStrategyType: "NONE", orderStrategyType: "SINGLE", orderLegCollection: [{ instruction: "SELL_TO_CLOSE", quantity: 2, instrument: { symbol: SPY, assetType: "OPTION" } }] } }]);
r = await post({ op: "close", account: "1234", nonce: uuid(), symbol: QQQ, limit: 1.44 }); assert.deepEqual([sent[0].method, sent[0].path, sent[0].body.orderLegCollection[0].quantity], ["POST", H1 + "/orders", 1]);
r = await post({ op: "close", account: "1234", nonce: uuid(), symbol: SPY, limit: 0 }); assert.deepEqual([r.j.error, sent.length], ["bad_price", 0]);
orders.push({ orderId: 7, status: "WORKING", orderType: "LIMIT", price: 3, quantity: 2, enteredTime: new Date().toISOString(), orderLegCollection: [optLeg("SELL_TO_CLOSE", SPY, 2)] });
r = await post({ op: "close", account: "1234", nonce: uuid(), symbol: SPY, limit: 1.44 }); assert.deepEqual([r.status, r.j.error, sent.length], [409, "several_sells", 0]);
r = await post({ op: "stop", account: "1234", nonce: uuid(), symbol: SPY, stop: 1 }); assert.deepEqual([r.j.error, sent.length], ["several_sells", 0]);
ok("closing sells the whole position with a limit, taking the stop's place so the contract is never offered twice");

r = await post({ op: "cancel", account: "1234", nonce: uuid(), order_id: "7" }); assert.deepEqual([r.status, r.j.ok, sent], [200, true, [{ method: "DELETE", path: H1 + "/orders/7", body: null }]]);
for (const order_id of ["1", "404", 7, "7; drop", null]) { r = await post({ op: "cancel", account: "1234", nonce: uuid(), order_id }); assert.deepEqual([r.status >= 400, sent.length], [true, 0], String(order_id)); }
ok("cancel takes one of his working orders and nothing else");
console.log("sends recorded: " + audit.length + ", every one with an account tail and no account number: " + audit.every((a) => /^\d{4}$/.test(a.account_tail) && !/HASH|11111234/.test(JSON.stringify(a))));
Deno.exit(0);

import { serve } from "../_shared/http.ts";
// INDAI -> Schwab orders, for the owner alone. INDAI never sends an order by herself: every request here is his
// own tap on the Trade page, carrying his passcode or his sign-in. The rules for what may be sent are in orders.ts.
//   POST {op:"accounts"}                                   his accounts, by their last four digits
//   POST {op:"quote", symbol} or {op:"quote", underlying, expiry, type, strike}   one contract's live quote
//   POST {op:"book", account}                              the options he holds, with quotes, and his orders
//   POST {op:"history", symbol}                            today's one-minute candles of one contract
//   POST {op:"preview", account, order}                    Schwab's own check of a buy, nothing sent
//   POST {op:"place", account, nonce, order}               buy to open with a limit, and its stop
//   POST {op:"stop", account, nonce, symbol, stop}         move the stop on a contract he holds (or place one)
//   POST {op:"close", account, nonce, symbol, limit}       sell the whole position with a limit
//   POST {op:"cancel", account, nonce, order_id}           cancel one working order
// order = { symbol, qty, limit, stop? }. `nonce` is a UUID the page makes for each tap; the same one is never sent twice.
// Sending (place, stop, close, cancel) needs more than the passcode: the header x-indai-device carries a key that one
// of his own devices made and keeps, and only an approved device may send.
//   POST {op:"enroll", label?}                             this device: approved at once if it is the first, else waiting
//   POST {op:"devices"} / {op:"approve", code} / {op:"forget", code}   from an approved device: list, approve, remove
import { account } from "../_shared/auth.ts";
import { db, rpc, uuid } from "../_shared/db.ts";
import { failure, HttpError, objectBody } from "../_shared/http.ts";
import { MARKET, schwabApp, schwabSession, TRADER } from "../_shared/schwab.ts";
import { buyOrder, checkBuy, contract, contractsFrom, MAX_ORDER_USD, newYorkDay, ordersFrom, parseOcc, positionsFrom, previewFrom, price, quotesFrom, refusal, sellOrder, stopOrder, underlyingOf, usd, workingSells } from "./orders.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-indai-pass, x-indai-device",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const READS = new Set(["accounts", "quote", "book", "history", "preview"]), SENDS = new Set(["place", "stop", "close", "cancel"]), DEVICES = new Set(["enroll", "devices", "approve", "forget"]);
const cap = () => { const n = Number(Deno.env.get("INDAI_ORDER_MAX_USD")); return n > 0 && n < MAX_ORDER_USD ? n : MAX_ORDER_USD; };   // a secret can lower the limit, never raise it

async function schwab(token: string, method: string, url: string, body?: unknown) {
  let r: Response;
  try {
    r = await fetch(url, { method, headers: { Authorization: "Bearer " + token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12_000) });
  } catch { throw new HttpError(502, "schwab", "Schwab did not answer. Nothing is known about this request: look at your orders before trying again."); }
  const text = await r.text().catch(() => "");
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, ok: r.ok, data, id: r.headers.get("location")?.match(/\/orders\/(\d+)\s*$/)?.[1] ?? null };
}
const read = async (token: string, url: string, what: string) => {
  const r = await schwab(token, "GET", url);
  if (!r.ok) throw new HttpError(502, "schwab", "Schwab did not give " + what + ": " + refusal(r.data, r.status));
  return r.data;
};
// His accounts are named by their last four digits; Schwab's own handle for each stays in the back end.
let known: { at: number; map: Map<string, string> } | null = null;
async function accounts(token: string) {
  if (known && Date.now() - known.at < 600_000) return known.map;
  const list = await read(token, TRADER + "/accounts/accountNumbers", "your accounts");
  const map = new Map<string, string>();
  for (const a of Array.isArray(list) ? list : []) if (typeof a?.accountNumber === "string" && typeof a?.hashValue === "string" && /^[A-Za-z0-9]+$/.test(a.hashValue)) map.set(a.accountNumber.slice(-4), a.hashValue);
  if (!map.size) throw new HttpError(502, "schwab", "Schwab listed no account for this sign-in.");
  known = { at: Date.now(), map };
  return map;
}
async function chosen(token: string, tail: unknown) {
  const map = await accounts(token);
  if (typeof tail === "string" && map.has(tail)) return { tail, hash: map.get(tail)! };
  if (tail == null && map.size === 1) { const [[t, h]] = [...map]; return { tail: t, hash: h }; }
  throw new HttpError(400, "choose_account", "Choose which Schwab account to use.");
}
// A contract's name has spaces in it: they go out as %20, the way Schwab's own examples write them.
const qs = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
const ordersUrl = (hash: string, now: number) => TRADER + "/accounts/" + hash + "/orders?" + qs({ fromEnteredTime: new Date(now - 60 * 86400_000).toISOString(), toEnteredTime: new Date(now + 3600_000).toISOString(), maxResults: "250" });
const quotes = async (token: string, symbols: string[]) => symbols.length ? quotesFrom(await read(token, MARKET + "/quotes?" + qs({ symbols: symbols.join(","), fields: "quote", indicative: "false" }), "the option's price")) : {};

// One send: written down first, so that the same tap is never sent twice and every send has a record.
async function once(nonce: unknown, op: string, tail: string, request: unknown, send: () => Promise<{ status: number; ok: boolean; data: unknown; id: string | null }>) {
  if (typeof nonce !== "string" || !uuid.test(nonce)) throw new HttpError(400, "bad_request", "The request has no valid nonce.");
  const made = await db("indai_orders", { on_conflict: "nonce" }, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ nonce, op, account_tail: tail, request }) });
  if (!Array.isArray(made) || !made.length) {
    const [was] = await db("indai_orders", { nonce: "eq." + nonce, select: "status,order_id,message" });
    return json({ duplicate: true, ok: was?.status != null && was.status < 300, order_id: was?.order_id ?? null, message: was?.message ?? "This was already sent. Look at your orders." });
  }
  const note = (fields: Record<string, unknown>) => db("indai_orders", { nonce: "eq." + nonce }, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(fields) }).catch(() => {});
  let r;
  try { r = await send(); } catch (e) { await note({ status: 0, message: e instanceof Error ? e.message.slice(0, 300) : "failed" }); throw e; }
  if (!r.ok) {
    const message = refusal(r.data, r.status);
    await note({ status: r.status, message });
    throw new HttpError(422, "schwab_refused", "Schwab refused it: " + message);
  }
  await note({ status: r.status, order_id: r.id, message: "accepted" });
  return json({ ok: true, order_id: r.id });
}

// ---- the devices that may send
type Device = { key_hash: string; label: string; approved: boolean; added_at: string };
const code = (d: { key_hash: string }) => d.key_hash.slice(0, 6).toUpperCase();
async function deviceHash(req: Request) {
  const key = req.headers.get("x-indai-device") ?? "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(key)) return null;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const devices = (): Promise<Device[]> => db("indai_trade_devices", { select: "key_hash,label,approved,added_at", order: "added_at.asc" });
async function approvedDevice(req: Request) {
  const hash = await deviceHash(req), list = hash ? await devices() : [];
  if (!list.some((d) => d.key_hash === hash && d.approved)) throw new HttpError(403, "device", "This device is not approved to send orders. Approve it from a device that is, on the Trade page.");
  return { hash: hash!, list };
}
async function deviceOp(req: Request, body: Record<string, unknown>) {
  const shown = (list: Device[], mine: string) => list.map((d) => ({ code: code(d), label: d.label, approved: d.approved, added_at: d.added_at, this: d.key_hash === mine }));
  if (body.op === "enroll") {
    const hash = await deviceHash(req);
    if (!hash) throw new HttpError(400, "bad_request", "This device sent no key.");
    const list = await devices(), mine = list.find((d) => d.key_hash === hash);
    if (mine) return json({ enrolled: mine.approved, code: code(mine), first: false });
    const first = !list.some((d) => d.approved), waiting = list.filter((d) => !d.approved);
    for (const old of waiting.slice(0, Math.max(0, waiting.length - 4))) await db("indai_trade_devices", { key_hash: "eq." + old.key_hash, approved: "is.false" }, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    const label = typeof body.label === "string" ? body.label.replace(/[^\w .,()-]/g, "").slice(0, 40) : "";
    await db("indai_trade_devices", {}, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ key_hash: hash, label, approved: first }) });
    return json({ enrolled: first, code: hash.slice(0, 6).toUpperCase(), first });
  }
  const { hash, list } = await approvedDevice(req);
  if (body.op === "devices") return json({ devices: shown(list, hash) });
  const wanted = typeof body.code === "string" ? body.code.toUpperCase() : "", target = list.filter((d) => code(d) === wanted);
  if (target.length !== 1) throw new HttpError(404, "no_device", "No device has that code.");
  if (body.op === "approve") await db("indai_trade_devices", { key_hash: "eq." + target[0].key_hash }, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ approved: true }) });
  else await db("indai_trade_devices", { key_hash: "eq." + target[0].key_hash }, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return json({ devices: shown(await devices(), hash) });
}

serve("indai-orders", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method", message: "Use POST." }, 405);
  try {
    const body = await objectBody(req, 8000), op = body.op;
    const user = await account(req);
    const [owner] = await db("indai_owner", { select: "user_id", limit: "1" });
    if (!owner || owner.user_id !== user) throw new HttpError(403, "forbidden", "Only the owner trades.");
    if (!READS.has(op) && !SENDS.has(op) && !DEVICES.has(op)) throw new HttpError(400, "bad_request", "Choose accounts, quote, book, history, preview, place, stop, close, cancel, enroll, devices, approve or forget.");
    const [bucket, perHour] = SENDS.has(op) ? ["orders-send", 60] : ["orders", 1500];
    if (!await rpc("indai_take_request", { p_user: user, p_bucket: bucket, p_limit: perHour })) throw new HttpError(429, "rate_limited", "Hourly request limit reached. Try again later.");
    if (DEVICES.has(op)) return await deviceOp(req, body);
    if (SENDS.has(op)) await approvedDevice(req);
    const token = await schwabSession({ app: schwabApp() }).token();
    if (!token) throw new HttpError(409, "not_connected", "Schwab is not connected. Sign in on the Connect Schwab page first.");
    const now = Date.now();

    if (op === "accounts") return json({ accounts: [...(await accounts(token)).keys()].sort().map((tail) => ({ tail })), max_order_usd: cap() });
    if (op === "quote") {
      if (body.symbol != null) {
        const c = contract(body.symbol, now), q = (await quotes(token, [c.symbol]))[c.symbol];
        if (!q) throw new HttpError(404, "no_contract", "Schwab has no quote for that contract.");
        return json({ contract: c, ...q, choices: [] });
      }
      const type = body.type === "C" || body.type === "P" ? body.type : null, strike = typeof body.strike === "number" && body.strike > 0 ? body.strike : NaN;
      const under = typeof body.underlying === "string" && /^\$?[A-Z][A-Z0-9.]{0,5}$/.test(body.underlying) ? body.underlying : null;
      if (!type || !under || !(strike > 0) || typeof body.expiry !== "string" || !/^\d{4}-\d\d-\d\d$/.test(body.expiry)) throw new HttpError(400, "bad_contract", "Give the ticker, the expiry (YYYY-MM-DD), C or P and the strike.");
      if (body.expiry < newYorkDay(now)) throw new HttpError(400, "expired", "That expiry has passed.");
      const chain = await read(token, MARKET + "/chains?" + qs({ symbol: underlyingOf(under), contractType: type === "C" ? "CALL" : "PUT", strike: String(strike), fromDate: body.expiry, toDate: body.expiry, includeUnderlyingQuote: "false" }), "that contract");
      const found = contractsFrom(chain, body.expiry, strike).filter((c) => parseOcc(c.symbol)?.type === type);
      if (!found.length) throw new HttpError(404, "no_contract", "Schwab lists no such contract. Check the expiry and the strike.");
      const pick = found.length === 1 ? found[0] : found.find((c) => c.root === body.root);
      if (!pick) return json({ contract: null, choices: found.map((c) => ({ symbol: c.symbol, root: c.root, description: c.description })) });
      return json({ contract: parseOcc(pick.symbol), symbol: pick.symbol, bid: pick.bid, ask: pick.ask, mark: pick.mark, last: pick.last, delta: pick.delta, underlying_price: null, realtime: true, description: pick.description, choices: [] });
    }
    if (op === "history") {
      const c = contract(body.symbol, now);
      const h = await read(token, MARKET + "/pricehistory?" + qs({ symbol: c.symbol, periodType: "day", period: "1", frequencyType: "minute", frequency: "1", needExtendedHoursData: "false", endDate: String(now) }), "the contract's candles") as any;
      const bars = (Array.isArray(h?.candles) ? h.candles : []).filter((b: any) => b?.datetime > 0 && b.close > 0).map((b: any) => [b.datetime, b.open, b.high, b.low, b.close, b.volume ?? 0]);
      return json({ symbol: c.symbol, bars: bars.slice(-420) });
    }

    const acct = await chosen(token, body.account);
    const book = async () => {
      const [a, o] = await Promise.all([read(token, TRADER + "/accounts/" + acct.hash + "?fields=positions", "your positions"), read(token, ordersUrl(acct.hash, now), "your orders")]);
      return { positions: positionsFrom(a), orders: ordersFrom(o) };
    };
    if (op === "book") {
      const b = await book(), today = newYorkDay(now);
      const q = await quotes(token, b.positions.map((p) => p.symbol)).catch(() => ({} as Record<string, unknown>));
      return json({ account: acct.tail, at: new Date(now).toISOString(), max_order_usd: cap(),
        positions: b.positions.map((p) => ({ ...p, quote: q[p.symbol] ?? null, stop: workingSells(b.orders, p.symbol).find((o) => o.kind === "STOP") ?? null, sells: workingSells(b.orders, p.symbol).length })),
        orders: b.orders.filter((o) => o.asset === "OPTION" && (o.open || (o.entered ?? "") >= today)).slice(0, 60) });
    }
    if (op === "preview" || op === "place") {
      const o = checkBuy(body.order && typeof body.order === "object" ? body.order : {}, now, cap()), order = buyOrder(o, now);
      if (op === "preview") {
        const r = await schwab(token, "POST", TRADER + "/accounts/" + acct.hash + "/previewOrder", order);
        return json({ cost: o.cost, checked: r.ok, ...(r.ok ? previewFrom(r.data) : { ok: null, rejects: [], warns: ["Schwab's check did not answer: " + refusal(r.data, r.status)] }) });
      }
      return await once(body.nonce, "place", acct.tail, { symbol: o.symbol, qty: o.qty, limit: o.limit, stop: o.stop, cost: o.cost }, () => schwab(token, "POST", TRADER + "/accounts/" + acct.hash + "/orders", order));
    }
    if (op === "cancel") {
      const id = typeof body.order_id === "string" && /^\d{1,20}$/.test(body.order_id) ? body.order_id : null;
      if (!id) throw new HttpError(400, "bad_request", "Which order?");
      const target = (await book()).orders.find((o) => o.id === id);
      if (!target || !target.open) throw new HttpError(409, "not_working", "That order is no longer working.");
      return await once(body.nonce, "cancel", acct.tail, { order_id: id, symbol: target.symbol }, () => schwab(token, "DELETE", TRADER + "/accounts/" + acct.hash + "/orders/" + id));
    }
    // stop and close act on a contract he holds
    const c = contract(body.symbol, now), b = await book(), held = b.positions.find((p) => p.symbol === c.symbol);
    if (!held) throw new HttpError(409, "no_position", "You do not hold that contract in this account.");
    const sells = workingSells(b.orders, c.symbol);
    if (sells.length > 1) throw new HttpError(409, "several_sells", "More than one order is working to sell this contract. Cancel the extra ones first.");
    const place = (order: unknown) => () => sells.length
      ? schwab(token, "PUT", TRADER + "/accounts/" + acct.hash + "/orders/" + sells[0].id, order)
      : schwab(token, "POST", TRADER + "/accounts/" + acct.hash + "/orders", order);
    if (op === "stop") {
      const stop = price(body.stop);
      if (!(stop > 0)) throw new HttpError(400, "bad_stop", "The stop price is in dollars and cents, above zero.");
      if (sells.length && sells[0].kind !== "STOP") throw new HttpError(409, "selling", "A sell order is already working for this contract. Cancel it before setting a stop.");
      const q = (await quotes(token, [c.symbol]))[c.symbol], mark = q?.mark ?? q?.bid ?? null;
      if (mark == null) throw new HttpError(502, "schwab", "Schwab gave no price for this contract, so the stop was not changed.");
      if (!(stop < mark)) throw new HttpError(400, "stop_above_price", `That stop (${usd(stop)}) is at or above the option's price now (${usd(mark)}), so it would sell at once. Use Close to sell.`);
      return await once(body.nonce, "stop", acct.tail, { symbol: c.symbol, qty: held.qty, stop, replaces: sells[0]?.id ?? null }, place(stopOrder(c.symbol, held.qty, stop, now)));
    }
    const sellAt = price(body.limit);
    if (!(sellAt > 0)) throw new HttpError(400, "bad_price", "The limit price is in dollars and cents, above zero.");
    return await once(body.nonce, "close", acct.tail, { symbol: c.symbol, qty: held.qty, limit: sellAt, replaces: sells[0]?.id ?? null }, place(sellOrder(c.symbol, held.qty, sellAt)));
  } catch (e) { return failure(e); }
});

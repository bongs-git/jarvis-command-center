// The rules for an order INDAI may send to Schwab, the order as Schwab wants it, and Schwab's account answers
// turned into what the Trade page shows. Nothing here talks to anyone: indai-orders/index.ts does that.
// What may be sent, and nothing else:
//   - one option contract, bought to open with a limit price, with a stop to sell it resting at Schwab if asked;
//   - a stop on a contract he holds, moved or placed (it sells at market when the option's mark touches it);
//   - a contract he holds, sold to close with a limit price;
//   - one of his working orders, cancelled.
import { HttpError } from "../_shared/http.ts";

export const MAX_ORDER_USD = 5000;   // the owner's choice on November 20, 2026: nothing bigger is sent
export const MAX_CONTRACTS = 50;
export const DEFAULT_STOP = 0.2;     // his choice the same day: a buy goes out with a stop 20% under its limit price

export type Contract = { symbol: string; root: string; underlying: string; expiry: string; type: "C" | "P"; strike: number };
const INDEX: Record<string, string> = { SPX: "$SPX", SPXW: "$SPX", NDX: "$NDX", NDXP: "$NDX", RUT: "$RUT", RUTW: "$RUT", XSP: "$XSP", VIX: "$VIX", VIXW: "$VIX", DJX: "$DJX", OEX: "$OEX", XEO: "$XEO" };

// The name Schwab's market data knows a ticker or an option root by: an index takes a dollar sign.
export const underlyingOf = (root: string) => root.startsWith("$") ? root : INDEX[root] ?? root;
// Schwab's name for a contract, "SPY   261120C00695000": the root padded to six, the date, C or P, the strike in thousandths.
export function parseOcc(symbol: unknown): Contract | null {
  if (typeof symbol !== "string" || symbol.length !== 21) return null;
  const m = symbol.match(/^([A-Z][A-Z0-9.]{0,5})( *)(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/);
  if (!m || m[1].length + m[2].length !== 6) return null;
  const month = +m[4], day = +m[5], strike = +m[7] / 1000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || !(strike > 0)) return null;
  return { symbol, root: m[1], underlying: INDEX[m[1]] ?? m[1], expiry: `20${m[3]}-${m[4]}-${m[5]}`, type: m[6] as "C" | "P", strike };
}
export const newYorkDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(ms);
export const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const bad = (code: string, message: string) => new HttpError(400, code, message);
// A price in dollars and whole cents, or NaN.
export function price(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? Math.round(n * 100) / 100 : NaN;
}
export function contract(symbol: unknown, now: number): Contract {
  const c = parseOcc(symbol);
  if (!c) throw bad("bad_contract", "That is not an option contract INDAI can send.");
  if (c.expiry < newYorkDay(now)) throw bad("expired", "That contract has expired.");
  return c;
}
export function quantity(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw bad("bad_quantity", "The quantity is a whole number of contracts, 1 or more.");
  if (v > MAX_CONTRACTS) throw bad("over_cap", `INDAI sends at most ${MAX_CONTRACTS} contracts in one order.`);
  return v;
}

// A buy as the owner asks for it, checked against his limits. Throws with words fit to show him.
export function checkBuy(input: Record<string, unknown>, now: number, cap = MAX_ORDER_USD) {
  const c = contract(input.symbol, now), qty = quantity(input.qty), limit = price(input.limit);
  if (!(limit > 0)) throw bad("bad_price", "The limit price is in dollars and cents, above zero.");
  const cost = Math.round(limit * qty * 100 * 100) / 100;
  if (cost > cap) throw bad("over_cap", `This order would cost ${usd(cost)}. INDAI sends nothing over ${usd(cap)}.`);
  let stop: number | null = null;
  if (input.stop != null && input.stop !== "") {
    stop = price(input.stop);
    if (!(stop > 0)) throw bad("bad_stop", "The stop price is in dollars and cents, above zero.");
    if (!(stop < limit)) throw bad("bad_stop", "The stop has to be below the price you are buying at.");
  }
  return { symbol: c.symbol, contract: c, qty, limit, stop, cost };
}

// ---- the orders, as Schwab's Trader API takes them
const leg = (instruction: "BUY_TO_OPEN" | "SELL_TO_CLOSE", symbol: string, qty: number) => ({ instruction, quantity: qty, instrument: { symbol, assetType: "OPTION" } });
// A stop rests at Schwab and sells at market when the option's mark (the middle of bid and ask) touches it.
// It lasts the day for a contract that expires today, and until cancelled otherwise.
export const stopOrder = (symbol: string, qty: number, stop: number, now: number) => ({
  orderType: "STOP", session: "NORMAL", stopPrice: stop, stopType: "MARK",
  duration: parseOcc(symbol)?.expiry === newYorkDay(now) ? "DAY" : "GOOD_TILL_CANCEL",
  orderStrategyType: "SINGLE", orderLegCollection: [leg("SELL_TO_CLOSE", symbol, qty)],
});
export const buyOrder = (o: { symbol: string; qty: number; limit: number; stop: number | null }, now: number) => ({
  orderType: "LIMIT", session: "NORMAL", price: o.limit, duration: "DAY", complexOrderStrategyType: "NONE",
  orderStrategyType: o.stop ? "TRIGGER" : "SINGLE", orderLegCollection: [leg("BUY_TO_OPEN", o.symbol, o.qty)],
  ...(o.stop ? { childOrderStrategies: [stopOrder(o.symbol, o.qty, o.stop, now)] } : {}),
});
export const sellOrder = (symbol: string, qty: number, limit: number) => ({
  orderType: "LIMIT", session: "NORMAL", price: limit, duration: "DAY", complexOrderStrategyType: "NONE",
  orderStrategyType: "SINGLE", orderLegCollection: [leg("SELL_TO_CLOSE", symbol, qty)],
});

// ---- Schwab's answers, made small
const DONE = new Set(["FILLED", "CANCELED", "REJECTED", "REPLACED", "EXPIRED"]);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
export type Order = { id: string; parent: string | null; status: string; open: boolean; kind: string; side: string; symbol: string; description: string; asset: string; qty: number; filled: number; price: number | null; stop: number | null; fill: number | null; entered: string | null; cancelable: boolean; note: string };
// Every order with its children (a buy's attached stop is a child of the buy), newest first.
export function ordersFrom(list: unknown): Order[] {
  const out: Order[] = [];
  const walk = (o: any, parent: string | null) => {
    if (!o || typeof o !== "object" || o.orderId == null) return;
    const l = o.orderLegCollection?.[0] ?? {}, id = String(o.orderId), status = String(o.status ?? "");
    const fills = (o.orderActivityCollection ?? []).flatMap((a: any) => a?.executionType === "FILL" ? a.executionLegs ?? [] : []);
    const got = fills.reduce((s: number, f: any) => s + (num(f?.quantity) ?? 0), 0);
    out.push({
      id, parent, status, open: !DONE.has(status), kind: String(o.orderType ?? ""), side: String(l.instruction ?? ""),
      symbol: String(l.instrument?.symbol ?? ""), description: String(l.instrument?.description ?? ""), asset: String(l.instrument?.assetType ?? ""),
      qty: num(o.quantity) ?? num(l.quantity) ?? 0, filled: num(o.filledQuantity) ?? 0, price: num(o.price), stop: num(o.stopPrice),
      fill: got > 0 ? Math.round(fills.reduce((s: number, f: any) => s + (num(f?.price) ?? 0) * (num(f?.quantity) ?? 0), 0) / got * 10000) / 10000 : null,
      entered: typeof o.enteredTime === "string" ? o.enteredTime : null, cancelable: o.cancelable === true,
      note: (o.complexOrderStrategyType && o.complexOrderStrategyType !== "NONE") || (o.orderLegCollection?.length ?? 0) > 1 ? "more than one leg" : String(o.statusDescription ?? "").slice(0, 200),
    });
    for (const child of o.childOrderStrategies ?? []) walk(child, id);
  };
  for (const o of Array.isArray(list) ? list : []) walk(o, null);
  return out.sort((a, b) => String(b.entered ?? "").localeCompare(String(a.entered ?? "")));
}
export type Position = { symbol: string; underlying: string; description: string; type: "C" | "P"; strike: number; expiry: string; qty: number; avg: number | null; value: number | null; open_pl: number | null; day_pl: number | null };
// The option contracts he holds long. Shares and short options are not INDAI's to trade, so they are left out.
export function positionsFrom(account: unknown): Position[] {
  const rows = (account as any)?.securitiesAccount?.positions;
  const out: Position[] = [];
  for (const p of Array.isArray(rows) ? rows : []) {
    const c = p?.instrument?.assetType === "OPTION" ? parseOcc(p.instrument.symbol) : null, qty = num(p?.longQuantity) ?? 0;
    if (!c || !(qty > 0)) continue;
    out.push({ symbol: c.symbol, underlying: c.underlying, description: String(p.instrument.description ?? ""), type: c.type, strike: c.strike, expiry: c.expiry, qty, avg: num(p.averageLongPrice) ?? num(p.averagePrice), value: num(p.marketValue), open_pl: num(p.longOpenProfitLoss), day_pl: num(p.currentDayProfitLoss) });
  }
  return out.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.symbol.localeCompare(b.symbol));
}
// A working order that would sell this contract: its stop, or a sell he has already sent.
export const workingSells = (orders: Order[], symbol: string) => orders.filter((o) => o.open && o.symbol === symbol && o.side === "SELL_TO_CLOSE" && o.asset === "OPTION" && o.note !== "more than one leg");
export type Quote = { symbol: string; bid: number | null; ask: number | null; mark: number | null; last: number | null; delta: number | null; underlying_price: number | null; realtime: boolean };
export function quotesFrom(body: unknown): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const [symbol, row] of Object.entries(body && typeof body === "object" ? body as Record<string, any> : {})) {
    const q = row?.quote;
    if (!q || row.assetMainType !== "OPTION") continue;
    const pos = (v: unknown) => { const n = num(v); return n != null && n >= 0 ? n : null; };
    out[symbol] = { symbol, bid: pos(q.bidPrice), ask: pos(q.askPrice), mark: pos(q.mark), last: pos(q.lastPrice), delta: num(q.delta) != null && Math.abs(q.delta) <= 1 ? q.delta : null, underlying_price: pos(q.underlyingPrice), realtime: row.realtime === true };
  }
  return out;
}
// The contracts in a chain answer that match one strike and one day (an index can have two: SPX and SPXW).
export function contractsFrom(chain: unknown, expiry: string, strike: number) {
  const out: { symbol: string; description: string; root: string; bid: number | null; ask: number | null; mark: number | null; last: number | null; delta: number | null }[] = [];
  for (const side of ["callExpDateMap", "putExpDateMap"]) {
    for (const [day, strikes] of Object.entries((chain as any)?.[side] ?? {})) {
      if (!day.startsWith(expiry)) continue;
      for (const list of Object.values(strikes as Record<string, any[]>)) {
        for (const c of Array.isArray(list) ? list : []) {
          const p = parseOcc(c?.symbol);
          if (!p || p.expiry !== expiry || Math.abs(p.strike - strike) > 1e-6) continue;
          const pos = (v: unknown) => { const n = num(v); return n != null && n >= 0 ? n : null; };
          out.push({ symbol: p.symbol, description: String(c.description ?? ""), root: p.root, bid: pos(c.bid), ask: pos(c.ask), mark: pos(c.mark), last: pos(c.last), delta: num(c.delta) != null && Math.abs(c.delta) <= 1 ? c.delta : null });
        }
      }
    }
  }
  return out;
}
// What Schwab said when it refused something, short enough to show.
export function refusal(body: unknown, status: number): string {
  const b = body as any;
  const text = typeof b?.message === "string" ? b.message : typeof b?.errors?.[0]?.detail === "string" ? b.errors[0].detail : typeof b?.errors?.[0]?.title === "string" ? b.errors[0].title : typeof b?.error === "string" ? b.error : "";
  return (text ? text.replace(/\s+/g, " ").trim().slice(0, 300) : "no reason given") + " (Schwab " + status + ")";
}
// Schwab's check of an order before it is sent: does it pass, and what does Schwab say about it.
export function previewFrom(body: unknown) {
  const v = (body as any)?.orderValidationResult ?? {}, words = (list: unknown) => (Array.isArray(list) ? list : []).map((x: any) => String(x?.message ?? x?.activityMessage ?? x?.validationRuleName ?? "")).filter(Boolean).map((s) => s.slice(0, 240));
  const rejects = words(v.rejects), warns = [...words(v.warns), ...words(v.alerts), ...words(v.reviews)];
  return { ok: rejects.length === 0, rejects, warns };
}

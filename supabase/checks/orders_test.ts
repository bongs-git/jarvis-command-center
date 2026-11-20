import assert from "node:assert/strict";
import { HttpError } from "../_shared/http.ts";
import { buyOrder, checkBuy, contractsFrom, MAX_ORDER_USD, ordersFrom, parseOcc, positionsFrom, previewFrom, price, quotesFrom, refusal, sellOrder, stopOrder, underlyingOf, workingSells } from "../indai-orders/orders.ts";

// What INDAI may send to Schwab and how it is written (supabase/indai-orders/orders.ts). No network.
const NOW = Date.parse("2026-11-20T15:30:00-05:00");   // Friday afternoon in New York
const SPY = "SPY   261120C00695000", NEXT = "SPY   261127P00690000", SPXW = "SPXW  261120C07000000";
const refuses = (f: () => unknown, code: string, words?: RegExp) => assert.throws(f, (e: unknown) => e instanceof HttpError && e.status === 400 && e.code === code && (!words || words.test(e.message)));

Deno.test("a contract's name is read exactly, and anything else is not a contract", () => {
  assert.deepEqual(parseOcc(SPY), { symbol: SPY, root: "SPY", underlying: "SPY", expiry: "2026-11-20", type: "C", strike: 695 });
  assert.deepEqual(parseOcc(SPXW), { symbol: SPXW, root: "SPXW", underlying: "$SPX", expiry: "2026-11-20", type: "C", strike: 7000 });
  assert.equal(parseOcc("BRK.B 261218P00412500")?.strike, 412.5);
  for (const no of ["SPY", "SPY 261120C00695000", "SPY   261120C00695000 ", "SPY   261320C00695000", "SPY   261120X00695000", "spy   261120C00695000", "SPY   261120C00000000", " SPY  261120C00695000", "SPY  X261120C00695000", 42, null, { symbol: SPY }]) assert.equal(parseOcc(no), null, String(no));
  assert.deepEqual([underlyingOf("SPX"), underlyingOf("SPXW"), underlyingOf("$SPX"), underlyingOf("AAPL")], ["$SPX", "$SPX", "$SPX", "AAPL"]);
});

Deno.test("prices are dollars and whole cents", () => {
  assert.deepEqual([price(1.25), price("1.25"), price(" 3 "), price(0.1 + 0.2)], [1.25, 1.25, 3, 0.3]);
  for (const no of [1.255, "1.2.3", "abc", "", null, undefined, NaN, Infinity, "1e3", "-1", [1]]) assert.ok(Number.isNaN(price(no)), String(no));
});

Deno.test("a buy: checked against the owner's limits before anything is built", () => {
  assert.deepEqual(checkBuy({ symbol: SPY, qty: 2, limit: 1.25, stop: 1 }, NOW), { symbol: SPY, contract: parseOcc(SPY), qty: 2, limit: 1.25, stop: 1, cost: 250 });
  assert.equal(checkBuy({ symbol: SPY, qty: 1, limit: "1.45" }, NOW).stop, null);
  assert.equal(MAX_ORDER_USD, 5000);
  assert.equal(checkBuy({ symbol: SPY, qty: 10, limit: 5 }, NOW).cost, 5000);
  refuses(() => checkBuy({ symbol: SPY, qty: 10, limit: 5.01 }, NOW), "over_cap", /\$5,010\.00.*nothing over \$5,000\.00/);
  refuses(() => checkBuy({ symbol: SPY, qty: 1, limit: 50.01 }, NOW), "over_cap");
  refuses(() => checkBuy({ symbol: SPY, qty: 3, limit: 5 }, NOW, 1000), "over_cap", /nothing over \$1,000\.00/);
  refuses(() => checkBuy({ symbol: SPY, qty: 51, limit: 0.01 }, NOW), "over_cap", /50 contracts/);
  for (const qty of [0, -1, 1.5, "2", null, NaN]) refuses(() => checkBuy({ symbol: SPY, qty, limit: 1 }, NOW), "bad_quantity");
  for (const limit of [0, -1, "x", null, 1.234]) refuses(() => checkBuy({ symbol: SPY, qty: 1, limit }, NOW), "bad_price");
  for (const stop of [1.25, 2, 0, -1, "x"]) refuses(() => checkBuy({ symbol: SPY, qty: 1, limit: 1.25, stop }, NOW), "bad_stop");
  refuses(() => checkBuy({ symbol: "SPY", qty: 1, limit: 1 }, NOW), "bad_contract");
  refuses(() => checkBuy({ symbol: "SPY   261119C00695000", qty: 1, limit: 1 }, NOW), "expired");
  assert.equal(checkBuy({ symbol: SPY, qty: 1, limit: 1 }, Date.parse("2026-11-20T23:30:00-05:00")).symbol, SPY, "the expiry day itself is still that day in New York");
});

Deno.test("the orders are written the way Schwab takes them, and only these three kinds exist", () => {
  const stop = { orderType: "STOP", session: "NORMAL", stopPrice: 1, stopType: "MARK", duration: "DAY", orderStrategyType: "SINGLE", orderLegCollection: [{ instruction: "SELL_TO_CLOSE", quantity: 2, instrument: { symbol: SPY, assetType: "OPTION" } }] };
  assert.deepEqual(stopOrder(SPY, 2, 1, NOW), stop);
  assert.equal(stopOrder(NEXT, 1, 0.5, NOW).duration, "GOOD_TILL_CANCEL", "a stop on a later expiry stays until cancelled");
  assert.deepEqual(buyOrder({ symbol: SPY, qty: 2, limit: 1.25, stop: 1 }, NOW), {
    orderType: "LIMIT", session: "NORMAL", price: 1.25, duration: "DAY", complexOrderStrategyType: "NONE", orderStrategyType: "TRIGGER",
    orderLegCollection: [{ instruction: "BUY_TO_OPEN", quantity: 2, instrument: { symbol: SPY, assetType: "OPTION" } }], childOrderStrategies: [stop],
  });
  const alone = buyOrder({ symbol: SPY, qty: 1, limit: 1.25, stop: null }, NOW) as Record<string, unknown>;
  assert.deepEqual([alone.orderStrategyType, "childOrderStrategies" in alone], ["SINGLE", false]);
  assert.deepEqual(sellOrder(SPY, 3, 1.4), { orderType: "LIMIT", session: "NORMAL", price: 1.4, duration: "DAY", complexOrderStrategyType: "NONE", orderStrategyType: "SINGLE", orderLegCollection: [{ instruction: "SELL_TO_CLOSE", quantity: 3, instrument: { symbol: SPY, assetType: "OPTION" } }] });
  const all = JSON.stringify([buyOrder({ symbol: SPY, qty: 1, limit: 1, stop: 0.8 }, NOW), stopOrder(SPY, 1, 0.8, NOW), sellOrder(SPY, 1, 1)]);
  assert.ok(!/MARKET|SELL_TO_OPEN|BUY_TO_CLOSE|"BUY"|"SELL"|EQUITY/.test(all), "no market order, no short, no shares");
});

const order = (id: number, o: Record<string, unknown>) => ({ orderId: id, session: "NORMAL", duration: "DAY", complexOrderStrategyType: "NONE", orderStrategyType: "SINGLE", quantity: 1, filledQuantity: 0, cancelable: true, enteredTime: "2026-11-20T19:0" + (id % 10) + ":00+0000", accountNumber: 12345678, ...o });
const optLeg = (instruction: string, symbol = SPY) => [{ instruction, quantity: 1, instrument: { assetType: "OPTION", symbol, description: "SPY 11/20/2026 695.00 C", putCall: "CALL", underlyingSymbol: "SPY" } }];
Deno.test("his orders: parents and their attached stops, with what filled", () => {
  const list = ordersFrom([
    order(1, { status: "FILLED", orderType: "LIMIT", price: 1.25, filledQuantity: 1, orderStrategyType: "TRIGGER", orderLegCollection: optLeg("BUY_TO_OPEN"), orderActivityCollection: [{ activityType: "EXECUTION", executionType: "FILL", quantity: 1, executionLegs: [{ legId: 1, price: 1.24, quantity: 1 }] }],
      childOrderStrategies: [order(2, { status: "WORKING", orderType: "STOP", stopPrice: 1, stopType: "MARK", orderLegCollection: optLeg("SELL_TO_CLOSE") })] }),
    order(3, { status: "CANCELED", orderType: "LIMIT", price: 2, orderLegCollection: optLeg("SELL_TO_CLOSE") }),
    order(4, { status: "WORKING", orderType: "LIMIT", price: 200, orderLegCollection: [{ instruction: "BUY", quantity: 5, instrument: { assetType: "EQUITY", symbol: "AAPL" } }] }),
    order(5, { status: "WORKING", orderType: "NET_DEBIT", complexOrderStrategyType: "CUSTOM", price: 1, orderLegCollection: [...optLeg("SELL_TO_CLOSE"), ...optLeg("BUY_TO_OPEN", NEXT)] }),
    { nonsense: true }, null,
  ]);
  assert.deepEqual(list.map((o) => [o.id, o.parent, o.status, o.open, o.kind, o.side, o.price, o.stop, o.fill]), [
    ["5", null, "WORKING", true, "NET_DEBIT", "SELL_TO_CLOSE", 1, null, null], ["4", null, "WORKING", true, "LIMIT", "BUY", 200, null, null], ["3", null, "CANCELED", false, "LIMIT", "SELL_TO_CLOSE", 2, null, null],
    ["2", "1", "WORKING", true, "STOP", "SELL_TO_CLOSE", null, 1, null], ["1", null, "FILLED", false, "LIMIT", "BUY_TO_OPEN", 1.25, null, 1.24],
  ]);
  assert.deepEqual(workingSells(list, SPY).map((o) => o.id), ["2"], "the stop is the one working sell; a cancelled sell, shares and a spread are not");
  assert.deepEqual(ordersFrom({ message: "no" }), []);
  assert.ok(!JSON.stringify(list).includes("12345678"), "no account number is carried along");
});

Deno.test("his positions: the options he holds long, nothing else", () => {
  const account = { securitiesAccount: { accountNumber: "12345678", type: "MARGIN", currentBalances: { buyingPower: 99999.99 }, positions: [
    { longQuantity: 2, shortQuantity: 0, averagePrice: 1.24, averageLongPrice: 1.24, marketValue: 290, longOpenProfitLoss: 42, currentDayProfitLoss: 42, instrument: { assetType: "OPTION", symbol: SPY, description: "SPY 11/20/2026 695.00 C", putCall: "CALL", underlyingSymbol: "SPY" } },
    { longQuantity: 0, shortQuantity: 1, averagePrice: 3, marketValue: -300, instrument: { assetType: "OPTION", symbol: NEXT, putCall: "PUT" } },
    { longQuantity: 100, shortQuantity: 0, averagePrice: 200, marketValue: 21000, instrument: { assetType: "EQUITY", symbol: "AAPL" } },
  ] } };
  const p = positionsFrom(account);
  assert.deepEqual(p, [{ symbol: SPY, underlying: "SPY", description: "SPY 11/20/2026 695.00 C", type: "C", strike: 695, expiry: "2026-11-20", qty: 2, avg: 1.24, value: 290, open_pl: 42, day_pl: 42 }]);
  assert.ok(!/12345678|99999/.test(JSON.stringify(p)), "no account number and no balance");
  assert.deepEqual(positionsFrom({}), []);
});

Deno.test("quotes, chain matches, Schwab's refusals and its check, made small", () => {
  assert.deepEqual(quotesFrom({ [SPY]: { assetMainType: "OPTION", realtime: true, quote: { bidPrice: 1.44, askPrice: 1.45, mark: 1.445, lastPrice: 1.46, delta: 0.41, underlyingPrice: 695.2 } }, AAPL: { assetMainType: "EQUITY", quote: { lastPrice: 200 } }, errors: { invalidSymbols: ["X"] } }),
    { [SPY]: { symbol: SPY, bid: 1.44, ask: 1.45, mark: 1.445, last: 1.46, delta: 0.41, underlying_price: 695.2, realtime: true } });
  const c = (symbol: string, bid: number) => [{ symbol, description: symbol.trim(), bid, ask: bid + 0.1, mark: bid + 0.05, last: bid, delta: 0.5, optionRoot: symbol.slice(0, 6).trim() }];
  const chain = { callExpDateMap: { "2026-11-20:0": { "7000.0": [...c("SPX   261120C07000000", 12), ...c(SPXW, 11)], "7005.0": c("SPXW  261120C07005000", 9) }, "2026-11-23:3": { "7000.0": c("SPXW  261123C07000000", 30) } }, putExpDateMap: {} };
  assert.deepEqual(contractsFrom(chain, "2026-11-20", 7000).map((x) => [x.symbol, x.root, x.bid]), [["SPX   261120C07000000", "SPX", 12], [SPXW, "SPXW", 11]]);
  assert.deepEqual(contractsFrom(chain, "2026-11-21", 7000), []);
  assert.deepEqual(contractsFrom({ status: "FAILED" }, "2026-11-20", 7000), []);
  assert.equal(refusal({ message: "Insufficient   buying power\nfor this order." }, 400), "Insufficient buying power for this order. (Schwab 400)");
  assert.equal(refusal({ errors: [{ detail: "Invalid price increment" }] }, 400), "Invalid price increment (Schwab 400)");
  assert.equal(refusal(null, 500), "no reason given (Schwab 500)");
  assert.deepEqual(previewFrom({ orderValidationResult: { rejects: [{ validationRuleName: "x", message: "Not enough buying power." }], warns: [{ message: "This option expires today." }], alerts: [], accepts: [{ message: "ok" }] } }), { ok: false, rejects: ["Not enough buying power."], warns: ["This option expires today."] });
  assert.deepEqual(previewFrom({}), { ok: true, rejects: [], warns: [] });
});

import assert from "node:assert/strict";
import { BRIDGE, bridgeBars, bridgeQuote, closeBefore, days } from "../indai-market/bridge.ts";

// November 2026 is on standard time: 9:30 in New York is 14:30 UTC.
const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00-05:00`);
function run(day: string, from: string, to: string, start = 100) {
  const out = [];
  for (let t = at(day, from), i = 0; t < at(day, to); t += 60000, i++) {
    const c = start + i * 0.01;
    out.push({ t, o: c - 0.01, h: c + 0.05, l: c - 0.06, c, v: 100 + i });
  }
  return out;
}
const thu = "2026-11-19", fri = "2026-11-20", sat = "2026-11-21";

Deno.test("In the session a current bridge gives the price, the day's range and the change", () => {
  const rows = run(thu, "09:30", "11:00").reverse(); // stored rows arrive newest first
  const q = bridgeQuote("SPY", rows, 99, at(thu, "11:01"))!;
  assert.equal(q.ok, true);
  assert.equal(q.source, BRIDGE);
  assert.equal(q.delay, 0);
  assert.equal(q.price, 100 + 89 * 0.01);
  assert.equal(q.close, q.price);
  assert.equal(q.open, 99.99);
  assert.equal(q.high, q.price + 0.05);
  assert.equal(q.low, 99.94);
  assert.equal(q.prevClose, 99);
  assert.equal(q.change, Math.round((q.price - 99) * 100) / 100);
  assert.equal(q.timestamp, new Date(at(thu, "11:00")).toISOString());
});
Deno.test("In the session an old candle is never given as the price", () => {
  const rows = run(thu, "09:30", "11:00");
  assert.equal(bridgeQuote("SPY", rows, 99, at(thu, "11:09")) !== null, true);
  assert.equal(bridgeQuote("SPY", rows, 99, at(thu, "11:11")), null);
});
Deno.test("After the close the last stored candle is given, with extended hours as the price", () => {
  const regular = run(thu, "09:30", "16:00");
  const evening = bridgeQuote("SPY", regular, 99, at(thu, "21:00"))!;
  assert.equal(evening.price, evening.close);
  const withExtended = [...regular, ...run(thu, "16:00", "18:00", 105)];
  const q = bridgeQuote("SPY", withExtended, 99, at(thu, "18:05"))!;
  assert.equal(q.close, regular[regular.length - 1].c);
  assert.equal(q.price, 105 + 119 * 0.01);
  assert.equal(q.high, Math.max(...regular.map((b) => b.h))); // the day's range stays regular hours
  assert.notEqual(bridgeQuote("SPY", regular, 99, at(sat, "12:00")), null); // weekends are not trading hours
});
Deno.test("Before the open the price is pre-market and the close is the day before", () => {
  const rows = [...run(thu, "09:30", "16:00"), ...run(fri, "07:00", "08:00", 103)];
  const q = bridgeQuote("SPY", rows, 0, at(fri, "08:05"))!;
  assert.equal(q.price, 103 + 59 * 0.01);
  assert.equal(q.close, rows[389].c);
  assert.equal(q.prevClose, rows[389].c);
  assert.equal(q.open, 0);
  assert.equal(q.high, 0);
  const bars = bridgeBars(rows)!;
  assert.equal(bars.session, thu);
  assert.equal(bars.bars.length, 390);
});
Deno.test("A bridge that started mid-session does not invent the day's open, range or change", () => {
  const rows = run(thu, "12:40", "16:00");
  const q = bridgeQuote("SPY", rows, 0, at(thu, "21:00"))!;
  assert.equal(q.price > 0 && q.close === q.price, true);
  assert.deepEqual([q.open, q.high, q.low, q.volume, q.prevClose, q.change, q.changePct], [0, 0, 0, 0, 0, 0, 0]);
  const bars = bridgeBars(rows)!;
  assert.equal(bars.bars.length, 200);
  assert.deepEqual(bars.bars[0].slice(0, 2), [12 * 60 + 41, rows[0].o]); // the minute the candle ends in
  assert.equal(bars.source, BRIDGE);
});
Deno.test("Candles are regular hours only, and unusable rows are dropped", () => {
  const rows: any[] = [...run(thu, "08:00", "09:30"), ...run(thu, "09:30", "09:35"), ...run(thu, "16:00", "16:10")];
  rows.push({ t: at(thu, "09:36") + 5000, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: at(thu, "09:37"), o: 1, h: 1, l: 1, c: 0, v: 1 });
  rows.push({ t: String(at(thu, "09:35")), o: "101.5", h: "101.6", l: "101.4", c: "101.55", v: "7" });
  const bars = bridgeBars(rows)!;
  assert.equal(bars.bars.length, 6);
  assert.deepEqual(bars.bars[5], [9 * 60 + 36, 101.5, 101.6, 101.4, 101.55, 7, 0, 0]);
  assert.equal(bridgeBars(run(fri, "07:00", "08:00")), null);
  assert.equal(bridgeQuote("SPY", [], 0, at(thu, "21:00")), null);
});
Deno.test("The previous close is only taken from a day stored up to its final minutes", () => {
  const whole = [...run(thu, "09:30", "16:00"), ...run(fri, "09:30", "10:00")];
  assert.equal(closeBefore(whole, fri), whole[389].c);
  const stoppedEarly = [...run(thu, "09:30", "14:00"), ...run(fri, "09:30", "10:00")];
  assert.equal(closeBefore(stoppedEarly, fri), 0);
  assert.equal(closeBefore(run(fri, "09:30", "10:00"), fri), 0);
  assert.deepEqual(days(whole).order, [thu, fri]);
});

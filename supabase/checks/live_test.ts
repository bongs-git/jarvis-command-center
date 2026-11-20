import assert from "node:assert/strict";
import { cursorOf, LIVE_FOR, liveRows, seenAfter } from "../indai-tv/live.ts";

// The forming-candle helpers of the TradingView bridge endpoint (supabase/indai-tv/live.ts).
const now = Date.parse("2026-11-20T15:00:31.200Z"), minute = Date.parse("2026-11-20T15:00:00Z");
const clean = (t: unknown) => typeof t === "string" && /^(BATS:)?[A-Z]{1,6}$/.test(t) ? t.split(":").pop()! : null;
const num = (v: unknown) => v == null || v === "" || !isFinite(Number(v)) ? null : Number(v);
const bar = (over: Record<string, unknown> = {}) => ({ s: "BATS:QQQ", t: minute, o: 645.1, h: 645.6, l: 645, c: 645.4, v: 1200, ...over });

Deno.test("The forming candle of the running minute is kept, with the time it was received", () => {
  assert.deepEqual(liveRows([bar(), bar({ s: "BATS:SPY", c: "680.2", v: "" })], "1", now, clean, num), [
    { ticker: "QQQ", t: minute, o: 645.1, h: 645.6, l: 645, c: 645.4, v: 1200, received_at: "2026-11-20T15:00:31.200Z" },
    { ticker: "SPY", t: minute, o: 645.1, h: 645.6, l: 645, c: 680.2, v: null, received_at: "2026-11-20T15:00:31.200Z" },
  ]);
  // just after the minute turned, the candle that has just ended is still acceptable
  assert.equal(liveRows([bar({ t: minute - 60_000 })], "1", now, clean, num).length, 1);
});

Deno.test("Anything that is not a current one-minute forming candle is left out", () => {
  const none = (list: unknown[], tf: unknown = "1") => assert.deepEqual(liveRows(list, tf, now, clean, num), []);
  none([bar()], "5"); // the alert sits on the wrong chart
  none([bar({ t: minute - 10 * 60_000 })]); // an old candle delivered late
  none([bar({ t: minute + 5 * 60_000 })]); // a time in the future
  none([bar({ t: minute + 1500 })]); // not a minute boundary
  none([bar({ c: 0 }), bar({ c: null }), bar({ s: "not a ticker" }), bar({ t: "soon" }), null, "text", 7]);
  assert.equal(liveRows([bar()], undefined, now, clean, num).length, 1); // a message without a timeframe is one-minute
});

Deno.test("A cursor is used only when it is a recent time", () => {
  assert.equal(seenAfter("2026-11-20T15:00:16.000+00:00", now), "2026-11-20T15:00:16.000Z");
  for (const bad of [null, "", "yesterday", "2026-11-20T16:00:00Z", "2026-11-20T09:00:00Z"]) assert.equal(seenAfter(bad, now), null);
});

Deno.test("The next cursor is the newest stored time in the answer, held 1.5 seconds short of now, and never goes back", () => {
  const a = [{ received_at: "2026-11-20T15:00:03.100+00:00" }], b = [{ received_at: "2026-11-20T15:00:16.250+00:00" }, { received_at: "junk" }, {}];
  assert.equal(cursorOf(null, now, a, b), "2026-11-20T15:00:16.250Z");
  // a row stored half a second ago: the cursor stops 1.5 seconds back, so the next look sends that row once more
  assert.equal(cursorOf(null, now, a, [{ received_at: "2026-11-20T15:00:30.700Z" }]), "2026-11-20T15:00:29.700Z");
  assert.equal(cursorOf("2026-11-20T15:00:30.000Z", now, a, [{ received_at: "2026-11-20T15:00:30.700Z" }]), "2026-11-20T15:00:30.000Z");
  assert.equal(cursorOf("2026-11-20T15:00:20.000Z", now, a, b), "2026-11-20T15:00:20.000Z");
  assert.equal(cursorOf("2026-11-20T15:00:20.000Z", now, [], []), "2026-11-20T15:00:20.000Z");
  assert.equal(cursorOf(null, now, [], []), null);
  assert.equal(cursorOf("not a time", now, [], []), null);
  assert.equal(LIVE_FOR, 90_000);
});

import assert from "node:assert/strict";
import { gexRows } from "../indai-jobs/gex.ts";

const session = { day: "2026-11-30", previous: "2026-11-27", minute: 554, previous_close_min: 780 };
const levels = {
  total: 3_340_000,
  callWall: 101,
  putWall: 99,
  callWall2: null,
  putWall2: 98,
  zeroGamma: 100,
};
const chain = (timestamp: string) => ({
  symbol: "QQQ",
  spot: 100,
  timestamp,
  gex: levels,
  gexNear: { ...levels, expiry: "2026-11-30" },
});

Deno.test("A and N scopes use the same market date and preserve the previous half-day close", () => {
  for (const stamp of ["2026-11-27T17:59:00Z", "2026-11-30 09:02", "2026-11-30T09:02:00-05:00"]) {
    const rows = gexRows("QQQ", chain(stamp), session);
    assert.deepEqual(rows.map((r) => r.scope), ["A", "N"]);
    assert.ok(rows.every((r) => r.asof_et === "2026-11-30 09:14" && r.net_gex_m === 3.3));
    assert.equal(rows[0].expiry, "2027-01-14");
    assert.equal(rows[1].expiry, "2026-11-30");
  }
});

Deno.test("Failed, stale and future chain snapshots cannot be stamped as a morning refresh", () => {
  for (const stamp of ["unavailable", "2026-11-25 16:00", "2026-11-27 08:30", "2026-11-30 10:30"]) {
    assert.throws(() => gexRows("QQQ", chain(stamp), session));
  }
  assert.throws(() => gexRows("SPY", chain("2026-11-30 09:12"), session));
});

Deno.test("CBOE envelope times are UTC while unqualified exchange inputs retain their original meaning", () => {
  const cboe = (stamp: string) => ({...chain(stamp), source: "CBOE delayed quotes (about 15 minutes)"});
  assert.equal(gexRows("QQQ", cboe("2026-11-30 14:02:00"), session).length, 2);
  assert.equal(gexRows("QQQ", cboe("2026-11-27 17:59:00"), session).length, 2);
  assert.throws(() => gexRows("QQQ", cboe("2026-11-30 16:10:00"), session));
});

import assert from "node:assert/strict";
import { eligible, fiveMinuteBars } from "../indai-jobs/push.ts";
import { PROFILES } from "../indai-push/scanner.js";
const open = Date.parse("2026-11-19T14:30:00Z");
const session = { day: "2026-11-19", minute: 607, open_ms: open, close_min: 960 };
const minutes = Array.from(
  { length: 10 },
  (_, i) => ({ t: open + i * 60000, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 10 }),
);

Deno.test("The scanner sees only closed five-minute bars with five distinct consecutive minutes", () => {
  const bars = fiveMinuteBars(minutes, open + 9 * 60000);
  assert.deepEqual(bars, [{ t: open, o: 100, h: 106, l: 99, c: 105, v: 50 }]);
  assert.equal(fiveMinuteBars(minutes.filter((_, i) => i !== 3), open + 9 * 60000).length, 0);
  assert.equal(fiveMinuteBars([minutes[0], ...minutes], open + 9 * 60000).length, 0);
});
Deno.test("Each setup requires today's active plan with available risk", () => {
  const aggr = Object.keys(PROFILES).find((key) =>
    PROFILES[key as keyof typeof PROFILES].afterGoal === "stop"
  )!;
  const plan = { date: session.day, aggr, capital: 2000, strategies: ["ema"] };
  assert.equal(eligible(plan, session, open), true);
  for (
    const diff of [{ date: "2026-11-18" }, { tripped: true }, { cooldownUntil: open + 1 }, { pnl: -2000 }, {
      goal: 100,
      pnl: 101,
    }]
  ) {
    assert.equal(eligible({ ...plan, ...diff }, session, open), false);
  }
  assert.equal(eligible(plan, { ...session, minute: 960 }, open), false);
});

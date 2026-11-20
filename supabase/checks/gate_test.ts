import assert from "node:assert/strict";
import { feedGate, type GateRow } from "../indai-market/gate.ts";

// The pause the price service keeps while CBOE refuses its servers (supabase/indai-market/gate.ts).
// `shared` stands for the row in indai_feed_gate; each feedGate() is one short-lived instance of the function.
const MIN = 60_000, T0 = Date.parse("2026-11-20T15:00:00Z");
function world(start: GateRow | null = null) {
  const w = { shared: start, reads: 0, writes: 0, clears: 0, down: false, sent: 0 };
  const instance = () => feedGate({
    read: () => { w.reads++; return w.down ? Promise.reject(new Error("db")) : Promise.resolve(w.shared && { ...w.shared }); },
    write: (row) => { w.writes++; if (w.down) return Promise.reject(new Error("db")); w.shared = { ...row }; return Promise.resolve(); },
    clear: () => { w.clears++; if (w.down) return Promise.reject(new Error("db")); w.shared = null; return Promise.resolve(); },
  });
  // one request to the source, as cboe() makes it: `answers` is what the source would say if it were asked
  const ask = async (g: ReturnType<typeof instance>, now: number, answers: number) => {
    const paused = await g.blocked(now);
    if (paused) return "not sent (" + paused + ")";
    w.sent++;
    if (answers === 403 || answers === 429) { await g.refused(now, answers); return "refused"; }
    if (answers === 200) await g.answered();
    return "answered " + answers;
  };
  return { w, instance, ask };
}

Deno.test("while the source answers, the gate costs one read per instance and writes nothing", async () => {
  const { w, instance, ask } = world();
  const g = instance();
  for (let i = 0; i < 50; i++) assert.equal(await ask(g, T0 + i * 100, 200), "answered 200");
  assert.deepEqual([w.reads, w.writes, w.clears, w.sent], [1, 0, 0, 50]);
  for (let i = 0; i < 4; i++) await ask(g, T0 + 40_000 + i * 31_000, 200);   // it looks again every half minute
  assert.equal(w.reads, 5);
});

Deno.test("one refusal stops every instance for five minutes", async () => {
  const { w, instance, ask } = world();
  const a = instance();
  assert.deepEqual(await Promise.all(["SPY", "QQQ", "IWM", "TSLA", "AMZN", "MSFT"].map(() => ask(a, T0, 403))), Array(6).fill("refused"));   // six tickers at once, before anyone knew
  assert.deepEqual([w.shared?.status, w.shared?.wait_ms, w.shared?.until], [403, 5 * MIN, new Date(T0 + 5 * MIN).toISOString()]);
  w.sent = 0;
  for (let t = T0 + 1000; t < T0 + 5 * MIN; t += 20_000) {   // the same instance, and a new one every twenty seconds
    assert.equal(await ask(a, t, 403), "not sent (403)");
    assert.equal(await ask(instance(), t, 403), "not sent (403)");
  }
  assert.equal(w.sent, 0);
});

Deno.test("after the pause one request tries the door; a second refusal doubles the pause, up to an hour", async () => {
  const { w, instance, ask } = world();
  await ask(instance(), T0, 403);
  let t = T0, waits: number[] = [];
  for (let round = 0; round < 7; round++) {
    t = Date.parse(w.shared!.until) + 1;
    w.sent = 0;
    const g = instance();
    assert.deepEqual(await Promise.all(Array.from({ length: 6 }, () => ask(g, t, 403))), ["refused", ...Array(5).fill("not sent (403)")]);
    assert.equal(await ask(g, t + 5000, 403), "not sent (403)");
    assert.equal(w.sent, 1, "one request per instance when the pause ends");
    waits.push(w.shared!.wait_ms / MIN);
    assert.equal(w.shared!.until, new Date(t + w.shared!.wait_ms).toISOString());
  }
  assert.deepEqual(waits, [10, 20, 40, 60, 60, 60, 60]);
});

Deno.test("an answer opens the gate for everyone", async () => {
  const { w, instance, ask } = world({ status: 403, wait_ms: 40 * MIN, until: new Date(T0).toISOString() });
  const a = instance(), b = instance();
  assert.equal(await ask(b, T0 - 1000, 200), "not sent (403)");   // b learned of the refusal a second before the pause ended
  assert.equal(await ask(a, T0 + 1, 200), "answered 200");
  assert.deepEqual([w.shared, w.clears], [null, 1]);
  assert.equal(await ask(a, T0 + 2, 200), "answered 200");
  assert.equal(await ask(instance(), T0 + 3, 200), "answered 200");
  assert.equal(await ask(b, T0 + 4, 200), "answered 200");        // b's own turn at the door
  assert.equal(w.clears, 2);
  assert.equal(await ask(instance(), T0 + MIN, 403), "refused");
  assert.equal(w.shared!.wait_ms, 5 * MIN, "a new refusal starts again from five minutes");
});

Deno.test("an error that is not a refusal changes nothing", async () => {
  const { w, instance, ask } = world();
  const g = instance();
  for (const status of [404, 500, 502, 503]) assert.equal(await ask(g, T0, status), "answered " + status);
  assert.deepEqual([w.shared, w.writes, w.clears], [null, 0, 0]);
  const held = world({ status: 429, wait_ms: 5 * MIN, until: new Date(T0).toISOString() }), h = held.instance();
  assert.equal(await held.ask(h, T0 + 1, 500), "answered 500");   // the try at the door met a server error: nothing learned
  assert.equal(await held.ask(h, T0 + 2, 200), "not sent (429)");
  assert.equal(await held.ask(h, T0 + 10_002, 200), "answered 200");
  assert.equal(held.w.shared, null);
});

Deno.test("if the gate's table cannot be reached, requests go out as before", async () => {
  const { w, instance, ask } = world();
  w.down = true;
  const g = instance();
  assert.equal(await ask(g, T0, 200), "answered 200");
  assert.equal(await ask(g, T0 + 1, 403), "refused");               // remembered by this instance even though the write failed
  assert.equal(await ask(g, T0 + 2, 403), "not sent (403)");
  assert.equal(await ask(instance(), T0 + 3, 403), "refused");      // another instance could not know
  assert.equal(w.shared, null);
});

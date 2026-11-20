// Remembering that an outside source is refusing INDAI's servers, so they stop asking.
// A refusal (403, or 429) is for the servers' address, not for one ticker, and an instance of this function lives
// about a minute, so the memory is a row in indai_feed_gate that every instance reads. While the pause runs nobody
// asks. When it ends, one request per instance goes out to see whether the door has opened: an answer clears the
// row, another refusal doubles the pause (five minutes, then ten, up to an hour).
// If the row cannot be read or written, requests go out as if there were no gate: prices never wait on it.
export type GateRow = { status: number; wait_ms: number; until: string };
export type GateStore = { read(): Promise<GateRow | null>; write(row: GateRow): Promise<void>; clear(): Promise<void> };
export const REFUSALS = [403, 429];

export function feedGate(store: GateStore, opt = { first: 5 * 60_000, max: 60 * 60_000, fresh: 30_000, probe: 10_000 }) {
  let row: GateRow | null = null, readAt = -Infinity, probeUntil = 0;
  let reading: Promise<void> | null = null;
  function load(now: number) {
    if (now - readAt < opt.fresh) return reading ?? Promise.resolve();
    readAt = now;
    reading = store.read().then((r) => { row = r; }, () => {}).finally(() => { reading = null; });
    return reading;
  }
  return {
    // The status the source last refused with while nothing should be sent, or null when a request may go.
    async blocked(now: number): Promise<number | null> {
      await load(now);
      if (!row) return null;
      if (now < Date.parse(row.until) || now < probeUntil) return row.status;
      probeUntil = now + opt.probe;   // this request is the one that tries the door; the rest wait for its result
      return null;
    },
    async refused(now: number, status: number) {
      const running = row !== null && now < Date.parse(row.until);   // another request already recorded this refusal
      const wait = !row ? opt.first : running ? row.wait_ms : Math.min(row.wait_ms * 2, opt.max);
      row = { status, wait_ms: wait, until: running ? row!.until : new Date(now + wait).toISOString() };
      readAt = now;
      try { await store.write(row); } catch { /* this instance still remembers */ }
    },
    async answered() {
      if (!row) return;
      row = null; probeUntil = 0;
      try { await store.clear(); } catch { /* the next refusal or answer writes it again */ }
    },
  };
}

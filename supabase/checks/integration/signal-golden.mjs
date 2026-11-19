import { scanSetups as server } from "../../indai-push/scanner.js";
import { scanSetups as client } from "../../../js/signals.js";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const start = Date.parse("2026-11-19T14:30:00Z");
let matches = 0;
let found = false;
for (let scenario = 1; scenario <= 120; scenario++) {
  let p = 100, seed = scenario, bars = [];
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 66; i++) {
    const o = p, c = o + (rand() - .46) * .4;
    const b = {
      t: start + i * 300000,
      o,
      c,
      h: Math.max(o, c) + rand() * .16,
      l: Math.min(o, c) - rand() * .16,
      v: Math.round(1000 + rand() * 1600),
    };
    p = c;
    bars.push(b);
    const opts = {
      levels: { cw: 100.5, pw: 99.5, cw2: 102, pw2: 98, zg: 100 },
      leadDir: 0,
      now: b.t + 300000,
    };
    const sk = (x) => x.map(({ at, ...r }) => r);
    const a = sk(server("QQQ", bars, opts)), z = sk(client("QQQ", bars, opts));
    assert.deepEqual(a, z);
    matches++;
    if (!found && i >= 12 && a.some((s) => s.score >= 80) && i <= 50) {
      found = true;
      writeFileSync(
        process.env.LAB_DIR + "/golden.json",
        JSON.stringify({ bars, signal: a.sort((a, b) => b.score - a.score)[0], opts }),
      );
      console.log("golden", i, a[0].strat, a[0].score);
    }
  }
}
assert.ok(found);
console.log("matched candidate and score parity on", matches, "bar windows");

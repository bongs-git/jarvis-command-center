import assert from "node:assert/strict";
import { spokenPrefix } from "../indai-brain/stream.ts";

Deno.test("Each partial JSON prefix reveals only complete spoken characters", () => {
  const sample =
    '{"spoken":"Good morning, \\uD83D\\uDC4B. \\"QQQ\\".\\nWatch the open.","remember":["private detail"]}';
  const expected = JSON.parse(sample).spoken;
  let prior = "";
  for (let index = 0; index <= sample.length; index++) {
    const current = spokenPrefix(sample.slice(0, index));
    assert.ok(current.startsWith(prior));
    assert.ok(expected.startsWith(current));
    assert.doesNotMatch(current, /[\uD800-\uDBFF]$/);
    prior = current;
  }
  assert.equal(prior, expected);
});

Deno.test("Only the leading spoken property emits deltas", () => {
  assert.equal(spokenPrefix('{"remember":["a private note"],"spoken":"hi"}'), "");
  assert.equal(spokenPrefix('```json\n{"spoken":"ready","summary":["later"]}'), "ready");
});

import assert from "node:assert/strict";
import { wavDuration } from "../indai-ears/wav.ts";

function clip(samples: number, extraChunk = false) {
  const extra = extraChunk ? 10 : 0;
  const wav = new Uint8Array(44 + extra + 2 * samples);
  const data = new DataView(wav.buffer);
  function tag(at: number, label: string) {
    wav.set(new TextEncoder().encode(label), at);
  }
  tag(0, "RIFF");
  data.setUint32(4, wav.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, 16000, true);
  data.setUint32(28, 32000, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  if (extraChunk) {
    tag(36, "JUNK");
    data.setUint32(40, 1, true);
  }
  tag(36 + extra, "data");
  data.setUint32(40 + extra, samples * 2, true);
  return wav;
}

Deno.test("Four-second clips, padded chunks and the 30-second boundary are accepted", () => {
  assert.equal(wavDuration(clip(64000)), 4);
  assert.equal(wavDuration(clip(64000, true)), 4);
  assert.equal(wavDuration(clip(480000)), 30);
});

Deno.test("Empty, truncated, stereo and oversized audio is rejected", () => {
  for (const invalid of [clip(0), clip(3).subarray(0, 45), clip(480001)]) {
    assert.throws(() => wavDuration(invalid), /mono 16-bit PCM/);
  }
  const stereo = clip(64000);
  new DataView(stereo.buffer).setUint16(22, 2, true);
  assert.throws(() => wavDuration(stereo), /mono 16-bit PCM/);
});

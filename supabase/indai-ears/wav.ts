import { HttpError } from "../_shared/http.ts";
export function wavDuration(wav: Uint8Array): number {
  const bad = () =>
    new HttpError(422, "invalid_wav", "Expected a 16 kHz mono 16-bit PCM WAV file of up to 30 seconds.");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  if (
    wav.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) + 8 !== wav.length
  ) throw bad();
  let format = false, frames = 0, pos = 12;
  while (pos + 8 <= wav.length) {
    const type = tag(pos), len = view.getUint32(pos + 4, true), start = pos + 8;
    if (start + len > wav.length) throw bad();
    if (type === "fmt ") {
      if (
        format || len < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 ||
        view.getUint32(start + 4, true) !== 16000 || view.getUint32(start + 8, true) !== 32000 ||
        view.getUint16(start + 12, true) !== 2 || view.getUint16(start + 14, true) !== 16
      ) throw bad();
      format = true;
    }
    if (type === "data") {
      if (!format || frames || !len || len % 2 || len > 960000) throw bad();
      frames = len / 2;
    }
    pos = start + len + (len % 2);
  }
  if (pos !== wav.length || !format || !frames) throw bad();
  return frames / 16000;
}

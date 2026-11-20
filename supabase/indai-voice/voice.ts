// INDAI's hosted voice: ElevenLabs speaks her words, so no device has to download or run a voice model.
// Nothing here knows about requests or the database: indai-voice/index.ts does that.
// Checked against ElevenLabs' documentation on November 20, 2026:
//   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=...   header xi-api-key
//        body { text, model_id, previous_text?, next_text? }  ->  the audio, streamed
//   GET  https://api.elevenlabs.io/v2/voices?page_size=100   ->  { voices: [{ voice_id, name, category, labels, description, preview_url }], has_more, next_page_token }
//   models: eleven_v4_turbo ("our most expressive, real-time" model), eleven_flash_v2_5 (the fast one before it)
import { HttpError } from "../_shared/http.ts";

export const API = "https://api.elevenlabs.io";
export const MODEL = "eleven_v4_turbo", FALLBACK_MODEL = "eleven_flash_v2_5";
export const FORMAT = "mp3_44100_128";
export const MAX_TEXT = 800;            // one request is a sentence or a few; a long reply arrives as several
export const DAILY_CHARS = 60000;       // about 240 spoken replies a day, a few dollars at most; a loop cannot spend more
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Config = { key: string; model: string; dailyChars: number; voice: string | null };
export type Voice = { id: string; name: string; category: string; gender: string; accent: string; age: string; use: string; description: string; preview_url: string | null };

export const voiceId = (v: unknown): string | null => typeof v === "string" && /^[A-Za-z0-9]{8,64}$/.test(v) ? v : null;
export function voiceConfig(env: (name: string) => string | undefined = (n) => Deno.env.get(n)): Config | null {
  const key = env("ELEVENLABS_API_KEY")?.trim();
  if (!key) return null;
  const model = env("ELEVENLABS_MODEL")?.trim(), cap = Number(env("INDAI_VOICE_DAILY_CHARS"));
  return { key, model: model && /^[a-z0-9_.-]{3,60}$/.test(model) ? model : MODEL, dailyChars: Number.isInteger(cap) && cap > 0 ? cap : DAILY_CHARS, voice: voiceId(env("ELEVENLABS_VOICE_ID")?.trim()) };
}
// What is to be said, tidied: one line, no markup, within the limit. Null when there is nothing to say.
export function sayable(text: unknown, max = MAX_TEXT): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t && t.length <= max ? t : null;
}

// ---- the voices in his ElevenLabs account
const word = (v: unknown, max = 60) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
export function voicesFrom(body: unknown): Voice[] {
  const out: Voice[] = [];
  for (const v of Array.isArray((body as any)?.voices) ? (body as any).voices : []) {
    const id = voiceId(v?.voice_id), l = v?.labels && typeof v.labels === "object" ? v.labels : {};
    if (!id || !word(v?.name)) continue;
    const preview = typeof v.preview_url === "string" && /^https:\/\//.test(v.preview_url) ? v.preview_url : null;
    out.push({ id, name: word(v.name), category: word(v.category, 20), gender: word(l.gender, 20).toLowerCase(), accent: word(l.accent, 30), age: word(l.age, 20), use: word(l.use_case ?? l.use_cases, 40), description: word(v.description || l.description, 200), preview_url: preview });
  }
  return out;
}
// The voice she starts with before he has chosen: a woman's voice made for conversation if the account has one.
export function pickVoice(list: Voice[]): Voice | null {
  const score = (v: Voice) => (v.gender === "female" ? 8 : v.gender ? 0 : 2) + (/convers|assistant|agent/i.test(v.use + " " + v.description) ? 4 : 0) + (/warm|soft|calm|friendly|gentle/i.test(v.description) ? 2 : 0) + (v.category === "premade" ? 1 : 0);
  return list.length ? list.map((v, i) => ({ v, s: score(v), i })).sort((a, b) => b.s - a.s || a.i - b.i)[0].v : null;
}
// What ElevenLabs said when it refused, as INDAI's own error.
export function refused(status: number, body: unknown): HttpError {
  const d = (body as any)?.detail, code = word(typeof d === "object" && !Array.isArray(d) ? d?.status ?? d?.code : "", 60), said = word(typeof d === "string" ? d : Array.isArray(d) ? d[0]?.msg : d?.message, 200);
  const about = (re: RegExp) => re.test(code + " " + said);
  if (about(/quota|credit|limit_reached|insufficient/i) && status !== 429) return new HttpError(402, "voice_quota", "ElevenLabs says this month's credits are used up.");
  if (status === 401 || status === 403) return new HttpError(502, "voice_key", "ElevenLabs did not accept the API key" + (said ? ": " + said : "."));
  if (status === 429) return new HttpError(429, "voice_busy", "ElevenLabs is taking too many requests at once. Try again in a moment.");
  if (about(/voice/i) && (status === 400 || status === 404 || status === 422)) return new HttpError(409, "voice_gone", "ElevenLabs no longer has that voice. Choose another on the voice page.");
  return new HttpError(502, "voice", "ElevenLabs did not produce the audio (" + status + (code ? ", " + code : "") + ").");
}
const modelRefused = (status: number, body: unknown) => [400, 403, 404, 422].includes(status) && /model/i.test(JSON.stringify((body as any)?.detail ?? "").slice(0, 600));

export async function listVoices(cfg: Config, f: Fetch = (u, i) => fetch(u, i)): Promise<Voice[]> {
  const out: Voice[] = [];
  let token: string | null = null;
  for (let page = 0; page < 3; page++) {   // three hundred voices is more than a picker should show
    const r = await f(API + "/v2/voices?page_size=100&include_total_count=false" + (token ? "&next_page_token=" + encodeURIComponent(token) : ""), { headers: { "xi-api-key": cfg.key, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw refused(r.status, j);
    out.push(...voicesFrom(j));
    token = j?.has_more === true && typeof j.next_page_token === "string" ? j.next_page_token : null;
    if (!token) break;
  }
  return out.filter((v, i) => out.findIndex((x) => x.id === v.id) === i);
}
// Her words as audio. The answer's body is ElevenLabs' stream, to be passed straight on.
// If the chosen model is refused the faster, older one is tried once, and remembered for ten minutes.
let primaryDownUntil = 0;
export async function speak(cfg: Config, voice: string, text: string, around: { previous?: string | null; next?: string | null } = {}, io: { fetch?: Fetch; now?: () => number } = {}): Promise<{ audio: Response; model: string }> {
  const f: Fetch = io.fetch ?? ((u, i) => fetch(u, i)), now = io.now ?? (() => Date.now());
  const ask = (model: string) => f(API + "/v1/text-to-speech/" + voice + "/stream?output_format=" + FORMAT, {
    method: "POST", headers: { "xi-api-key": cfg.key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model, ...(around.previous ? { previous_text: around.previous } : {}), ...(around.next ? { next_text: around.next } : {}) }),
    signal: AbortSignal.timeout(25_000),
  });
  let model = cfg.model !== FALLBACK_MODEL && now() < primaryDownUntil ? FALLBACK_MODEL : cfg.model, r: Response;
  try { r = await ask(model); } catch { throw new HttpError(502, "voice", "ElevenLabs did not answer."); }
  if (!r.ok) {
    let j = await r.json().catch(() => null);
    if (model !== FALLBACK_MODEL && modelRefused(r.status, j)) {
      primaryDownUntil = now() + 600_000; model = FALLBACK_MODEL;
      try { r = await ask(model); } catch { throw new HttpError(502, "voice", "ElevenLabs did not answer."); }
      if (r.ok) return { audio: r, model };
      j = await r.json().catch(() => null);
    }
    throw refused(r.status, j);
  }
  return { audio: r, model };
}
export const forgetModelTrouble = () => { primaryDownUntil = 0; };   // for the checks

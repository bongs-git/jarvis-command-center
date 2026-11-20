import { serve } from "../_shared/http.ts";
// INDAI's hosted voice, for the owner: his devices send her words and get audio back, in the voice he chose.
//   POST {op:"status"}                  is it set up, and which voice is hers (one is picked for him the first time)
//   POST {op:"voices"}                  the voices in his ElevenLabs account, to choose from
//   POST {op:"choose", voice_id}        make one of them hers, on every device
//   POST {op:"speak", text, previous?, next?, voice_id?}   the audio (audio/mpeg), streamed. voice_id is for trying a voice out.
// Every request needs the owner: his passcode header or his own sign-in. Spoken characters are counted per New York
// day and refused past the limit, so a fault in an app cannot run up his ElevenLabs bill.
// Secrets he sets in Supabase himself: ELEVENLABS_API_KEY (and, if wanted, ELEVENLABS_MODEL, ELEVENLABS_VOICE_ID,
// INDAI_VOICE_DAILY_CHARS).
import { account } from "../_shared/auth.ts";
import { db, rpc } from "../_shared/db.ts";
import { failure, HttpError, objectBody } from "../_shared/http.ts";
import { type Config, listVoices, pickVoice, sayable, speak, voiceConfig, voiceId } from "./voice.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-indai-pass",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "x-indai-voice-model",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
type Chosen = { id: string; name: string; picked: string };
// What does not change while an instance lives (it lives about a minute): who the owner is, and her voice.
let ownerId: string | null = null, held: { at: number; voice: Chosen | null } | null = null;
const stored = async (): Promise<Chosen | null> => {
  if (held && Date.now() - held.at < 60_000) return held.voice;
  const [row] = await db("indai_voice", { id: "eq.owner", select: "voice_id,voice_name,picked" });
  const voice = row && voiceId(row.voice_id) ? { id: row.voice_id, name: String(row.voice_name ?? ""), picked: String(row.picked ?? "owner") } : null;
  held = { at: Date.now(), voice };
  return voice;
};
async function keep(voice: { id: string; name: string }, picked: "owner" | "auto") {
  await db("indai_voice", { on_conflict: "id" }, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "owner", voice_id: voice.id, voice_name: voice.name.slice(0, 60), picked, updated_at: new Date().toISOString() }) });
  held = { at: Date.now(), voice: { ...voice, picked } };
  return held.voice!;
}
// Her voice: the one he chose; else the one named in the secrets; else one picked from his account and kept.
async function hers(cfg: Config): Promise<Chosen> {
  const have = await stored();
  if (have) return have;
  if (cfg.voice) return { id: cfg.voice, name: "", picked: "secret" };
  const pick = pickVoice(await listVoices(cfg));
  if (!pick) throw new HttpError(409, "no_voice", "Your ElevenLabs account has no voices yet. Add one in ElevenLabs, then open the voice page.");
  return await keep(pick, "auto");
}

serve("indai-voice", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method", message: "Use POST." }, 405);
  try {
    const body = await objectBody(req, 6000), op = body.op;
    const user = await account(req);
    if (!ownerId) { const [owner] = await db("indai_owner", { select: "user_id", limit: "1" }); ownerId = owner?.user_id ?? null; }
    if (!ownerId || ownerId !== user) throw new HttpError(403, "forbidden", "Only the owner uses INDAI's hosted voice.");
    if (!["status", "voices", "choose", "speak"].includes(op)) throw new HttpError(400, "bad_request", "Choose status, voices, choose or speak.");
    const cfg = voiceConfig();
    if (op === "status" && !cfg) return json({ configured: false, ready: false });
    if (!cfg) throw new HttpError(503, "not_configured", "Add ELEVENLABS_API_KEY to the Supabase secrets first.");

    if (op === "speak") {
      const text = sayable(body.text);
      if (!text) throw new HttpError(400, "bad_text", "Send between 1 and 800 characters to say.");
      const trial = body.voice_id == null ? null : voiceId(body.voice_id);
      if (body.voice_id != null && !trial) throw new HttpError(400, "bad_voice", "That is not a voice id.");
      const [allowed, voice] = await Promise.all([rpc("indai_voice_take", { p_chars: text.length, p_limit: cfg.dailyChars }), trial ? null : hers(cfg)]);
      if (!allowed) throw new HttpError(429, "voice_daily_limit", "Today's limit for the hosted voice is reached. It starts again tomorrow.");
      const { audio, model } = await speak(cfg, trial ?? voice!.id, text, { previous: sayable(body.previous, 300), next: sayable(body.next, 300) });
      return new Response(audio.body, { status: 200, headers: { ...CORS, "Content-Type": audio.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store", "x-indai-voice-model": model } });
    }
    if (!await rpc("indai_take_request", { p_user: user, p_bucket: "voice", p_limit: 240 })) throw new HttpError(429, "rate_limited", "Hourly request limit reached. Try again later.");
    const status = async () => {
      // Whether ElevenLabs accepts the key is part of the answer: a refused key is said in words, not thrown.
      try { const v = await hers(cfg); return { configured: true, ready: true, voice: { id: v.id, name: v.name, picked: v.picked }, model: cfg.model, daily_chars: cfg.dailyChars }; }
      catch (e) { if (!(e instanceof HttpError)) throw e; return { configured: true, ready: false, error: e.code, message: e.message }; }
    };
    if (op === "status") return json(await status());
    if (op === "voices") return json({ voices: await listVoices(cfg), chosen: (await stored())?.id ?? cfg.voice ?? null });
    const id = voiceId(body.voice_id);
    if (!id) throw new HttpError(400, "bad_voice", "That is not a voice id.");
    const found = (await listVoices(cfg)).find((v) => v.id === id);
    if (!found) throw new HttpError(404, "no_voice", "That voice is not in your ElevenLabs account.");
    await keep(found, "owner");
    return json(await status());
  } catch (e) { return failure(e); }
});

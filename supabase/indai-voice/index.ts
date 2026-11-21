import { serve } from "../_shared/http.ts";
// INDAI's hosted voice, for the owner: his devices send her words and get audio back, in the voice he chose.
//   POST {op:"status"}                  is it set up, and which voice is hers (one is picked for him the first time)
//   POST {op:"voices"}                  the voices in his ElevenLabs account, to choose from
//   POST {op:"choose", voice_id}        make one of them hers, on every device
//   POST {op:"tune", speed?, feel?}     how she speaks, on every device: speed 0.7 to 1.2, feel steady | natural | expressive
//   POST {op:"speak", text, previous?, next?, voice_id?, speed?, feel?}   the audio (audio/mpeg), streamed. voice_id, speed
//        and feel are for trying a voice out; they change nothing kept. Headers say which model spoke and whether her
//        speed and feel were taken (x-indai-voice-settings: applied | dropped | none).
// Every request needs the owner: his passcode header or his own sign-in. Spoken characters are counted per New York
// day and refused past the limit, so a fault in an app cannot run up his ElevenLabs bill.
// Secrets he sets in Supabase himself: ELEVENLABS_API_KEY (and, if wanted, ELEVENLABS_MODEL, ELEVENLABS_VOICE_ID,
// INDAI_VOICE_DAILY_CHARS).
import { account } from "../_shared/auth.ts";
import { db, rpc } from "../_shared/db.ts";
import { failure, HttpError, objectBody } from "../_shared/http.ts";
import { type Config, FALLBACK_MODEL, feelOf, listVoices, paced, pickVoice, sayable, speak, speedOf, takesSpeed, type Tune, tuneOf, voiceConfig, voiceId } from "./voice.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-indai-pass",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "x-indai-voice-model, x-indai-voice-settings",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
type Chosen = { id: string; name: string; picked: string };
// Who the owner is does not change while an instance lives. Her voice and how she speaks are read again after fifteen
// seconds, so a change made on one device is heard on the others almost at once.
let ownerId: string | null = null, held: { at: number; voice: Chosen | null; tune: Tune } | null = null;
const read = async () => {
  if (held && Date.now() - held.at < 15_000) return held;
  const [row] = await db("indai_voice", { id: "eq.owner", select: "voice_id,voice_name,picked,speed,feel" });
  const voice = row && voiceId(row.voice_id) ? { id: row.voice_id, name: String(row.voice_name ?? ""), picked: String(row.picked ?? "owner") } : null;
  return held = { at: Date.now(), voice, tune: tuneOf(row) };
};
const stored = async (): Promise<Chosen | null> => (await read()).voice;
// Only the fields given are written: choosing a voice keeps her speed and feel, and tuning keeps her voice.
async function keep(voice: { id: string; name: string }, picked: "owner" | "auto", tune?: Tune) {
  const was = (await read()).tune;
  await db("indai_voice", { on_conflict: "id" }, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: "owner", voice_id: voice.id, voice_name: voice.name.slice(0, 60), picked, ...(tune ?? {}), updated_at: new Date().toISOString() }) });
  held = { at: Date.now(), voice: { ...voice, picked }, tune: tune ?? was };
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

// A speed or feel sent with a request. Something sent that is not one is refused rather than ignored.
function tuning(body: Record<string, unknown>): Partial<Tune> {
  const out: Partial<Tune> = {};
  if (body.speed != null) { const v = speedOf(body.speed); if (v == null) throw new HttpError(400, "bad_tune", "Her speed goes from 0.7 to 1.2."); out.speed = v; }
  if (body.feel != null) { const v = feelOf(body.feel); if (!v) throw new HttpError(400, "bad_tune", "Her feel is steady, natural or expressive."); out.feel = v; }
  return out;
}
const speaker = (cfg: Config, tune: Tune) => paced(tune) && !takesSpeed(cfg.model) ? FALLBACK_MODEL : cfg.model;   // the model her speed needs

serve("indai-voice", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method", message: "Use POST." }, 405);
  try {
    const body = await objectBody(req, 6000), op = body.op;
    const user = await account(req);
    if (!ownerId) { const [owner] = await db("indai_owner", { select: "user_id", limit: "1" }); ownerId = owner?.user_id ?? null; }
    if (!ownerId || ownerId !== user) throw new HttpError(403, "forbidden", "Only the owner uses INDAI's hosted voice.");
    if (!["status", "voices", "choose", "tune", "speak"].includes(op)) throw new HttpError(400, "bad_request", "Choose status, voices, choose, tune or speak.");
    const cfg = voiceConfig();
    if (op === "status" && !cfg) return json({ configured: false, ready: false });
    if (!cfg) throw new HttpError(503, "not_configured", "Add ELEVENLABS_API_KEY to the Supabase secrets first.");

    if (op === "speak") {
      const text = sayable(body.text);
      if (!text) throw new HttpError(400, "bad_text", "Send between 1 and 800 characters to say.");
      const trial = body.voice_id == null ? null : voiceId(body.voice_id);
      if (body.voice_id != null && !trial) throw new HttpError(400, "bad_voice", "That is not a voice id.");
      const tryTune = tuning(body);
      const [allowed, voice, kept] = await Promise.all([rpc("indai_voice_take", { p_chars: text.length, p_limit: cfg.dailyChars }), trial ? null : hers(cfg), read()]);
      if (!allowed) throw new HttpError(429, "voice_daily_limit", "Today's limit for the hosted voice is reached. It starts again tomorrow.");
      const { audio, model, settings } = await speak(cfg, trial ?? voice!.id, text, { previous: sayable(body.previous, 300), next: sayable(body.next, 300), tune: { ...kept.tune, ...tryTune } });
      return new Response(audio.body, { status: 200, headers: { ...CORS, "Content-Type": audio.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store", "x-indai-voice-model": model, "x-indai-voice-settings": settings } });
    }
    if (!await rpc("indai_take_request", { p_user: user, p_bucket: "voice", p_limit: 240 })) throw new HttpError(429, "rate_limited", "Hourly request limit reached. Try again later.");
    const status = async () => {
      // Whether ElevenLabs accepts the key is part of the answer: a refused key is said in words, not thrown.
      try {
        const v = await hers(cfg), tune = (await read()).tune;
        return { configured: true, ready: true, voice: { id: v.id, name: v.name, picked: v.picked }, tune, model: speaker(cfg, tune), daily_chars: cfg.dailyChars };
      }
      catch (e) { if (!(e instanceof HttpError)) throw e; return { configured: true, ready: false, error: e.code, message: e.message }; }
    };
    if (op === "status") return json(await status());
    if (op === "voices") return json({ voices: await listVoices(cfg), chosen: (await stored())?.id ?? cfg.voice ?? null });
    if (op === "tune") {
      const change = tuning(body);
      if (!Object.keys(change).length) throw new HttpError(400, "bad_tune", "Send a speed from 0.7 to 1.2, or a feel: steady, natural or expressive.");
      const v = await hers(cfg);
      await keep(v, v.picked === "owner" ? "owner" : "auto", { ...(await read()).tune, ...change });
      return json(await status());
    }
    const id = voiceId(body.voice_id);
    if (!id) throw new HttpError(400, "bad_voice", "That is not a voice id.");
    const found = (await listVoices(cfg)).find((v) => v.id === id);
    if (!found) throw new HttpError(404, "no_voice", "That voice is not in your ElevenLabs account.");
    await keep(found, "owner");
    return json(await status());
  } catch (e) { return failure(e); }
});

import { serve } from "../_shared/http.ts";
import { account, rateLimit } from "../_shared/auth.ts";
import { db } from "../_shared/db.ts";
import { bytes, CORS, failure, HttpError, json } from "../_shared/http.ts";
import { wavDuration } from "./wav.ts";

serve("indai-ears", async (req) => {
  const start = performance.now();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "method", "Use POST with a WAV file.");
    if (
      !["audio/wav", "audio/wave", "audio/x-wav", "application/octet-stream"].includes(
        (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(),
      )
    ) {
      throw new HttpError(415, "content_type", "Send audio/wav.");
    }
    const user = await account(req);
    const wav = await bytes(req, 1_000_000);
    wavDuration(wav);
    const key = Deno.env.get("DEEPGRAM_API_KEY");
    if (Deno.env.get("INDAI_STT_PROVIDER") !== "deepgram" || !key) {
      throw new HttpError(503, "not_configured", "Server transcription has not been enabled.");
    }
    await rateLimit(user, "speech");
    const rows = await db("indai_profile", {
      user_id: "eq." + user,
      key: "in.(indai.speech.v1,watchlist,plan)",
      select: "key,value",
    });
    const profiles = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
    const fixes = Object.values(profiles["indai.speech.v1"]?.fixes ?? {}).sort((a: any, b: any) => b.n - a.n);
    const terms = new Set<string>();
    const symbols = profiles.watchlist?.symbols ?? profiles.plan?.symbols;
    const requested = new URL(req.url).searchParams.get("symbols")?.split(",") ?? [];
    for (const sym of [...requested, ...(Array.isArray(symbols) ? symbols : []), "QQQ", "SPY", "IWM"]) {
      if (typeof sym === "string" && /^[A-Za-z.]{1,8}$/.test(sym)) terms.add(sym.toUpperCase());
    }
    for (const fix of fixes as { to?: string }[]) {
      if (typeof fix.to === "string" && fix.to.trim().length && fix.to.length <= 60) terms.add(fix.to.trim());
    }
    const url = new URL("https://api.deepgram.com/v1/listen");
    url.search = new URLSearchParams({
      model: "nova-3",
      language: "en-US",
      smart_format: "true",
      alternatives: "3",
      redact_usage: "true",
    }).toString();
    for (const term of [...terms].slice(0, 40)) url.searchParams.append("keyterm", term);
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(12_000)]),
      headers: { Authorization: "Token " + key, "Content-Type": "audio/wav" },
      body: wav,
    });
    if (!response.ok) {
      throw new HttpError(502, "transcription", "The speech provider could not transcribe this clip.");
    }
    const result = await response.json();
    const alternatives = result.results?.channels?.[0]?.alternatives;
    if (!Array.isArray(alternatives) || typeof alternatives[0]?.transcript !== "string") {
      throw new HttpError(502, "transcription", "The speech provider returned an incomplete result.");
    }
    return json({
      text: alternatives[0].transcript,
      alternatives: alternatives.slice(1).map((a) => a.transcript).filter((t) => typeof t === "string"),
      ms: Math.round(performance.now() - start),
    });
  } catch (e) {
    return failure(e);
  }
});

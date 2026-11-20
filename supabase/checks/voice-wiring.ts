// The real indai-voice function, served locally. ElevenLabs and the database are stand-ins that record every call.
// deno run -A supabase/checks/voice-wiring.ts "$PWD/supabase/indai-voice/index.ts"   (not part of `deno test`: it serves on port 8000)
import assert from "node:assert/strict";
const real = globalThis.fetch;
const OWNER = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const SARAH = "EXAVITQu4vr4xnSDxMaL", ADAM = "pNInz6obpgDQGcFmaJgB", MIRA = "AAAAAAAAAAAAAAAAAAAA";
let row: any = null, taken = 0, limitHit = false, eleven: { status: number; detail: unknown } | null = null;
const asked: { method: string; path: string; body: any; key: string | null }[] = [], takes: any[] = [];
const voice = (voice_id: string, name: string, gender: string, use_case: string, description: string) => ({ voice_id, name, category: "premade", description, preview_url: "https://storage.example/" + name + ".mp3", labels: { gender, use_case }, settings: { stability: 0.5 } });
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input)), method = init.method ?? "GET";
  if (url.host === "127.0.0.1:8000") return real(input, init);
  const head = new Headers(init.headers), body = init.body ? JSON.parse(String(init.body)) : null;
  if (url.host === "api.elevenlabs.io") {
    asked.push({ method, path: url.pathname + url.search, body, key: head.get("xi-api-key") });
    if (eleven) return Response.json({ detail: eleven.detail }, { status: eleven.status });
    if (url.pathname === "/v2/voices") return Response.json({ voices: [voice(ADAM, "Adam", "male", "narration", "Deep"), voice(SARAH, "Sarah", "female", "conversational", "Soft and warm"), voice(MIRA, "Mira", "female", "advertisement", "Bright")], has_more: false });
    if (url.pathname.startsWith("/v1/text-to-speech/")) return new Response(new Uint8Array([73, 68, 51, 4, 0, 0]), { headers: { "content-type": "audio/mpeg" } });
    throw new Error("unexpected ElevenLabs call: " + url);
  }
  if (url.pathname === "/auth/v1/user") return head.get("Authorization") === "Bearer other-token" ? Response.json({ id: OTHER }) : new Response("{}", { status: 401 });
  if (url.pathname === "/rest/v1/indai_owner") return Response.json([{ user_id: OWNER }]);
  if (url.pathname === "/rest/v1/rpc/indai_take_request") return Response.json(true);
  if (url.pathname === "/rest/v1/rpc/indai_voice_take") { takes.push(body); if (limitHit) return Response.json(false); taken += body.p_chars; return Response.json(true); }
  if (url.pathname === "/rest/v1/indai_voice") {
    if (method === "POST") { assert.match(url.search, /on_conflict=id/); row = body; return new Response("", { status: 201 }); }
    return Response.json(row ? [row] : []);
  }
  throw new Error("unexpected outside call: " + method + " " + url);
}) as typeof fetch;
Deno.env.set("SUPABASE_URL", "http://rest.invalid"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service"); Deno.env.set("SUPABASE_ANON_KEY", "public-key"); Deno.env.set("INDAI_PASSCODE", "open sesame");
for (const k of ["ELEVENLABS_API_KEY", "ELEVENLABS_MODEL", "ELEVENLABS_VOICE_ID", "INDAI_VOICE_DAILY_CHARS"]) Deno.env.delete(k);
await import(Deno.args[0]);
await new Promise((r) => setTimeout(r, 300));
let n = 0; const ok = (name: string) => console.log(`ok ${++n} ${name}`);
const pass = { "x-indai-pass": "open sesame" };
const post = async (body: unknown, headers: Record<string, string> = pass, method = "POST") => {
  asked.length = 0; takes.length = 0;
  const r = await real("http://127.0.0.1:8000/", { method, headers: { Authorization: "Bearer public-key", ...headers, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
  const type = r.headers.get("content-type") ?? "", bytes = new Uint8Array(await r.arrayBuffer()), text = type.includes("json") ? new TextDecoder().decode(bytes) : "";
  assert.ok(!/xi-SECRET/.test(text), "the key is never in an answer");
  return { status: r.status, type, bytes, j: text ? JSON.parse(text) : null, model: r.headers.get("x-indai-voice-model") };
};

let r = await post({ op: "status" }, {}); assert.deepEqual([r.status, r.j.error], [401, "passcode"]);
r = await post({ op: "speak", text: "hello" }, { "x-indai-pass": "guess" }); assert.deepEqual([r.status, asked.length, takes.length], [401, 0, 0]);
r = await post({ op: "speak", text: "hello" }, { Authorization: "Bearer other-token" }); assert.deepEqual([r.status, r.j.error, asked.length, takes.length], [403, "forbidden", 0, 0]);
r = await post(null, pass, "GET"); assert.equal(r.status, 405);
r = await post({ op: "sing" }); assert.equal(r.status, 400);
ok("only the owner is answered, and another account can neither speak nor use up the day's allowance");

r = await post({ op: "status" }); assert.deepEqual([r.status, r.j, asked.length], [200, { configured: false, ready: false }, 0]);
r = await post({ op: "speak", text: "hello" }); assert.deepEqual([r.status, r.j.error, takes.length], [503, "not_configured", 0]);
ok("before the key is in Supabase: said plainly, nothing asked of ElevenLabs");

Deno.env.set("ELEVENLABS_API_KEY", "xi-SECRET");
eleven = { status: 401, detail: { status: "invalid_api_key", message: "Invalid API key" } };
r = await post({ op: "status" }); assert.deepEqual([r.status, r.j.configured, r.j.ready, r.j.error, row], [200, true, false, "voice_key", null]);
eleven = null;
r = await post({ op: "status" });
assert.deepEqual([r.status, r.j], [200, { configured: true, ready: true, voice: { id: SARAH, name: "Sarah", picked: "auto" }, model: "eleven_v4_turbo", daily_chars: 60000 }]);
assert.deepEqual([row.voice_id, row.picked, asked.map((a) => a.path), asked[0].key], [SARAH, "auto", ["/v2/voices?page_size=100&include_total_count=false"], "xi-SECRET"]);
r = await post({ op: "status" }); assert.deepEqual([r.j.voice.name, asked.length], ["Sarah", 0]);
ok("with the key in: a key ElevenLabs refuses is said in words; otherwise a first voice is picked for him and kept");

r = await post({ op: "speak", text: "  Good morning,\n Bongs. ", previous: "Hello.", next: "x".repeat(400) });
assert.deepEqual([r.status, r.type, [...r.bytes], r.model], [200, "audio/mpeg", [73, 68, 51, 4, 0, 0], "eleven_v4_turbo"]);
assert.deepEqual(asked, [{ method: "POST", path: "/v1/text-to-speech/" + SARAH + "/stream?output_format=mp3_44100_128", body: { text: "Good morning, Bongs.", model_id: "eleven_v4_turbo", previous_text: "Hello." }, key: "xi-SECRET" }]);
assert.deepEqual(takes, [{ p_chars: 20, p_limit: 60000 }]);
ok("speak: her words go to ElevenLabs in her voice and the audio comes straight back; the characters are counted");

for (const text of ["", "   ", "x".repeat(801), 42, null]) { r = await post({ op: "speak", text }); assert.deepEqual([r.status, r.j.error, asked.length, takes.length], [400, "bad_text", 0, 0]); }
r = await post({ op: "speak", text: "hi", voice_id: "../../v1/user" }); assert.deepEqual([r.status, r.j.error, asked.length], [400, "bad_voice", 0]);
limitHit = true; r = await post({ op: "speak", text: "hello" }); assert.deepEqual([r.status, r.j.error, asked.length], [429, "voice_daily_limit", 0]); limitHit = false;
eleven = { status: 401, detail: { status: "quota_exceeded", message: "This request exceeds your quota." } };
r = await post({ op: "speak", text: "hello" }); assert.deepEqual([r.status, r.j.error, r.j.message], [402, "voice_quota", "ElevenLabs says this month's credits are used up."]); eleven = null;
ok("nothing to say, too much to say, a bad voice id, the day's limit and ElevenLabs' own quota are each refused in words");

r = await post({ op: "voices" });
assert.deepEqual([r.status, r.j.chosen, r.j.voices.map((v: any) => [v.id, v.name, v.gender, v.use, v.preview_url])], [200, SARAH, [[ADAM, "Adam", "male", "narration", "https://storage.example/Adam.mp3"], [SARAH, "Sarah", "female", "conversational", "https://storage.example/Sarah.mp3"], [MIRA, "Mira", "female", "advertisement", "https://storage.example/Mira.mp3"]]]);
r = await post({ op: "speak", text: "This is Mira.", voice_id: MIRA }); assert.deepEqual([r.status, asked[0].path.includes(MIRA), row.voice_id], [200, true, SARAH], "trying a voice does not make it hers");
r = await post({ op: "choose", voice_id: "ZZZZZZZZZZZZZZZZZZZZ" }); assert.deepEqual([r.status, r.j.error, row.voice_id], [404, "no_voice", SARAH]);
r = await post({ op: "choose", voice_id: MIRA }); assert.deepEqual([r.status, r.j.voice, row.voice_id, row.picked], [200, { id: MIRA, name: "Mira", picked: "owner" }, MIRA, "owner"]);
r = await post({ op: "speak", text: "Now I sound like this." }); assert.ok(asked[0].path.includes(MIRA));
ok("the picker: his voices, a trial that changes nothing, and a choice that only takes a voice from his account");
console.log("ALL VOICE WIRING CHECKS PASSED (characters counted: " + taken + ")");
Deno.exit(0);

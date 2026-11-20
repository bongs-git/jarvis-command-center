import assert from "node:assert/strict";
import { HttpError } from "../_shared/http.ts";
import { API, forgetModelTrouble, listVoices, pickVoice, refused, sayable, speak, voiceConfig, voiceId, voicesFrom } from "../indai-voice/voice.ts";

// INDAI's hosted voice (supabase/indai-voice/voice.ts): what is sent to ElevenLabs and how its answers are read. No network.
const cfg = { key: "xi-KEY", model: "eleven_v4_turbo", dailyChars: 60000, voice: null };
const VOICE = "EXAVITQu4vr4xnSDxMaL";
const raw = (over: Record<string, unknown> = {}) => ({ voice_id: VOICE, name: "Sarah", category: "premade", description: "Soft, warm and reassuring", preview_url: "https://storage.example/sarah.mp3", labels: { gender: "female", accent: "American", age: "young", use_case: "conversational" }, samples: null, settings: { stability: 0.5 }, ...over });

Deno.test("the set-up comes from the owner's secrets, with safe defaults", () => {
  const env = (o: Record<string, string>) => (n: string) => o[n];
  assert.equal(voiceConfig(env({})), null);
  assert.deepEqual(voiceConfig(env({ ELEVENLABS_API_KEY: "  xi-KEY \n" })), { key: "xi-KEY", model: "eleven_v4_turbo", dailyChars: 60000, voice: null });
  assert.deepEqual(voiceConfig(env({ ELEVENLABS_API_KEY: "k", ELEVENLABS_MODEL: "eleven_v4", INDAI_VOICE_DAILY_CHARS: "20000", ELEVENLABS_VOICE_ID: VOICE })), { key: "k", model: "eleven_v4", dailyChars: 20000, voice: VOICE });
  assert.deepEqual(voiceConfig(env({ ELEVENLABS_API_KEY: "k", ELEVENLABS_MODEL: "bad model/../x", INDAI_VOICE_DAILY_CHARS: "-5", ELEVENLABS_VOICE_ID: "../../etc" })), { key: "k", model: "eleven_v4_turbo", dailyChars: 60000, voice: null });
  assert.deepEqual([voiceId(VOICE), voiceId("abc"), voiceId("a/b/../c1234567"), voiceId(42), voiceId(null)], [VOICE, null, null, null, null]);
});

Deno.test("what is to be said is tidied and bounded", () => {
  assert.equal(sayable("  Good morning,\n Bongs.\t "), "Good morning, Bongs.");
  assert.equal(sayable("x".repeat(800))?.length, 800);
  for (const no of ["", "   ", "x".repeat(801), null, undefined, 42, ["hi"], { text: "hi" }]) assert.equal(sayable(no), null);
  assert.equal(sayable("x".repeat(301), 300), null);
});

Deno.test("the voices in his account, made small; and the one she starts with", () => {
  const list = voicesFrom({ voices: [
    raw({ voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "Deep narrator", labels: { gender: "male", use_case: "narration" } }),
    raw({ voice_id: "AAAAAAAAAAAAAAAAAAAA", name: "Mira", category: "generated", description: "Bright announcer", labels: { gender: "female", use_case: "advertisement" } }),
    raw(),
    raw({ voice_id: "bad id!" }), raw({ name: "" }), null, "x",
    raw({ voice_id: "BBBBBBBBBBBBBBBBBBBB", name: "NoLabels", labels: null, description: null, preview_url: "http://insecure.example/x.mp3" }),
  ], has_more: false });
  assert.deepEqual(list.map((v) => v.name), ["Adam", "Mira", "Sarah", "NoLabels"]);
  assert.deepEqual(list[2], { id: VOICE, name: "Sarah", category: "premade", gender: "female", accent: "American", age: "young", use: "conversational", description: "Soft, warm and reassuring", preview_url: "https://storage.example/sarah.mp3" });
  assert.deepEqual([list[3].gender, list[3].description, list[3].preview_url], ["", "", null]);
  assert.ok(!JSON.stringify(list).includes("stability"), "only what a picker needs");
  assert.equal(pickVoice(list)?.name, "Sarah", "a woman's conversational, warm voice before any other");
  assert.equal(pickVoice(list.filter((v) => v.name !== "Sarah"))?.name, "Mira");
  assert.equal(pickVoice(list.filter((v) => v.gender !== "female"))?.name, "NoLabels", "an unlabelled voice before a man's");
  assert.equal(pickVoice([]), null);
  assert.deepEqual(voicesFrom({ detail: "no" }), []);
});

Deno.test("listing asks ElevenLabs with the key, page by page", async () => {
  const seen: string[] = [];
  const pages = [{ voices: [raw()], has_more: true, next_page_token: "t/2" }, { voices: [raw({ voice_id: "AAAAAAAAAAAAAAAAAAAA", name: "Mira" }), raw()], has_more: false, next_page_token: null }];
  const list = await listVoices(cfg, (url, init) => { seen.push(url + " " + (init.headers as Record<string, string>)["xi-api-key"]); return Promise.resolve(Response.json(pages[seen.length - 1])); });
  assert.deepEqual(seen, [API + "/v2/voices?page_size=100&include_total_count=false xi-KEY", API + "/v2/voices?page_size=100&include_total_count=false&next_page_token=t%2F2 xi-KEY"]);
  assert.deepEqual(list.map((v) => v.name), ["Sarah", "Mira"], "a voice listed twice appears once");
  await assert.rejects(() => listVoices(cfg, () => Promise.resolve(Response.json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, { status: 401 }))), (e: unknown) => e instanceof HttpError && e.code === "voice_key" && e.status === 502 && /Invalid API key/.test(e.message));
});

Deno.test("speaking: the request ElevenLabs gets, and a refused model falls back once", async () => {
  forgetModelTrouble();
  const sent: { url: string; headers: Record<string, string>; body: any }[] = [];
  let now = 1_000_000;
  const io = (answer: (body: any) => Response) => ({ now: () => now, fetch: (url: string, init: RequestInit) => { const body = JSON.parse(String(init.body)); sent.push({ url, headers: init.headers as Record<string, string>, body }); return Promise.resolve(answer(body)); } });
  const audio = () => new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } });
  let out = await speak(cfg, VOICE, "Good morning.", { previous: "Hello.", next: null }, io(audio));
  assert.deepEqual(sent[0], { url: API + "/v1/text-to-speech/" + VOICE + "/stream?output_format=mp3_44100_128", headers: { "xi-api-key": "xi-KEY", "Content-Type": "application/json", Accept: "audio/mpeg" }, body: { text: "Good morning.", model_id: "eleven_v4_turbo", previous_text: "Hello." } });
  assert.deepEqual([out.model, new Uint8Array(await out.audio.arrayBuffer()).length], ["eleven_v4_turbo", 3]);
  // the model is not available to this account: the older fast one is used, and remembered for ten minutes
  sent.length = 0;
  const picky = (body: any) => body.model_id === "eleven_v4_turbo" ? Response.json({ detail: { status: "model_not_found", message: "A model with model ID eleven_v4_turbo does not exist" } }, { status: 400 }) : audio();
  out = await speak(cfg, VOICE, "One.", {}, io(picky));
  assert.deepEqual([out.model, sent.map((s) => s.body.model_id)], ["eleven_flash_v2_5", ["eleven_v4_turbo", "eleven_flash_v2_5"]]);
  sent.length = 0; now += 60_000;
  out = await speak(cfg, VOICE, "Two.", {}, io(picky));
  assert.deepEqual(sent.map((s) => s.body.model_id), ["eleven_flash_v2_5"], "not asked again for ten minutes");
  sent.length = 0; now += 600_000;
  await speak(cfg, VOICE, "Three.", {}, io(audio));
  assert.deepEqual(sent.map((s) => s.body.model_id), ["eleven_v4_turbo"]);
  forgetModelTrouble();
  // other refusals are not retried, and come back as INDAI's own errors
  const fails = async (status: number, detail: unknown) => { sent.length = 0; try { await speak(cfg, VOICE, "x", {}, io(() => Response.json({ detail }, { status }))); } catch (e) { return [(e as HttpError).status, (e as HttpError).code, sent.length]; } return null; };
  assert.deepEqual(await fails(401, { status: "quota_exceeded", message: "This request exceeds your quota." }), [402, "voice_quota", 1]);
  assert.deepEqual(await fails(401, { status: "invalid_api_key", message: "Invalid API key" }), [502, "voice_key", 1]);
  assert.deepEqual(await fails(429, { status: "too_many_concurrent_requests", message: "Too many concurrent requests" }), [429, "voice_busy", 1]);
  assert.deepEqual(await fails(404, { status: "voice_not_found", message: "A voice with that id was not found." }), [409, "voice_gone", 1]);
  assert.deepEqual(await fails(422, [{ loc: ["body", "text"], msg: "field required", type: "missing" }]), [502, "voice", 1]);
  assert.deepEqual(await fails(500, "Internal Server Error"), [502, "voice", 1]);
  await assert.rejects(() => speak(cfg, VOICE, "x", {}, { fetch: () => Promise.reject(new Error("network")) }), (e: unknown) => e instanceof HttpError && e.code === "voice" && e.status === 502);
  assert.equal(refused(400, { detail: { status: "max_character_limit_exceeded", message: "too long" } }).code, "voice");
  assert.ok(refused(401, { detail: { message: "long ".repeat(400) } }).message.length < 260, "a refusal's words are cut short");
});

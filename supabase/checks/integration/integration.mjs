import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, dir = process.env.LAB_DIR;
const pool = new Pool({
  host: "127.0.0.1",
  port: 55432,
  user: "postgres",
  password: "local-dev-only",
  database: "indai",
  max: 12,
});
let passed = 0;
const report = [];
const check = async (label, test) => {
  await test();
  report.push(label);
  console.log("PASS", ++passed, label);
};
const sql = async (statement, params = []) => (await pool.query(statement, params)).rows;
const hdr = (token = anon, pass) => ({
  apikey: anon,
  Authorization: "Bearer " + token,
  ...(pass ? { "x-indai-pass": process.env.INDAI_PASSCODE } : {}),
});
const post = (path, body, h = {}) =>
  fetch(url + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...h },
    body: JSON.stringify(body),
  });
const brain = (body, user, pass = false) => post("/functions/v1/indai-brain", body, hdr(user, pass));
const data = async (response, code = 200) => {
  const r = await response;
  const j = await r.json();
  assert.equal(r.status, code, `HTTP ${r.status} ${j.error ?? ""} ${j.message ?? ""}`);
  return j;
};
const publicBrain = (body) => brain(body);
const job = async (name, args = {}) => {
  const [{ id }] = await sql("insert into indai_job_log(job,args) values($1,$2) returning id", [
    name,
    JSON.stringify(args),
  ]);
  const [{ secret }] = await sql("select secret from vault.secrets where name='indai_job_token'");
  return post("/functions/v1/indai-jobs", { id, job: name }, { "x-indai-job": secret });
};
const login = async (handle) => {
  const res = await post("/auth/v1/otp", { email: handle + "@local.test" }, hdr());
  if (!res.ok) throw new Error("GoTrue OTP " + res.status + " " + (await res.text()).slice(0, 220));
  const file = dir + "/" + handle + ".eml";
  for (let i = 0; !existsSync(file) && i < 50; i++) await new Promise((r) => setTimeout(r, 60));
  const content = execFileSync("python3", [
    "-c",
    "import sys,email,html;from email import policy;m=email.message_from_binary_file(open(sys.argv[1],'rb'),policy=policy.default); b=m.get_body(preferencelist=('html','plain')) or m; print(html.unescape(b.get_content()))",
    file,
  ], { encoding: "utf8" });
  const link = content.match(/href=["'](http:\/\/127\.0\.0\.1:55435\/auth\/v1\/verify\?[^"']+)/i)?.[1];
  assert.ok(link, "OTP verification URL");
  const redirect = await fetch(link, { redirect: "manual" });
  assert.ok(redirect.status >= 300 && redirect.status < 400);
  const hash = new URL(redirect.headers.get("location")).hash.slice(1);
  const result = new URLSearchParams(hash).get("access_token");
  assert.ok(result, "access token");
  return result;
};
let A, B, aid, bid, mem, entity;
try {
  await check("All six edge entrypoints answer OPTIONS with open CORS", async () => {
    for (const name of ["brain", "market", "tv", "ears", "jobs", "push"]) {
      const r = await fetch(url + "/functions/v1/indai-" + name, { method: "OPTIONS" });
      assert.equal(r.status, 204);
      assert.equal(r.headers.get("access-control-allow-origin"), "*");
    }
  });
  await check(
    "Two real Supabase Auth email magic links yield distinct verified sessions through local SMTP",
    async () => {
      A = await login("alpha");
      B = await login("beta");
      const users = await sql("select id,email from auth.users order by email");
      [aid, bid] = users.map((x) => x.id);
      assert.notEqual(aid, bid);
      await sql("select indai_link_owner($1)", [aid]);
    },
  );
  await check(
    "Signed-out owner passcode reads legacy memory, and authenticated users are isolated",
    async () => {
      const payload = { mode: "memory", op: "list" };
      const a = await data(brain(payload, A)),
        b = await data(brain(payload, B)),
        owner = await data(brain(payload, anon, true));
      assert.equal(a.memory[0].text, "One private pre-migration rule");
      assert.deepEqual(a, owner);
      assert.equal(b.memory.length, 0);
      await data(publicBrain(payload), 401);
      const ar = await data(fetch(url + "/rest/v1/indai_memory?select=id,text", { headers: hdr(A) }));
      const br = await data(fetch(url + "/rest/v1/indai_memory?select=id,text", { headers: hdr(B) }));
      assert.equal(ar.length, 1);
      assert.equal(br.length, 0);
    },
  );
  await check("Scoped SQL RPCs and invalid session tokens refuse access", async () => {
    const r = await post(
      "/rest/v1/rpc/indai_learn",
      { p_user: aid, p_items: [{ text: "No write" }] },
      hdr(B),
    );
    assert.ok([401, 403, 404].includes(r.status));
    await data(brain({ mode: "memory", op: "list" }, "invalid-local-session", true), 401);
  });
  await check(
    "Two devices merge speech counters and fixes atomically, including a retried write",
    async () => {
      const key = "indai.speech.v1", mutation = randomUUID();
      const put = (n, to, uuid) =>
        brain({
          mode: "profile",
          op: "put",
          key,
          mutation_id: uuid,
          value: { fixes: { q: { n, to } }, used: { q: 1 }, stats: { heard: 1 } },
        }, A);
      await Promise.all([
        data(put(1, "q", mutation)),
        data(put(4, "QQQ", randomUUID())),
        data(put(1, "q", mutation)),
      ]);
      const j = await data(brain({ mode: "profile", op: "get", key }, anon, true));
      assert.equal(j.value.used.q, 2);
      assert.equal(j.value.stats.heard, 2);
      assert.equal(j.value.fixes.q.to, "QQQ");
      const other = await data(brain({ mode: "profile", op: "get", key }, B));
      assert.equal(other.value, null);
      await data(brain({ mode: "profile", op: "put", key, value: { stats: { heard: -1 } } }, A), 400);
      await data(
        brain({ mode: "profile", op: "put", key: "ears", value: { blob: "é".repeat(34000) } }, A),
        413,
      );
      await data(
        brain({ mode: "profile", op: "put", key: "watchlist", value: { symbols: ["NVDA", "QQQ"] } }, A),
      );
    },
  );
  await check(
    "Nonstream talk returns the existing envelope and persists the assistant and user together",
    async () => {
      const j = await data(
        brain(
          { mode: "talk", question: "remember Juniper", search: false, history: [], session: "phone" },
          A,
        ),
      );
      assert.ok(j.result.spoken);
      assert.equal(j.remembered[0].kind, "fact");
      mem = j.remembered[0].id;
      const next = await data(
        brain(
          { mode: "talk", question: "what was the word?", search: false, history: [], session: "phone" },
          A,
        ),
      );
      assert.ok(next.result.spoken.includes("Juniper"));
      const h = await data(brain({ mode: "history", op: "list", session: "phone" }, A));
      assert.deepEqual(h.turns.map((x) => x.role), ["user", "assistant", "user", "assistant"]);
      assert.equal((await data(brain({ mode: "history", op: "list", session: "phone" }, B))).turns.length, 0);
      assert.ok(
        (await data(brain({ mode: "memory", op: "list" }, A))).memory.find((x) => x.id === mem).uses > 0,
      );
    },
  );
  await check("SSE sends real incremental spoken chunks, one final envelope, then DONE", async () => {
    const start = performance.now();
    const r = await brain({
      mode: "talk",
      question: "hello",
      session: "new",
      history: [],
      search: false,
      stream: true,
    }, A);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("content-type").startsWith("text/event-stream"));
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", first = null, events = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).slice(6);
        buf = buf.slice(i + 2);
        const obj = line === "[DONE]" ? line : JSON.parse(line);
        events.push(obj);
        if (obj.delta && first == null) first = performance.now() - start;
      }
    }
    const deltas = events.filter((x) => x.delta).map((x) => x.delta);
    const final = events.at(-2);
    assert.ok(deltas.length > 1);
    assert.equal(events.at(-1), "[DONE]");
    assert.equal(final.result.spoken, deltas.join(""));
    assert.equal(final.mode, "talk");
    assert.deepEqual(final.remembered, []);
    assert.equal(events.filter((x) => x.result).length, 1);
    console.log("Local fixture first delta", Math.round(first), "ms");
  });
  await check("User-supplied history and history clearing are session scoped", async () => {
    const j = await data(
      brain({
        mode: "talk",
        question: "what word?",
        session: "fresh",
        search: false,
        history: [{ role: "user", text: "Juniper" }, { role: "assistant", text: "Understood" }],
      }, A),
    );
    assert.match(j.result.spoken, /Juniper/);
    await data(brain({ mode: "history", op: "clear", session: "phone" }, A));
    assert.equal((await data(brain({ mode: "history", op: "list", session: "phone" }, A))).turns.length, 0);
    assert.equal((await data(brain({ mode: "history", op: "list", session: "fresh" }, A))).turns.length, 2);
  });
  await check("Trade envelope retains verdict, sources and usage", async () => {
    const t = await data(brain({ mode: "trade", idea: { symbol: "QQQ" }, context: {} }, A));
    for (
      const k of [
        "rag",
        "spoken",
        "confidence",
        "headline",
        "summary",
        "bullish",
        "bearish",
        "events",
        "watch",
        "plan_notes",
      ]
    ) assert.ok(k in t.result);
  });
  await check("Nightly memory job merges paraphrases and caps each user's least-used memories", async () => {
    for (const t of ["I skip the first five minutes.", "I avoid the opening five minutes."]) {
      await data(brain({ mode: "memory", op: "add", text: t, kind: "rule" }, A));
    }
    const res = await data(job("memory", { user: aid }));
    assert.equal(res.ok, true);
    assert.equal(
      (await sql("select count(*)::int n from indai_memory where user_id=$1 and kind='rule'", [aid]))[0].n,
      1,
    );
    await sql(
      "insert into indai_memory(user_id,text,kind) select $1,'fixture '||i,'fact' from generate_series(1,158)i",
      [bid],
    );
    await data(job("memory", { user: bid }));
    assert.equal((await sql("select count(*)::int n from indai_memory where user_id=$1", [bid]))[0].n, 150);
  });
  await check(
    "A four-second PCM file reaches the speech adapter with watchlist and learned vocabulary",
    async () => {
      const wav = Buffer.alloc(44 + 4 * 32000);
      wav.write("RIFF");
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(16000, 24);
      wav.writeUInt32LE(32000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(wav.length - 44, 40);
      const ears = (b) =>
        fetch(url + "/functions/v1/indai-ears", {
          method: "POST",
          headers: { ...hdr(A), "Content-Type": "audio/wav" },
          body: b,
        });
      const j = await data(ears(wav));
      assert.match(j.text, /665/);
      assert.ok(j.alternatives.length);
      assert.ok(j.ms >= 0);
      const record = readFileSync(dir + "/provider.ndjson", "utf8").trim().split("\n").map(JSON.parse).find(
        (x) => x.vendor === "deepgram",
      );
      assert.ok(record.terms.includes("NVDA"));
      assert.ok(record.terms.includes("QQQ"));
      wav.writeUInt16LE(2, 22);
      await data(ears(wav), 422);
      await data(ears(Buffer.alloc(1_000_001)), 413);
    },
  );
  await check(
    "Real-time snapshots, compact candles, and paginated option chains preserve existing fields",
    async () => {
      const market = (q) => data(fetch(url + "/functions/v1/indai-market?" + q, { headers: hdr(A) }));
      let q = await market("kind=snapshot&symbols=QQQ");
      assert.equal(q.delay, 0);
      assert.equal(q.source, "Massive");
      assert.equal(q.quotes[0].price, 100);
      const b = await market("kind=bars&symbols=QQQ");
      assert.equal(b.bars.QQQ.bars[0].length, 8);
      const c = await market("kind=chain&symbol=QQQ");
      assert.equal(c.chain.length, 2);
      assert.ok(c.gexNear);
      assert.equal(c.delayed, false);
      const pub = await data(
        fetch(url + "/functions/v1/indai-market?kind=snapshot&symbols=QQQ", { headers: hdr() }),
      );
      assert.equal(pub.delay, 900);
      await fetch(url + "/test-mode?mode=delayed");
      q = await market("kind=snapshot&symbols=SPY");
      assert.equal(q.delay, 900);
      await fetch(url + "/test-mode");
    },
  );
  await check(
    "GEX batches update both scopes, with DST, holidays, an independent deadline and failure alerts",
    async () => {
      const at = "2026-11-19T14:14:00Z";
      await fetch(url + "/test-mode?at=" + Date.parse(at));
      const [{ s }] = await sql("select indai_market_session($1::timestamptz) s", [at]);
      const state = await data(job("gex-batch", { day: s.day, symbols: ["QQQ", "SPY", "IWM"] }));
      assert.equal(state.ok, true);
      const rows = await data(
        fetch(url + "/rest/v1/indai_gex_levels?select=ticker,scope,asof_et,net_gex_m", { headers: hdr() }),
      );
      assert.equal(rows.length, 6);
      assert.ok(rows.every((r) => r.asof_et.startsWith(s.day) && r.net_gex_m != null));
      await sql(
        "select vault.create_secret('https://local.test','indai_project_url'),vault.create_secret('https://monitor.test','indai_alert_url')",
      );
      const clock = async (at) => (await sql("select indai_market_session($1::timestamptz) s", [at]))[0].s;
      assert.equal((await clock("2026-07-06T13:14Z")).minute, 554);
      assert.equal((await clock("2026-11-19T14:14Z")).minute, 554);
      assert.equal((await clock("2026-11-26T14:14Z")).close_min, null);
      assert.equal((await clock("2026-11-27T14:14Z")).close_min, 780);
      await sql("select indai_gex_tick('2026-11-18T14:14Z'),indai_gex_tick('2026-11-18T14:20Z')");
      assert.ok((await sql("select 1 from net.requests where url='https://monitor.test'")).length);
      const h = await data(fetch(url + "/functions/v1/indai-market?kind=health"));
      assert.ok(h.jobs.some((j) => j.job === "gex-batch"));
      assert.ok(h.jobs.some((j) => j.job === "gex"));
      await data(post("/functions/v1/indai-jobs", { job: "memory", id: randomUUID() }, hdr()), 401);
      await fetch(url + "/test-mode");
    },
  );
  await check(
    "Web Push supports encrypted test sends, account ownership, queue deduplication and unsubscribe",
    async () => {
      const keys = createECDH("prime256v1");
      keys.generateKeys();
      entity = {
        endpoint: "https://fcm.googleapis.com/fcm/send/local-fixture",
        keys: {
          p256dh: keys.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
      };
      const push = (op, body = {}, u = A) => post("/functions/v1/indai-push", { op, ...body }, hdr(u));
      assert.ok((await data(fetch(url + "/functions/v1/indai-push"))).publicKey);
      await data(push("subscribe", { subscription: entity }));
      await data(push("subscribe", { subscription: entity }, B), 409);
      assert.equal((await data(push("test"))).accepted, 1);
      await data(push("test", {}, B), 404);
      const records = readFileSync(dir + "/provider.ndjson", "utf8").trim().split("\n").map(JSON.parse);
      assert.ok(
        records.some((x) => x.vendor === "push" && x.vapid && x.encoding === "aes128gcm" && x.bytes > 70),
      );
      const queue = async () =>
        (await sql("select indai_queue_signal($1,'QQQ',100,'ema',1,2,'{}') result", [aid]))[0].result;
      const results = await Promise.all([queue(), queue()]);
      assert.deepEqual(results.sort(), [false, true]);
      assert.equal((await sql("select * from indai_claim_push($1)", [randomUUID()])).length, 1);
      await data(push("unsubscribe", { endpoint: entity.endpoint }));
      assert.equal((await sql("select count(*)::int n from indai_push_queue"))[0].n, 0);
    },
  );
  await check(
    "A scheduled market-hours scan delivers the matching A-grade setup once and honors the risk breaker",
    async () => {
      const { bars, opts, signal } = JSON.parse(readFileSync(dir + "/golden.json", "utf8"));
      const payload = {
        date: "2026-11-19",
        capital: 5000,
        goal: 200,
        aggr: "balanced",
        strategies: ["ema", "vwap", "orb", "gex"],
        levels: { QQQ: opts.levels },
        tripped: false,
        cooldownUntil: 0,
        goalHit: false,
        pnl: 0,
      };
      const writePlan = (p) => data(brain({ mode: "profile", op: "put", key: "plan", value: p }, B));
      await writePlan(payload);
      await data(brain({ mode: "profile", op: "put", key: "watchlist", value: { symbols: ["QQQ"] } }, B));
      await data(post("/functions/v1/indai-push", { op: "subscribe", subscription: entity }, hdr(B)));
      const minutes = bars.flatMap((b) =>
        Array.from(
          { length: 5 },
          (_, i) => ({
            ticker: "QQQ",
            t: b.t + i * 60000,
            o: b.o,
            h: b.h,
            l: b.l,
            c: b.c,
            v: b.v / 5,
            tf: "1",
            received_at: new Date().toISOString(),
          }),
        )
      );
      const insert = await post(
        "/rest/v1/indai_tv_bars",
        minutes,
        hdr(process.env.SUPABASE_SERVICE_ROLE_KEY),
      );
      assert.equal(insert.status, 201);
      const count = () =>
        readFileSync(dir + "/provider.ndjson", "utf8").trim().split("\n").map(JSON.parse).filter((x) =>
          x.vendor === "push"
        ).length;
      const old = count();
      await fetch(url + "/test-mode?at=" + opts.now);
      try {
        await writePlan({ tripped: true });
        await data(job("push"));
        assert.equal(count(), old);
        await writePlan({ tripped: false });
        await data(job("push"));
        assert.equal(count(), old + 1);
        await data(job("push"));
        assert.equal(count(), old + 1);
        const [event] = await sql("select ticker,strat,bar_t from indai_signal_events where user_id=$1", [
          bid,
        ]);
        assert.equal(event.strat, signal.strat);
        assert.equal(Number(event.bar_t), signal.barT);
      } finally {
        await fetch(url + "/test-mode");
      }
    },
  );
  await check(
    "Webhook authenticates and accepts >4 KB bridge batches, rejects >16 KiB, and purges expired records",
    async () => {
      const b = Date.now(),
        bars = Array.from(
          { length: 80 },
          (_, i) => ({ s: "QQQ", t: b - i * 60000, o: 1, h: 2, l: 1, c: 1.5, v: 2000 }),
        );
      const tv = (key, body) => post("/functions/v1/indai-tv?key=" + key, body);
      await data(tv("x", { kind: "bars", bars }), 401);
      assert.equal((await data(tv("local-fixture", { kind: "bars", tf: "1", bars }))).bars, 80);
      await data(tv("local-fixture", { text: "x".repeat(16400) }), 413);
      await data(tv("local-fixture", { text: "QQQ CW 101", ticker: "QQQ" }));
      await sql(
        "update indai_tv_alerts set received_at=now()-interval '4 days'; update indai_tv_bars set received_at=now()-interval '4 days'",
      );
      await sql("select indai_retention()");
      assert.equal((await sql("select count(*)::int n from indai_tv_bars"))[0].n, 0);
      assert.equal((await sql("select count(*)::int n from indai_tv_alerts"))[0].n, 0);
    },
  );
  await check(
    "Concurrent requests observe the per-user rolling limit and atomic global token reservations",
    async () => {
      const id = randomUUID();
      const r = await Promise.all(
        Array.from({ length: 9 }, () => sql("select indai_take_request($1,'test',4) allowed", [id])),
      );
      assert.equal(r.filter((x) => x[0].allowed).length, 4);
      const [{ balance }] = await sql("select (reserved+spent)::int balance from indai_token_days");
      const tokens = await Promise.all(
        Array.from({ length: 4 }, () => sql("select indai_reserve_tokens(60,$1) id", [balance + 120])),
      );
      assert.equal(tokens.filter((x) => x[0].id).length, 2);
      for (const t of tokens.flat()) if (t.id) await sql("select indai_settle_tokens($1,0)", [t.id]);
      await fetch(url + "/test-mode?budget=0");
      assert.equal(
        (await data(brain({ mode: "talk", question: "hi", stream: true }, A), 429)).error,
        "budget",
      );
      await fetch(url + "/test-mode?budget=250000");
      await sql(
        "insert into indai_rate_events(user_id,bucket) select $1,'brain' from generate_series(1,60)",
        [bid],
      );
      assert.equal((await data(brain({ mode: "trade" }, B), 429)).error, "rate_limited");
    },
  );
  await check("Project live-check curl script passes with the local provider fixture", async () => {
    const config = { encoding: "utf8", env: { ...process.env, BASE: url, ANON_KEY: anon, USER_JWT: A } };
    console.log(execFileSync("bash", ["supabase/checks/brain-live.sh"], config).trim());
    console.log(execFileSync("python3", ["supabase/checks/stream-live.py"], config).trim());
  });
  writeFileSync(dir + "/integration-result.json", JSON.stringify({ passed: report }, null, 2));
} finally {
  await pool.end();
}

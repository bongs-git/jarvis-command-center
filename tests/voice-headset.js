// PAP-3 on the headset: her hosted voice (js/cloud-voice.js) against a stand-in indai-voice that answers with a real
// short sound. Ported from the website's tests/voice-test.js.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8765/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
function tone(ms = 320) {
  const rate = 22050, n = Math.round(rate * ms / 1000), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 3000), 44 + i * 2);
  return b;
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function backend(page, b) {
  Object.assign(b, { calls: [], configured: true, ready: true, speakFails: null, delay: 0 });
  await page.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.host === 'localhost:8765') return route.continue();
    if (u.host !== 'zptjziewsfuvfcogrikz.supabase.co') { b.other = (b.other || 0) + (/huggingface|hf\.co/.test(u.host) ? 1 : 0); return route.abort(); }
    const json = (j, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.endsWith('/indai-voice')) {
      const body = JSON.parse(req.postData() || '{}'), pass = req.headers()['x-indai-pass'] || '';
      b.calls.push({ ...body, _pass: pass });
      if (pass !== 'open sesame') return json({ error: 'passcode' }, 401);
      if (body.op === 'status') return json(!b.configured ? { configured: false, ready: false } : { configured: true, ready: b.ready, voice: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' } });
      if (body.op === 'speak') {
        if (b.speakFails) return json(b.speakFails.body, b.speakFails.status);
        if (b.delay) await sleep(b.delay);
        return route.fulfill({ status: 200, contentType: 'audio/mpeg', headers: cors, body: tone() });
      }
      return json({ error: 'bad_request' }, 400);
    }
    if (u.pathname.endsWith('/indai-market')) return json({ error: 'unavailable' }, 503);
    if (u.pathname.endsWith('/indai-brain')) return json(req.method() === 'GET' ? { configured: false, passcode: false, memory: true } : { error: 'not_configured' }, req.method() === 'GET' ? 200 : 503);
    if (u.pathname.endsWith('/indai-schwab')) return json({ error: 'not_connected', message: 'off in this test' }, 409);
    if (u.pathname.includes('/rest/v1/')) return json([]);
    if (u.pathname.endsWith('/indai-tv')) return json(u.searchParams.get('bars') ? { bars: [], live: [], now: Date.now() } : { alerts: [] });
    return json({ error: 'not_found' }, 404);
  });
}
const speaks = (b) => b.calls.filter(c => c.op === 'speak');
const VERDICT = 'This one is amber. Price is below VWAP by 0.42 percent and the 665 calls need a move by the close. Watch 664.50.';

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const open = async ({ pass = 'open sesame', query = '', hosted = '', known = '', engine = 'neural' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }), page = await ctx.newPage(), b = {}, errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(([p, h, k, e]) => {
      const s = JSON.parse(localStorage.getItem('jarvis.settings.v1') || '{}'); s.researchPass = p; s.voice = true; s.voiceEngine = e; s.main = 'SPY'; s.gestureTutorialOffered = true; localStorage.setItem('jarvis.settings.v1', JSON.stringify(s));
      if (h) localStorage.setItem('indai.voice.hosted', h); if (k) localStorage.setItem('indai.voice.known', k);
      window.__system = []; const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => { window.__system.push(u.text); setTimeout(() => u.onend && u.onend(), 30); }; }
    }, [pass, hosted, known, engine]);
    await backend(page, b);
    await page.goto(BASE + (query ? '?' + query : ''));
    await page.waitForFunction(() => window.__indai && window.__indai.P && window.__indai.P.chart, null, { timeout: 40000 });
    await page.mouse.click(640, 400);   // the first tap unlocks audio, as on the headset
    await sleep(2200);                  // past the voice preload timer
    return { ctx, page, b, errors };
  };
  try {
    {
      const { ctx, page, b, errors } = await open({ known: 'on' });
      const st = await page.evaluate(() => { const a = window.__indai.app, v = a.indai.voice; return { cloud: { state: a.cloudVoice.state, voice: a.cloudVoice.voice }, tts: !!v._ttsAsked }; });
      check('[on] with the passcode the headset finds her hosted voice and downloads no speaking model', st.cloud.state === 'on' && st.cloud.voice.name === 'Sarah' && !st.tts && b.calls[0].op === 'status', st);
      b.calls.length = 0;
      await page.evaluate((t) => { const v = window.__indai.app.indai.voice; window.__states = []; const on = v.onState; v.onState = (s) => { window.__states.push(s.speaking); on(s); }; v.speak(t); }, VERDICT);
      await page.waitForFunction(() => window.__states.length > 1 && window.__states.at(-1) === false, null, { timeout: 8000 }).catch(() => {});
      const r = await page.evaluate(() => { const a = window.__indai.app, v = a.indai.voice; return { states: window.__states, system: window.__system, spoken: a.cloudVoice.spoken, tts: !!v._ttsAsked, speaking: v.state.speaking }; });
      const s = speaks(b);
      check('[on] a verdict is fetched in two pieces: the first sentence alone, then the rest', s.length === 2 && s[0].text === 'This one is amber.' && /Watch 664\.50\.$/.test(s[1].text) && s.every(x => x._pass === 'open sesame'), s.map(x => x.text));
      check('[on] it plays, "speaking" goes on and then off, and the device voice is not used or downloaded', r.states[0] === true && r.states.at(-1) === false && r.spoken === 2 && r.system.length === 0 && !r.tts && !r.speaking, r);
      // the orb follows "speaking"
      await page.evaluate(() => { const v = window.__indai.app.indai.voice; window.__orb = []; const i = setInterval(() => window.__orb.push(v.state.speaking), 40); window.__orbStop = () => clearInterval(i); v.speak('Good morning. The tape is quiet.'); });
      await page.waitForFunction(() => window.__orb.includes(true) && window.__orb.at(-1) === false, null, { timeout: 8000 }).catch(() => {}); const orb = await page.evaluate(() => { window.__orbStop(); return window.__orb; });
      check('[on] while she speaks voice.state.speaking is on (the orb\'s speaking glow follows it)', orb.includes(true) && orb.at(-1) === false, orb.map(x => x ? 1 : 0).join(''));
      // stop
      b.calls.length = 0; b.delay = 250;
      await page.evaluate((t) => { const v = window.__indai.app.indai.voice; v.speak(t + ' ' + t); setTimeout(() => v.stopSpeaking(), 120); }, VERDICT);
      await sleep(1500);
      const stopped = await page.evaluate(() => { const a = window.__indai.app; return { speaking: a.indai.voice.state.speaking, playing: !!a.indai.voice.playing }; });
      check('[on] "stop" silences her at once', !stopped.speaking && !stopped.playing, stopped);
      b.delay = 0;
      // 402 voice_quota: the device says the whole reply, she says why once in writing
      await page.evaluate(() => { window.__indai.app.settings.voiceEngine = 'system'; });   // the fallback here is the browser voice, which the test can hear
      b.calls.length = 0; b.speakFails = { status: 402, body: { error: 'voice_quota', message: "ElevenLabs says this month's credits are used up." } };
      await page.evaluate((t) => { window.__system.length = 0; window.__indai.app.indai.voice.speak(t); }, VERDICT);
      await page.waitForFunction(() => window.__system.length > 0, null, { timeout: 6000 }).catch(() => {});
      const fb = await page.evaluate(() => { const a = window.__indai.app; return { system: window.__system, note: a.cloudVoice.note, log: a.indai.log.map(l => l.text).filter(t => /credits are used up/.test(t)) }; });
      check('[402] the headset\'s own voice says the whole reply, and she says why once, in writing', fb.system.length === 1 && /^This one is amber\..*Watch 664\.50\.$/.test(fb.system[0]) && fb.log.length === 1, fb);
      // Settings
      await page.evaluate(() => window.__indai.app.openSettings()); await sleep(300);
      const html = await page.innerHTML('#cloud-voice-status');
      check('[on] Settings names the hosted voice and links to "Choose her voice"', /Hosted voice \(Sarah\)/.test(html) && html.includes('https://bongs-git.github.io/indai/voice.html'), html);
      check('[on] no script errors', errors.length === 0, errors);
      await ctx.close();
    }
    for (const [label, opts] of [['without a saved passcode', { pass: '', known: 'on' }], ['switched off on this device', { hosted: 'off', known: 'on' }], ['in demo mode', { query: 'demo=1', known: 'on' }]]) {
      const { ctx, page, b } = await open({ ...opts, engine: 'system' });
      await page.evaluate(() => { window.__system.length = 0; window.__indai.app.indai.voice.speak('Good morning.'); });
      await sleep(600);
      const sys = await page.evaluate(() => window.__system.length);
      check(`[${label}] not one request to indai-voice, and the headset speaks as before`, b.calls.length === 0 && sys === 1, { calls: b.calls.length, sys });
      await ctx.close();
    }
    {
      const { ctx, page, b } = await open({ known: 'on', engine: 'system' });
      b.configured = false; b.calls.length = 0;
      await page.evaluate(() => window.__indai.app.cloudVoice.check()); await sleep(300);
      await page.evaluate(() => { window.__system.length = 0; window.__indai.app.indai.voice.speak('Good morning.'); }); await sleep(500);
      const off = await page.evaluate(() => ({ state: window.__indai.app.cloudVoice.state, sys: window.__system.length }));
      await page.evaluate(() => window.__indai.app.openSettings()); await sleep(300);
      const line = await page.textContent('#cloud-voice-status');
      check('[not set up] configured:false keeps the headset\'s own voice, and Settings says "not set up"', off.state === 'off' && off.sys === 1 && speaks(b).length === 0 && /^Hosted voice: not set up/.test(line), { off, line });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();

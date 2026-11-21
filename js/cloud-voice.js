// INDAI's hosted voice. When the owner's passcode is saved and the back end has a voice for her (indai-voice,
// ElevenLabs), what she says is fetched as audio and played here, so the device does not have to download or run a
// voice model. Nothing in the shared voice code is changed: this stands in front of its speak(), and hands back to it
// (the on-device voice, or the browser's) whenever the hosted voice is off, slow to answer, refused or out of credit.
//   app.cloudVoice = { state: 'off' | 'on' | 'trouble', voice, note, spoken, downUntil }   for a status line
// Turn it off on one device with localStorage 'indai.voice.hosted' = 'off' (the voice page has the switch).
import { RELAY_URL, RELAY_ANON } from './relay.js';
import { speakable } from './voice.js';

const ENDPOINT = `${RELAY_URL}/functions/v1/indai-voice`;
const KNOWN = 'indai.voice.known';   // whether the hosted voice was on last time, so a new visit knows at once
const read = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

// Her words in pieces to fetch: the first sentence alone, so she starts talking quickly, then the rest a few
// sentences at a time. No piece is longer than the back end takes.
export function pieces(said, { first = 140, rest = 260, max = 780 } = {}) {
  const clean = String(said || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // A sentence ends at . ! or ? followed by a space and then anything but a small letter: the point in 700.42 is
  // not an ending, and neither is the pause in "Yes... it is".
  const sentences = [];
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    if (!'.!?'.includes(clean[i])) continue;
    const after = clean[i + 2] || '';
    if (i + 1 === clean.length || (clean[i + 1] === ' ' && !(after >= 'a' && after <= 'z'))) { sentences.push(clean.slice(start, i + 1).trim()); start = i + 1; }
  }
  if (start < clean.length) sentences.push(clean.slice(start).trim());
  const out = [];
  for (let s of sentences.filter(Boolean)) {
    while (s.length > max) { const cut = s.lastIndexOf(' ', max); out.push(s.slice(0, cut > 200 ? cut : max)); s = s.slice(cut > 200 ? cut + 1 : max); }
    const last = out[out.length - 1];
    if (out.length > 1 && last.length + 1 + s.length <= rest) out[out.length - 1] = last + ' ' + s;
    else if (out.length === 1 && last.length < 12 && last.length + 1 + s.length <= first) out[0] = last + ' ' + s;   // "Okay." is too short to stand alone
    else out.push(s);
  }
  return out;
}

export function initCloudVoice(app, { doc = document, win = window } = {}) {
  if (new URLSearchParams(win.location.search).has('demo')) return;
  const v = app.indai.voice;
  const cloud = app.cloudVoice = { state: read(KNOWN) === 'on' ? 'on' : 'off', voice: null, note: '', spoken: 0, downUntil: 0, checkedAt: 0 };
  const pass = () => (app.settings && app.settings.researchPass) || '';
  const wanted = () => !!pass() && read('indai.voice.hosted') !== 'off';
  const usable = () => wanted() && cloud.state === 'on' && Date.now() >= cloud.downUntil;
  const headers = () => ({ apikey: RELAY_ANON, Authorization: `Bearer ${RELAY_ANON}`, 'Content-Type': 'application/json', 'x-indai-pass': pass() });
  const changed = () => { try { app.markDirty && app.markDirty('settings'); } catch { /* not drawn yet */ } };

  // Is there a hosted voice for her? Asked at the start, when the page comes back into view, and every ten minutes.
  let checking = false;
  async function check() {
    if (checking || !wanted()) { if (!wanted() && cloud.state !== 'off') { cloud.state = 'off'; changed(); } return; }
    checking = true;
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: headers(), body: JSON.stringify({ op: 'status' }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        cloud.state = j.ready ? 'on' : j.configured ? 'trouble' : 'off';
        cloud.voice = j.voice || null; cloud.note = j.ready ? '' : j.message || '';
        if (j.ready) cloud.downUntil = 0;
        write(KNOWN, cloud.state === 'on' ? 'on' : 'off');
      } else if (r.status === 401 || r.status === 403 || r.status === 404) { cloud.state = 'off'; write(KNOWN, 'off'); }
      cloud.checkedAt = Date.now(); changed();
    } catch { /* offline: what was known stands */ }
    checking = false;
  }

  // ---- speaking
  const inner = v.speak.bind(v), innerStop = v.stopSpeaking.bind(v), innerPreload = v.preload.bind(v);
  let queue = [], playing = false, loading = 0, told = false;
  async function load(item) {
    const ctrl = new AbortController(); item.abort = () => ctrl.abort();
    const slow = setTimeout(() => ctrl.abort(), 9000);   // a voice that takes this long is no better than the one on the device
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: headers(), signal: ctrl.signal, body: JSON.stringify({ op: 'speak', text: item.text, ...(item.previous ? { previous: item.previous.slice(-300) } : {}), ...(item.next ? { next: item.next.slice(0, 300) } : {}) }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); item.error = { status: r.status, code: j.error || '', message: j.message || '' }; return false; }
      const bytes = await r.arrayBuffer(), c = v.audioCtx();
      item.audio = await new Promise((done, fail) => { const p = c.decodeAudioData(bytes, done, fail); if (p && p.catch) p.catch(fail); });
      return !!item.audio;
    } catch (e) { item.error = { status: 0, code: e && e.name === 'AbortError' ? 'slow' : 'network', message: '' }; return false; }
    finally { clearTimeout(slow); }
  }
  function fill() {
    for (const item of queue) {
      if (loading >= 2) break;
      if (item.state !== 'new') continue;
      item.state = 'loading'; loading++;
      load(item).then((ok) => { loading--; item.state = ok ? 'ready' : 'failed'; fill(); play(); });   // a piece no longer wanted is no longer in the queue
    }
  }
  function play() {
    if (playing) return;
    const item = queue[0];
    if (!item) { v.pump(); return; }                      // nothing of hers left here: the shared code settles "speaking"
    if (item.state === 'failed') { handBack(item.error || {}); return; }
    if (item.state !== 'ready') return;                   // still on its way
    if (v.playing) { setTimeout(play, 60); return; }      // the device's own voice is mid-sentence
    queue.shift();
    try {
      const c = v.audioCtx(), src = c.createBufferSource(), gain = c.createGain();
      src.buffer = item.audio; gain.gain.value = 0.95; src.connect(gain).connect(c.destination);
      src.onended = () => { playing = false; if (v.playing === src) v.playing = null; cloud.spoken++; play(); };
      playing = true; v.playing = src; v.setState({ speaking: true });
      src.start();
    } catch { playing = false; v.playing = null; handBack({ code: 'audio' }, item.text); }
  }
  // The hosted voice failed on a piece: the device's own voice says what is left, and the hosted one rests a while.
  function handBack(err, first = '') {
    const gone = err.status === 401 || err.status === 403 || err.code === 'not_configured' || err.code === 'voice_key' || err.code === 'voice_gone' || err.code === 'no_voice';
    const spent = err.code === 'voice_quota' || err.code === 'voice_daily_limit';
    cloud.downUntil = Date.now() + (gone || spent ? 30 : 2) * 60e3;
    cloud.note = err.message || (err.code === 'slow' ? 'The hosted voice was slow to answer.' : 'The hosted voice could not be reached.');
    if (gone) { cloud.state = 'trouble'; write(KNOWN, 'off'); }
    if ((gone || spent) && !told && app.indai.say) { told = true; app.indai.say(`${cloud.note} I'm using this device's own voice for now.`, 'info', { speak: false }); }
    const left = [first, ...queue.map((q) => q.text)].filter(Boolean).join(' ');
    for (const q of queue) q.abort && q.abort();
    queue = []; changed();
    if (left) inner(left);
  }
  v.speak = (text) => {
    if (!text || !usable()) return inner(text);
    const parts = pieces(speakable(text));
    if (!parts.length) return;
    parts.forEach((t, i) => queue.push({ text: t, previous: parts[i - 1] || '', next: parts[i + 1] || '', state: 'new', audio: null }));
    v.audioCtx(); v.setState({ speaking: true });
    fill();
  };
  v.stopSpeaking = () => {
    for (const q of queue) q.abort && q.abort();
    queue = []; playing = false;
    innerStop();
  };
  // With the hosted voice on there is nothing to download for speaking. Listening is untouched.
  v.preload = (opts = {}) => innerPreload(usable() && opts.tts !== false ? { ...opts, tts: false, stt: !!opts.stt } : opts);

  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState !== 'hidden' && Date.now() - cloud.checkedAt > 15e3) check(); });
  setInterval(() => { if (doc.visibilityState !== 'hidden') check(); }, 600e3);
  check();
  cloud.check = check;
}

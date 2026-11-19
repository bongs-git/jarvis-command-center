// INDAI's voice: neural speech out (Kokoro, on-device) and speech in (Whisper on-device, or the
// browser's own recognizer where one exists). Works on Meta Quest, which has no Web Speech API.

export const VOICES = [
  { id: 'af_heart', label: 'Heart — warm (default)' },
  { id: 'af_bella', label: 'Bella — bright, friendly' },
  { id: 'af_nicole', label: 'Nicole — soft, breathy' },
  { id: 'af_sarah', label: 'Sarah — calm' },
  { id: 'bf_emma', label: 'Emma — British, gentle' },
  { id: 'bf_isabella', label: 'Isabella — British' },
];

function splitSentences(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const parts = clean.match(/[^.!?;]+[.!?;]*\s*/g) || [clean];
  const out = [];
  for (const p of parts) {
    const s = p.trim(); if (!s) continue;
    if (out.length && (out[out.length - 1].length < 28 || s.length < 12)) out[out.length - 1] += ' ' + s; else out.push(s);
  }
  return out;
}
// Make numbers and symbols read naturally.
export function speakable(text) {
  return text
    .replace(/\bQQQ\b/g, 'Q Q Q').replace(/\bIWM\b/g, 'I W M').replace(/\bSPY\b/g, 'spy').replace(/\bSPX\b/g, 'S P X')
    .replace(/\bGEX\b/g, 'gex').replace(/\bVWAP\b/g, 'V-wap').replace(/\bMACD\b/g, 'mac-D').replace(/\bRSI\b/g, 'R S I').replace(/\bIV\b/g, 'I V')
    .replace(/\b0DTE\b/gi, 'zero D T E').replace(/\bDTE\b/g, 'D T E').replace(/\bRAG\b/g, 'rag')
    .replace(/(\d+(?:\.\d+)?)%/g, '$1 percent').replace(/\$(\d)/g, '$1').replace(/−/g, 'minus ').replace(/\+(\d)/g, 'plus $1')
    .replace(/σ/g, ' sigma').replace(/≈/g, 'about ').replace(/[•·]/g, ',');
}

export class VoiceIO {
  constructor({ getSettings, onState, onLog }) {
    this.getSettings = getSettings;
    this.onState = onState || (() => {});
    this.onLog = onLog || (() => {});
    this.worker = null;
    this.ctx = null;
    this.epoch = 0;
    this.nextId = 1;
    this.pending = new Map();       // id -> {resolve, reject}
    this.audioQueue = [];           // [{seq, samples, rate}]
    this.expectSeq = 0;
    this.seq = 0;
    this.playing = null;
    this.state = { speaking: false, listening: false, ttsReady: false, sttReady: false, ttsLoad: null, sttLoad: null, error: null, sttModel: null };
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    this.micOK = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  get canListen() { return this.micOK || !!this.SR; }
  get webgpu() { return !!navigator.gpu; }
  setState(p) { Object.assign(this.state, p); this.onState(this.state); }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./workers/voice-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.worker.onerror = (e) => { this.setState({ error: 'Voice engine failed to start: ' + (e.message || 'unknown error') }); };
    return this.worker;
  }
  onWorker(m) {
    if (m.type === 'progress') {
      const pct = m.total ? Math.round(m.loaded / m.total * 100) : null;
      this.setState(m.kind === 'tts' ? { ttsLoad: pct } : { sttLoad: pct });
    } else if (m.type === 'ready') {
      this.setState(m.kind === 'tts' ? { ttsReady: true, ttsLoad: null } : { sttReady: true, sttLoad: null, sttModel: m.model });
      if (m.kind === 'tts' && this.backlog?.length) { const keep = this.backlog.filter(b => Date.now() - b.at < 45e3); this.backlog = []; for (const b of keep) this.speak(b.text); }
    } else if (m.type === 'audio') {
      if (m.epoch !== this.epoch) return;
      this.audioQueue.push({ seq: m.id, samples: m.samples, rate: m.rate });
      this.pump();
    } else if (m.type === 'text') {
      const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); if (m.ms != null) this.lastSttMs = m.ms; p.resolve(m.text); }
    } else if (m.type === 'error') {
      if (m.kind === 'stt' && m.id) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p.reject(new Error(m.message)); } }
      if (m.kind === 'tts') {
        if (!this.state.ttsReady) { this.ttsFailedAt = Date.now(); this.speakSystem(m.text); }
        if (m.epoch === this.epoch) { this.expectSeq = Math.max(this.expectSeq, (m.id || 0) + 1); this.pump(); }
      }
      if (m.kind === 'tts') this._ttsAsked = false; else this._sttAsked = false;
      this.setState({ error: `${m.kind === 'tts' ? 'Voice' : 'Speech recognition'}: ${m.message}`, ...(m.kind === 'tts' ? { ttsLoad: null } : { sttLoad: null }) });
      this.onLog(`${m.kind === 'tts' ? 'Voice' : 'Speech recognition'} problem: ${m.message}`);
    } else if (m.type === 'log') this.onLog(m.message);
  }

  audioCtx() {
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  // Call from a click/tap/trigger so audio is allowed to play.
  unlock() {
    try { const c = this.audioCtx(); const b = c.createBuffer(1, 1, 22050); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(); } catch {}
  }
  preload({ tts = true, stt = false } = {}) {
    const s = this.getSettings();
    if (tts && (this.state.ttsReady || this._ttsAsked)) tts = false;
    if (stt && (this.state.sttReady || this._sttAsked)) stt = false;
    if (!tts && !stt) return;
    if (tts) this._ttsAsked = true;
    if (stt) this._sttAsked = true;
    if (s.voiceEngine === 'system' && !stt) return;
    this.ensureWorker().postMessage({ type: 'preload', tts: tts && s.voiceEngine !== 'system', stt, device: this.webgpu ? 'webgpu' : 'wasm' });
  }

  // ---------------------------------------------------------------- speaking
  speak(text) {
    const s = this.getSettings();
    if (!text) return;
    const said = speakable(text);
    // Browser voice when chosen, or for a few minutes after the natural voice failed to load (it retries later).
    const neuralDown = this.ttsFailedAt && Date.now() - this.ttsFailedAt < 5 * 60e3;
    if ((s.voiceEngine === 'system' || neuralDown) && this.speakSystem(said)) return;
    if (!this.state.ttsReady) {
      // The natural voice is still downloading (first run only). Use the browser's voice meanwhile if it has one;
      // otherwise hold the latest two messages and say them as soon as the voice is ready.
      this.preload({ tts: true });
      if (this.hasSystemVoice() && this.speakSystem(said)) return;
      this.backlog = [...(this.backlog || []), { text, at: Date.now() }].slice(-2);
      return;
    }
    this.audioCtx();
    const w = this.ensureWorker();
    for (const sentence of splitSentences(said)) {
      const id = this.seq++;
      w.postMessage({ type: 'speak', id, epoch: this.epoch, text: sentence, voice: s.voiceName || 'af_heart', speed: s.voiceSpeed || 0.95 });
    }
    this.setState({ speaking: true });
  }
  hasSystemVoice() { try { return 'speechSynthesis' in window && speechSynthesis.getVoices().length > 0; } catch { return false; } }
  speakSystem(said) {
    if (!said || !('speechSynthesis' in window)) return false;
    try {
      const s = this.getSettings();
      const u = new SpeechSynthesisUtterance(said);
      const voices = speechSynthesis.getVoices();
      const v = voices.find(v => /samantha|victoria|zira|aria|jenny|ava|allison|female|google us english/i.test(v.name) && /^en/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
      if (v) u.voice = v;
      u.rate = s.voiceSpeed || 1; u.pitch = 1.08;
      u.onstart = () => this.setState({ speaking: true }); u.onend = u.onerror = () => this.setState({ speaking: speechSynthesis.speaking });
      speechSynthesis.speak(u);
      return true;
    } catch { return false; }
  }
  pump() {
    if (this.playing) return;
    const i = this.audioQueue.findIndex(a => a.seq === this.expectSeq);
    if (i < 0) { if (this.expectSeq >= this.seq) this.setState({ speaking: false }); return; }
    const a = this.audioQueue.splice(i, 1)[0];
    this.expectSeq++;
    try {
      const c = this.audioCtx();
      const buf = c.createBuffer(1, a.samples.length, a.rate);
      buf.copyToChannel(a.samples, 0);
      const src = c.createBufferSource(); src.buffer = buf;
      const gain = c.createGain(); gain.gain.value = 0.95;
      src.connect(gain).connect(c.destination);
      src.onended = () => { this.playing = null; this.pump(); };
      this.playing = src; this.setState({ speaking: true });
      src.start();
    } catch (e) { this.playing = null; this.pump(); }
  }
  stopSpeaking() {
    this.epoch++; this.audioQueue = []; this.expectSeq = this.seq;
    if (this.worker) this.worker.postMessage({ type: 'cancel', epoch: this.epoch });
    if (this.playing) { try { this.playing.onended = null; this.playing.stop(); } catch {} this.playing = null; }
    if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch {}
    this.setState({ speaking: false });
  }

  // ---------------------------------------------------------------- listening
  // Records until the speaker finishes, then returns the transcript.
  //   - end of speech is detected from the speaker's own pace (the pause length is learned, see `ears`)
  //   - transcription starts the moment a pause begins, so the answer is usually ready by the time the pause is confirmed
  //   - onInterim(text) gets what has been heard so far when the speaker carries on after a short pause
  //   - quiet: for hands-free follow-ups; gives up silently after `waitMs` with no speech
  transcribe(audio, { drop } = {}) {
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ensureWorker().postMessage({ type: 'transcribe', id, audio, drop, device: this.webgpu ? 'webgpu' : 'wasm' }, [audio.buffer]);
    return { id, p };
  }
  async listen({ maxMs = 20000, waitMs = 7000, onInterim = null } = {}) {
    if (this.state.listening) { this.stop(); return null; }
    this.stopSpeaking();
    const s = this.getSettings();
    const useBrowser = this.SR && (s.micEngine === 'browser' || (s.micEngine !== 'whisper' && !/OculusBrowser|Quest/i.test(navigator.userAgent)));
    if (useBrowser) return this.listenBrowser({ onInterim, waitMs });
    if (!this.micOK) throw new Error('This browser cannot use the microphone.');
    this.preload({ tts: false, stt: true });
    // keep the mic open between turns so follow-ups start instantly
    let stream = this._stream;
    if (!stream || !stream.active) stream = this._stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    clearTimeout(this._streamTimer);
    const c = this.audioCtx();
    const src = c.createMediaStreamSource(stream);
    const proc = c.createScriptProcessor(2048, 1, 1);
    const sink = c.createGain(); sink.gain.value = 0;
    const rate = c.sampleRate, frameMs = 2048 / rate * 1000;
    const ears = this.ears;
    const chunks = [];
    let speech = false, firstVoice = -1, lastVoice = -1, voicedMs = 0, started = performance.now(), frames = 0;
    let noise = Math.min(0.02, Math.max(0.002, ears.noise || 0.004)), peak = 0;
    let spec = null;                     // { id, upTo, p } transcription started at the current pause
    const endMs = Math.max(450, Math.min(1200, ears.pause || 750));
    this.setState({ listening: true, heard: '' });
    const cut = (to) => {
      const from = Math.max(0, firstVoice - Math.ceil(350 / frameMs)), end = Math.min(chunks.length, to + Math.ceil(250 / frameMs));
      const part = chunks.slice(from, end), total = part.reduce((a, b) => a + b.length, 0);
      const all = new Float32Array(total); let o = 0; for (const ch of part) { all.set(ch, o); o += ch.length; }
      // level the volume so quiet speakers are heard as well as loud ones
      let mx = 0; for (let i = 0; i < all.length; i++) { const v = Math.abs(all[i]); if (v > mx) mx = v; }
      if (mx > 0.001 && mx < 0.5) { const g = Math.min(8, 0.7 / mx); for (let i = 0; i < all.length; i++) all[i] *= g; }
      return resample(all, rate, 16000);
    };
    return await new Promise((resolve, reject) => {
      const finish = async (reason) => {
        if (!this.state.listening) return;
        this.setState({ listening: false });
        try { proc.disconnect(); src.disconnect(); sink.disconnect(); } catch {}
        this._stop = null;
        // let go of the mic if nothing else needs it soon
        this._streamTimer = setTimeout(() => { if (!this.state.listening && this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; } }, 25000);
        if (!speech || voicedMs < 120 || reason === 'cancel') { if (spec) this.worker.postMessage({ type: 'drop', id: spec.id }); resolve(''); return; }
        // remember this room and this speaker for next time
        ears.noise = ears.noise ? ears.noise * 0.8 + noise * 0.2 : noise; ears.level = ears.level ? ears.level * 0.8 + peak * 0.2 : peak; ears.turns = (ears.turns || 0) + 1; this.saveEars();
        this.lastEnd = { at: performance.now(), reason };
        this.setState({ transcribing: true });
        try {
          let job = spec && spec.upTo === lastVoice ? spec : null;
          if (spec && !job) this.worker.postMessage({ type: 'drop', id: spec.id });
          if (!job) job = this.transcribe(cut(lastVoice + 1));
          const text = await job.p;
          this.setState({ transcribing: false, heard: '' });
          resolve(text);
        } catch (e) { this.setState({ transcribing: false, heard: '' }); reject(e); }
      };
      this._stop = finish;
      proc.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(d));
        let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        const rms = Math.sqrt(sum / d.length), now = performance.now(), i = chunks.length - 1;
        frames++;
        // the noise floor follows the room: drops quickly, rises slowly, and never learns from speech
        const thr = Math.max(0.009, noise * 3), keep = Math.max(0.006, noise * 2);
        const voiced = rms > (speech && i - lastVoice < 6 ? keep : thr);
        if (!voiced) noise = rms < noise ? noise * 0.7 + rms * 0.3 : noise * 0.97 + rms * 0.03;
        if (voiced) {
          if (firstVoice < 0) firstVoice = i;
          if (lastVoice >= 0 && speech) { const gap = (i - lastVoice) * frameMs; if (gap > 250) ears.gaps = [...(ears.gaps || []), Math.round(gap)].slice(-40); }
          lastVoice = i; voicedMs += frameMs; if (rms > peak) peak = rms;
          if (voicedMs > 100) speech = true;
        } else if (!speech && firstVoice >= 0 && (i - lastVoice) * frameMs > 400) { firstVoice = -1; voicedMs = 0; }   // a click or a bump, not a word
        this.level = rms;
        const quietMs = lastVoice >= 0 ? (i - lastVoice) * frameMs : 0;
        if (speech && quietMs > 260 && (!spec || spec.upTo !== lastVoice) && this.state.sttReady) {
          // a pause just began: start on what we have. If they keep talking we show it as the running caption.
          if (spec) this.worker.postMessage({ type: 'drop', id: spec.id });
          const upTo = lastVoice, job = this.transcribe(cut(lastVoice + 1));
          spec = { ...job, upTo };
          job.p.then((t) => { if (this.state.listening && t) { this.setState({ heard: t }); onInterim?.(t); } }).catch(() => {});
        }
        if (speech && quietMs > endMs) finish('pause');
        else if (!speech && now - started > waitMs) finish('silence');
        else if (now - started > maxMs) finish('max');
      };
      src.connect(proc); proc.connect(sink); sink.connect(c.destination);
    });
  }
  // What INDAI has learned about this speaker and room: noise floor, speaking level, and how long their pauses run.
  get ears() {
    if (!this._ears) { try { this._ears = JSON.parse(localStorage.getItem('indai.ears.v1') || '{}'); } catch { this._ears = {}; } }
    return this._ears;
  }
  saveEars() {
    const e = this.ears;
    // pause length: long enough to cover this speaker's normal mid-sentence gaps, short enough to feel instant
    if (e.gaps && e.gaps.length >= 6) { const g = [...e.gaps].sort((a, b) => a - b), p80 = g[Math.floor(g.length * 0.8)]; e.pause = Math.round(Math.max(520, Math.min(1100, (e.pause || 750) * 0.7 + (p80 + 260) * 0.3))); }
    try { localStorage.setItem('indai.ears.v1', JSON.stringify(e)); } catch {}
  }
  // The speaker carried on right after we stopped listening: we cut in too early, so wait a little longer from now on.
  cutOffEarly() { const e = this.ears; e.pause = Math.min(1200, (e.pause || 750) + 90); this.saveEars(); }
  stop() { if (this._stop) this._stop('stop'); if (this._rec) try { this._rec.stop(); } catch {} }
  cancel() { if (this._stop) this._stop('cancel'); if (this._rec) try { this._rec.abort(); } catch {} }
  listenBrowser({ onInterim = null, waitMs = 7000 } = {}) {
    return new Promise((resolve, reject) => {
      const rec = new this.SR(); this._rec = rec;
      rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
      let final = '', done = false;
      const end = (v, err) => { if (done) return; done = true; clearTimeout(timer); this.setState({ listening: false, heard: '' }); this._rec = null; err ? reject(err) : resolve(v); };
      const timer = setTimeout(() => { try { rec.abort(); } catch {} end(''); }, waitMs + 13000);
      rec.onstart = () => this.setState({ listening: true, heard: '' });
      rec.onend = () => end(final);
      rec.onerror = (e) => (e.error === 'no-speech' || e.error === 'aborted') ? end('') : end('', new Error(e.error));
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) { final += r[0].transcript; this.alternatives = Array.from(r).map(a => a.transcript); } else interim += r[0].transcript; }
        const heard = (final + ' ' + interim).trim();
        if (heard) { this.setState({ heard }); onInterim?.(heard); }
      };
      try { rec.start(); } catch (err) { end('', err); }
    });
  }
}

function resample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to, n = Math.floor(input.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, i0 = Math.floor(x), i1 = Math.min(input.length - 1, i0 + 1), f = x - i0;
    // light low-pass by averaging the span we skip
    let acc = 0, cnt = 0;
    for (let j = i0; j <= Math.min(input.length - 1, Math.floor(x + ratio)); j++) { acc += input[j]; cnt++; }
    out[i] = cnt > 1 ? acc / cnt : input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

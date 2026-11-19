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
    } else if (m.type === 'audio') {
      if (m.epoch !== this.epoch) return;
      this.audioQueue.push({ seq: m.id, samples: m.samples, rate: m.rate });
      this.pump();
    } else if (m.type === 'text') {
      const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p.resolve(m.text); }
    } else if (m.type === 'error') {
      if (m.kind === 'stt' && m.id) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p.reject(new Error(m.message)); } }
      if (m.kind === 'tts') {
        if (!this.state.ttsReady) { this.ttsFailedAt = Date.now(); this.speakSystem(m.text); }
        if (m.epoch === this.epoch) { this.expectSeq = Math.max(this.expectSeq, (m.id || 0) + 1); this.pump(); }
      }
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
    this.audioCtx();
    const w = this.ensureWorker();
    for (const sentence of splitSentences(said)) {
      const id = this.seq++;
      w.postMessage({ type: 'speak', id, epoch: this.epoch, text: sentence, voice: s.voiceName || 'af_heart', speed: s.voiceSpeed || 0.95 });
    }
    this.setState({ speaking: true });
  }
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
    if (this.playing) { try { this.playing.onended = null; this.playing.stop(); } catch {} this.playing = null; }
    if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch {}
    this.setState({ speaking: false });
  }

  // ---------------------------------------------------------------- listening
  // Records until the speaker pauses (or stop() is called), then returns the transcript.
  async listen({ maxMs = 15000 } = {}) {
    if (this.state.listening) { this.stop(); return null; }
    this.stopSpeaking();
    const s = this.getSettings();
    const useBrowser = this.SR && (s.micEngine === 'browser' || (s.micEngine !== 'whisper' && !/OculusBrowser|Quest/i.test(navigator.userAgent)));
    if (useBrowser) return this.listenBrowser();
    if (!this.micOK) throw new Error('This browser cannot use the microphone.');
    this.preload({ tts: false, stt: true });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const c = this.audioCtx();
    const src = c.createMediaStreamSource(stream);
    const proc = c.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    const rate = c.sampleRate;
    let speech = false, lastVoice = performance.now(), started = performance.now(), noise = 0.004, frames = 0;
    this.setState({ listening: true });
    return await new Promise((resolve, reject) => {
      const finish = async (reason) => {
        if (!this.state.listening) return;
        this.setState({ listening: false });
        try { proc.disconnect(); src.disconnect(); } catch {}
        stream.getTracks().forEach(t => t.stop());
        this._stop = null;
        if (!speech || reason === 'cancel') { resolve(''); return; }
        const total = chunks.reduce((a, b) => a + b.length, 0);
        const all = new Float32Array(total); let o = 0; for (const ch of chunks) { all.set(ch, o); o += ch.length; }
        const audio = resample(all, rate, 16000);
        const id = this.nextId++;
        this.setState({ transcribing: true });
        this.pending.set(id, { resolve: (t) => { this.setState({ transcribing: false }); resolve(t); }, reject: (e) => { this.setState({ transcribing: false }); reject(e); } });
        this.worker.postMessage({ type: 'transcribe', id, audio, device: this.webgpu ? 'webgpu' : 'wasm' }, [audio.buffer]);
      };
      this._stop = finish;
      proc.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(d));
        let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        const rms = Math.sqrt(sum / d.length), now = performance.now();
        frames++;
        if (frames < 4 && !speech) noise = Math.max(noise, rms * 0.9);
        const thr = Math.max(0.012, noise * 2.8);
        if (rms > thr) { speech = true; lastVoice = now; }
        this.level = rms;
        if (speech && now - lastVoice > 1300) finish('pause');
        else if (!speech && now - started > 7000) finish('silence');
        else if (now - started > maxMs) finish('max');
      };
      src.connect(proc); proc.connect(c.destination);
    });
  }
  stop() { if (this._stop) this._stop('stop'); if (this._rec) try { this._rec.stop(); } catch {} }
  cancel() { if (this._stop) this._stop('cancel'); if (this._rec) try { this._rec.abort(); } catch {} }
  listenBrowser() {
    return new Promise((resolve, reject) => {
      const rec = new this.SR(); this._rec = rec;
      rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onstart = () => this.setState({ listening: true });
      rec.onend = () => { this.setState({ listening: false }); this._rec = null; };
      rec.onerror = (e) => { this.setState({ listening: false }); e.error === 'no-speech' ? resolve('') : reject(new Error(e.error)); };
      rec.onresult = (e) => resolve(e.results[0][0].transcript);
      try { rec.start(); } catch (err) { reject(err); }
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

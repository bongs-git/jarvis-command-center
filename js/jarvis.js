// Jarvis: spoken announcements (speechSynthesis) + push-to-talk voice commands (SpeechRecognition where available).

const ALIASES = {
  spy: 'SPY', spiders: 'SPY', 'the spy': 'SPY', 's p y': 'SPY', 'es': 'SPY',
  qqq: 'QQQ', cues: 'QQQ', queues: 'QQQ', 'triple q': 'QQQ', 'q q q': 'QQQ', qs: 'QQQ', nasdaq: 'QQQ',
  iwm: 'IWM', russell: 'IWM', 'i w m': 'IWM', 'small caps': 'IWM',
  tsla: 'TSLA', tesla: 'TSLA', amzn: 'AMZN', amazon: 'AMZN', msft: 'MSFT', microsoft: 'MSFT',
  nvda: 'NVDA', nvidia: 'NVDA', aapl: 'AAPL', apple: 'AAPL', meta: 'META', facebook: 'META',
  googl: 'GOOGL', google: 'GOOGL', alphabet: 'GOOGL', amd: 'AMD', netflix: 'NFLX', nflx: 'NFLX',
};
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, 'seventy five': 75, eighty: 80, ninety: 90, hundred: 100, 'a hundred': 100, 'one hundred': 100, 'two hundred': 200, 'three hundred': 300 };

export class Jarvis {
  constructor(app) {
    this.app = app;
    this.log = [];
    this.muted = !app.settings.voice;
    this.speaking = false;
    this.listening = false;
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    this.canListen = !!this.SR;
    this.canSpeak = 'speechSynthesis' in window;
    this.voice = null;
    if (this.canSpeak) {
      const pick = () => { this.voice = this.pickVoice(); };
      pick();
      try { speechSynthesis.addEventListener('voiceschanged', pick); } catch {}
    }
  }

  pickVoice() {
    const vs = speechSynthesis.getVoices() || [];
    const prefs = [/Daniel/i, /Google UK English Male/i, /Microsoft Ryan/i, /Arthur/i, /en-GB.*male/i, /en[-_]GB/i, /Google US English/i, /en[-_]US/i];
    for (const re of prefs) { const v = vs.find(v => re.test(v.name) || re.test(v.lang)); if (v) return v; }
    return vs[0] || null;
  }

  say(text, kind = 'info', { speak = true } = {}) {
    this.log.unshift({ t: Date.now(), text, kind });
    if (this.log.length > 40) this.log.length = 40;
    this.app.markDirty('jarvis');
    if (speak && !this.muted && this.canSpeak) this.speak(text);
  }

  speak(text) {
    try {
      if (speechSynthesis.pending || speechSynthesis.speaking) {
        // keep the queue short so alerts stay timely
        if (this.queued > 2) speechSynthesis.cancel();
      }
      const u = new SpeechSynthesisUtterance(text.replace(/\$/g, ' dollars ').replace(/−/g, 'minus ').replace(/\+/g, 'plus '));
      if (this.voice) u.voice = this.voice;
      u.rate = 1.04; u.pitch = 0.95; u.volume = 1;
      this.queued = (this.queued || 0) + 1;
      u.onstart = () => { this.speaking = true; this.app.markDirty('jarvis'); };
      u.onend = u.onerror = () => { this.queued = Math.max(0, this.queued - 1); this.speaking = speechSynthesis.speaking; this.app.markDirty('jarvis'); };
      speechSynthesis.speak(u);
    } catch { /* speech unavailable */ }
  }

  setMuted(m) {
    this.muted = m;
    if (m && this.canSpeak) try { speechSynthesis.cancel(); } catch {}
    this.app.markDirty('jarvis');
  }

  listen() {
    if (!this.canListen) { this.say("Voice input isn't available in this browser. The buttons do everything voice can.", 'info', { speak: false }); return; }
    if (this.listening) { try { this.rec && this.rec.stop(); } catch {} return; }
    const rec = new this.SR();
    this.rec = rec;
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 3; rec.continuous = false;
    rec.onstart = () => { this.listening = true; this.app.markDirty('jarvis'); };
    rec.onend = () => { this.listening = false; this.app.markDirty('jarvis'); };
    rec.onerror = (e) => {
      this.listening = false;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.say('I need microphone permission for voice commands. Allow the mic for this site in the browser settings.', 'info', { speak: false });
      else if (e.error === 'no-speech') this.say("I didn't hear anything.", 'info', { speak: false });
      else if (e.error === 'network') this.say("Voice recognition needs an internet connection and isn't reachable right now.", 'info', { speak: false });
      else this.say('Voice input stopped: ' + e.error, 'info', { speak: false });
    };
    rec.onresult = (e) => {
      const alts = [...e.results[0]].map(a => a.transcript);
      this.say(`“${alts[0]}”`, 'you', { speak: false });
      this.handle(alts);
    };
    try { rec.start(); } catch (err) { this.say('Could not start voice input.', 'info', { speak: false }); }
  }

  // Returns true if a command was recognised.
  handle(alternatives) {
    for (const raw of alternatives) if (this.tryCommand(raw)) return true;
    this.say('I didn\'t catch a command. Try "show IWM", "five minute", "brief me", or "log a loss of 50".');
    return false;
  }

  tryCommand(raw) {
    const app = this.app;
    let t = ' ' + raw.toLowerCase().replace(/[^a-z0-9.$ ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    t = t.replace(/\b([a-z]) (?=[a-z]\b)/g, '$1'); // "i w m" -> "iwm"
    for (const [w, n] of Object.entries(NUM_WORDS).sort((a, b) => b[0].length - a[0].length)) t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), String(n));

    if (/\b(brief|briefing|status|update|sitrep|how are we|what s the market|market check)\b/.test(t)) { app.brief(); return true; }
    if (/\bre ?cent(er|re)\b/.test(t)) { app.recenter(); this.say('Recentered.'); return true; }
    if (/\bundo\b/.test(t)) { app.undoTrade(); return true; }
    if (/\b(unmute|voice on)\b/.test(t)) { app.toggleMute(false); return true; }
    if (/\b(mute|quiet|silence|shut up|voice off)\b/.test(t)) { app.toggleMute(true); return true; }

    const tr = t.match(/\b(win|winner|won|profit|green|loss|loser|lost|lose|red)\b.*?\$? ?(\d+(?:\.\d+)?)/) || t.match(/\$? ?(\d+(?:\.\d+)?) (dollar )?(win|winner|profit|loss|loser)/);
    if (tr) {
      const word = tr[1] && isNaN(tr[1]) ? tr[1] : tr[3];
      const amt = parseFloat(tr[1] && !isNaN(tr[1]) ? tr[1] : tr[2]);
      if (amt > 0) { const win = /win|won|profit|green/.test(word); app.logTrade(win ? amt : -amt); return true; }
    }

    const tf = t.match(/\b(1|5|15) ?(minute|min|m)\b/);
    if (tf) { app.setTimeframe(tf[1] + 'min'); this.say(`${tf[1]} minute chart.`); return true; }

    for (const key of ['vwap', 'ema', 'gex', 'levels', 'cloud']) {
      if (t.includes(' ' + key) || t.includes(key + ' ')) {
        const k = key === 'levels' ? 'gex' : key === 'cloud' ? 'ema' : key;
        if (/\b(hide|remove|off|turn off)\b/.test(t)) { app.setShow(k, false); this.say(`${k.toUpperCase()} off.`); return true; }
        if (/\b(show|add|on|turn on)\b/.test(t)) { app.setShow(k, true); this.say(`${k.toUpperCase()} on.`); return true; }
      }
    }

    // ticker
    const words = t.trim().split(' ');
    const syms = new Set(app.settings.symbols);
    for (const [alias, sym] of Object.entries(ALIASES).sort((a, b) => b[0].length - a[0].length)) {
      if (t.includes(' ' + alias + ' ')) { app.selectSymbol(sym, { announce: true }); return true; }
    }
    for (const w of words) {
      const up = w.toUpperCase();
      if (syms.has(up)) { app.selectSymbol(up, { announce: true }); return true; }
    }
    const m = t.match(/\b(show|chart|pull up|open|switch to|go to|load) ([a-z]{1,5})\b/);
    if (m) { app.selectSymbol(m[2].toUpperCase(), { announce: true }); return true; }
    return false;
  }
}

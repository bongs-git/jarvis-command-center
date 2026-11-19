// INDAI: the voice and brain of the command center.
//   - speaks with a warm neural voice and listens on-device (VoiceIO)
//   - runs commands ("show IWM", "five minute", "brief me", "log a loss of 50")
//   - analyzes trade ideas ("hey INDAI, QQQ calls expiring today, 665 strike") into a RAG verdict
//   - deep dives a ticker, answers open questions with web research when the research key is set
import { VoiceIO } from './voice.js';
import { relay } from './relay.js';
import { etToMs, aggregate, INTERVAL_MS, marketStatus } from './market.js';
import { technicals, realizedVol, stripWake, parseIdea, looksLikeTradeIdea, scoreTrade, headlineSentiment, quantRead } from './analysis.js';
import { fmtPrice, fmtMoney } from './hud.js';
import { LEADLAG } from './feeds.js';
import { STRATEGIES, PROFILES, buildPlan } from './signals.js';
import { levelSourceLabel } from './panels.js';
import { SpeechMemory, similar } from './speech.js';

const ALIASES = {
  spy: 'SPY', spiders: 'SPY', 'the spy': 'SPY',
  qqq: 'QQQ', cues: 'QQQ', queues: 'QQQ', 'triple q': 'QQQ', qs: 'QQQ', nasdaq: 'QQQ',
  iwm: 'IWM', russell: 'IWM', 'small caps': 'IWM',
  tsla: 'TSLA', tesla: 'TSLA', amzn: 'AMZN', amazon: 'AMZN', msft: 'MSFT', microsoft: 'MSFT',
  nvda: 'NVDA', nvidia: 'NVDA', aapl: 'AAPL', apple: 'AAPL', meta: 'META', facebook: 'META',
  googl: 'GOOGL', google: 'GOOGL', alphabet: 'GOOGL', amd: 'AMD', netflix: 'NFLX', nflx: 'NFLX', palantir: 'PLTR', coinbase: 'COIN',
};
const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// "six sixty five" -> 665, "six hundred and sixty five" -> 665, "fifty" -> 50, "seven fifty" -> 750
export function wordsToNumbers(text) {
  const toks = text.split(/(\s+)/);
  const out = []; let i = 0;
  const isNum = (w) => w in UNITS || w in TENS || w === 'hundred' || w === 'thousand';
  while (i < toks.length) {
    const w = toks[i].toLowerCase();
    if (!isNum(w)) { out.push(toks[i]); i++; continue; }
    const words = []; let j = i;
    while (j < toks.length) {
      const x = toks[j].toLowerCase();
      if (/^\s+$/.test(x)) { j++; continue; }
      if (isNum(x) || (x === 'and' && words.length && isNum((toks[j + 2] || '').toLowerCase()))) { words.push(x); j++; } else break;
    }
    out.push(String(parseWords(words.filter(x => x !== 'and'))));
    // keep the whitespace that followed the run
    let k = j - 1; while (k > i && /^\s+$/.test(toks[k])) k--;
    for (let m = k + 1; m < j; m++) out.push(toks[m]);
    i = j;
  }
  return out.join('');
}
function parseWords(ws) {
  // grouped speech: [unit][tens][unit] after a unit means hundreds ("six sixty five")
  let total = 0, cur = 0;
  const groups = [];
  for (const w of ws) {
    if (w === 'hundred') { cur = (cur || 1) * 100; continue; }
    if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; continue; }
    const v = UNITS[w] ?? TENS[w];
    if (v == null) continue;
    if (w in TENS) { if (cur % 100 !== 0 && cur % 100 < 10 && cur < 10) { groups.push(cur); cur = v; } else cur += v; }
    else if (cur % 10 === 0 && cur % 100 !== 0) cur += v;            // twenty + five
    else if (cur && cur < 10) { groups.push(cur); cur = v; }           // six | five
    else cur += v;
  }
  if (groups.length) { const head = groups.reduce((a, g) => a * 10 + g, 0); return head * (cur >= 10 ? 100 : 10) + cur; }
  return total + cur;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const pct = (v) => `${Math.round(v * 100)}%`;
function expWords(exp) {
  if (!exp) return '';
  if (exp === today()) return 'expiring today';
  const d = new Date(exp + 'T12:00:00Z');
  return 'expiring ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export class Indai {
  constructor(app) {
    this.app = app;
    this.log = [];
    this.muted = !app.settings.voice;
    this.thinking = null;
    this.lastSpoken = '';
    this.brain = { configured: false, checked: false };
    this.speech = new SpeechMemory();     // what she has learned about how this person talks
    this.lastHeard = null; this.missed = null; this.confirm = null; this.followUp = 0;
    this.voice = new VoiceIO({
      getSettings: () => app.settings,
      onState: (st) => { app.markDirty('indai'); app.markDirty('dock'); this.maybeAutoListen(st); },
      onLog: (m) => { const now = Date.now(); if (this._lastVoiceLog === m && now - this._lastVoiceLogAt < 120e3) return; this._lastVoiceLog = m; this._lastVoiceLogAt = now; this.say(m, 'info', { speak: false }); },
    });
    relay.brainStatus().then(s => { this.brain = { ...s, checked: true }; app.markDirty('indai'); });
  }

  get speaking() { return this.voice.state.speaking; }
  get listening() { return this.voice.state.listening || this.voice.state.transcribing; }

  say(text, kind = 'info', { speak = true, log = true } = {}) {
    if (!text) return;
    if (log) this.log.push({ t: Date.now(), text, kind });
    if (!this.app.inXR && kind !== 'you') this.app.caption?.(text, kind);
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
    this.app.markDirty('indai');
    if (speak && !this.muted) { this.lastSpoken = text; this.voice.speak(text); }
  }
  repeat() { if (this.lastSpoken) { this.voice.stopSpeaking(); this.voice.speak(this.lastSpoken); } }
  setMuted(m) { this.muted = m; if (m) this.voice.stopSpeaking(); this.app.markDirty('indai'); }
  setThinking(t) { this.thinking = t; this.app.markDirty('indai'); }

  // Talk to INDAI. Call again while listening to stop early. `quiet` is the hands-free follow-up:
  // the mic opens by itself after she answers, and closes without comment if nothing is said.
  async talk({ quiet = false } = {}) {
    const v = this.voice;
    if (v.state.listening) { v.stop(); return; }
    if (v.state.transcribing) return;
    if (!v.canListen) { this.say("Voice input isn't available in this browser. The buttons do everything voice can.", 'info', { speak: false }); return; }
    v.unlock();
    this.followUp = 0; clearTimeout(this._fu);
    if (!quiet && !v.state.sttReady && v.state.sttLoad == null && !v.SR) this.say('Getting my ears ready. The first time takes a minute while the listening model downloads.', 'info', { speak: false });
    let text = '';
    try { text = await v.listen({ waitMs: quiet ? 5500 : 7000 }); }
    catch (e) {
      if (quiet) return;
      const msg = String(e && (e.message || e.name) || e);
      if (/NotAllowed|denied|not-allowed|Permission/i.test(msg)) this.say('I need microphone permission. Allow the mic for this site, then try again.', 'risk', { speak: false });
      else this.say('I could not listen: ' + msg, 'info', { speak: false });
      return;
    }
    if (text == null) return;
    text = text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /^(you|thank you\.?|thanks for watching\.?|bye\.?|\.+|uh+|um+|hmm+)$/i.test(text)) { if (!quiet) this.say("I didn't catch that. Go ahead, I'm listening.", 'info', { speak: false }); if (!quiet) this.keepListening(); return; }
    const fixed = this.speech.normalize(text);
    this.say(`“${fixed}”`, 'you', { speak: false });
    const res = await this.handle(fixed, { voice: true, quiet });
    if (res !== 'end') this.keepListening();
  }
  // Keep the conversation going: once she has finished answering, listen for a follow-up without a button press.
  keepListening() {
    if (this.app.settings.handsFree === false || !this.voice.canListen) return;
    this.followUp = Date.now();
    setTimeout(() => this.maybeAutoListen(this.voice.state), 500);
  }

  // Returns 'ok' (handled), or 'end' (the conversation is over for now).
  async handle(raw, { voice = false, quiet = false } = {}) {
    const cleaned = wordsToNumbers(stripWake(raw));
    const low = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const prev = this.lastHeard;
    this.lastHeard = { text: cleaned, at: Date.now() };
    try {
      if (/^(that s all|that ll be all|that is all|thanks|thank you|thanks a lot|stop listening|goodbye|bye|i m done|im done|nothing|no thanks|never mind that s all)( indai)?$/.test(low)) { if (!quiet) this.say('Anytime.', 'info'); return 'end'; }
      // she got it wrong and is being told so: learn from it
      const corr = cleaned.match(/^(?:no[, ]+|nope[, ]+|sorry[, ]+)?(?:i said|i meant|i mean|what i said was|i was saying)[, ]+(.+)$/i);
      if (corr && prev) {
        const meant = corr[1].trim();
        if (this.speech.learn(prev.text, meant)) this.say(`Got it: “${meant}”. I'll know that next time.`, 'good', { speak: false });
        this.missed = null;
        return await this.handle(meant, { voice, quiet });
      }
      if (/^(no )?(that s|that is|thats)? ?(wrong|not right|not what i said|incorrect)$|^you (misheard|got (it|that) wrong|heard (me|that) wrong)( me)?$/.test(low) && prev) {
        this.missed = { text: prev.text, at: Date.now(), teach: true };
        this.say("Sorry about that. Say it once more and I'll learn it.", 'info');
        return 'ok';
      }
      if (this.confirm) {
        const c = this.confirm; this.confirm = null;
        if (/^(yes|yeah|yep|yup|correct|right|that s right|exactly|do it|sure|please|i did)\b/.test(low)) { this.speech.learn(c.heard, c.phrase); this.lastHeard = { text: c.phrase, at: Date.now() }; await this.route(c.phrase); this.speech.heard(true, c.phrase); return 'ok'; }
        if (/^(no|nope|nah)$/.test(low)) { this.missed = { text: c.heard, at: Date.now(), teach: true }; this.say("Okay. Say it again and I'll learn it.", 'info'); return 'ok'; }
      }
      if (await this.route(cleaned) === 'ok') {
        // a repeat that worked right after a miss teaches her what the miss meant
        const m = this.missed;
        if (m && (m.teach ? Date.now() - m.at < 40e3 : Date.now() - m.at < 20e3 && similar(m.text, cleaned) > 0.2) && this.speech.learn(m.text, cleaned)) this.say(`Learned: “${m.text}” means “${cleaned}”.`, 'good', { speak: false });
        this.missed = null; this.speech.heard(true, cleaned);
        return 'ok';
      }
      return await this.interpret(cleaned, { quiet });
    } catch (e) {
      console.warn(e);
      this.setThinking(null);
      this.say('Something went wrong: ' + (e.message || e), 'info', { speak: false });
      return 'ok';
    }
  }
  // The things she can do directly. 'ok' if one of them took it.
  async route(cleaned) {
    if (this.awaiting) {
      if (/^\s*(cancel|stop|never ?mind|skip( it)?|later)\b/i.test(cleaned)) { this.awaiting = null; this.say('No problem. Tap Start day when you want to set the plan.', 'info'); return 'ok'; }
      if (await this.answerPlan(cleaned)) return 'ok';
    }
    if (looksLikeTradeIdea(cleaned)) { await this.analyzeText(cleaned); return 'ok'; }
    if (this.tryCommand(cleaned)) return 'ok';
    if (/\b(analy[sz]e|check|rate|score|grade|what about|how about|thoughts on)\b/i.test(cleaned) && /\b(calls?|puts?)\b/i.test(cleaned)) { await this.analyzeText(cleaned); return 'ok'; }
    return 'unknown';
  }
  lexicon() {
    const syms = this.app.settings.symbols || [];
    return ['brief me', 'start my day', 'check the temperature', 'open the calculator', 'give me a summary', 'bring the screens back', 'close', 'show the details',
      'recenter', 'mute', 'unmute', 'undo', 'repeat that', 'self test', 'practice alert', 'gesture tutorial', 'next scene', 'passthrough', 'open tradingview',
      'switch to the loft', 'switch to midnight', 'show me the ocean', 'take me to orbit', 'switch to the command deck',
      'one minute chart', 'five minute chart', 'fifteen minute chart', 'show vwap', 'hide vwap', 'show gex', 'hide gex', 'show ema', 'hide ema',
      'go conservative', 'go balanced', 'go aggressive', 'gestures off', 'gestures on', 'what do you remember', 'stop listening',
      ...syms.flatMap(s => [`show ${s}`, `deep dive on ${s}`])];
  }
  // Not a direct command. Work out what was meant: her brain if it is on, otherwise the closest thing she knows.
  async interpret(cleaned, { quiet = false } = {}) {
    const m = this.missed;
    if (m && !m.teach && Date.now() - m.at < 9000) {
      // probably one sentence that got split by a pause: try the two halves together
      if (await this.route(m.text + ' ' + cleaned) === 'ok') { this.voice.cutOffEarly(); this.missed = null; this.speech.heard(true); return 'ok'; }
    }
    if (this.brain.configured) { if (await this.converse(cleaned)) return 'ok'; }
    const words = cleaned.trim().split(/\s+/).length;
    const top = words <= 7 ? this.speech.best(cleaned, this.lexicon()) : null;
    if (top && top.score >= 0.8) {
      this.say(`Taking that as “${top.phrase}”.`, 'info', { speak: false });
      this.speech.learn(cleaned, top.phrase); this.speech.heard(true, top.phrase); this.missed = null;
      await this.route(top.phrase);
      return 'ok';
    }
    if (top && top.score >= 0.58 && !quiet) { this.confirm = { heard: cleaned, phrase: top.phrase }; this.say(`Did you mean “${top.phrase}”?`, 'info'); return 'ok'; }
    this.speech.heard(false);
    this.missed = { text: cleaned, at: Date.now() };
    if (quiet) return 'end';                                   // talk in the room during a follow-up: let it go
    const name = this.app.settings.name || '';
    if (/^(hi|hello|hey|good (morning|afternoon|evening)|what s up|whats up|yo)\b/i.test(cleaned)) this.say(`Hi${name ? ' ' + name : ''}. I'm here. Want the brief, or have a trade in mind?`, 'info');
    else if (/\bhow are you\b|\bhow s it going\b|\bhow you doing\b/i.test(cleaned)) this.say("I'm good, and watching the tape. What do you need?", 'info');
    else if (/\b(who are you|what can you do|what do you do|help)\b/i.test(cleaned)) this.say('I rate trade ideas, brief you, deep dive a ticker, watch for your setups, run the calculator and log trades. Just say it the way you would to a person.', 'info');
    else this.say(`I heard “${cleaned}”, and I'm not sure what you'd like. Say it another way and I'll learn it.`, 'info');
    return 'ok';
  }
  liveContext() {
    const app = this.app, sym = app.settings.main, q = app.feed.quote(sym), lv = app.levelsFor(sym);
    return {
      watchlist: Object.fromEntries(app.settings.symbols.map(s => { const x = app.feed.quote(s); return [s, x ? { price: x.last, pct: Math.round(x.pct * 100) / 100 } : null]; })),
      mainChart: { symbol: sym, price: q?.last, levels: lv && { callWall: lv.cw, putWall: lv.pw, flip: lv.zg, source: lv.source } },
      riskBreaker: { state: app.riskState().state, dayPnl: app.day.pnl },
      plan: app.day.plan ? { capital: app.day.plan.capital, goal: app.day.plan.goal, style: app.day.plan.aggr, strategies: app.day.plan.strategies } : null,
      lastAnalysis: app.analysis ? { idea: app.analysis.idea, rag: app.analysis.final?.rag || app.analysis.score.rag, score: app.analysis.score.score } : null,
      scene: app.settings.scene, market: marketStatus().label,
      dataNote: app.feed.status.mode === 'delayed' ? 'Prices are delayed about 15 minutes.' : app.feed.status.mode,
    };
  }
  // A real back-and-forth with her brain. It can answer, run the command center, fix mishears and remember things.
  async converse(cleaned) {
    const app = this.app;
    this.setThinking('Thinking…');
    const turns = this.log.filter(l => l.kind === 'you' || !/^(•|Learned:|Taking that as|Noted:)/.test(l.text)).slice(-15)
      .map(l => ({ role: l.kind === 'you' ? 'user' : 'assistant', text: l.text.replace(/^“|”$/g, '') }));
    if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();          // the line being answered now
    try {
      const res = await relay.brain({ mode: 'talk', name: app.settings.name, question: cleaned, history: turns, context: this.liveContext(), speech: this.speech.habits() }, app.settings.researchPass);
      this.setThinking(null);
      const f = res.result || {};
      if (f.heard_as && similar(f.heard_as, cleaned) < 0.97) this.speech.learn(cleaned, f.heard_as);
      let ran = false;
      if (f.command) ran = (await this.route(wordsToNumbers(String(f.command)))) === 'ok';
      if (f.spoken && (!ran || !this.voice.state.speaking)) this.say(f.spoken, 'info');
      for (const b of (f.summary || []).slice(0, 4)) this.say('• ' + b, 'info', { speak: false });
      for (const r of (res.remembered || [])) this.say('Noted: ' + r.text, 'good', { speak: false });
      this.speech.heard(true); this.missed = null;
      return true;
    } catch (e) {
      this.setThinking(null);
      if (e.code !== 'not_configured') this.say(`I couldn't reach my thinking brain (${e.message}).`, 'info', { speak: false });
      return false;
    }
  }
  // Long-term memory: things she is told to remember, kept in the backend so every device shares them.
  async remember(text) {
    try { await relay.brain({ mode: 'memory', op: 'add', text, kind: 'taught' }, this.app.settings.researchPass); this.say(`I'll remember that: ${text}`, 'good'); }
    catch (e) { this.say(`I couldn't save that (${e.message}).`, 'info', { speak: false }); }
  }
  async recall() {
    let mem = [];
    try { mem = (await relay.brain({ mode: 'memory', op: 'list' }, this.app.settings.researchPass)).memory || []; } catch {}
    const st = this.speech.stats, rate = st.heard ? Math.round(st.understood / st.heard * 100) : null;
    this.say(mem.length ? `I'm holding ${mem.length} thing${mem.length === 1 ? '' : 's'} you've taught me, and ${st.fixes} fix${st.fixes === 1 ? '' : 'es'} for how you speak.` : `Nothing saved yet. Say “remember that…” and I'll keep it. I've learned ${st.fixes} fix${st.fixes === 1 ? '' : 'es'} for how you speak.`, 'info');
    for (const m of mem.slice(-8)) this.say('• ' + m.text, 'info', { speak: false });
    for (const f of this.speech.list().slice(0, 5)) this.say(`• “${f.heard}” means “${f.to}”`, 'info', { speak: false });
    if (rate != null) this.say(`• Understood ${rate}% of ${st.heard} things you've said.`, 'info', { speak: false });
  }

  tryCommand(raw) {
    const app = this.app;
    let t = ' ' + raw.toLowerCase().replace(/[^a-z0-9.$ ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    t = t.replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');
    const symIn = (s) => {
      for (const [alias, sym] of Object.entries(ALIASES).sort((a, b) => b[0].length - a[0].length)) if (s.includes(' ' + alias + ' ')) return sym;
      const up = s.trim().split(' ').map(w => w.toUpperCase());
      return up.find(w => app.settings.symbols.includes(w)) || null;
    };
    if (/^ (stop|cancel|quiet|shh|never mind|nevermind)( talking)? $/.test(t)) { this.voice.stopSpeaking(); return true; }
    // teaching and memory
    const rem = raw.match(/^\s*(?:please )?(?:remember|note|keep in mind|don'?t forget|make a note)(?: that| this)?[,: ]+(.{4,})$/i);
    if (rem) { this.remember(rem[1].trim()); return true; }
    if (/\bwhat (do|did) you (remember|know about me)\b|\bwhat have (you learned|i taught you)\b|\bhow well do you (understand|hear) me\b/.test(t)) { this.recall(); return true; }
    if (/\b(hands ?free|follow ups?|keep listening) (off|on)\b/.test(t)) { const on = / on $/.test(t); app.settings.handsFree = on; app.saveSettings(); this.say(on ? "Hands-free is on. After I answer, I'll listen for your reply." : "Hands-free is off. Tap Talk or pinch the orb when you want me.", 'info'); return true; }
    if (/\bgestures? (off|on|easy|easier|normal|strict|stricter|harder|less sensitive|more sensitive)\b|\b(turn|switch) (off|on) (the |hand )?gestures\b/.test(t)) {
      const lvl = /\boff\b/.test(t) ? 'off' : /easy|easier|more sensitive/.test(t) ? 'easy' : /strict|harder|less sensitive/.test(t) ? 'strict' : 'normal';
      app.setGestures(lvl); return true;
    }
    // scenes: passthrough or a virtual space
    if (/\b(pass ?through|my (real )?room|real world|see my room)\b/.test(t) && !/\b(calls?|puts?)\b/.test(t)) { app.setScene('passthrough'); return true; }
    if (/\b(next|another|different|change( the)?|switch( the)?) (scene|background|environment|space|view)\b/.test(t)) { app.cycleScene(1); return true; }
    if (/\b(switch|change|go|take me|move|show|set|put me|background|scene|environment|space|view|bring up)\b/.test(t)) {
      for (const [id, re] of [['loft', /\bloft\b/], ['midnight', /\b(midnight|penthouse|night city|city at night)\b/], ['ocean', /\b(ocean|beach|sunset|the sea)\b/], ['orbit', /\b(orbit|outer space|space station|above earth|in space)\b/], ['deck', /\b(command deck|the grid|classic (view|scene|look))\b/]]) if (re.test(t)) { app.setScene(id); return true; }
      if (/\b(scenes|backgrounds|environments)\b/.test(t)) { app.openFocus('scenes'); return true; }
    }
    if (/\b(repeat|say (that|it) again|come again)\b/.test(t)) { this.repeat(); return true; }
    if (/\b(brief|briefing|status|sitrep|how are we|market check|catch me up)\b/.test(t)) { app.brief(); return true; }
    if (/\bre ?cent(er|re)\b/.test(t)) { app.recenter(); this.say('Recentered.'); return true; }
    if (/\bundo\b/.test(t)) { app.undoTrade(); return true; }
    if (/\b(unmute|voice on)\b/.test(t)) { app.toggleMute(false); return true; }
    if (/\b(mute|voice off|shut up)\b/.test(t)) { app.toggleMute(true); return true; }
    if (/\b(restore|bring (back|them back|the screens back)|expand( everything| all)?|show (all|every) ?(screens|windows))\b/.test(t)) { app.restoreAll(); return true; }
    if (/\b(consolidate|summari[sz]e (everything|all)|one window|everything at a glance|collapse)\b/.test(t) || /^ (summary|give me a summary|the summary) $/.test(t)) { app.consolidate(); return true; }
    if (/\btrading ?view\b/.test(t) && /\b(open|show|pull up|launch|go to)\b/.test(t)) { app.openTradingView(symIn(t)); return true; }
    if (/\b(gestures?|hand) (tutorial|lesson|training|practice|guide)\b|\b(teach|show) me (the |how to (use |do )?)?(hand )?gestures\b|\bhow do (the )?gestures work\b/.test(t)) { app.startTutorial(); return true; }
    if (app.tutorial && /\b(exit|end|stop|close|quit) (the )?tutorial\b/.test(t)) { app.endTutorial(false); return true; }
    if (app.tutorial && /^ (next|skip|skip it|next step|go on) $/.test(t)) { app.tutorialGo(1); return true; }
    if (app.tutorial && /^ (back|go back|previous|last step) $/.test(t)) { app.tutorialGo(-1); return true; }
    if (/\b(self ?test|test (yourself|everything|the system|all systems)|diagnostics?|system check|systems check|are you working|run a test)\b/.test(t)) { this.selfTest(); return true; }
    if (/\b(practice|test|sample|demo) (alert|signal|setup)\b/.test(t)) { app.practiceAlert(); return true; }
    if (/\b(start (my|the) day|game ?plan|check ?in|new plan|change (the|my) plan|set (the|my|up the) plan|let s (get started|start|go))\b/.test(t)) { this.startDay({ voice: true }); return true; }
    if (/\b(temperature|temp check|how hot|market mood|how s the market|hows the market)\b/.test(t)) { this.tempCheck(); return true; }
    if (/\b(only|just|focus on|alert me on|watch for)\b/.test(t) && /\b(ema|cloud|clouds|vwap|gex|wall|walls|opening range|orb|breakout)\b/.test(t)) {
      const ks = this.strategiesIn(t); if (ks.length) { app.planDraft = { ...app.planDraft, strategies: ks }; if (app.day.plan) app.lockPlan({ quiet: true }); this.say(`Got it. I'll alert on ${ks.map(k => STRATEGIES[k].short).join(' and ')} setups.`); return true; }
    }
    if (/\b(conservative|balanced|aggressive)\b/.test(t) && /\b(go|be|switch|set|make it|let s|mode|get)\b/.test(t)) { const k = t.match(/\b(conservative|balanced|aggressive)\b/)[1]; app.planSet({ aggr: k }); app.lockPlan(); return true; }
    if (/\b(calculator|profit calc|calc)\b/.test(t)) { app.openFocus('calc'); this.say('Calculator open.', 'info', { speak: false }); return true; }
    if (/\b(close|dismiss|hide) (it|this|that|the (panel|card|window|analysis|calculator|deep dive))\b/.test(t) || /^ close $/.test(t)) { app.closeFocus(); return true; }
    if (/\b(details|show (me )?the (analysis|details|breakdown))\b/.test(t)) { app.openFocus('analysis'); return true; }

    const tr = t.match(/\b(win|winner|won|profit|loss|loser|lost|lose)\b.*?\$? ?(\d+(?:\.\d+)?)/) || t.match(/\$? ?(\d+(?:\.\d+)?) (dollar |dollars )?(win|winner|profit|loss|loser)/);
    if (tr && /\b(log|logged|took|take|booked|record|add|a)\b/.test(t)) {
      const word = tr[1] && isNaN(tr[1]) ? tr[1] : tr[3];
      const amt = parseFloat(tr[1] && !isNaN(tr[1]) ? tr[1] : tr[2]);
      if (amt > 0) { app.logTrade(/win|won|profit/.test(word) ? amt : -amt); return true; }
    }
    const tf = t.match(/\b(1|5|15|one|five|fifteen) ?(minute|min|m)\b/);
    if (tf) { const n = { one: 1, five: 5, fifteen: 15 }[tf[1]] || tf[1]; app.setTimeframe(n + 'min'); this.say(`${n} minute chart.`, 'info', { speak: false }); return true; }
    for (const key of ['vwap', 'ema', 'gex', 'levels', 'cloud']) {
      if (t.includes(' ' + key + ' ') || t.includes(' ' + key + 's ')) {
        const k = key === 'levels' ? 'gex' : key === 'cloud' ? 'ema' : key;
        if (/\b(hide|remove|off|turn off)\b/.test(t)) { app.setShow(k, false); return true; }
        if (/\b(show|add|on|turn on)\b/.test(t)) { app.setShow(k, true); return true; }
      }
    }
    const dd = t.match(/\b(deep dive|dive into|explode|break ?down|tell me about|what s going on with|whats going on with|how is|how s|full picture on|everything on) (on |into )?(.+)$/);
    if (dd) {
      const s = symIn(' ' + dd[3]) || (/^[a-z]{1,5} ?$/.test(dd[3].trim()) ? dd[3].trim().toUpperCase() : null);
      if (s) { app.openDeepDive(s); return true; }
    }
    const sym = symIn(t);
    if (sym && t.trim().split(' ').length <= 4) { app.selectSymbol(sym, { announce: true }); return true; }
    const m = t.match(/\b(show|chart|pull up|open|switch to|go to|load) ([a-z]{1,5}) $/);
    if (m && !['me', 'the', 'it', 'all'].includes(m[2])) { app.selectSymbol(m[2].toUpperCase(), { announce: true }); return true; }
    return false;
  }



  // ---------------------------------------------------------------- self-test
  // Checks every part of INDAI and plays a practice alert, so it can be tested at any hour.
  async selfTest() {
    const app = this.app, v = this.voice;
    if (this._testing) return; this._testing = true;
    const results = [];
    const add = (name, status, detail) => { results.push({ name, status, detail }); app.onSelfTest?.(results, false); };
    const timeET = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    this.setThinking('Running self-test…');
    this.say('Running a self-test. Give me a few seconds.', 'info');
    app.onSelfTest?.(results, false);
    v.unlock();
    if (!this.muted && app.settings.voiceEngine !== 'system') v.preload({ tts: true });
    try {
      const st = app.feed.status, main = app.settings.main, q = app.feed.quote(main);
      add('Market data', st.mode === 'demo' ? 'fail' : q ? 'pass' : 'warn', st.mode === 'demo' ? `demo prices only: ${st.note || "couldn't reach market data"}` : `${st.mode === 'live' ? 'Finnhub real-time + CBOE' : 'CBOE, about 15 minutes delayed'}${app.feed.bridgeLive ? ' + TradingView bridge' : ''} · ${main} ${q ? fmtPrice(q.last) : 'no quote yet'}`);
      try {
        const c = await relay.chain(main, '', 0.03);
        if (c?.spot) app.noteChainGex(main, c);
        add('Options chain', c?.spot ? 'pass' : 'fail', c?.spot ? `${main}: ${c.chain.length} contracts near ${fmtPrice(c.spot)}, nearest expiry ${c.expiry}` : (c?.error || 'no data'));
      } catch (e) { add('Options chain', 'fail', e.message); }
      const lv = app.levelsFor(main);
      add('GEX levels', lv ? (lv.source === 'demo' ? 'warn' : 'pass') : 'fail', lv ? `${main} call wall ${lv.cw ?? '—'}, put wall ${lv.pw ?? '—'}, flip ${lv.zg ?? '—'} (${levelSourceLabel(lv).replace('Levels: ', '').toLowerCase()})` : 'none loaded yet');
      const br = app.feed.status.tvAt;
      add('TradingView bridge', app.feed.bridgeLive ? 'pass' : 'warn', app.feed.bridgeLive ? `live, last candle at ${timeET(br)}` : br ? `quiet since ${timeET(br)}` : 'no candles yet. It starts once your TradingView chart closes a candle (by 9:30 at the latest)');
      const b = await relay.brainStatus(); this.brain = { ...b, checked: true };
      add('Web research', b.configured ? 'pass' : 'warn', b.configured ? 'on' : 'off until the Anthropic key is added; trade ratings use market data only');
      const vs = v.state;
      add('Voice', vs.ttsReady || app.settings.voiceEngine === 'system' ? 'pass' : 'warn', vs.ttsReady ? 'natural voice ready' : app.settings.voiceEngine === 'system' ? 'using the browser voice' : vs.ttsLoad != null ? `natural voice downloading, ${vs.ttsLoad}% (first time only)` : 'natural voice downloading (first time only)');
      let mic = 'unknown';
      try { mic = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
      add('Microphone', !v.canListen ? 'fail' : mic === 'granted' ? 'pass' : mic === 'denied' ? 'fail' : 'warn', !v.canListen ? 'this browser has no microphone access' : mic === 'granted' ? 'allowed' : mic === 'denied' ? 'blocked: allow the microphone for this site in the browser settings' : 'not allowed yet: tap Talk once and choose Allow');
      const quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
      const onDevice = !(v.SR && (app.settings.micEngine === 'browser' || (app.settings.micEngine !== 'whisper' && !quest)));
      if (onDevice && !vs.sttReady) v.preload({ tts: false, stt: true });
      add('Listening', !onDevice || vs.sttReady ? 'pass' : 'warn', !onDevice ? "using this browser's speech recognition" : vs.sttReady ? `on-device model ready (${vs.sttModel})` : vs.sttLoad != null ? `listening model downloading, ${vs.sttLoad}%` : 'listening model downloading (first time only)');
      const p = app.day.plan;
      add('Game plan', p ? 'pass' : 'warn', p ? `${fmtMoney(p.capital)} start, ${fmtMoney(p.goal)} goal, ${PROFILES[p.aggr].label.toLowerCase()}` : 'not set today: tap Start day or say "start my day"');
      const rs = app.riskState();
      add('Risk breaker', rs.state === 'armed' ? 'pass' : 'warn', rs.state === 'armed' ? `armed, ${fmtMoney(rs.room)} of room today` : rs.state === 'tripped' ? 'tripped for today' : 'on cooldown');
      const rep = app.replayScan();
      add('Setup alerts', rep.symbols ? 'pass' : 'warn', rep.symbols ? `${rep.count} setup${rep.count === 1 ? '' : 's'} scoring ${rep.minScore}+ in the ${rep.label} session across ${rep.symbols} tickers${rep.best ? `; best: ${rep.best.sym}, ${rep.best.title} (${rep.best.score})` : ''}` : 'no candles loaded yet');
      app.onSelfTest?.(results, true);
      for (const r of results) this.say(`${r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '•'} ${r.name}: ${r.detail}`, r.status === 'fail' ? 'risk' : r.status === 'pass' ? 'good' : 'info', { speak: false });
      const fails = results.filter(r => r.status === 'fail'), waits = results.filter(r => r.status === 'warn');
      this.say(`Self-test done. ${results.length - fails.length - waits.length} of ${results.length} checks passed.${fails.length ? ` Needs fixing: ${fails.map(f => f.name.toLowerCase()).join(', ')}.` : ''}${waits.length ? ` Still waiting on: ${waits.map(w => w.name.toLowerCase()).join(', ')}.` : ''}${rep.practice ? " Here's a practice alert so you can hear one." : ''}`, fails.length ? 'risk' : 'good');
      if (rep.practice) setTimeout(() => app.practiceAlert(rep.practice), 900);
    } catch (e) {
      this.say('Self-test stopped early: ' + (e.message || e), 'risk', { speak: false });
    } finally {
      this.setThinking(null); this._testing = false;
    }
    return results;
  }

  // ---------------------------------------------------------------- morning check-in / game plan
  maybeAutoListen(st) {
    if (st.speaking || st.listening || st.transcribing || this.thinking) return;
    if (this.autoListen) {
      if (Date.now() - this.autoListen > 60e3) { this.autoListen = 0; return; }
      this.autoListen = 0;
      setTimeout(() => { if (this.awaiting && !this.voice.state.listening) this.talk(); }, 350);
      return;
    }
    if (this.followUp) {
      const fresh = Date.now() - this.followUp < 120e3;
      this.followUp = 0; clearTimeout(this._fu);
      if (fresh) this._fu = setTimeout(() => { const s = this.voice.state; if (!s.speaking && !s.listening && !s.transcribing && !this.thinking && !this.muted) this.talk({ quiet: true }); else if (s.speaking || this.thinking) this.followUp = Date.now(); }, 450);
    }
  }
  ask(question, step, { voice = false } = {}) {
    this.awaiting = step;
    this.say(question, 'info');
    if (voice && this.voice.canListen) { if (this.muted || !this.voice.state.speaking) setTimeout(() => { if (this.awaiting === step && !this.voice.state.listening) this.talk(); }, 600); else this.autoListen = Date.now(); }
  }
  strategiesIn(t) {
    const ks = [];
    if (/\b(ema|cloud|clouds)\b/.test(t)) ks.push('ema');
    if (/\bvwap\b/.test(t)) ks.push('vwap');
    if (/\b(gex|wall|walls|gamma)\b/.test(t)) ks.push('gex');
    if (/\b(opening range|orb|breakout|breakouts)\b/.test(t)) ks.push('orb');
    if (/\b(all|everything|all of them)\b/.test(t)) return Object.keys(STRATEGIES);
    return ks;
  }
  async tempCheck() {
    const app = this.app;
    this.setThinking('Reading the market…');
    const t = await app.checkTemperature(true);
    this.setThinking(null);
    this.say(this.tempLine(t));
  }
  tempLine(t) {
    if (!t) return "I couldn't read the market just now.";
    return `Market temperature: ${t.label.toLowerCase()}, with a ${t.bias} lean. ${t.notes.slice(0, 3).join('. ')}. ${t.advice}${t.demo ? ' This is demo data.' : ''}`;
  }
  async startDay({ voice = false, skipTemp = false } = {}) {
    const app = this.app;
    app.planDraft = { ...app.planDraft };
    app.openFocus('plan');
    this.planVoice = voice;
    const name = app.settings.name;
    if (!skipTemp) {
      this.setThinking('Reading the market…');
      const t = await app.checkTemperature(true);
      this.setThinking(null);
      const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()));
      this.say(`${h < 12 ? 'Good morning' : 'Hey'}, ${name}. Let me take the temperature first. ${this.tempLine(t)}`);
    }
    this.ask(app.day.plan ? `Let's reset the plan. How much are we working with?` : `How much are we starting with today?`, 'capital', { voice });
  }
  parseMoney(t, { base } = {}) {
    let s = t.toLowerCase().replace(/,/g, '');
    s = s.replace(/\ba (hundred|thousand|grand|k)\b/g, '1 $1').replace(/\bhalf a (k|grand|thousand)\b/g, '0.5 $1')
      .replace(/(\d+(?:\.\d+)?) and a half (k|grand|thousand)\b/g, (m, n, u) => `${Number(n) + 0.5} ${u}`)
      .replace(/(\d+(?:\.\d+)?) and a half\b/g, (m, n) => `${Number(n) + 0.5}`)
      .replace(/(\d+(?:\.\d+)?) hundred\b/g, (m, n) => `${Number(n) * 100}`);
    const pctM = s.match(/(\d+(?:\.\d+)?)\s*(%|percent)/);
    if (pctM && base) return Math.round(base * Number(pctM[1]) / 100);
    const m = s.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|thousand|grand)?(?![a-z])/);
    if (!m) return null;
    let v = Number(m[1]);
    if (m[2]) v *= 1000;
    return v > 0 ? Math.round(v) : null;
  }
  async answerPlan(t) {
    const app = this.app, d = app.planDraft, step = this.awaiting, voice = this.planVoice;
    const low = t.toLowerCase();
    if (step === 'capital') {
      const v = this.parseMoney(low);
      if (!v || v < 50) { this.ask("I didn't catch the amount. How much are we starting with? For example, two thousand.", 'capital', { voice }); return true; }
      app.planSet({ capital: v });
      const sug = Math.max(10, Math.round(v * 0.03 / 10) * 10);
      this.ask(`${fmtMoney(v)}. And what's the minimum goal for today? A dollar amount or a percent. Around ${fmtMoney(sug)} is a solid day.`, 'goal', { voice });
      return true;
    }
    if (step === 'goal') {
      const v = this.parseMoney(low, { base: d.capital });
      if (!v) { this.ask("What's the minimum goal, in dollars or percent?", 'goal', { voice }); return true; }
      app.planSet({ goal: v });
      const hot = app.temp && (app.temp.label === 'Hot');
      this.ask(`Goal ${fmtMoney(v)}. How aggressive do we go: conservative, balanced, or aggressive?${hot ? " It's hot out there, so I'd lean balanced or conservative." : ''}`, 'aggr', { voice });
      return true;
    }
    if (step === 'aggr') {
      let k = /\b(conservative|safe|careful|low|light|easy|defensive)\b/.test(low) ? 'conservative' : /\b(aggressive|high|send it|full|max|attack|go hard)\b/.test(low) ? 'aggressive' : /\b(balanced|medium|moderate|normal|middle|regular|mid)\b/.test(low) ? 'balanced' : null;
      if (!k) { this.ask('Conservative, balanced, or aggressive?', 'aggr', { voice }); return true; }
      app.planSet({ aggr: k });
      const ks = this.strategiesIn(low);
      if (ks.length) app.planSet({ strategies: ks });
      this.awaiting = null;
      app.lockPlan();
      return true;
    }
    this.awaiting = null;
    return false;
  }

  analyzeSignal(sig) {
    const k = sig.contract || {};
    this.analyzeIdea({ raw: sig.title, sym: sig.sym, type: sig.type, side: 1, strike: k.strike, expiry: k.expiry || null, qty: k.qty || 1 }, `${sig.sym} ${sig.type === 'P' ? 'puts' : 'calls'} from INDAI's ${sig.title} alert`);
  }

  // ---------------------------------------------------------------- trade analysis
  quickIdea(sym, type) {
    const q = this.app.feed.quote(sym);
    this.analyzeIdea({ raw: `${sym} ${type === 'P' ? 'puts' : 'calls'}`, sym, type, side: 1, expiry: null, strike: undefined, qty: 1 }, `${sym} ${type === 'P' ? 'puts' : 'calls'} near the money`);
    if (!q) this.say(`Pulling ${sym}…`, 'info', { speak: false });
  }
  async analyzeText(text) {
    const app = this.app;
    const idea = parseIdea(text, { symbols: app.settings.symbols, spotOf: (s) => app.feed.quote(s)?.last ?? null });
    if (!idea.sym) idea.sym = app.settings.main;
    if (!idea.type) { this.say(`Calls or puts on ${idea.sym}? Say it again with calls or puts.`); return; }
    return this.analyzeIdea(idea, text);
  }

  async analyzeIdea(idea, question) {
    const app = this.app, sym = idea.sym, r = app.settings.rate ?? 0.04;
    const runId = (this.runId = (this.runId || 0) + 1);
    this.setThinking(`Analyzing ${sym}…`);
    this.say(`Looking at ${sym} ${idea.strike ?? ''} ${idea.type === 'P' ? 'puts' : 'calls'} ${expWords(idea.expiry) || 'at the nearest expiry'}. Pulling the chain, flow, charts and news.`, 'info', { speak: false });
    // 1. data, in parallel
    let chain = await relay.chain(sym, idea.expiry || '', 0.08).catch(e => ({ error: e.message }));
    if (chain.error || !chain.spot) {
      this.setThinking(null);
      this.say(`I couldn't load the ${sym} options chain${chain.error ? ` (${chain.error})` : ''}. Check the ticker and try again.`);
      return;
    }
    if (idea.expiry && chain.expiry !== idea.expiry) this.say(`${sym} has no contracts expiring ${idea.expiry}; I used the next one, ${chain.expiry}.`, 'alert', { speak: false });
    idea.expiry = chain.expiry;
    const strikes = [...new Set(chain.chain.filter(o => o.type === idea.type).map(o => o.strike))].sort((a, b) => a - b);
    if (idea.strike == null && strikes.length) {
      idea.strike = strikes.reduce((b, k) => Math.abs(k - chain.spot) < Math.abs(b - chain.spot) ? k : b, strikes[0]);
      this.say(`No strike given, so I used the at-the-money ${idea.strike}.`, 'info', { speak: false });
    }
    let row = chain.chain.find(o => o.type === idea.type && o.strike === idea.strike);
    if (!row) {
      const wide = await relay.chain(sym, idea.expiry, 0.25).catch(() => null);
      row = wide?.chain?.find(o => o.type === idea.type && o.strike === idea.strike);
      if (!row && wide?.chain?.length) {
        const same = wide.chain.filter(o => o.type === idea.type);
        const near = same.reduce((b, o) => !b || Math.abs(o.strike - idea.strike) < Math.abs(b.strike - idea.strike) ? o : b, null);
        if (near && Math.abs(near.strike - idea.strike) / chain.spot < 0.01) { this.say(`There's no ${idea.strike} strike; using ${near.strike}.`, 'alert', { speak: false }); idea.strike = near.strike; row = near; }
      }
    }
    const [barsRes, dailyRes, newsRes] = await Promise.all([
      this.barsFor(sym), relay.daily([sym]).catch(() => null), relay.news(sym).catch(() => null),
    ]);
    if (runId !== this.runId) return;
    const q = app.feed.quote(sym);
    const fresh = q && Date.now() - (q.lastTradeAt || 0) < 120e3 && app.feed.status.mode !== 'demo';
    let spot = fresh ? q.last : chain.spot;
    // Outside market hours, a big after-hours move makes closing option quotes stale: use the after-hours price
    // and price the option with the model at the chain's implied volatility.
    const offHours = marketStatus().state !== 'open' && q?.ext && Math.abs(q.ext / q.last - 1) > 0.003;
    if (offHours) { spot = q.ext; this.say(`Market's closed and ${sym} has moved to ${fmtPrice(q.ext)} after hours, so I priced the option with the model instead of the closing quote.`, 'info', { speak: false }); }
    const daily = dailyRes?.daily?.[sym] || null;
    const rv = realizedVol(daily);
    const contract = row ? { ...row, mid: idea.premium ?? (offHours ? 0 : row.mid) } : (idea.premium ? { mid: idea.premium, bid: 0, ask: 0, iv: 0, vol: 0, oi: 0 } : null);
    const quant = quantRead({ spot, strike: idea.strike, type: idea.type, side: idea.side, expiry: idea.expiry, contract, ivFallback: rv || (chain.meta?.iv30 ? chain.meta.iv30 / 100 : 0.25), r });
    const tech = technicals(barsRes);
    app.noteChainGex(sym, chain);
    let levels = app.levelsFor(sym);
    if (levels && idea.expiry === today() && levels.near && (levels.near.cw || levels.near.pw)) levels = { ...levels, cw: levels.near.cw ?? levels.cw, pw: levels.near.pw ?? levels.pw, zg: levels.near.zg ?? levels.zg };
    const leadlag = {};
    for (const s of new Set([...LEADLAG, sym])) { const qq = app.feed.quote(s); if (qq) leadlag[s] = qq.pct; }
    const news = headlineSentiment(newsRes?.items || []);
    const risk = app.riskState();
    const score = scoreTrade({ idea, spot, contract: row, quant, tech, chain, levels, leadlag, news, risk });
    const an = {
      at: Date.now(), idea: { ...idea }, question, spot, delayed: !fresh,
      contract: row ? { bid: row.bid, ask: row.ask, mid: row.mid, vol: row.vol, oi: row.oi, iv: row.iv, delta: row.delta } : null,
      quant, tech, levels, score, news: news.items.slice(0, 6), chainSummary: { all: chain.all, expiryStats: chain.expiryStats, unusual: (chain.unusual || []).slice(0, 5), gex: chain.gex, gexNear: chain.gexNear, iv30: chain.meta?.iv30 },
      final: null, pendingAI: false, aiError: null,
    };
    app.analysis = an;
    app.loadCalc({ sym, spot, legs: [{ type: idea.type, side: idea.side || 1, strike: idea.strike, qty: idea.qty || 1, entry: +quant.entry.toFixed(2), iv: +quant.iv.toFixed(4), expiry: idea.expiry }], expirations: chain.expirations, strikes });
    app.openFocus('analysis');
    app.markDirty('all');
    // 2. quick spoken verdict from the numbers
    const lead = score.gate ? `${score.gate} So this one is RED.` : `Quant read is ${score.rag}, ${score.score} out of 100.`;
    const odds = idea.side > 0
      ? `Chance of profit at expiry about ${pct(quant.popExpiry)}; it needs ${fmtPrice(quant.breakeven)}, a ${quant.moveNeededSigma.toFixed(1)} sigma move.${quant.mc ? ` About ${pct(quant.mc.probTouch50)} chance it's up 50 percent at some point.` : ''}`
      : `Chance it expires worthless for you about ${pct(quant.popExpiry)}.`;
    const pro = score.pros[0] ? ` Working for it: ${score.pros.slice(0, 2).map(f => f.name.toLowerCase()).join(' and ')}.` : '';
    const con = score.cons[0] ? ` Against it: ${score.cons.slice(0, 2).map(f => f.name.toLowerCase()).join(' and ')}.` : '';
    const priceLine = row ? ` Option is about ${quant.entry.toFixed(2)}${offHours ? ' by the model' : ''}.` : '';
    const willResearch = this.brain.configured;
    this.say(`${sym} ${idea.strike} ${idea.type === 'P' ? 'puts' : 'calls'}, ${expWords(idea.expiry)}. ${lead}${priceLine} ${odds}${pro}${con}${willResearch ? ' Checking the news and today\'s events now.' : ''}`, score.rag === 'GREEN' ? 'good' : score.rag === 'RED' ? 'risk' : 'alert');
    this.setThinking(willResearch ? 'Researching news…' : null);
    if (!willResearch) {
      if (!this.toldNoBrain) { this.toldNoBrain = true; this.say('Web research is off: add the research key (see the setup note) and I will also read today\'s news, events and sentiment before rating.', 'info', { speak: false }); }
      return;
    }
    // 3. web research + final verdict
    an.pendingAI = true; app.markDirty('indai'); app.markDirty('analysis');
    try {
      const context = this.compactContext(an, chain);
      const res = await relay.brain({ mode: 'trade', depth: app.settings.researchDepth || 'fast', name: app.settings.name, question, idea: an.idea, context }, app.settings.researchPass);
      if (runId !== this.runId) return;
      const f = res.result || {};
      if (risk.state !== 'armed') f.rag = 'RED';
      an.final = { ...f, sources: res.sources || [], model: res.model };
      an.pendingAI = false;
      this.setThinking(null);
      if (f.spoken) this.say(f.spoken, f.rag === 'GREEN' ? 'good' : f.rag === 'RED' ? 'risk' : 'alert');
      for (const b of (f.summary || []).slice(0, 4)) this.say('• ' + b, 'info', { speak: false });
    } catch (e) {
      an.pendingAI = false; an.aiError = e.message; this.setThinking(null);
      const why = e.code === 'not_configured' ? 'the research key is not set up yet' : e.code === 'passcode' ? 'the research passcode in Settings is wrong' : e.name === 'AbortError' ? 'it took too long' : e.message;
      this.say(`Web research didn't finish (${why}). The rating above is from the market data alone.`, 'info', { speak: false });
    }
    app.markDirty('all');
  }

  compactContext(an, chain) {
    const t = an.tech, q = an.quant, app = this.app;
    const r2 = (v) => v == null ? null : Math.round(v * 100) / 100;
    return {
      dataNote: an.delayed ? 'Prices are CBOE delayed about 15 minutes.' : 'Prices are live.',
      spot: r2(an.spot), symbol: an.idea.sym, expiry: an.idea.expiry, hoursLeftInContract: r2(q.hoursLeft),
      contract: an.contract, model: { iv: r2(q.iv), entry: r2(q.entry), fair: r2(q.fair), breakeven: r2(q.breakeven), expectedMove: r2(q.expectedMove), moveNeededSigma: r2(q.moveNeededSigma), probProfitAtExpiry: r2(q.popExpiry), probITM: r2(q.probITM), probTouchStrike: r2(q.probTouch), delta: r2(q.delta), gamma: q.gamma, thetaPerDay: r2(q.theta), vegaPer1pct: r2(q.vega), thetaPctOfPremiumPerHour: r2(q.thetaPctPerHour), monteCarlo: q.mc && { probProfit: r2(q.mc.probProfitAtExpiry), touch50: r2(q.mc.probTouch50), touch100: r2(q.mc.probTouch100), p10: r2(q.mc.p10), p50: r2(q.mc.p50), p90: r2(q.mc.p90) } },
      technicals5m: t && { trend: t.trend, emaFastCloud: t.emaFast, emaSlowCloud: t.emaSlow, vwap: r2(t.vwap), vwapDistPct: r2(t.vwapDistPct), macdHist: r2(t.macdHist), macdRising: t.macdRising, macdCross: t.macdCross, rsi: r2(t.rsi), divergence: t.divergence, momentumPct: r2(t.momentumPct), volumeRatio: r2(t.volumeRatio), dayHigh: r2(t.dayHigh), dayLow: r2(t.dayLow) },
      gexLevels: an.levels && { callWall: an.levels.cw, putWall: an.levels.pw, gammaFlip: an.levels.zg, callWall2: an.levels.cw2, putWall2: an.levels.pw2, source: an.levels.source, asof: an.levels.asof },
      optionsFlow: { allExpiries: chain.all, thisExpiry: chain.expiryStats, unusual: (chain.unusual || []).slice(0, 6), iv30: chain.meta?.iv30 },
      marketToday: Object.fromEntries(LEADLAG.map(s => [s, r2(app.feed.quote(s)?.pct)])),
      headlines: an.news.slice(0, 6).map(n => n.title),
      quantScore: { score: an.score.score, rag: an.score.rag, factors: an.score.factors.map(f => ({ name: f.name, score: r2(f.s), note: f.note })) },
      riskBreaker: { state: app.riskState().state, dayPnl: app.day.pnl, roomLeft: app.riskState().room },
    };
  }

  // 5-minute bars for any ticker (from the live feed if tracked, else the relay).
  async barsFor(sym) {
    const have = this.app.feed.getBars(sym, '5min');
    if (have.length >= 20) return have;
    try {
      const j = await relay.bars([sym]);
      const d = j.bars?.[sym];
      if (!d?.bars?.length) return have;
      const [y, m, dd] = d.session.split('-').map(Number);
      const base = etToMs(y, m, dd, 0, 0);
      const one = d.bars.map(b => ({ t: base + (b[0] - 1) * 60e3, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
      return aggregate(one, INTERVAL_MS['5min']);
    } catch { return have; }
  }

  // ---------------------------------------------------------------- deep dive ("explode")
  async deepDive(sym) {
    const app = this.app;
    const d = { sym, loading: true, at: Date.now() };
    app.deep = d; app.openFocus('deep');
    const [bars, chain, news] = await Promise.all([this.barsFor(sym), relay.chain(sym, '', 0.06).catch(() => null), relay.news(sym).catch(() => null)]);
    if (app.deep !== d) return;
    d.bars = bars; d.tech = technicals(bars); d.chain = chain && !chain.error ? chain : null;
    d.news = headlineSentiment(news?.items || []).items;
    if (!app.feed.quote(sym) && chain?.spot) d.quote = { last: chain.spot, pct: 0, chg: 0 };
    if (d.chain) app.noteChainGex(sym, d.chain);
    d.loading = false;
    app.markDirty('deep');
    const q = app.feed.quote(sym) || d.quote, t = d.tech, lv = app.levelsFor(sym);
    const parts = [`${sym}${q ? `, ${fmtPrice(q.last)}${q.pct ? `, ${q.pct >= 0 ? 'up' : 'down'} ${Math.abs(q.pct).toFixed(2)} percent` : ''}` : ''}.`];
    if (t) parts.push(`${t.trend === 'sideways' ? 'Chopping sideways' : t.trend === 'up' ? 'Trending up' : 'Trending down'}, ${t.aboveVwap ? 'above' : 'below'} VWAP, MACD ${t.macdRising ? 'rising' : 'falling'}, RSI ${Math.round(t.rsi)}.${t.divergence ? ` There's a ${t.divergence.type} divergence.` : ''}`);
    if (lv) parts.push(`Call wall ${lv.cw ?? 'not set'}, put wall ${lv.pw ?? 'not set'}${lv.zg ? `, gamma flip ${lv.zg}` : ''}.`);
    if (d.chain?.all?.pcVolume != null) parts.push(`Put call volume ratio ${d.chain.all.pcVolume}.`);
    if (d.chain?.unusual?.length) { const u = d.chain.unusual[0]; parts.push(`Biggest unusual print: ${u.strike} ${u.type === 'C' ? 'calls' : 'puts'}, ${fmtMoney(u.premium)} in premium.`); }
    this.say(parts.join(' '));
  }

  // ---------------------------------------------------------------- open questions
  async chat(question) { return this.interpret(question); }
}

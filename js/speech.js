// How INDAI learns the way one person talks.
//   - fixes: words and phrases the recognizer gets wrong for this speaker, and what they really said.
//     Learned when a repeat succeeds after a miss, when the speaker corrects her ("no, I said ..."),
//     when they confirm a guess, and (with the thinking key on) when her brain works out what was meant.
//   - a built-in list of the usual trading mishears (tickers, GEX, VWAP, calls/puts) so day one is not a cold start.
//   - fuzzy matching against the things she can do, so "breef me" still runs "brief me".
// Everything is kept on the device and gets better the more it is used.
const KEY = 'indai.speech.v1';

const TICK = '(spy|qqq|iwm|tsla|tesla|amzn|amazon|msft|microsoft|nvda|nvidia|aapl|apple|meta|googl|google|amd|nflx|netflix)';
const BUILTIN = [
  [/\b(cue cue cue|q q q|kyu kyu kyu|queue queue queue|cu cu cu|triple q|the qs|the cues|q's|cuckoo q|qq q|q qq)\b/gi, 'QQQ'],
  [/\b(s p y|spie|spy's|the spy|espy|s\.p\.y\.?)\b/gi, 'SPY'],
  [/\b(i w m|i double u m|i w n|iw m|i\.w\.m\.?)\b/gi, 'IWM'],
  [/\b(tessla|tesler|tezla|tesla's)\b/gi, 'Tesla'],
  [/\b(g e x|gecks|jex|geks|gex's|g\.e\.x\.?|jacks levels|gecko levels)\b/gi, 'GEX'],
  [/\b(v wap|v-wap|vee wap|v\.w\.a\.p\.?|v w a p|the wap|vwop|v whap|we wap)\b/gi, 'VWAP'],
  [/\b(e m a|e\.m\.a\.?|ema's)\b/gi, 'EMA'],
  [/\b(zero d t e|zero dte|0 d t e|zero day|zero days)\b/gi, '0DTE'],
  [/\b(breathe me|brief may|beef me|breef me|brief mean|brief meet)\b/gi, 'brief me'],
  [/\b(strike prize|strike prise|struck price|strike of price)\b/gi, 'strike price'],
  [/\b(deep die|deep dive in|the dive)\b/gi, 'deep dive'],
  [/\b(re-center|re center|recentre)\b/gi, 'recenter'],
  [/\b(pass through|past through|passed through)\b/gi, 'passthrough'],
  [new RegExp(`\\b${TICK} (cause|cars|coals|calls?'?s|called|cold|colds|cools|calls\\.)(?=\\s|$)`, 'gi'), '$1 calls'],
  [new RegExp(`\\b${TICK} (pots|pulls|puts?'?s|foots|boots|put's|puts\\.)(?=\\s|$)`, 'gi'), '$1 puts'],
];

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9$.% ]+/g, ' ').replace(/\s+/g, ' ').trim();
// a rough "sounds like" key: drop vowels after the first letter of each word, fold look-alike consonants
const sound = (t) => norm(t).split(' ').map(w => w[0] + w.slice(1).replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/[aeiouyhw]/g, '').replace(/(.)\1+/g, '$1').replace(/c/g, 'k').replace(/z/g, 's')).join(' ');
function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const sim = (a, b) => { const m = Math.max(a.length, b.length); return m ? 1 - lev(a, b) / m : 1; };
// 0..1: how alike two phrases are, by letters and by sound
export function similar(a, b) { const x = norm(a), y = norm(b); return Math.max(sim(x, y), 0.94 * sim(sound(x), sound(y))); }

export class SpeechMemory {
  constructor() {
    try { this.d = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { this.d = {}; }
    this.d.fixes ??= {};      // heard phrase -> { to, n, at }
    this.d.used ??= {};       // phrase she understood -> times
    this.d.stats ??= { heard: 0, understood: 0, learned: 0 };
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch {} }
  get count() { return Object.keys(this.d.fixes).length; }
  get stats() { return { ...this.d.stats, fixes: this.count }; }
  list() { return Object.entries(this.d.fixes).map(([heard, f]) => ({ heard, to: f.to, n: f.n })).sort((a, b) => b.n - a.n); }
  forgetAll() { this.d.fixes = {}; this.save(); }

  // Clean up a raw transcript with everything known about this speaker.
  normalize(text) {
    let t = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
    for (const [re, to] of BUILTIN) t = t.replace(re, to);
    // learned fixes, longest phrase first; whole-utterance fixes win outright
    const whole = this.d.fixes[norm(t)];
    if (whole) { whole.n++; whole.at = Date.now(); this.save(); return whole.to; }
    const keys = Object.keys(this.d.fixes).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      if (k.split(' ').length > 4) continue;                       // long ones only apply to the whole utterance
      const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z0-9]|$)`, 'gi');
      if (re.test(t)) { t = t.replace(re, `$1${this.d.fixes[k].to}`); this.d.fixes[k].n++; }
    }
    return t.trim();
  }

  // Remember that `heard` really meant `meant`. Stores the whole phrase and the specific words that differed.
  learn(heard, meant) {
    const h = norm(heard), m = norm(meant);
    if (!h || !m || h === m || h.length > 160) return false;
    const put = (k, to) => { if (!k || k === norm(to)) return; const f = this.d.fixes[k]; this.d.fixes[k] = { to, n: (f && f.to === to ? f.n : 0) + 1, at: Date.now() }; };
    put(h, m);
    // word-level difference: strip the common start and end, keep a short differing middle as a reusable fix
    const a = h.split(' '), b = m.split(' ');
    let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    const ha = a.slice(s, a.length - e).join(' '), mb = b.slice(s, b.length - e).join(' ');
    if (ha && mb && ha.split(' ').length <= 3 && mb.split(' ').length <= 3 && ha.length >= 3 && (s > 0 || e > 0)) put(ha, mb);
    // keep the store small: drop the least used, oldest fixes
    const ks = Object.keys(this.d.fixes);
    if (ks.length > 300) ks.sort((x, y) => (this.d.fixes[x].n - this.d.fixes[y].n) || (this.d.fixes[x].at - this.d.fixes[y].at)).slice(0, ks.length - 300).forEach(k => delete this.d.fixes[k]);
    this.d.stats.learned++; this.save();
    return true;
  }
  heard(understood, phrase) {
    this.d.stats.heard++; if (understood) { this.d.stats.understood++; if (phrase) { const k = norm(phrase); if (k.length < 60) this.d.used[k] = (this.d.used[k] || 0) + 1; } }
    if (this.d.stats.heard % 5 === 0) this.save();
  }
  // Closest thing she knows how to do. Phrases this speaker actually uses get a small edge.
  best(text, candidates) {
    let top = null;
    for (const c of candidates) {
      const sc = similar(text, c) + Math.min(0.04, (this.d.used[norm(c)] || 0) * 0.01);
      if (!top || sc > top.score) top = { phrase: c, score: sc };
    }
    return top;
  }
  // A short description of this speaker's habits, sent to her brain so it can interpret mishears too.
  habits() { return { fixes: this.list().slice(0, 25).map(f => `${f.heard} = ${f.to}`), says: Object.entries(this.d.used).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]) }; }
}

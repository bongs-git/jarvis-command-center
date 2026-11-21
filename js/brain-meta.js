// What the shared code does not keep from INDAI's brain: which brains worked on a rated idea (`brains`, in order)
// and whether a conversational answer was about that idea (`about: "idea"`). This stands in front of relay.brain
// without changing what is sent or returned (the website's demo.js wraps it the same way).
//   app.brainMeta.trade = { at, brains, model }   the last researched verdict
//   app.brainMeta.talk  = { at, about }           the last conversational answer
import { relay } from './relay.js';

export function initBrainMeta(app) {
  const meta = app.brainMeta = { trade: null, talk: null };
  const real = relay.brain.bind(relay);
  relay.brain = async (body, pass) => {
    const res = await real(body, pass);
    try {
      const mode = body && body.mode;
      if (mode === 'trade') meta.trade = { at: Date.now(), brains: Array.isArray(res && res.brains) ? res.brains : null, model: res && res.model };
      else if (mode === 'talk') meta.talk = { at: Date.now(), about: (res && (res.about || (res.result && res.result.about))) || null };
    } catch { /* never in the way of the answer */ }
    return res;
  };
}

const NAME = { perplexity: 'Perplexity', claude: 'Claude', chatgpt: 'ChatGPT' };
const who = (s) => NAME[s && s.brain] || (s && s.brain) || 'A brain';
// One line for who did what on a verdict, and a faint one for what went wrong. Nothing at all for an older server.
export function brainsLine(brains, final) {
  if (!Array.isArray(brains) || !brains.length) return null;
  const by = (role) => brains.find((s) => s && s.role === role);
  const research = by('research'), verdict = by('verdict'), stand = by('stand-in for Claude'), second = by('second opinion');
  const parts = [], trouble = [];
  if (research && research.ok) parts.push(`Research: ${who(research)}`);
  if (stand && stand.ok) parts.push(`Verdict: ${who(stand)} (standing in for ${verdict ? who(verdict) : 'Claude'})`);
  else if (verdict && verdict.ok) parts.push(`Verdict: ${who(verdict)}`);
  const o = final && final.second;
  if (o && o.rag) parts.push(`Second opinion: ${o.by || (second ? who(second) : 'ChatGPT')}, ${String(o.rag).toLowerCase()}, ${o.agrees ? 'agrees' : 'disagrees'}${!o.agrees && o.reason ? ': ' + String(o.reason).replace(/\.$/, '') : ''}`);
  if (research && !research.ok) trouble.push(`${who(research)} did not answer; ${verdict && verdict.ok ? who(verdict) + ' searched itself' : 'the verdict went ahead without it'}`);
  if (verdict && !verdict.ok) trouble.push(`${who(verdict)} did not answer${stand && stand.ok ? `; ${who(stand)} stood in` : ''}`);
  if (stand && !stand.ok) trouble.push(`${who(stand)} could not stand in either`);
  if (second && !second.ok) trouble.push('the second opinion did not come back');
  if (!parts.length && !trouble.length) return null;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  return { line: parts.join(' · '), trouble: trouble.length ? cap(trouble.join('; ')) + '.' : '' };
}

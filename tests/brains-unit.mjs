// PAP-5: the line under a verdict that says which brains worked on it (js/brain-meta.js brainsLine).
import { brainsLine } from '../js/brain-meta.js';
let failed = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : '\n   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want)}`); };
const P = (ok = true) => ({ brain: 'perplexity', role: 'research', model: 'sonar-pro', ok, ms: 4100, ...(ok ? {} : { error: 'timeout' }) });
const Cl = (ok = true) => ({ brain: 'claude', role: 'verdict', model: 'claude-opus-5-5', ok, ms: 22000, ...(ok ? {} : { error: 'overloaded' }) });
const G2 = (ok = true) => ({ brain: 'chatgpt', role: 'second opinion', model: 'gpt-5.5', ok, ms: 9000 });
const GS = (ok = true) => ({ brain: 'chatgpt', role: 'stand-in for Claude', model: 'gpt-5.5', ok, ms: 15000 });
const second = (agrees) => ({ second: { by: 'ChatGPT', model: 'gpt-5.5', rag: agrees ? 'GREEN' : 'AMBER', confidence: 55, reason: 'Fed speaker at two.', risk: 'rates', agrees } });
check('three working brains, second opinion disagrees', brainsLine([P(), Cl(), G2()], { rag: 'GREEN', ...second(false) }),
  { line: 'Research: Perplexity · Verdict: Claude · Second opinion: ChatGPT, amber, disagrees: Fed speaker at two', trouble: '' });
check('three working brains, second opinion agrees', brainsLine([P(), Cl(), G2()], { rag: 'GREEN', ...second(true) }),
  { line: 'Research: Perplexity · Verdict: Claude · Second opinion: ChatGPT, green, agrees', trouble: '' });
check('Perplexity failed: Claude searched itself', brainsLine([P(false), Cl(), G2()], { rag: 'GREEN', ...second(true) }),
  { line: 'Verdict: Claude · Second opinion: ChatGPT, green, agrees', trouble: 'Perplexity did not answer; Claude searched itself.' });
check('ChatGPT stood in for Claude', brainsLine([P(), Cl(false), GS()], { rag: 'AMBER' }),
  { line: 'Research: Perplexity · Verdict: ChatGPT (standing in for Claude)', trouble: 'Claude did not answer; ChatGPT stood in.' });
check('an older server (no brains): nothing new is shown', brainsLine(undefined, { rag: 'GREEN' }), null);
check('only Claude (no other keys set)', brainsLine([Cl()], { rag: 'GREEN' }), { line: 'Verdict: Claude', trouble: '' });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

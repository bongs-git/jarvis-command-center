// Atlas engine checks: the formula desk against the atlas's own worked examples (pp. 070-079, 117),
// and, when atlas_kb.json is available, the printed ledger, matrix, sentiment, MACD and bracket tables.
// Run: node atlas/engine_test.mjs            (looks for atlas/atlas_kb.json)
//      ATLAS_KB=/path/to/atlas_kb.json node atlas/engine_test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createAtlas from './index.mjs';

const f = createAtlas.f;
let fails = 0, passes = 0;
const near = (x, y, tol, label) => { const ok = Math.abs(x - y) <= tol; ok ? passes++ : fails++; if (!ok) console.log('FAIL', label, x, 'expected', y); };

const g = f.bsm({ S: 100, K: 100, T: 30 / 365, r: 0.04, q: 0, sigma: 0.2 });
near(g.call, 2.45, 0.01, 'BSM call'); near(g.deltaCall, 0.53, 0.01, 'delta'); near(g.gamma, 0.069, 0.001, 'gamma');
near(g.thetaCall, -0.044, 0.002, 'theta per day'); near(g.vega, 0.114, 0.002, 'vega per vol point'); near(g.lambdaCall, 21.6, 0.3, 'elasticity');
near(f.impliedVol({ price: g.call, S: 100, K: 100, T: 30 / 365, r: 0.04 }), 0.2, 1e-4, 'implied vol');
near(f.pnlApprox({ delta: 0, gamma: g.gamma, dS: 1 }), 0.035, 0.002, 'gamma P&L term');
near(f.expectancy(0.4, 3, 1), 0.6, 1e-9, 'expectancy'); near(f.breakEven(2, 1, 0.1), 0.3667, 0.001, 'break-even');
near(f.omega([0.04, -0.02, 0.01]), 2.5, 1e-9, 'Omega');
const s = f.sharesForRisk({ riskBudget: 70, entry: 50, stop: 48.5, costPerShare: 0.1 });
near(s.shares, 43, 0, 'shares'); near(s.plannedLoss, 68.8, 1e-9, 'planned loss'); near(s.notional, 2150, 0, 'notional');
near(f.gapStress({ shares: 43, entry: 50, gapExit: 46, costPerShare: 0.1 }), 176.3, 1e-9, 'gap stress');
near(f.futuresContracts({ riskBudget: 500, stopPoints: 5, pointValue: 50 }), 2, 0, 'futures');
near(f.futuresContracts({ riskBudget: 500, stopPoints: 5, pointValue: 50, costPerContract: 10 }), 1, 0, 'futures + cost');
near(f.vixDailyMove(5000, 20), 63, 0.1, 'VIX one-day scale'); near(f.recoveryNeeded(-0.5), 1, 1e-9, 'recovery');
near(f.vwap([10, 10, 13], [1, 1, 1]), 11, 1e-9, 'VWAP'); near(f.bayes(21 / 60, 0.6, 0.3), 0.7, 1e-9, 'Bayes');
near(f.permutations(3, 2), 6, 0, 'P(3,2)'); near(f.permutations(3, 2, true), 9, 0, '3^2'); near(f.combinations(3, 2), 3, 0, 'C(3,2)');
near(f.netReturn(100, 102), 0.019, 1e-9, 'net return'); near(f.trueRange(15, 13, 10), 5, 0, 'true range');
const c = f.candle({ O: 10, H: 14, L: 8, C: 13 }); near(c.body + c.upper * 10 + c.lower * 100, 213, 0, 'candle parts');

const here = fileURLToPath(new URL('.', import.meta.url));
const kbPath = process.env.ATLAS_KB || here + 'atlas_kb.json';
if (existsSync(kbPath)) {
  const a = createAtlas(JSON.parse(readFileSync(kbPath, 'utf8')));
  const L = (rule, o = {}) => a.lookup({ rule, ...o });
  const h = L('hammer'); near(h.pooled.later.win, 0.553, 0.001, 'hammer win'); near(h.pooled.later.lift, 0.0192, 0.0002, 'hammer lift');
  near(h.pooled.later.ci[0], -0.026, 0.001, 'hammer interval');
  near(L('bull flag').pooled.later.lift, -0.0086, 0.0001, 'bull flag lift'); near(L('bull flag').bracket.win_rate, 0.42, 0.001, 'bull flag bracket');
  near(L('harami').pooled.later.ci[1], -0.0012, 0.0005, 'harami interval below zero');
  const tc = L('two crows', { trend: 'above', vol: 'low', horizon: 5 }); near(tc.cell.later.win, 0.437, 0.001, 'two crows cell'); near(tc.cell.later.n, 103, 0, 'two crows n');
  const hb = L('hammer', { trend: 'below', vol: 'high', horizon: 5 }); near(hb.cell.later.n, 1101, 0, 'hammer cell n'); if (hb.cellGrade !== 'RED') { fails++; console.log('FAIL hammer below/high grade', hb.cellGrade); } else passes++;
  const sv = a.sentimentLookup({ vix: 30, sequence: 'Three lower closes' })[0]; near(sv.win_rate, 0.589, 0.001, 'VIX>=25 three lower closes');
  near(a.kb.macd.find((m) => m.rule === 'Regular bull' && m.era === 'later').lift, 0.0198, 0.0001, 'MACD regular bull');
  const cmb = a.combine(['doji', 'long-legged doji', 'rickshaw man', 'hammer']); near(cmb.independentSignals, 2, 0, 'overlap collapses');
  near(a.enumerate().length, 2525, 0, 'tested permutations');
  if (a.read({ rule: 'gravestone doji' }).lookup.side !== 'long') { fails++; console.log('FAIL gravestone side'); } else passes++;
} else console.log(`(skipped ${kbPath}: knowledge base not present; formula checks only)`);

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

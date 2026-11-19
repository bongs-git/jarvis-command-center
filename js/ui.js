// 2D overlay: headset entry, settings drawer, options calculator, install prompt.
import { VOICES } from './voice.js';
import { relay } from './relay.js';
import { pnlGrid, positionSummary, positionPnl, expiryCloseMs } from './options.js';
import { levelSourceLabel } from './panels.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => v == null || !isFinite(v) ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const px = (v) => v == null || !isFinite(v) ? '—' : v >= 1000 ? v.toFixed(1) : v.toFixed(2);

export function initUI(app) {
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); };
  app.toast = toast;
  const cap = $('caption');
  app.caption = (text, kind = 'info') => {
    cap.innerHTML = `<b>INDAI</b> ${esc(text)}`; cap.className = 'show ' + kind;
    clearTimeout(cap._h); cap._h = setTimeout(() => cap.classList.remove('show'), Math.min(16000, 4000 + text.length * 45));
  };
  cap.addEventListener('click', () => cap.classList.remove('show'));

  // ---- headset entry
  const btnAR = $('btn-ar'), btnVR = $('btn-vr'), hint = $('xr-hint');
  const check = async (mode) => { try { return navigator.xr ? await navigator.xr.isSessionSupported(mode) : false; } catch { return false; } };
  Promise.all([check('immersive-ar'), check('immersive-vr')]).then(([ar, vr]) => { btnAR.hidden = !ar; btnVR.hidden = !vr; hint.hidden = ar || vr; });
  const isWindowApp = new URLSearchParams(location.search).get('app') === 'window';
  if (isWindowApp) document.body.classList.add('window-app');
  const enter = (mode, onFail) => async () => {
    app.indai.voice.unlock();
    if (!app.indai.muted) app.indai.voice.preload({ tts: true });
    const mic = await app.primeMic();
    try { await app.enterXR(mode); }
    catch (e) {
      if (mic === 'granted-now') toast('Microphone allowed. Tap again to enter.');
      else if (isWindowApp) toast('INDAI Window stays a window in your home. Open the INDAI app for mixed reality and scenes.');
      else toast('Could not start: ' + (e.message || e));
      onFail && onFail();
    }
  };
  btnAR.addEventListener('click', enter('ar'));
  btnVR.addEventListener('click', enter('vr'));

  // Installed Quest app (?app=quest): go straight into mixed reality, with a big start button as fallback.
  const isQuestApp = new URLSearchParams(location.search).get('app') === 'quest';
  const launch = $('launch');
  if (isQuestApp) {
    $('launch-btn').addEventListener('click', async () => {
      launch.hidden = true;
      await enter('ar', () => { launch.hidden = false; })();
    });
    app.onXREnd = () => { launch.hidden = false; };
    setTimeout(async () => { try { await app.enterXR('ar'); } catch { launch.hidden = false; } }, 400);
  }

  // ---- settings drawer
  const drawer = $('settings');
  const f = (id) => $(id);
  const vname = $('s-vname');
  $('s-scene').innerHTML = app.scenes.map(sc => `<option value="${sc.id}">${esc(sc.name)} · ${esc(sc.note)}</option>`).join('');
  vname.innerHTML = VOICES.map(v => `<option value="${v.id}">${esc(v.label)}</option>`).join('');
  function fill() {
    const s = app.settings;
    f('s-name').value = s.name; f('s-symbols').value = s.symbols.join(', ');
    f('s-mode').value = s.dataMode === 'demo' ? 'demo' : 'auto';
    f('s-fh').value = s.finnhubKey; f('s-levels').value = s.levelsText;
    f('s-account').value = s.risk.account; f('s-maxloss').value = s.risk.maxDailyLoss; f('s-riskpct').value = s.risk.riskPct;
    f('s-stoppct').value = s.risk.stopPct; f('s-consec').value = s.risk.maxConsecLosses; f('s-cool').value = s.risk.cooldownMin;
    f('s-scene').value = s.scene || 'passthrough';
    f('s-gestures').value = s.gestures || 'normal'; f('s-handsfree').value = s.handsFree === false ? 'off' : 'on';
    f('s-voice').checked = s.voice; f('s-vengine').value = s.voiceEngine; vname.value = s.voiceName; f('s-vspeed').value = s.voiceSpeed; f('s-mic').value = s.micEngine;
    f('s-depth').value = s.researchDepth; f('s-rate').value = +(s.rate * 100).toFixed(2); f('s-pass').value = s.researchPass;
    f('s-a-levels').checked = s.alerts.levels; f('s-a-hod').checked = s.alerts.hod; f('s-a-bells').checked = s.alerts.bells; f('s-a-tv').checked = s.alerts.tradingview !== false;
    updateLevelsPreview(); updateStatus();
  }
  function updateLevelsPreview() {
    const lines = f('s-levels').value.split(/\n|;/).map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(l => { const m = l.match(/^\$?([A-Za-z.]{1,6})/); return m ? m[1].toUpperCase() : null; }).filter(Boolean);
    $('levels-preview').textContent = parsed.length ? `Overriding: ${[...new Set(parsed)].join(', ')}` : '';
  }
  function updateStatus() {
    const s = app.settings;
    $('gex-status').innerHTML = s.symbols.map(sym => {
      const lv = app.levelsFor(sym);
      if (!lv) return `${sym}: <span class="warn">loading…</span>`;
      const cls = lv.source === 'morning' || lv.source === 'live' || lv.source === 'manual' ? 'ok' : 'warn';
      return `${sym}: CW ${lv.cw ?? '—'}  PW ${lv.pw ?? '—'}  ZG ${lv.zg ?? '—'}  <span class="${cls}">${esc(levelSourceLabel(lv).replace('Levels: ', ''))}</span>`;
    }).join('\n');
    const vs = app.indai.voice.state;
    const vparts = [];
    vparts.push(vs.ttsReady ? '<span class="ok">Voice ready</span>' : vs.ttsLoad != null ? `<span class="warn">Voice downloading ${vs.ttsLoad}%</span>` : 'Voice downloads the first time it speaks (about 90 MB, then cached)');
    vparts.push(vs.sttReady ? `<span class="ok">Listening ready (${esc(vs.sttModel || 'on-device')})</span>` : vs.sttLoad != null ? `<span class="warn">Listening model ${vs.sttLoad}%</span>` : app.indai.voice.SR && !/OculusBrowser|Quest/i.test(navigator.userAgent) ? 'Listening uses the browser recognizer here' : 'Listening model downloads the first time you talk (about 40 MB)');
    if (vs.error) vparts.push(`<span class="bad">${esc(vs.error)}</span>`);
    $('voice-status').innerHTML = vparts.join('\n');
    const tv = app.tvAlerts || [];
    const br = app.feed.status.tvAt;
    const bridgeLine = br ? (app.feed.bridgeLive ? `<span class="ok">Bridge live</span>: last candle ${new Date(br).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : `<span class="warn">Bridge quiet</span> since ${new Date(br).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`) : 'Bridge: not connected yet (add the INDAI Bridge indicator and its alert).';
    $('tv-status').innerHTML = bridgeLine + '\n' + (tv.length ? `<span class="ok">Connected</span>: ${tv.length} alert${tv.length === 1 ? '' : 's'} in the last two days. Latest: ${esc(tv[0].text.slice(0, 120))}` : 'Alerts: none received yet (optional).');
    const b = app.indai.brain;
    $('research-status').innerHTML = !b.checked ? 'Checking…' : b.configured ? `<span class="ok">Research is on</span>${b.passcode ? ' (passcode required)' : ''}` : '<span class="warn">Research is off.</span> It turns on once the Anthropic API key is saved in the INDAI backend (see the setup note). Until then INDAI rates trades from the market data alone.';
  }
  f('s-levels').addEventListener('input', updateLevelsPreview);
  f('s-vspeed').addEventListener('input', () => { $('s-vspeed-v').textContent = `${(+f('s-vspeed').value).toFixed(2)}×`; });
  const num = (el, def, min, max) => { const v = parseFloat(el.value); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
  let statusTimer = null;
  app.openSettings = () => { fill(); $('s-vspeed-v').textContent = `${(+f('s-vspeed').value).toFixed(2)}×`; drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); clearInterval(statusTimer); statusTimer = setInterval(updateStatus, 1500); };
  const close = () => { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); clearInterval(statusTimer); };
  $('btn-settings').addEventListener('click', app.openSettings);
  $('s-close').addEventListener('click', close);
  const readVoice = () => { const s = app.settings; s.voiceEngine = f('s-vengine').value; s.voiceName = vname.value; s.voiceSpeed = +f('s-vspeed').value; s.micEngine = f('s-mic').value; };
  $('s-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const s = app.settings;
    const prev = { f: s.finnhubKey, syms: s.symbols.join(','), mode: s.dataMode };
    s.name = f('s-name').value.trim().slice(0, 24) || 'Trader';
    const syms = f('s-symbols').value.split(/[\s,]+/).map(x => x.trim().toUpperCase().replace(/[^A-Z.]/g, '')).filter(Boolean);
    s.symbols = [...new Set(syms)].slice(0, 12);
    if (!s.symbols.length) s.symbols = ['SPY', 'QQQ', 'IWM'];
    if (!s.symbols.includes(s.main)) s.main = s.symbols[0];
    s.dataMode = f('s-mode').value;
    s.finnhubKey = f('s-fh').value.trim();
    s.levelsText = f('s-levels').value;
    const r = s.risk;
    r.account = num(f('s-account'), r.account, 100, 1e8);
    r.maxDailyLoss = num(f('s-maxloss'), r.maxDailyLoss, 10, 1e7);
    r.riskPct = num(f('s-riskpct'), r.riskPct, 0.1, 100);
    r.stopPct = num(f('s-stoppct'), r.stopPct, 5, 100);
    r.maxConsecLosses = Math.round(num(f('s-consec'), r.maxConsecLosses, 1, 10));
    r.cooldownMin = Math.round(num(f('s-cool'), r.cooldownMin, 1, 240));
    s.voice = f('s-voice').checked; readVoice();
    if (f('s-scene').value !== s.scene) app.setScene(f('s-scene').value, { announce: false });
    if (f('s-gestures').value !== (s.gestures || 'normal')) app.setGestures(f('s-gestures').value, { announce: false });
    s.handsFree = f('s-handsfree').value !== 'off';
    s.researchDepth = f('s-depth').value; s.rate = num(f('s-rate'), s.rate * 100, 0, 15) / 100; s.researchPass = f('s-pass').value.trim();
    s.alerts.levels = f('s-a-levels').checked; s.alerts.hod = f('s-a-hod').checked; s.alerts.bells = f('s-a-bells').checked; s.alerts.tradingview = f('s-a-tv').checked;
    app.applySettings(prev);
    close();
    toast('Saved');
  });
  $('s-reset-layout').addEventListener('click', () => { app.resetLayout(); toast('Screens moved back to the default layout'); });
  const resetDay = $('s-reset-day');
  resetDay.addEventListener('click', () => {
    if (resetDay.dataset.armed) { app.resetDay(); resetDay.textContent = "Reset today's P&L"; delete resetDay.dataset.armed; toast("Today's P&L reset"); return; }
    resetDay.dataset.armed = '1'; resetDay.textContent = 'Tap again to confirm';
    setTimeout(() => { resetDay.textContent = "Reset today's P&L"; delete resetDay.dataset.armed; }, 4000);
  });
  $('s-test-voice').addEventListener('click', () => {
    readVoice();
    app.indai.voice.unlock(); app.indai.voice.stopSpeaking();
    app.indai.voice.speak(`Hi ${f('s-name').value || app.settings.name}, I'm INDAI. Ready when you are.`);
    if (app.settings.voiceEngine === 'neural' && !app.indai.voice.state.ttsReady) toast('Loading the voice. The first time takes a moment.');
  });
  $('s-dl-voice').addEventListener('click', () => { readVoice(); app.indai.voice.unlock(); app.indai.voice.preload({ tts: true, stt: true }); toast('Downloading INDAI\'s voice and listening model'); updateStatus(); });
  $('s-mic-test').addEventListener('click', async () => { const r = await app.primeMic(); toast(r === 'denied' ? 'Microphone is blocked for this site. Allow it in the browser settings.' : r === 'unavailable' ? 'This browser has no microphone access.' : 'Microphone allowed'); });
  $('s-fh-show').addEventListener('click', (e) => { const el = $('s-fh'); el.type = el.type === 'password' ? 'text' : 'password'; e.target.textContent = el.type === 'password' ? 'Show' : 'Hide'; });

  $('btn-tv').addEventListener('click', () => app.openTradingView());

  // ---- self-test results (2D)
  const tm = $('test-modal');
  const closeTest = () => { tm.classList.remove('open'); tm.setAttribute('aria-hidden', 'true'); };
  app.onSelfTest = (results, done) => {
    if (app.inXR) return;
    tm.classList.add('open'); tm.setAttribute('aria-hidden', 'false');
    const icon = { pass: '✓', warn: '•', fail: '✗' };
    $('t-list').innerHTML = results.map(r => `<div class="tline"><div class="ic ${r.status}">${icon[r.status]}</div><div><b>${esc(r.name)}</b><span>${esc(r.detail)}</span></div></div>`).join('');
    const fails = results.filter(r => r.status === 'fail').length, waits = results.filter(r => r.status === 'warn').length;
    $('t-sub').textContent = done ? `${results.length - fails - waits} of ${results.length} passed${fails ? ` · ${fails} to fix` : ''}${waits ? ` · ${waits} waiting` : ''}. Amber items are normal before the open or on first launch.` : 'Checking every part of INDAI…';
  };
  $('btn-test').addEventListener('click', () => { app.indai.voice.unlock(); app.indai.selfTest(); });
  $('s-selftest').addEventListener('click', () => { close(); app.indai.voice.unlock(); app.indai.selfTest(); });
  $('t-close').addEventListener('click', closeTest);
  tm.addEventListener('click', (e) => { if (e.target === tm) closeTest(); });
  $('t-again').addEventListener('click', () => app.indai.selfTest());
  $('t-practice').addEventListener('click', () => { app.indai.voice.unlock(); app.practiceAlert(); });
  $('t-plan').addEventListener('click', () => { closeTest(); app.indai.startDay({ voice: false }); });

  // ---- options profit calculator (2D)
  initCalc(app, toast);

  // ---- install (PWA)
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('btn-install').hidden = false; });
  $('btn-install').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $('btn-install').hidden = true; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // The service worker switches on multi-core voice processing. The first time it takes over, reload once (only during start-up).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      let done = false; try { done = !!sessionStorage.getItem('indai.coi'); } catch { done = true; }
      if (!self.crossOriginIsolated && !done && !app.inXR && performance.now() < 20000) { try { sessionStorage.setItem('indai.coi', '1'); } catch {} location.reload(); }
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const qp = new URLSearchParams(location.search);
  if (qp.get('settings') === '1') app.openSettings();
  if (qp.get('calc') === '1') app.openCalc();
  if (qp.get('selftest') === '1') setTimeout(() => app.indai.selfTest(), 5000);
}

// ---------------------------------------------------------------- calculator modal
function initCalc(app, toast) {
  const modal = $('calc-modal');
  let unit = 'usd';
  const r = () => app.settings.rate ?? 0.04;
  const spotOf = (c) => app.feed.quote(c.sym)?.last ?? c.spot;
  const stepOf = (c) => {
    const ks = c.strikes || [];
    const near = ks.filter(k => Math.abs(k - spotOf(c)) / spotOf(c) < 0.05);
    let d = Infinity; for (let i = 1; i < near.length; i++) d = Math.min(d, near[i] - near[i - 1]);
    return isFinite(d) && d > 0 ? d : app.strikeStep(c.sym, spotOf(c));
  };
  const snap = (c, v) => { const ks = c.strikes; if (!ks || !ks.length) { const st = stepOf(c); return Math.round(v / st) * st; } return ks.reduce((b, k) => Math.abs(k - v) < Math.abs(b - v) ? k : b, ks[0]); };

  function open() {
    const c = app.ensureCalc();
    $('c-sym').value = c.sym;
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
    renderAll();
    if (!c.strikes) app.calcFromChain({ quiet: true });
  }
  const close = () => { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); };
  app.openCalcModal = open;
  $('btn-calc').addEventListener('click', open);
  $('c-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  $('c-xr').addEventListener('click', () => { close(); app.openFocus('calc'); });
  app.onCalcChange = () => { if (!modal.classList.contains('open')) return; if (!$('c-legs').contains(document.activeElement)) renderLegs(); renderExp(); renderOut(); };

  $('c-load').addEventListener('click', () => loadSym());
  $('c-sym').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadSym(); } });
  function loadSym() {
    const sym = $('c-sym').value.trim().toUpperCase().replace(/[^A-Z.]/g, '');
    if (!sym) return;
    app.calc = null; app.ensureCalc(sym);
    $('c-strat').value = 'long-call';
    renderAll();
  }
  $('c-exp').addEventListener('change', () => { const c = app.calc; for (const l of c.legs) l.expiry = $('c-exp').value; app.calcFromChain({ quiet: true }); renderOut(); });
  $('c-strat').addEventListener('change', () => applyStrategy($('c-strat').value));
  $('c-add').addEventListener('click', () => { const c = app.calc; const base = c.legs[c.legs.length - 1] || { type: 'C', side: 1, strike: snap(c, spotOf(c)), qty: 1, entry: 1, iv: 0.2, expiry: $('c-exp').value }; c.legs.push({ ...base }); $('c-strat').value = 'custom'; renderAll(); app.calcFromChain({ quiet: true }); });
  $('c-fill').addEventListener('click', () => app.calcFromChain());
  for (const b of $('c-unit').querySelectorAll('button')) b.addEventListener('click', () => { unit = b.dataset.u; $('c-unit').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderOut(); });

  function applyStrategy(kind) {
    const c = app.calc; if (!c || kind === 'custom') return;
    const S = spotOf(c), k0 = snap(c, S), st = stepOf(c), w = st * Math.max(1, Math.round(S * 0.0075 / st)), exp = $('c-exp').value || c.legs[0]?.expiry;
    const iv = c.legs[0]?.iv || 0.2, q = 1;
    const L = (side, type, strike) => ({ side, type, strike: snap(c, strike), qty: q, entry: 1, iv, expiry: exp });
    const map = {
      'long-call': [L(1, 'C', k0)], 'long-put': [L(1, 'P', k0)],
      'bull-call': [L(1, 'C', k0), L(-1, 'C', k0 + w)], 'bear-put': [L(1, 'P', k0), L(-1, 'P', k0 - w)],
      'bull-put': [L(-1, 'P', k0 - w), L(1, 'P', k0 - 2 * w)], 'bear-call': [L(-1, 'C', k0 + w), L(1, 'C', k0 + 2 * w)],
      straddle: [L(1, 'C', k0), L(1, 'P', k0)], strangle: [L(1, 'C', k0 + w), L(1, 'P', k0 - w)],
      condor: [L(-1, 'P', k0 - w), L(1, 'P', k0 - 2 * w), L(-1, 'C', k0 + w), L(1, 'C', k0 + 2 * w)],
    };
    c.legs = map[kind];
    c.legs.forEach(l => app.calcReprice(l));
    renderAll();
    app.calcFromChain({ quiet: true });
  }

  function renderAll() { renderExp(); renderLegs(); renderOut(); }
  function renderExp() {
    const c = app.calc; const sel = $('c-exp');
    const exps = c.expirations && c.expirations.length ? c.expirations.slice(0, 30) : [...new Set(c.legs.map(l => l.expiry))];
    const cur = c.legs[0]?.expiry;
    if (!exps.includes(cur)) exps.unshift(cur);
    const html = exps.map(e => `<option value="${e}">${expLabel(e)}</option>`).join('');
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = cur;
    $('c-spot').textContent = `${px(spotOf(c))}`;
    $('c-note').textContent = c.loading ? 'Loading the chain…' : c.strikes ? 'Prices from the CBOE chain (delayed ~15 min)' : 'Model prices (chain not loaded)';
  }
  function renderLegs() {
    const c = app.calc;
    $('c-legs').innerHTML = c.legs.map((l, i) => `<tr data-i="${i}">
      <td><select data-k="side"><option value="1"${l.side > 0 ? ' selected' : ''}>Buy</option><option value="-1"${l.side < 0 ? ' selected' : ''}>Sell</option></select></td>
      <td><select data-k="type"><option value="C"${l.type === 'C' ? ' selected' : ''}>Call</option><option value="P"${l.type === 'P' ? ' selected' : ''}>Put</option></select></td>
      <td><input data-k="strike" type="number" step="0.5" value="${l.strike}"></td>
      <td><input data-k="qty" type="number" min="1" step="1" value="${l.qty}"></td>
      <td><input data-k="entry" type="number" min="0" step="0.01" value="${(+l.entry).toFixed(2)}"></td>
      <td><input data-k="iv" type="number" min="1" step="0.5" value="${(l.iv * 100).toFixed(1)}"></td>
      <td>${c.legs.length > 1 ? '<button type="button" class="small" data-del="1">Remove</button>' : ''}</td></tr>`).join('');
  }
  $('c-legs').addEventListener('change', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const c = app.calc, leg = c.legs[+tr.dataset.i], k = e.target.dataset.k, v = e.target.value;
    if (k === 'side') leg.side = +v; else if (k === 'type') leg.type = v; else if (k === 'strike') leg.strike = +v; else if (k === 'qty') leg.qty = Math.max(1, Math.round(+v || 1));
    else if (k === 'entry') leg.entry = Math.max(0, +v || 0); else if (k === 'iv') leg.iv = Math.max(0.01, (+v || 20) / 100);
    $('c-strat').value = 'custom';
    if (k === 'type' || k === 'strike') { app.calcReprice(leg); renderLegs(); app.calcFromChain({ quiet: true }); }
    app.markDirty('calc'); renderOut();
  });
  $('c-legs').addEventListener('click', (e) => {
    if (!e.target.dataset.del) return;
    const tr = e.target.closest('tr'); app.calc.legs.splice(+tr.dataset.i, 1); $('c-strat').value = 'custom'; renderLegs(); renderOut(); app.markDirty('calc');
  });

  function renderOut() {
    const c = app.calc; if (!c || !c.legs.length) return;
    const S = spotOf(c), rr = r();
    const sum = positionSummary(c.legs, S, rr);
    const grid = pnlGrid(c.legs, S, rr, { rows: 17, maxCols: 9 });
    if (!sum || !grid) return;
    const cost = sum.netDebit;
    const stats = [
      [cost >= 0 ? 'Cost (debit)' : 'Credit received', money(Math.abs(cost))],
      ['Max profit', sum.unlimitedProfit ? 'Unlimited' : money(sum.maxProfit)],
      ['Max loss', sum.unlimitedLoss ? 'Unlimited' : money(sum.maxLoss)],
      ['Breakeven at expiry', sum.breakevens.map(px).join(' / ') || '—'],
      ['Chance of profit', `${Math.round(sum.pop * 100)}%`],
      ['Delta (shares)', sum.greeks.delta.toFixed(0)],
      ['Theta per day', money(sum.greeks.theta)],
      ['Expected move', `±${grid.expectedMove.toFixed(2)}`],
    ];
    $('c-stats').innerHTML = stats.map(([l, v]) => `<div class="stat"><small>${l}</small><b>${esc(v)}</b></div>`).join('');
    // heat map
    const max = Math.max(1, ...grid.grid.flat().map(Math.abs));
    const base = Math.abs(cost) || 1;
    const cell = (v) => unit === 'pct' ? `${v >= 0 ? '+' : '−'}${Math.abs(v / base * 100).toFixed(0)}%` : `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    let html = '<table><thead><tr><th style="text-align:left">Price</th>' + grid.cols.map(c2 => `<th>${esc(c2.label)}</th>`).join('') + '</tr></thead><tbody>';
    grid.prices.forEach((p, i) => {
      const isSpot = Math.abs(p - S) <= grid.step / 2;
      html += `<tr class="${isSpot ? 'spotrow' : ''}"><td class="px">${px(p)}${isSpot ? ' ●' : ''}</td>` + grid.grid[i].map(v => {
        const t = Math.min(1, Math.abs(v) / max), a = (0.08 + 0.6 * t).toFixed(2);
        return `<td style="background:${v >= 0 ? `rgba(52,211,153,${a})` : `rgba(248,113,113,${a})`}">${cell(v)}</td>`;
      }).join('') + '</tr>';
    });
    $('c-heat').innerHTML = html + '</tbody></table>';
    drawPayoff(c, S, rr, grid);
  }
  function drawPayoff(c, S, rr, grid) {
    const cv = $('c-payoff'), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 1000, H = cv.clientHeight || 240;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const lo = Math.min(...grid.prices), hi = Math.max(...grid.prices);
    const exp = c.legs.map(l => l.expiry).sort()[0];
    const atExp = expiryCloseMs(exp), now = Date.now();
    const N = 160, xs = [...Array(N + 1)].map((_, i) => lo + (hi - lo) * i / N);
    const e = xs.map(x => positionPnl(c.legs, x, atExp, rr)), t = xs.map(x => positionPnl(c.legs, x, now, rr));
    const ymin = Math.min(0, ...e, ...t), ymax = Math.max(0, ...e, ...t), pad = (ymax - ymin) * 0.1 || 10;
    const X = (v) => 50 + (v - lo) / (hi - lo) * (W - 70), Y = (v) => 16 + (1 - (v - ymin + pad) / (ymax - ymin + 2 * pad)) * (H - 40);
    ctx.font = '12px Geist Mono, monospace'; ctx.fillStyle = '#66758a';
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const v = ymin - pad + (ymax - ymin + 2 * pad) * k / 4; ctx.beginPath(); ctx.moveTo(50, Y(v)); ctx.lineTo(W - 20, Y(v)); ctx.stroke(); ctx.fillText(money(v), 4, Y(v) + 4); }
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; ctx.fillText(px(v), X(v) - 18, H - 6); }
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.moveTo(50, Y(0)); ctx.lineTo(W - 20, Y(0)); ctx.stroke();
    ctx.setLineDash([4, 5]); ctx.strokeStyle = '#5ad1ff'; ctx.beginPath(); ctx.moveTo(X(S), 10); ctx.lineTo(X(S), H - 24); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#5ad1ff'; ctx.fillText(`now ${px(S)}`, X(S) + 5, 22);
    // fill at expiry
    for (let i = 0; i < N; i++) { ctx.fillStyle = e[i] >= 0 ? 'rgba(52,211,153,.18)' : 'rgba(248,113,113,.18)'; ctx.beginPath(); ctx.moveTo(X(xs[i]), Y(0)); ctx.lineTo(X(xs[i]), Y(e[i])); ctx.lineTo(X(xs[i + 1]), Y(e[i + 1])); ctx.lineTo(X(xs[i + 1]), Y(0)); ctx.fill(); }
    const line = (arr, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); arr.forEach((v, i) => i ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v))); ctx.stroke(); };
    line(e, '#eef4fb', 2.2); line(t, '#f0c674', 2);
    ctx.font = '12px Geist, sans-serif'; ctx.fillStyle = '#eef4fb'; ctx.fillText('— at expiry', W - 190, 22); ctx.fillStyle = '#f0c674'; ctx.fillText('— now', W - 100, 22);
  }
}
function expLabel(exp) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const d = new Date(exp + 'T12:00:00Z');
  const days = Math.round((Date.parse(exp + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${days === 0 ? '0DTE' : days + 'd'}`;
}

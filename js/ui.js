// 2D overlay: XR entry buttons, settings drawer, install prompt.
export function initUI(app) {
  const $ = (id) => document.getElementById(id);
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); };

  // ---- headset entry
  const btnAR = $('btn-ar'), btnVR = $('btn-vr'), hint = $('xr-hint');
  const check = async (mode) => { try { return navigator.xr ? await navigator.xr.isSessionSupported(mode) : false; } catch { return false; } };
  Promise.all([check('immersive-ar'), check('immersive-vr')]).then(([ar, vr]) => {
    btnAR.hidden = !ar; btnVR.hidden = !vr;
    hint.hidden = ar || vr;
  });
  const enter = (mode) => async () => {
    // speaking inside the click primes audio so Jarvis can talk in the headset
    try { if (!app.jarvis.muted && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch {}
    try { await app.enterXR(mode); } catch (e) { toast('Could not start: ' + (e.message || e)); }
  };
  btnAR.addEventListener('click', enter('ar'));
  btnVR.addEventListener('click', enter('vr'));

  // Installed Quest app (?app=quest): go straight into mixed reality, with a big start button as fallback.
  const isQuestApp = new URLSearchParams(location.search).get('app') === 'quest';
  const launch = $('launch');
  if (isQuestApp) {
    const start = async () => {
      launch.hidden = true;
      try { await app.enterXR('ar'); }
      catch { try { await app.enterXR('vr'); } catch { launch.hidden = false; } }
    };
    $('launch-btn').addEventListener('click', start);
    app.onXREnd = () => { launch.hidden = false; };
    setTimeout(start, 400);
  }

  // ---- settings drawer
  const drawer = $('settings');
  const fields = {
    name: $('s-name'), symbols: $('s-symbols'), fh: $('s-fh'), td: $('s-td'), levels: $('s-levels'),
    account: $('s-account'), maxloss: $('s-maxloss'), riskpct: $('s-riskpct'), stoppct: $('s-stoppct'), consec: $('s-consec'), cool: $('s-cool'),
    voice: $('s-voice'), aLevels: $('s-a-levels'), aHod: $('s-a-hod'), aBells: $('s-a-bells'),
  };
  function fill() {
    const s = app.settings;
    fields.name.value = s.name; fields.symbols.value = s.symbols.join(', ');
    fields.fh.value = s.finnhubKey; fields.td.value = s.twelveKey; fields.levels.value = s.levelsText;
    fields.account.value = s.risk.account; fields.maxloss.value = s.risk.maxDailyLoss; fields.riskpct.value = s.risk.riskPct;
    fields.stoppct.value = s.risk.stopPct; fields.consec.value = s.risk.maxConsecLosses; fields.cool.value = s.risk.cooldownMin;
    fields.voice.checked = s.voice; fields.aLevels.checked = s.alerts.levels; fields.aHod.checked = s.alerts.hod; fields.aBells.checked = s.alerts.bells;
    updateLevelsPreview();
  }
  function updateLevelsPreview() {
    const txt = fields.levels.value;
    const lines = txt.split(/\n|;/).map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(l => { const m = l.match(/^\$?([A-Za-z.]{1,6})/); return m ? m[1].toUpperCase() : null; }).filter(Boolean);
    $('levels-preview').textContent = parsed.length ? `Read levels for: ${[...new Set(parsed)].join(', ')}` : 'Format: TICKER CW <call wall> PW <put wall> ZG <zero gamma>';
  }
  fields.levels.addEventListener('input', updateLevelsPreview);
  const num = (el, def, min, max) => { const v = parseFloat(el.value); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
  app.openSettings = () => { fill(); drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); };
  const close = () => { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); };
  $('btn-settings').addEventListener('click', app.openSettings);
  $('s-close').addEventListener('click', close);
  $('s-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const s = app.settings;
    const prevKeys = { f: s.finnhubKey, t: s.twelveKey, syms: s.symbols.join(',') };
    s.name = fields.name.value.trim().slice(0, 24) || 'Trader';
    const syms = fields.symbols.value.split(/[\s,]+/).map(x => x.trim().toUpperCase().replace(/[^A-Z.]/g, '')).filter(Boolean);
    s.symbols = [...new Set(syms)].slice(0, 12);
    if (!s.symbols.length) s.symbols = ['SPY', 'QQQ', 'IWM'];
    if (!s.symbols.includes(s.main)) s.main = s.symbols[0];
    s.finnhubKey = fields.fh.value.trim(); s.twelveKey = fields.td.value.trim();
    s.levelsText = fields.levels.value;
    const r = s.risk;
    r.account = num(fields.account, r.account, 100, 1e8);
    r.maxDailyLoss = num(fields.maxloss, r.maxDailyLoss, 10, 1e7);
    r.riskPct = num(fields.riskpct, r.riskPct, 0.1, 100);
    r.stopPct = num(fields.stoppct, r.stopPct, 5, 100);
    r.maxConsecLosses = Math.round(num(fields.consec, r.maxConsecLosses, 1, 10));
    r.cooldownMin = Math.round(num(fields.cool, r.cooldownMin, 1, 240));
    s.voice = fields.voice.checked;
    s.alerts.levels = fields.aLevels.checked; s.alerts.hod = fields.aHod.checked; s.alerts.bells = fields.aBells.checked;
    app.applySettings(prevKeys);
    close();
    toast(s.finnhubKey || s.twelveKey ? 'Saved — connecting to live data' : 'Saved');
  });
  $('s-reset-layout').addEventListener('click', () => { app.resetLayout(); toast('Screens moved back to the default layout'); });
  const resetDay = $('s-reset-day');
  resetDay.addEventListener('click', () => {
    if (resetDay.dataset.armed) { app.resetDay(); resetDay.textContent = "Reset today's P&L"; delete resetDay.dataset.armed; toast("Today's P&L reset"); return; }
    resetDay.dataset.armed = '1'; resetDay.textContent = 'Tap again to confirm';
    setTimeout(() => { resetDay.textContent = "Reset today's P&L"; delete resetDay.dataset.armed; }, 4000);
  });
  $('s-test-voice').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) { toast('This browser cannot speak'); return; }
    app.jarvis.speak(`Jarvis online. Ready when you are, ${fields.name.value || app.settings.name}.`);
  });
  for (const id of ['s-fh', 's-td']) {
    $(id + '-show').addEventListener('click', (e) => { const el = $(id); el.type = el.type === 'password' ? 'text' : 'password'; e.target.textContent = el.type === 'password' ? 'Show' : 'Hide'; });
  }

  // ---- install (PWA)
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('btn-install').hidden = false; });
  $('btn-install').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $('btn-install').hidden = true; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (new URLSearchParams(location.search).get('settings') === '1') app.openSettings();
}

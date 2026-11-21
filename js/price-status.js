// Is the main ticker's price live, and from where? One answer for the top bar, the chart note, spoken alerts,
// the greeting and what INDAI is told. It reads app.marketData (js/data-status.js, copied from the website), which
// keeps each ticker's source and delay as the price service reported them. Until a price has arrived it answers as
// the headset always has: delayed about 15 minutes.
export function initPriceStatus(app) {
  app.priceStatus = (sym = app.settings.main, now = Date.now()) => {
    const st = app.feed.status;
    if (st.mode === 'demo') return { kind: 'demo', text: 'Demo data', note: 'Simulated prices for practice.' };
    const l = app.marketData ? app.marketData.label(sym, 'quote', now) : null;
    if (l && l.live) {
      const source = l.text.split(',')[0].replace(/\s*bridge$/i, '').trim();
      return { kind: 'live', source, text: `Live · ${source}`, note: l.note };
    }
    if (app.feed.bridgeLive) return { kind: 'live', source: 'TradingView', text: 'Live · TradingView', note: 'Prices come from your TradingView bridge.' };
    if (l && l.text !== 'Waiting for prices' && !/delayed/i.test(l.text)) {
      // a live source that has gone quiet (market closed, or the last update is over two minutes old)
      const source = l.text.split(',')[0].replace(/\s*bridge$/i, '').trim();
      return { kind: 'idle', source, text: source, note: l.note };
    }
    if (st.mode === 'live') return { kind: 'live', source: 'Finnhub', text: 'Live · Finnhub', note: 'Prices stream from Finnhub.' };
    return { kind: 'delayed', text: 'Delayed ~15 min', note: l && l.note ? l.note : 'Prices are delayed about 15 minutes.' };
  };
  // What INDAI is told about the prices (the website wraps liveContext the same way, js/app.js).
  const ind = app.indai, liveContext = ind.liveContext.bind(ind);
  ind.liveContext = () => {
    const c = liveContext(), ps = app.priceStatus();
    if (ps.kind === 'live') c.dataNote = `Prices are live (${ps.source}).`;
    else if (ps.kind === 'idle') c.dataNote = `${ps.note} Not streaming right now.`;
    else if (ps.kind === 'delayed' && app.marketData && app.marketData.label(app.settings.main, 'quote').text !== 'Waiting for prices') c.dataNote = ps.note;
    return c;
  };
}

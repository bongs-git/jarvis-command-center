// Outside the regular session (pre-market and after hours) a live trade moves the extended-hours price and leaves
// the day's close alone; inside the session it goes through the feed as before. This sits on the prototype, so a
// restarted feed (new MarketFeed) keeps it. The website does the same in its ext.js (handoff/PAPILO-TASKS.md, PAP-1).
import { MarketFeed } from './feeds.js';
import { etParts, isTradingDay, sessionTimes } from './market.js';

const base = MarketFeed.prototype.applyTrade;
if (!base.__ownerHours) {
  MarketFeed.prototype.applyTrade = function (sym, price, vol, t, opts) {
    const p = etParts(t), st = sessionTimes(p.y, p.m, p.d);
    if (this.status.mode === 'demo' || (isTradingDay(p.y, p.m, p.d) && t >= st.open && t < st.close)) return base.call(this, sym, price, vol, t, opts);
    if (!(price > 0)) return;
    const s = this.sym(sym);
    s.ext = price; s.lastTradeAt = Date.now(); s.tvAt = Date.now();   // as applyBridgeBar does outside the session
    this.bump(s);
  };
  MarketFeed.prototype.applyTrade.__ownerHours = true;
}

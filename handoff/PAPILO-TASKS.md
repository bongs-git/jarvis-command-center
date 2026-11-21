# Papilo: the headset catches up with November 20

From the owner on November 21, 2026: "Update [Papilo] and have him fire away."

A lot landed on the server and the website on November 20. The headset gets almost none of it yet. In his words that
day: "Can i now get second live movement on the charts" (he chose a true tick-by-tick stream); "She sounds to robotic.
And i can't even download the actual voice we had created. I want something that can converse and reason the idea
with me"; and, choosing between voice engines, "The best vocal engine one" (ElevenLabs).

Your last brief (`handoff/QUEST-THEME-BRIEF.md`) is done (PRs #13, #14, #15). This is the next one.

## What changed on the server (all live; the contract rows are in `HANDOFF.md`)

- **His own Schwab data.** A request to `indai-market` that carries his passcode (`x-indai-pass`) is answered from his
  Schwab account: live quotes (`source:"Schwab"`, `delay:0`), option chains, minute and daily candles. Without the
  passcode nothing changes. He connected Schwab on November 20; the sign-in lasts seven days at a time.
- **Schwab's live stream.** `POST indai-schwab {op:"stream"}` with his passcode hands his browser what it needs to
  open Schwab's stream itself (address, stream ids, a token good for at most 30 minutes). One stream per Schwab account:
  the newest connection wins and the other device's client steps aside for five minutes. He confirmed it works
  ("We're live", November 20, on the website).
- **Her hosted voice.** `indai-voice` speaks her words in an ElevenLabs voice he chooses once, for every device.
  It answers `configured:false` until he saves his ElevenLabs key; then her voice is the same everywhere and nothing has
  to be downloaded to speak.
- **The brain.** Every researched verdict had been cut off since the afternoon of November 19; the server now gives
  them room, and a failure says why in the logs. His Perplexity key is saved, so a rated idea now goes Perplexity
  (research) → Claude (verdict) → ChatGPT (second opinion). A follow-up question about the idea he last rated is
  answered by the stronger model with the idea, its numbers and her verdict in front of it. None of this has run on a
  real verdict yet, and nothing changes in what an app sends for any of it.
- **Orders.** `indai-orders` and the website's Trade page are live (owner only, approved devices only). Not for the
  headset this round: see the end of this file.

## What the website already has, ready to copy

All three are in `bongs-git/bongs-git.github.io`, folder `indai/js/`, and were written against the same shared brain
modules your app uses (`feeds`, `market`, `analysis`, `signals`, `options`, `relay`, `indai`, `voice`, `speech`, `store`
were byte for byte the same in both repositories on the morning of November 21). Each one stands in front of the shared
code without changing it.

| File | What it does | What it needs from the app |
|---|---|---|
| `schwab-stream.js` | Schwab's stream client: sign-in, subscribe, reconnect with a growing wait, step aside when another device takes the stream. Stores nothing. | Nothing (pure module) |
| `owner-feed.js` | Adds `x-indai-pass` to `indai-market` requests (a `window.fetch` wrapper) and runs the stream into `app.feed.applyTrade`. `app.schwabLive = { state, detail, at, ticks, lastAt }` for a status line. | `app.settings.researchPass`, `.main`, `.symbols`; `app.feed.trackedSymbols`, `.syms`, `.status`, `.applyTrade`; `./relay.js`, `./market.js` |
| `cloud-voice.js` | Her hosted voice: wraps `voice.speak`, `voice.stopSpeaking` and `voice.preload`, fetches audio in pieces (the first sentence alone, so she starts quickly), falls back to the device's own voice on any failure. `app.cloudVoice` for a status line. | `app.indai.voice`, `app.indai.say`, `app.settings.researchPass`, `app.markDirty` (any id); `./relay.js`, `./voice.js` |

Your `main.js` has every one of those (`app.feed`, `app.indai`, `app.markDirty`, `app.settings`). The website's tests for
them are good models for your emulator runs: `indai/tests/stream-unit.mjs` (stand-in socket and clock, no browser),
`indai/tests/stream-test.js` (Playwright `routeWebSocket`), `indai/tests/schwab-test.js` (the passcode goes to price
requests and nowhere else), `indai/tests/voice-unit.mjs` and `indai/tests/voice-test.js` (a stand-in `indai-voice` that
returns a real short sound).

Worth knowing: the headset app (`/jarvis-command-center/`) and the website (`/indai/`) share one origin,
`bongs-git.github.io`, and both keep settings under `jarvis.settings.v1`. In the same browser a passcode saved in one is
already in the other, and so is the hosted-voice switch (`indai.voice.hosted`).

## Rules, as before

- No change to the shared brain modules or anything under `supabase/`. Wrap from outside, the way the website does
  (`indai/js/data-status.js` wraps `relay.snapshot`, `indai/js/demo.js` wraps `relay.brain`).
- One branch and one pull request per ticket (PAP-1 and PAP-2 may share one), a `FEATURES.md` line, your emulator tests.
- New modules go into `sw.js` `SHELL`, and `CACHE` gets a new name, or the installed app keeps the old files.
- Never print or log the passcode, a Schwab token or an ElevenLabs answer's headers.

## Tickets, in priority order

### PAP-1 · His Schwab prices on the headset, tick by tick · P0

1. Copy `schwab-stream.js` and `owner-feed.js` into `js/` unchanged.
2. Call `initOwnerFeed(app)` at the top level of `main.js`, right after `app.feed` is created, so the fetch wrapper is
   in place before `boot()` runs `app.feed.start()`. The website calls it at the same point.
3. Extended hours. The website routes a trade outside 9:30 to 16:00 New York through its `ext.js`, so a pre-market
   trade moves the extended-hours price and leaves yesterday's close alone. The headset has no `ext.js`; without this
   step a pre-market tick would replace the close. Do it on the prototype, because `restartFeed()` (`main.js`, around
   line 1458) makes a new `MarketFeed` and an instance wrapper would be lost:

   ```js
   import { MarketFeed } from './feeds.js';
   import { etParts, isTradingDay, sessionTimes } from './market.js';
   const base = MarketFeed.prototype.applyTrade;
   MarketFeed.prototype.applyTrade = function (sym, price, vol, t, opts) {
     const p = etParts(t), st = sessionTimes(p.y, p.m, p.d);
     if (this.status.mode === 'demo' || (isTradingDay(p.y, p.m, p.d) && t >= st.open && t < st.close)) return base.call(this, sym, price, vol, t, opts);
     if (!(price > 0)) return;
     const s = this.sym(sym);
     s.ext = price; s.lastTradeAt = Date.now(); s.tvAt = Date.now();   // as applyBridgeBar does outside the session
     this.bump(s);
   };
   ```
   Your watchlist and chart header already show `q.ext`. Finnhub ticks take the same path, which fixes the same problem
   for a Finnhub key. (The website's `ext.js` had its wrapper on the feed instance and lost it at every restart: the
   price stopped moving until a reload. It moved to the prototype on November 21.)
4. In Settings, one line from `app.schwabLive`: `live` → "Live prices: Schwab stream"; `elsewhere` → "Schwab stream is
   open on another device, trying again in 5 minutes"; `off` or `refused` → its `detail`; and if it says Schwab is not
   connected, point him at https://bongs-git.github.io/indai/schwab.html. The passcode field's label should say it also
   brings his Schwab prices and her voice, not only research.

The market is closed until Monday, so the stream sends no trades before then: use stand-ins, and leave the real check
for Monday's pre-market.

Check on the headset: whether `document.visibilityState` turns `hidden` when he takes the headset off or leaves the app.
`owner-feed.js` closes the stream when the page is hidden. If the page stays visible, the stream stays open while the
headset sleeps, which only matters when INDAI is also on screen somewhere else (the two take turns every five minutes).
Write down what you saw in `FEATURES.md`; do not fork `owner-feed.js` for it this round.

Done when:
- with the passcode saved, `indai-market` requests carry `x-indai-pass`, and no other address gets it that did not before;
- with no passcode, or in demo mode: no header, and not one request to `indai-schwab`;
- against a stand-in stream: a trade moves `app.feed.quote(sym).last` and the forming one-minute candle; a bid-only
  update does not; the first message after subscribing (an old trade time) is not counted as a trade;
- with the clock at 8:00 New York, a tick moves `quote.ext` and `quote.last` stays at the close; this still holds after
  `restartFeed()`;
- a hidden page closes the stream and a visible one opens it again.

### PAP-2 · Say "live" when the prices are live · P0, small, same pull request as PAP-1 is fine

The headset decides "delayed" from `app.feed.status.mode`, which is `delayed` whenever no Finnhub key is saved, even when
the price service answers live from Schwab or the TradingView bridge. Today that shows in four places, plus what INDAI
is told:

- the top bar badge, "Delayed ~15 min" (`panels.js`, around line 93);
- the note on the chart (`panels.js`, around line 502);
- the spoken alert's "Heads up, this is on delayed data" (`main.js`, around line 485);
- the greeting's "(delayed about 15 minutes)" (`main.js`, around line 1557);
- `dataNote` in her conversation context (shared `indai.js`, line 240), so she tells him prices are delayed.

From outside: wrap `relay.snapshot` and keep, per ticker, `{ source: q.source || answer.source, delay: q.delay ??
answer.delay ?? 900, at }` (the website's `data-status.js`, from line 27, does exactly this). Then let the main
ticker's entry decide: `delay === 0` and under two minutes old means live, with its source: "Live · Schwab", "Live ·
TradingView". Use that in the four places, and wrap `app.indai.liveContext` so `dataNote` says "Prices are live
(Schwab)." when they are. The greeting can simply say "Market data is connecting." The website made the same fix on
November 21: its `liveContext` wrapper sits right after `app.indai = new Indai(app)` in `indai/js/app.js`.

Done when: a stand-in snapshot with `source:"Schwab", delay:0` gives the badge "Live · Schwab", no delayed note, an alert
without the heads-up, and a `liveContext().dataNote` that says live; with `delay:900` everything reads as it does today.

### PAP-3 · Her hosted voice on the headset · P0

1. Copy `cloud-voice.js` into `js/` unchanged.
2. Call `initCloudVoice(app)` in `boot()` before the timer that preloads the voice (around line 1546). With the hosted
   voice on, `voice.preload({ tts: true })` then downloads nothing for speaking. Listening stays on the headset as now.
   (On the very first visit the hosted voice is not known yet when that timer fires, so the model may still download
   once.)
3. Settings, Voice section, one line from `app.cloudVoice`: `on` → "Hosted voice (her voice's name): from the server,
   nothing to download"; `trouble` → "Hosted voice is set up but not working:" and its `note`; otherwise "Hosted voice:
   not set up". Add a link "Choose her voice" to https://bongs-git.github.io/indai/voice.html (same origin, so the page
   finds his passcode). That page lists the voices in his ElevenLabs account, plays any of them, and stores his choice
   for every device.

Until he saves his ElevenLabs key, `indai-voice` answers `configured:false` and the headset keeps its own voice: nothing
changes and nothing breaks.

Done when, against a stand-in `indai-voice`:
- a verdict is spoken from two requests (the first sentence alone, then the rest), it plays, `voice.state.speaking`
  goes on and then off, and no speaking model is downloaded;
- "stop" silences her at once;
- a `402 voice_quota` answer makes the headset's own voice say the whole reply, and she says why once, in writing;
- with no passcode, in demo mode, or with `indai.voice.hosted` set to `off`: not one request to `indai-voice`.

Check on the headset: that Oculus Browser decodes the MP3 audio, the volume next to the on-device voice, and that the orb's
speaking animation follows `voice.state.speaking`.

### PAP-4 · Room for her to reason · P1, small

Ask about an idea, then follow up ("why amber?", "what if I go out a week?", "where does it break even?"): the answer now
comes from the stronger model with the idea in front of it, carries `about:"idea"`, and `spoken` may run to five
sentences, with the figures as `summary` lines. The headset's INDAI panel cuts every message at four wrapped lines
(`panels.js`, around line 702: `.slice(0, 4)`), so a reasoned answer is cut off on screen while she says all of it.

Show her newest reply in full (or let the panel scroll), and keep older messages at four lines. A small "thinking it
through" mark when the answer was about the idea is welcome but optional: the shared `indai.js` does not keep `about`,
so it needs a `relay.brain` wrapper (see PAP-5).

Done when a 900-character reply can be read in full at the panel's default size.

### PAP-5 · Show who worked on a verdict · P1

A rated idea's answer carries `brains: [{ brain, role, model, ok, ms, error?, stop? }]` (who did what, in order) and
`result.second: { by:"ChatGPT", model, rag, confidence, reason, risk, agrees }`; `model` names the brain that wrote the
verdict (ChatGPT's when it stood in for Claude). In the Analysis panel, under the verdict, one line such as "Research:
Perplexity · Verdict: Claude · Second opinion: ChatGPT, amber, disagrees: Fed speaker at two." When a step failed, say so
in faint text ("Perplexity did not answer; Claude searched itself").

`result.second` already reaches you as `an.final.second` (the shared code keeps the whole `result`). `brains` does not:
the shared `indai.js` (around line 625) keeps `res.result`, `res.sources` and `res.model` only. Wrap `relay.brain` from
outside and keep the last trade answer's `brains` (the website's `demo.js`, line 118, wraps `relay.brain` the same way).

Done when stand-in answers with three working brains, with a failed Perplexity step, and with ChatGPT standing in each read
correctly, and an answer without `brains` (an older server) shows exactly what it shows today. The website does not show
these yet either.

## Not this round, and why

- **Orders from the headset.** The order path is live but no real order has gone through it yet. Let the phone's Trade
  page prove it first; a second front end for real money waits until then. When he asks: the headset is just another
  device for `indai-orders` (it enrolls, he approves it from an approved device), the contract is in `HANDOFF.md`, and
  dragging the stop line maps well onto the level drag you built in PR #15.
- **"Hey INDAI" as a wake word.** On his iPhone that is a Siri shortcut (`HANDOFF.md` item 23). The headset already has
  palm-to-talk, A or X held, and the orb.
- **Capture and the atlas.** Still website-first.

## Questions for Ikpa

Write anything unclear in the server contract here, with the date. Ikpa reads this file.

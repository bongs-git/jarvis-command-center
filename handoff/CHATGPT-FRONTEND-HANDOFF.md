# Hand-off to ChatGPT: the INDAI website's front end

Written November 20, 2026 by Ikpa (the Claude bot on the back end and the chart work). The owner, Bongs, wants you to
take the website's remaining front-end work and "the final touches". Papilo (another Claude bot) builds the Meta Quest
app; do not edit the Quest app's `index.html` or `js/` in this repo.

## Where everything is

- Website code: repository `bongs-git/bongs-git.github.io`, folder `indai/`. Live at https://bongs-git.github.io/indai/.
  A push to `main` deploys it within a minute (GitHub Pages). Pull before you start: Ikpa also commits there.
- Read first, in that folder: `README.md` (what the site does), `SYNC.md` (which files are shared with the Quest app
  and how each website feature is built), `tests/README.md` (how to run the tests).
- This repository (`jarvis-command-center`): `HANDOFF.md` is the contract with the back end, `FEATURES.md` the shared
  feature log (add a row for anything a user would notice), `supabase/OPERATIONS.md` how the back end runs.
- Back end: Supabase project `zptjziewsfuvfcogrikz`. It is Ikpa's lane now. Ask for an endpoint; do not change functions,
  tables or jobs.

## Rules that keep the site working

1. Plain HTML, CSS and ES modules. No build step, no framework, no bundler.
2. Never edit the shared brain modules in `indai/js/`: `indai.js`, `voice.js`, `feeds.js`, `signals.js`, `market.js`,
   `relay.js`, `speech.js`, `analysis.js`, `options.js`, `store.js`. They are copied byte for byte from this repo by
   `indai/sync.sh`. The website changes their behaviour from outside (`app.js`, `demo.js`); `SYNC.md` shows how.
3. No third-party script may run in the site's origin: the owner's access token lives in `localStorage` there.
   Outside content goes in an `<iframe>` (see the TradingView panel).
4. The page is cross-origin isolated for the on-device voice models (`sw.js` adds the headers). A cross-origin
   `<iframe>` needs the `credentialless` attribute, and a cross-origin `fetch` needs CORS.
5. Bump `CACHE` in `indai/sw.js` and add any new file to `SHELL` when you add or rename files.
6. Phone first: 44px touch targets, nothing scrolls sideways at 360px, text in short plain sentences, no jargon.
7. Run the tests in `indai/tests` before pushing; add to them when you add a feature. Commit as the owner does
   (see `git log`), one topic per commit.

## What is there now (so you do not rebuild it)

Ideas strip, list and alerts; forming setups; catch-up; the Retrospective with learning, back-test and the TradingView
strategy (`indai/tradingview/`); access lock; push registration; thinking-budget care; iPhone sound fixes; and, new on
November 20, the working chart: drag to move, pinch and wheel to zoom, draggable price and time axes, Draw (trend
lines and levels, select, move, delete), earlier sessions when you scroll back, and "TradingView chart" (TradingView's
embedded chart in the panel).

Back-end behaviour the site can rely on (details in `HANDOFF.md`):

- `indai-market` `snapshot` and `bars` answer from the TradingView bridge when CBOE refuses a ticker. Such a quote or
  ticker entry has `source: "TradingView bridge"`, `delay: 0`; `open`, `high`, `low`, `prevClose`, `change` can be 0.
- `indai-tv?bars=1&ticker=QQQ&before=<ms>&limit=1000` returns stored one-minute candles for scrolling back.
- The bridge now sends pre-market and after-hours candles; `feeds.js` shows them as the extended-hours price.
- Option chains (`kind=chain`) have no fallback. Since the evening of November 19 CBOE has refused the back end, so
  strikes, chains and GEX levels can be missing.

## The final touches, in the order that matters to the owner

1. **Say where prices come from.** The badge and the chart note still read "Delayed 15 min" when the data is the
   bridge's. Read `source` and `delay` from the snapshot and bars answers: "TradingView, live" while the newest
   candle is under two minutes old, otherwise "TradingView, last candle 4:00 PM". Done when the badge, its tap
   explanation and the chart note agree with the answer's `source`.
2. **Never show an empty card without a reason.** When a chain or GEX answer fails, the calculator, verdict card,
   levels panel and idea contract should say "Option prices are unavailable right now" (and why, in one line) instead
   of staying blank. A quote with `prevClose` 0 shows "—" for the change, not 0%.
3. **Confirm the TradingView panel on real devices** (iPhone, iPad, laptop). Ikpa could not load TradingView from the
   build machine. If the frame is blank, switch to TradingView's current embed (their Advanced Chart is now a Web
   Component) inside a frame of its own, still with no TradingView script in the site's origin. Add a full-screen button.
4. **Earlier sessions, polish.** Show "Loading earlier candles…" while a page is on its way and "That is all INDAI
   has stored" at the left end (`app.history.state(sym)` gives `busy` and `done`); hour labels inside earlier
   sessions; keep the view when a new candle arrives while scrolled back (it does; test it).
5. **Drawing, polish.** Undo; a horizontal ray and a rectangle; a long press on touch that shows a magnifier while
   placing a point; keep drawings on every device by saving them with `relay.brain({mode:"profile",op:"put",key:"drawings",value})`
   and merging on load (the profile endpoint exists).
6. **Push, the visible part.** The service worker gets `barT` in each push: record when it arrived and show in
   Settings "Last alert reached you 6 s after its candle". Show the count the test push returns.
7. **Send the learning to the back end.** After "Apply" in the Retrospective, also save the applied changes with
   `mode:"profile", key:"tuning"` so Ikpa can make the push scanner use the same scores.
8. **"Send to Schwab"** on an idea card: a confirm sheet with the exact contract, limit price and maximum loss, then
   one call to the back end. Wait for Ikpa's endpoint contract in `HANDOFF.md` before building it.
9. **Tests.** `ideas-test.js` assumes the trading day has started; its catch-up checks fail between midnight and
   9:30 New York time. Make them independent of the clock.
10. **Check on the owner's iPhone:** INDAI's voice out loud with the ring switch off, and a push with the app closed.
    Both were built and tested in emulation only.

11. **Show the three brains** (added later on November 20). A rated idea's answer now carries `brains` (who worked
    on it: Perplexity researched, Claude judged, ChatGPT gave a second opinion) and, when ChatGPT answered,
    `result.second` (`rag`, `confidence`, `reason`, `risk`, `agrees`). On the verdict card show a small
    "Second opinion" row with its colour and reason, marked clearly when it disagrees, and one quiet line such as
    "Researched by Perplexity · judged by Claude · checked by ChatGPT". In Settings show which brains are on from
    `GET indai-brain` → `brains`. The contract row is in `HANDOFF.md`; nothing breaks if you ignore the new fields.

Ask Ikpa (through the owner, or a note at the top of `HANDOFF.md`) for anything that needs the back end: a new field,
an endpoint, a job. Do not work around a missing one in the browser.

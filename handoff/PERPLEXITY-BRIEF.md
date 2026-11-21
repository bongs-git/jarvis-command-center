# Brief for Perplexity: INDAI's research desk

**Before anything else:** read `handoff/PARTNER-PLAYBOOK.md` and check `ANSWERED.md` for your topic. Reuse what is
already answered, and end with an "ANSWERED entry" when you settle something new.

Written November 20, 2026 by Ikpa (the Claude bot on INDAI's back end and the website's chart). The owner, Bongs,
wants three brains working as one: Claude, "perplexity especially", then ChatGPT. This is your part.

## What INDAI is

A trading command center for one trader: a Meta Quest app and a website for phone, tablet and laptop, on one back
end. She watches a watchlist, alerts on setups, rates a trade idea red, amber or green with the reasons, and talks.
She gives information, never financial advice; the trader makes every trade.

Everything is public to read:

- Back end and Quest app: https://github.com/bongs-git/jarvis-command-center
- Website: https://github.com/bongs-git/bongs-git.github.io (folder `indai/`), live at https://bongs-git.github.io/indai/
- Who builds what: `HANDOFF.md` in the first repository. Ikpa: back end. Papilo (Claude): Quest app. ChatGPT: website.

## Your two roles

**1. Inside INDAI, by herself.** On every idea the trader asks her to rate, INDAI's back end asks Perplexity's API
for today's news, events and sentiment with sources, hands that to Claude for the verdict, and asks a ChatGPT model
for a second opinion. The code is
[`supabase/indai-brain/super.ts`](https://github.com/bongs-git/jarvis-command-center/blob/main/supabase/indai-brain/super.ts);
the plain description is "Three brains" in
[`supabase/OPERATIONS.md`](https://github.com/bongs-git/jarvis-command-center/blob/main/supabase/OPERATIONS.md).
It is deployed and switched off, waiting for the owner's API key. It has only ever run against stand-ins.

**2. On the team, through the owner.** You are the one of us who can read the live web and cite it. The builders
cannot reach most vendor sites from where they work. You research, you check, you report. You do not push code:
send findings and the owner carries them to whoever builds.

## First jobs, in this order

### 1. Check the code that calls you

Read `super.ts` against Perplexity's current API documentation and tell Ikpa exactly what is wrong. It was written
from the docs as fetched on November 20, 2026, and has never met the real API. Confirm or correct each of these:

- The endpoint `POST https://api.perplexity.ai/v1/agent` and `Authorization: Bearer`.
- The research request: `{ effort, instructions, input, max_output_tokens }` with `effort: "fast"` for a quick idea
  and `"low"` for a deep one. Does a request with `effort` accept `instructions` and `max_output_tokens`? Does `fast`
  search the web without a `tools` entry? Which effort level gives the freshest news inside about 20 seconds?
- The fallback it tries when the first shape is refused: `{ model: "perplexity/sonar", tools: [{ "type": "web_search" }], … }`.
- How the answer is read (`readResponse`): text from `output[]` items of type `message`, their `content[]` entries of
  type `output_text`; sources from an `output[]` item of type `search_results` (`results[].title`, `.url`); tokens from
  `usage.input_tokens` and `usage.output_tokens`.
- The second opinion: `{ model: "openai/gpt-6.1-sol", instructions, input, max_output_tokens: 1500, reasoning: { effort: "low" } }`.
  Is that model id in the catalog today? Is `reasoning` accepted for it? Is there a better pick for a short,
  independent risk read at low cost?
- Limits on a new account: requests per second, and whether two requests about a second apart are safe.
- What the owner must do to switch it on: where the API key is created, whether credits must be bought first, the
  smallest amount, and whether his subscription gives him any API credit at all.

Done when: a list of every mismatch with a link to the page that proves it, and the corrected JSON request bodies.
"No mismatches found" with the pages you checked is a good answer too.

### 2. Live prices, second by second

The owner wants the price and the forming candle to tick with the market, pre-market and after-hours included. INDAI
has a slot for a Finnhub key (browser WebSocket to `wss://ws.finnhub.io`), and he added a free key today.

- Finnhub's free plan: does the trade stream carry pre-market and after-hours trades, from which venues, how many
  symbols, and what do its terms say about one person watching his own screen?
- The best real-time US stock and ETF stream for one person, extended hours included: compare Finnhub, Alpaca,
  Schwab's Trader API stream, Massive (formerly Polygon), Tradier and anything better. For each: monthly cost, hours
  covered, whole market or one venue, whether a browser can connect directly, and the catch.

### 3. Schwab's Trader API for an individual

The owner has a Schwab account and wants to send an idea's contract from INDAI to Schwab, and to use Schwab's own
live data. He hit Schwab's "We have a technical issue" page at about 5:30 AM New York time today.

- Registering an individual developer app: the steps, the usual wait for approval, and what "Ready for use" needs.
- Streaming: which services (level-one equities, chart, options), extended-hours coverage, connection rules.
- Orders: the fields for a single-leg option order with a limit price, whether an order can be previewed first,
  rate limits, token lifetimes, and what breaks weekly (the manual sign-in).
- Option chains: which fields come back (open interest, Greeks) and how fresh they are.
- Is there a known Schwab outage or maintenance window in the early morning?

### 4. Option data to replace CBOE

INDAI's servers read CBOE's free delayed quotes for option chains (open interest, volume, Greeks), from which she
computes gamma levels. Since about 5:25 PM New York time on November 19, CBOE has answered every request from the
servers with 403. We will not disguise the servers to get around a refusal.

- Is that a known block on cloud addresses, a time-of-day window, or a terms matter? What do CBOE's terms allow?
- Which sources give full chains with open interest and Greeks, delayed is fine, to a server, for one trader:
  cost, limits and terms for each. Say which one you would pick and why.

### 5. TradingView's limits

INDAI's live candles come from a TradingView alert that posts a webhook when each one-minute candle closes.

- How often may one alert fire before TradingView stops it? Can a Pine script send the candle that is still forming
  every few seconds without tripping that?
- Can TradingView's free embedded chart show extended hours, and how is it switched on?

## How to report

One answer per job. The answer first, in a sentence or two. Then the evidence, each point with its link and the date
of the page. Say plainly what you could not confirm from a primary source. No trading advice. Keep keys, passcodes
and account details out of everything: nobody on this team needs to see them, and the owner types his own.

# INDAI Command Center for Meta Quest

INDAI is a voice-driven options trading command center that floats in your room. Open it in the Meta Quest browser and tap **Enter mixed reality**. The screens appear around you, and INDAI talks you through the day.

## What INDAI does

- **Morning check-in.** INDAI takes the market's temperature: SPY, QQQ and IWM moves, VIX, gamma regime and GEX walls. Then she asks how much you're starting with, your minimum goal and how aggressive you want to be, and turns your answers into the day's plan. The plan sets risk per trade, a loss limit that trips the breaker, contracts per alert, and how many good trades it takes to reach the goal.
- **Setup alerts.** She watches your watchlist on 5-minute bars using your playbook: EMA clouds (5/12, 34/50), VWAP reclaims and rejections, GEX wall bounces and breaks, and opening-range breakouts. Each setup is scored, and she only alerts when the score clears the bar for your aggressiveness level. Every alert comes with a suggested contract, size, stop and target. Alerts pause when the breaker trips, and after you hit your goal they either stop or tighten to A+ setups only.
- **Trade analysis.** Say something like *"Hey INDAI, QQQ calls expiring today, 665 strike"*. INDAI pulls the options chain, Greeks, flow, put/call ratios, unusual activity, GEX, MACD/RSI/divergence, EMA clouds and VWAP. She runs Black-Scholes and Monte Carlo odds, gives a **RED / AMBER / GREEN** verdict with the reasons, and says it out loud. If the research key is set, she also reads today's news and events on the web before the final verdict.
- **Options profit calculator.** A profit/loss grid by price and time, like optionsprofitcalculator.com, with a payoff chart, breakevens, max profit and loss, and chance of profit. Strategy presets cover long calls and puts, verticals, credit spreads, straddles, strangles and iron condors.
- **Screens.** Main chart with GEX lines, watchlist, lead/lag, GEX levels, risk breaker, and the INDAI feed.
- **Scenes.** Switch between **Passthrough** (your real room) and virtual spaces: a sunlit **Loft** with city views, a **Midnight** penthouse over a lit-up skyline, an **Ocean sunset** deck, **Orbit** above Earth, and the classic **Command deck**. Tap **Scene** on the dock or say "switch to loft", "passthrough" or "next scene"; it changes instantly without leaving the headset view.
- **Hand gestures.** Pinch, then spread your fingers to "explode" a ticker into a deep dive. Bring your open hands together to collapse everything into one summary; pull them apart to bring the screens back.
- **Gestures that fire once, when you mean it.** All 25 tracked joints per hand are used and drawn as dots with a skeleton and a palm ring. The dots turn gold when a gesture is primed and flash green when it fires. Explode is now a held fist that bursts open (a pinch can never trigger it); collapse and bring-back need open palms facing each other and a held start. Say "gestures easy", "gestures strict" or "gestures off" to change the feel.
- **Conversation that keeps up.** A faster on-device speech model (Moonshine, with Whisper as backup) on all CPU cores; transcription starts the moment you pause; the mic re-opens by itself after INDAI answers so you can just keep talking ("thanks" or "stop listening" ends it; "hands free off" disables it).
- **She learns how you talk.** Mishears are fixed and remembered: repeat yourself after a miss, say "no, I said …", or confirm her guess, and next time she gets it. She also learns your pauses so she stops cutting you off, and the room's noise level. "What do you remember" shows what she has learned.
- **Long-term memory and a thinking brain.** "Remember that I never trade the first five minutes" is saved in the backend and shared across devices. With the Anthropic key set in Supabase she becomes a full conversationalist (Claude) that can chat, reason about the market, run the command center from loose wording, and keep learning from what you tell her.
- **Gesture tutorial.** Say "gesture tutorial" or pinch **Gestures** on INDAI's panel. Each of the seven moves shows where it starts and where it finishes; START lights up when INDAI sees you in position and FINISH when the gesture lands, then it moves on. A live line shows what the headset sees (each hand's pose and how far apart they are).

INDAI's analysis is information, not financial advice. You make every trade.

## Two Quest apps

- **INDAI**: opens straight into mixed reality, with the scene switcher.
- **INDAI Window**: opens as a regular window in your Quest home (the Loft), next to your other apps.

## Talking to INDAI

- On a Quest: hold **A** or **X**, tap **Talk to INDAI**, or point at the orb and pinch or pull the trigger.
- On a computer: hold the **space bar**.
- Things to try: "run a self-test", "switch to the loft", "start my day", "brief me", "how's the market", "QQQ 665 calls today", "deep dive on Tesla", "open the calculator", "show IWM", "five minute chart", "log a loss of 50", "summary", "restore", "go conservative", "only EMA clouds and VWAP".

The voice and listening models run on the device itself, so voice works on the Quest. The first time, they download about 130 MB, which is then cached.

## Market data, stacked

1. **TradingView Bridge** (your subscription). Add [`tradingview/indai-bridge.pine`](tradingview/indai-bridge.pine) to a 1-minute chart and create one alert with your INDAI webhook link. INDAI then gets your watchlist's live candles every minute. It needs a paid TradingView plan with two-factor authentication turned on.
2. **Finnhub** (optional free key in Settings): real-time stock trades.
3. **CBOE** (always on, no key): quotes, intraday candles, full option chains with Greeks, and GEX. Delayed about 15 minutes.

GEX levels come from your Morning GEX refresh each weekday, live from the options chain, from TradingView alerts that include levels, or from levels you paste in Settings.

## Other TradingView alerts

Any TradingView alert sent to the same webhook link is read out loud. Alerts that include levels such as `QQQ CW 700 PW 650 ZG 676` update the GEX lines on the chart.

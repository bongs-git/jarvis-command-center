# J.A.R.V.I.S. Command Center for Meta Quest

A stock command center that floats in your room. Open it in the Meta Quest browser, tap **Enter Mixed Reality**, and the screens appear around you with your real room visible behind them.

## What's on the screens

- **Main chart**: 5-minute candles (1m/5m/15m) with Ripster-style EMA clouds (5/12, 34/50), VWAP, and your GEX levels (call wall, put wall, zero gamma).
- **Watchlist**: SPY, QQQ, IWM, TSLA, AMZN, MSFT by default (up to 12), with sparklines and the distance to the nearest GEX level. Tap a row to put it on the main chart.
- **Lead / lag**: SPY vs QQQ vs IWM since the open, and which one is leading.
- **GEX levels**: where price sits between your pasted levels.
- **Risk breaker**: day P&L, daily loss limit, a cooldown after losses in a row, a position sizer, and a setup checklist. Sizing is locked while the breaker is tripped or cooling down.
- **Jarvis**: spoken alerts (GEX level crosses, new high or low of day, opening and closing bell, breaker events) and a "Brief me" summary.

## Using it on the Quest

1. Put on the headset, open **Browser**, and go to this site's link.
2. Tap **Enter Mixed Reality** (or **Enter VR** for a dark virtual room).
3. Point a controller and pull the trigger to press buttons. With hands, point and pinch.
4. Move a screen by grabbing its title bar with the trigger or a pinch, or squeeze the grip anywhere on it. Your layout is saved.
5. **Recenter** puts the screens back in front of you.

## Live data

With no keys, the app runs on **demo data**, which is clearly labelled and not real prices. For live data, open **Settings** and add two free keys:

- [Finnhub](https://finnhub.io/register): real-time trade prices over a live stream.
- [Twelve Data](https://twelvedata.com/register): today's full intraday candles. The free plan allows 8 requests a minute and 800 a day, and the app paces itself to stay under both.

Keys and settings are saved only in that browser on that device.

## GEX levels

Paste one line per ticker in Settings, for example:

```
IWM CW 250 PW 240 ZG 245
SPY call wall 690, put wall 670, zero gamma 681
```

## Voice

Jarvis speaks wherever the browser supports speech. Voice commands use the browser's speech recognition and work only where it's available. Example commands: "show IWM", "five minute", "brief me", "log a loss of 50", "undo", "hide VWAP", "recenter".

## Install as an app

In a desktop or Android browser, use **Install app**. On the Quest, the site can be packaged as an APK with Meta's PWA tools. See `INSTALL-QUEST-APP.md`.

---

This is for information and discipline only. It is not financial advice, and it never places trades.

import { db, rpc } from "../_shared/db.ts";
type Levels = {
  callWall: number | null;
  putWall: number | null;
  callWall2: number | null;
  putWall2: number | null;
  zeroGamma: number | null;
  total: number;
};

export function gexRows(
  symbol: string,
  chain: any,
  session: { day: string; previous: string; minute: number; previous_close_min?: number },
) {
  let stamp = String(chain.timestamp ?? "");
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(stamp)) {
    const ms = Date.parse(stamp);
    if (!Number.isFinite(ms)) throw new Error("Invalid chain time");
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(ms).map((p) => [p.type, p.value]),
    );
    stamp = parts.year + "-" + parts.month + "-" + parts.day + " " + parts.hour + ":" + parts.minute;
  }
  const date = stamp.slice(0, 10), minute = Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
  const current = date === session.day && minute <= session.minute + 2;
  const priorClose = date === session.previous && minute >= (session.previous_close_min ?? 960) - 45;
  if (
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(stamp) || (!current && !priorClose) ||
    chain.symbol !== symbol || !(chain.spot > 0) || !chain.gexNear?.expiry
  ) {
    throw new Error("Stale or incomplete chain");
  }
  const horizon = new Date(Date.parse(session.day + "T12:00:00Z") + 45 * 86400_000).toISOString().slice(
    0,
    10,
  );
  const asof = session.day + " " + String(Math.floor(session.minute / 60)).padStart(2, "0") + ":" +
    String(session.minute % 60).padStart(2, "0");
  const row = (scope: string, g: Levels, expiry: string) => {
    if (!g || !Number.isFinite(g.total) || (g.callWall == null && g.putWall == null)) {
      throw new Error("Empty gamma calculation");
    }
    return {
      ticker: symbol,
      scope,
      asof_et: asof,
      expiry,
      spot: chain.spot,
      call_wall: g.callWall,
      put_wall: g.putWall,
      call_wall2: g.callWall2,
      put_wall2: g.putWall2,
      gamma_flip: g.zeroGamma,
      net_gex_m: Math.round(g.total / 100_000) / 10,
      source: "Morning GEX refresh",
      updated_at: new Date().toISOString(),
    };
  };
  return [row("A", chain.gex, horizon), row("N", chain.gexNear, chain.gexNear.expiry)];
}

export async function refreshGex(args: any) {
  const session = await rpc("indai_market_session");
  if (
    !session.close_min || args.day !== session.day || !Array.isArray(args.symbols) || args.symbols.length > 8
  ) throw new Error("Invalid GEX batch");
  const base = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_ANON_KEY")!;
  const symbols: string[] = args.symbols;
  const failed: string[] = [];
  for (let i = 0; i < symbols.length; i += 3) {
    await Promise.all(
      symbols.slice(i, i + 3).map(async (symbol) => {
        try {
          if (!/^[A-Z][A-Z.]{0,7}$/.test(symbol)) throw new Error("Invalid ticker");
          const url = new URL("/functions/v1/indai-market", base);
          url.search = new URLSearchParams({ kind: "chain", symbol, range: "0.01" }).toString();
          const r = await fetch(url, {
            headers: { apikey: key, Authorization: "Bearer " + key },
            signal: AbortSignal.timeout(28_000),
          });
          if (!r.ok) throw new Error("Market relay unavailable");
          const rows = gexRows(symbol, await r.json(), session);
          await db("indai_gex_levels", { on_conflict: "ticker,scope" }, {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify(rows),
          });
        } catch {
          failed.push(symbol);
        }
      }),
    );
  }
  return {
    ok: !failed.length,
    detail: failed.length
      ? "Refresh failed for " + failed.join(", ")
      : "Updated both scopes for " + symbols.length + " tickers.",
  };
}

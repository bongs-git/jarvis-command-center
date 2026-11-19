import { db, rpc } from "../_shared/db.ts";
import { PROFILES, scanSetups, STRATEGIES } from "../indai-push/scanner.js";
import { pushConfig, sendPush } from "../indai-push/webpush.ts";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
type Session = { day: string; minute: number; close_min: number | null; open_ms: number };
const defaults = ["SPY", "QQQ", "IWM", "TSLA", "AMZN", "MSFT"];
const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(ms);

export function eligible(p: any, s: Session, now: number) {
  if (
    !p || !s.close_min || s.minute < 570 || s.minute >= s.close_min || p.tripped === true ||
    Number(p.cooldownUntil) > now
  ) return false;
  const day = p.date ?? (Number.isFinite(p.at) ? dayOf(p.at) : null);
  if (day !== s.day || !Object.hasOwn(PROFILES, p.aggr) || !(p.capital > 0) || !Array.isArray(p.strategies)) {
    return false;
  }
  const profile = PROFILES[p.aggr as keyof typeof PROFILES];
  const risk = Math.max(10, Math.round(p.capital * profile.riskPct / 100));
  const maxLoss = Math.max(risk * 2, Math.round(p.capital * profile.lossPct / 100));
  if (Number(p.pnl) <= -maxLoss) return false;
  return !((p.goalHit || (p.goal > 0 && p.pnl >= p.goal)) && profile.afterGoal === "stop");
}
export function fiveMinuteBars(minutes: Bar[], now: number): Bar[] {
  const groups = new Map<number, Bar[]>();
  for (const b of minutes) {
    if (![b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite) || !(b.c > 0) || b.t % 60000 !== 0) continue;
    const start = Math.floor(b.t / 300000) * 300000;
    if (start + 300000 > now) continue;
    const group = groups.get(start) ?? [];
    group.push(b);
    groups.set(start, group);
  }
  const out: Bar[] = [];
  for (const [t, g] of groups) {
    if (g.length !== 5 || !g.every((b, i) => b.t === t + i * 60000)) continue;
    out.push({
      t,
      o: g[0].o,
      h: Math.max(...g.map((b) => b.h)),
      l: Math.min(...g.map((b) => b.l)),
      c: g[4].c,
      v: g.reduce((sum, b) => sum + b.v, 0),
    });
  }
  return out;
}
export async function scanPush() {
  const s: Session = await rpc("indai_market_session");
  if (!s.close_min || s.minute < 570 || s.minute >= s.close_min) {
    return { ok: true, detail: "Market closed." };
  }
  pushConfig();
  const now = Date.now();
  const users: string[] = [];
  for (let offset = 0;; offset += 500) {
    const subs = await db("indai_push_subs", {
      select: "user_id",
      order: "endpoint.asc",
      offset: String(offset),
      limit: "500",
    });
    for (const { user_id } of subs) if (!users.includes(user_id)) users.push(user_id);
    if (subs.length < 500) break;
  }
  const inputs = new Map<string, Promise<{ bars: Bar[]; levels: any }>>();
  function inputsFor(symbol: string) {
    if (!inputs.has(symbol)) {
      inputs.set(
        symbol,
        (async () => {
          const common = { ticker: "eq." + symbol };
          const [minutes, level, tv] = await Promise.all([
            db("indai_tv_bars", {
              ...common,
              tf: "eq.1",
              t: "gte." + s.open_ms,
              order: "t.asc",
              limit: "450",
              select: "t,o,h,l,c,v",
            }),
            db("indai_gex_levels", {
              ...common,
              scope: "eq.A",
              select: "asof_et,call_wall,put_wall,call_wall2,put_wall2,gamma_flip",
            }),
            db("indai_tv_alerts", {
              ...common,
              levels: "not.is.null",
              received_at: "gte." + new Date(s.open_ms - 9.5 * 3600e3).toISOString(),
              order: "received_at.desc",
              limit: "1",
              select: "levels",
            }),
          ]);
          const g = level[0];
          const morning = String(g?.asof_et ?? "").slice(0, 10) === s.day
            ? { cw: g.call_wall, pw: g.put_wall, cw2: g.call_wall2, pw2: g.put_wall2, zg: g.gamma_flip }
            : {};
          return { bars: fiveMinuteBars(minutes, now), levels: { ...morning, ...tv[0]?.levels } };
        })(),
      );
    }
    return inputs.get(symbol)!;
  }
  const dir = (b: Bar[]) => {
    if (b.length < 4 || now - b[b.length - 1].t - 300000 > 360000) return 0;
    const diff = b[b.length - 1].c - b[b.length - 4].c;
    return Math.abs(diff) / b[b.length - 1].c < 0.0005 ? 0 : Math.sign(diff);
  };
  let queued = 0, failures = 0;
  for (const user of users) {
    const rows = await db("indai_profile", {
      user_id: "eq." + user,
      key: "in.(plan,watchlist)",
      select: "key,value",
    });
    const profile = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
    const plan = profile.plan;
    if (!eligible(plan, s, now)) continue;
    const style = PROFILES[plan.aggr as keyof typeof PROFILES];
    const [spy, qqq] = await Promise.all([inputsFor("SPY"), inputsFor("QQQ")]);
    const lead = dir(spy.bars) === dir(qqq.bars) ? dir(spy.bars) : 0;
    const list = profile.watchlist?.symbols ?? plan.symbols ?? defaults;
    if (!Array.isArray(list)) continue;
    for (
      const sym of new Set<string>(
        list.filter((x) => typeof x === "string" && /^[A-Z][A-Z.]{0,7}$/.test(x)).slice(0, 32),
      )
    ) {
      const { bars, levels } = await inputsFor(sym);
      if (bars.length < 6 || now - bars[bars.length - 1].t - 300000 > 360000) continue;
      const enabled = plan.strategies.filter((key: string) =>
        Object.hasOwn(STRATEGIES, key) && (key !== "orb" || bars[0].t === s.open_ms)
      );
      const setups = scanSetups(
        sym,
        bars,
        {
          levels: plan.levels?.[sym] ?? levels,
          enabled,
          leadDir: ["SPY", "QQQ"].includes(sym) ? 0 : lead,
          now,
        } as any,
      )
        .filter((x) => x.score >= Math.max(80, style.minScore)).sort((a, b) => b.score - a.score);
      for (const signal of setups) {
        const payload = {
          title: "INDAI · " + sym,
          body: signal.title + " · score " + signal.score,
          symbol: sym,
          score: signal.score,
          barT: signal.barT,
          strat: signal.strat,
        };
        if (
          await rpc("indai_queue_signal", {
            p_user: user,
            p_ticker: sym,
            p_bar: signal.barT,
            p_strat: signal.strat,
            p_dir: signal.dir,
            p_hourly: style.perHour,
            p_payload: payload,
          })
        ) {
          queued++;
          break;
        }
      }
    }
  }
  const lease = crypto.randomUUID();
  const deliveries = await rpc("indai_claim_push", { p_lease: lease });
  for (let i = 0; i < deliveries.length; i += 5) {
    await Promise.all(
      deliveries.slice(i, i + 5).map(async (d: any) => {
        const done = () =>
          db("indai_push_queue", {
            event_id: "eq." + d.event_id,
            endpoint: "eq." + d.endpoint,
            lease: "eq." + lease,
          }, { method: "DELETE" });
        try {
          const [current] = await db("indai_profile", {
            user_id: "eq." + d.user_id,
            key: "eq.plan",
            select: "value",
          });
          if (
            !eligible(current?.value, s, Date.now()) || !current.value.strategies.includes(d.payload.strat)
          ) {
            await done();
            return;
          }
          if (await sendPush(d, d.payload) === "expired") {
            await db("indai_push_subs", { endpoint: "eq." + d.endpoint, user_id: "eq." + d.user_id }, {
              method: "DELETE",
            });
          } else await done();
        } catch {
          failures++;
        } // Leave the lease to expire. The browser tag coalesces retried deliveries.
      }),
    );
  }
  return { ok: !failures, detail: `Queued ${queued} setups. ${failures} deliveries require retry.` };
}

-- The candle that is still forming, one row per ticker, from the bridge's updates between candle closes.
-- Kept apart from indai_tv_bars on purpose: everything that reads that table (the push scanner, the price
-- fallback, chart history) relies on its candles being finished.
create table public.indai_tv_live (
  ticker text primary key,
  t bigint not null,
  o numeric, h numeric, l numeric, c numeric not null, v numeric,
  received_at timestamptz not null default now()
);
alter table public.indai_tv_live enable row level security;
revoke all on public.indai_tv_live from public, anon, authenticated;
grant all on public.indai_tv_live to service_role;

-- Stores a batch of forming candles and returns how many rows changed. An update never steps back: a late
-- delivery for an earlier minute, or an earlier update of the same minute, leaves the newer one in place.
create function public.indai_tv_live_put(p_rows jsonb) returns integer
language sql set search_path = '' as $$
  with fresh as (
    select distinct on (r.ticker) r.ticker, r.t, r.o, r.h, r.l, r.c, r.v, coalesce(r.received_at, now()) as received_at
    from jsonb_to_recordset(p_rows) as r(ticker text, t bigint, o numeric, h numeric, l numeric, c numeric, v numeric, received_at timestamptz)
    where r.ticker is not null and r.t is not null and r.c > 0
    order by r.ticker, r.t desc, r.received_at desc nulls last
  ), put as (
    insert into public.indai_tv_live as cur (ticker, t, o, h, l, c, v, received_at)
    select ticker, t, o, h, l, c, v, received_at from fresh
    on conflict (ticker) do update
      set t = excluded.t, o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v, received_at = excluded.received_at
      where excluded.t > cur.t or (excluded.t = cur.t and excluded.received_at >= cur.received_at)
    returning 1
  )
  select count(*)::integer from put;
$$;
revoke all on function public.indai_tv_live_put(jsonb) from public, anon, authenticated;
grant execute on function public.indai_tv_live_put(jsonb) to service_role;

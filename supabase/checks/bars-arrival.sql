-- Checks the bridge-arrival trigger (indai_bars_arrived) in a disposable database. Never run it on the hosted project.
--
--   createdb indai_check
--   psql -v ON_ERROR_STOP=1 -d indai_check \
--     -v migration=supabase/migrations/20261120001048_indai_push_scan_on_bar_arrival.sql -f supabase/checks/bars-arrival.sql
--
-- It stands in for the bridge table and for indai_push_tick(), applies the migration, and counts how often the
-- scan is started. Every line of output must end in "ok".
\set QUIET on
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if not exists(select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
  end loop;
end $$;
create table public.indai_tv_bars (
  ticker text not null, t bigint not null, o numeric, h numeric, l numeric, c numeric, v numeric,
  tf text not null default '1', received_at timestamptz not null default now(), primary key (ticker, t)
);
create table public.scan_started (at timestamptz not null default clock_timestamp());
create function public.indai_push_tick() returns void language plpgsql as $$
begin
  if current_setting('indai_check.fail', true) = 'on' then raise exception 'scan could not be started'; end if;
  insert into public.scan_started default values;
end $$;
\i :migration

-- The start, in milliseconds, of the latest five-minute candle whose last minute has already begun.
create function pg_temp.candle() returns bigint language sql as
  $$ select (floor((extract(epoch from clock_timestamp()) - 240) / 300) * 300)::bigint * 1000 $$;
create function pg_temp.expect(label text, wanted int) returns text language plpgsql as $$
declare got int;
begin
  select count(*) into got from public.scan_started;
  delete from public.scan_started;
  if got <> wanted then raise exception '%: scan started % times, expected %', label, got, wanted; end if;
  return label || ': ok';
end $$;
select pg_temp.candle() as candle \gset
\set QUIET off
\pset tuples_only on

-- 1. The bridge's normal write: six tickers, the minute that completes the candle, sent as one upsert.
insert into public.indai_tv_bars (ticker, t, o, h, l, c, v, tf)
  select s, :candle + 240000, 1, 1, 1, 1, 100, '1' from unnest(array['SPY','QQQ','IWM','TSLA','AMZN','MSFT']) s
  on conflict (ticker, t) do update set c = excluded.c, received_at = now();
select pg_temp.expect('closing minute of a candle starts one scan', 1);

-- 2. The other four minutes of a candle do not start a scan.
insert into public.indai_tv_bars (ticker, t, c, tf)
  select 'SPY', :candle + m * 60000, 1, '1' from generate_series(0, 3) m
  on conflict (ticker, t) do update set c = excluded.c;
select pg_temp.expect('earlier minutes start none', 0);

-- 3. The same closing minute sent again (an update, not a new row) does not start another scan.
insert into public.indai_tv_bars (ticker, t, c, tf) values ('SPY', :candle + 240000, 2, '1')
  on conflict (ticker, t) do update set c = excluded.c, received_at = now();
select pg_temp.expect('a resend starts none', 0);

-- 4. Old candles arriving late (a backfill) do not start a scan.
insert into public.indai_tv_bars (ticker, t, c, tf) values ('SPY', :candle + 240000 - 3600000, 1, '1');
select pg_temp.expect('a backfill starts none', 0);

-- 5. Candles on another timeframe do not start a scan.
insert into public.indai_tv_bars (ticker, t, c, tf) values ('NVDA', :candle + 240000, 1, '5');
select pg_temp.expect('another timeframe starts none', 0);

-- 6. A write with new and already stored rows still starts exactly one scan.
insert into public.indai_tv_bars (ticker, t, c, tf) values ('SPY', :candle + 240000, 3, '1'), ('AAPL', :candle + 240000, 1, '1')
  on conflict (ticker, t) do update set c = excluded.c;
select pg_temp.expect('a mixed write starts one', 1);

-- 7. If the scan cannot be started, the candle is stored all the same.
set indai_check.fail = 'on';
insert into public.indai_tv_bars (ticker, t, c, tf) values ('META', :candle + 240000, 1, '1');
reset indai_check.fail;
select pg_temp.expect('a failed start is swallowed', 0);
do $$ begin
  if not exists(select 1 from public.indai_tv_bars where ticker = 'META') then raise exception 'the candle was lost'; end if;
end $$;
select 'the candle is stored anyway: ok';

-- 8. A write that stores nothing starts nothing.
insert into public.indai_tv_bars (ticker, t, c, tf) select 'SPY', 0, 1, '1' where false;
select pg_temp.expect('an empty write starts none', 0);

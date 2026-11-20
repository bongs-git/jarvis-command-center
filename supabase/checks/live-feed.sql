-- Checks the forming-candle table and its writer (indai_tv_live, indai_tv_live_put) in a disposable database.
-- Never run it on the hosted project.
--
--   createdb indai_check
--   psql -v ON_ERROR_STOP=1 -d indai_check -v migration=supabase/migrations/20261120110046_indai_tv_live.sql -f supabase/checks/live-feed.sql
--
-- Every line of output must end in "ok".
\set QUIET on
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
  end loop;
end $$;
alter role service_role bypassrls; -- as on the hosted project, where the service role is the only reader and writer
drop function if exists public.indai_tv_live_put(jsonb);
drop table if exists public.indai_tv_live;
\i :migration
\pset tuples_only on
\pset format unaligned
create temp table said(line text);
create function pg_temp.say(label text, good boolean) returns void language sql as $$ insert into said values (label || ': ' || case when good then 'ok' else 'FAILED' end) $$;

-- Each write runs in its own statement and is looked at in the next: a statement cannot see its own function's rows.
select public.indai_tv_live_put('[{"ticker":"QQQ","t":1000,"o":1,"h":2,"l":0.5,"c":1.5,"v":10,"received_at":"2026-11-20T10:00:15Z"},{"ticker":"SPY","t":1000,"c":7,"received_at":"2026-11-20T10:00:15Z"}]') as n \gset
select pg_temp.say('two tickers stored', :n = 2 and (select count(*) from public.indai_tv_live) = 2);
select public.indai_tv_live_put('[{"ticker":"QQQ","t":1000,"o":1,"h":3,"l":0.5,"c":2.5,"v":20,"received_at":"2026-11-20T10:00:30Z"}]') as n \gset
select pg_temp.say('a later update of the same minute replaces it', :n = 1 and (select c = 2.5 and h = 3 and v = 20 from public.indai_tv_live where ticker = 'QQQ'));
select public.indai_tv_live_put('[{"ticker":"QQQ","t":1000,"c":9,"received_at":"2026-11-20T10:00:20Z"}]') as n \gset
select pg_temp.say('an earlier update of the same minute, delivered late, changes nothing', :n = 0 and (select c = 2.5 from public.indai_tv_live where ticker = 'QQQ'));
select public.indai_tv_live_put('[{"ticker":"QQQ","t":61000,"o":2.5,"h":2.6,"l":2.4,"c":2.55,"v":3,"received_at":"2026-11-20T10:01:15Z"}]') as n \gset
select pg_temp.say('the next minute replaces it', :n = 1 and (select t = 61000 and c = 2.55 from public.indai_tv_live where ticker = 'QQQ'));
select public.indai_tv_live_put('[{"ticker":"QQQ","t":1000,"c":9,"received_at":"2026-11-20T10:01:40Z"}]') as n \gset
select pg_temp.say('an earlier minute, delivered late, changes nothing', :n = 0 and (select t = 61000 and c = 2.55 from public.indai_tv_live where ticker = 'QQQ'));
select public.indai_tv_live_put('[{"ticker":"IWM","t":61000,"c":5,"received_at":"2026-11-20T10:01:15Z"},{"ticker":"IWM","t":61000,"c":6,"received_at":"2026-11-20T10:01:30Z"},{"ticker":"IWM","t":1000,"c":4,"received_at":"2026-11-20T10:01:45Z"}]') as n \gset
select pg_temp.say('one ticker twice in a batch: the newest wins, no error', :n = 1 and (select c = 6 from public.indai_tv_live where ticker = 'IWM'));
select public.indai_tv_live_put('[{"t":1,"c":1},{"ticker":"X","c":1},{"ticker":"Y","t":1,"c":0},{"ticker":"Z","t":1}]') as n \gset
select pg_temp.say('rows without a ticker, a time or a price are left out', :n = 0 and (select count(*) from public.indai_tv_live) = 3);
select public.indai_tv_live_put('[]') as n \gset
select pg_temp.say('an empty batch is fine', :n = 0);
select pg_temp.say('only the service role can read or write the table', not has_table_privilege('anon', 'public.indai_tv_live', 'select') and not has_table_privilege('authenticated', 'public.indai_tv_live', 'insert') and has_table_privilege('service_role', 'public.indai_tv_live', 'select,insert,update,delete'));
select pg_temp.say('only the service role can call the writer', not has_function_privilege('anon', 'public.indai_tv_live_put(jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.indai_tv_live_put(jsonb)', 'execute') and has_function_privilege('service_role', 'public.indai_tv_live_put(jsonb)', 'execute'));
select pg_temp.say('row level security is on', (select relrowsecurity from pg_class where oid = 'public.indai_tv_live'::regclass));
set role service_role;
select public.indai_tv_live_put('[{"ticker":"TSLA","t":61000,"c":388.1,"received_at":"2026-11-20T10:01:16Z"}]') = 1 as wrote \gset
reset role;
select pg_temp.say('the service role writes through row level security', :'wrote'::boolean);
select line from said;
select case when exists(select 1 from said where line like '%FAILED') then 'RESULT: FAILED' else 'RESULT: all ' || (select count(*) from said) || ' ok' end;

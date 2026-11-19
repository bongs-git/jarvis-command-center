create table if not exists public.indai_gex_levels (
  ticker text not null, scope text not null, asof_et text, expiry date, spot numeric,
  call_wall numeric,put_wall numeric,call_wall2 numeric,put_wall2 numeric,gamma_flip numeric,
  net_gex_m numeric,profile jsonb,source text,updated_at timestamptz default now(),primary key(ticker,scope)
);
-- Reuse the hosted primary/unique index when one already identifies both scopes.
do $$ begin
  if not exists(select 1 from pg_index i where i.indrelid='public.indai_gex_levels'::regclass
    and i.indisunique and i.indisvalid and i.indpred is null and i.indnkeyatts=2
    and (select array_agg(a.attname::text order by a.attname)
      from unnest(i.indkey) with ordinality k(attnum,pos)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
      where k.pos<=i.indnkeyatts)=array['scope','ticker']) then
    create unique index indai_gex_scope_key on public.indai_gex_levels(ticker,scope);
  end if;
end $$;
alter table public.indai_gex_levels enable row level security;
revoke insert,update,delete,truncate on public.indai_gex_levels from public,anon,authenticated;
grant select on public.indai_gex_levels to anon,authenticated;
grant all on public.indai_gex_levels to service_role;
create policy indai_read_levels on public.indai_gex_levels for select to anon,authenticated using(true);

-- NYSE published full-day closures and shortened regular sessions, 2026–2028.
create table public.indai_sessions(day date primary key,close_min integer not null);
insert into public.indai_sessions
select d::date,case when d::date in ('2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24') then 780 else 960 end
from generate_series('2026-01-01'::timestamp,'2028-12-31'::timestamp,interval '1 day') d
where extract(isodow from d)<6 and d::date not in (
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
  '2028-01-17','2028-02-21','2028-04-14','2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-11-23','2028-12-25'
);
alter table public.indai_sessions enable row level security;
revoke all on public.indai_sessions from public,anon,authenticated;
grant all on public.indai_sessions to service_role;
alter table public.indai_job_log add column args jsonb not null default '{}';

create function public.indai_market_session(p_now timestamptz default now())
returns jsonb language sql stable set search_path='' as $$
  with clock as (select p_now at time zone 'America/New_York' et)
  select jsonb_build_object('day',et::date,'minute',extract(hour from et)::int*60+extract(minute from et)::int,
    'close_min',(select close_min from public.indai_sessions where day=et::date),
    'previous',(select max(day) from public.indai_sessions where day<et::date),
    'previous_close_min',(select close_min from public.indai_sessions where day<et::date order by day desc limit 1),
    'open_ms',extract(epoch from ((et::date + time '09:30') at time zone 'America/New_York'))::bigint*1000)
  from clock
$$;
create function public.indai_gex_missing(p_date date) returns table(ticker text)
language sql stable set search_path='' as $$
  with universe as (select distinct g.ticker from public.indai_gex_levels g union values ('SPY'),('QQQ'),('IWM'))
  select u.ticker from universe u where (select count(distinct g.scope) from public.indai_gex_levels g
    where g.ticker=u.ticker and g.scope in ('A','N') and left(g.asof_et::text,10)=p_date::text)<>2 order by u.ticker
$$;
create function public.indai_gex_tick(p_now timestamptz default now()) returns void language plpgsql set search_path='' as $$
declare et timestamp:=p_now at time zone 'America/New_York'; syms text[]; i integer; run_id uuid; missing integer;
begin
  if extract(hour from et)<>9 or extract(minute from et) not in (14,17,20) then return; end if;
  if et::date>(select max(day) from public.indai_sessions) then
    if extract(minute from et)=20 then
      insert into public.indai_job_log(job,state,detail) values('gex','failed','Exchange calendar needs an update.');
    end if;
    return;
  end if;
  if not exists(select 1 from public.indai_sessions where day=et::date) then return; end if;
  select array_agg(ticker order by ticker) into syms from public.indai_gex_missing(et::date);
  missing:=coalesce(cardinality(syms),0);
  if extract(minute from et)=20 then
    insert into public.indai_job_log(job,state,ok,detail) values('gex',case when missing=0 then 'done' else 'failed' end,missing=0,
      case when missing=0 then 'Both scopes refreshed for every ticker.' else format('%s tickers still lack current levels.',missing) end);
    return;
  end if;
  -- Fan out small batches so one expensive index or failed vendor request cannot exhaust the whole run.
  i:=1;
  while i<=missing loop
    run_id:=public.indai_dispatch('gex-batch');
    update public.indai_job_log set args=jsonb_build_object('symbols',syms[i:i+7],'day',et::date) where id=run_id;
    i:=i+8;
  end loop;
end $$;
create function public.indai_job_health() returns table(job text,ok boolean,detail text,at timestamptz,state text)
language sql stable set search_path='' as $$
  select distinct on(j.job) j.job,j.ok,j.detail,j.at,j.state from public.indai_job_log j order by j.job,j.at desc,j.id
$$;
create function public.indai_alert_failure() returns trigger language plpgsql security definer set search_path='' as $$
declare target text; body jsonb;
begin
  if new.state='failed' and (tg_op='INSERT' or old.state is distinct from 'failed') then
    body:=jsonb_build_object('job',new.job,'ok',false,'detail',new.detail,'at',new.at);
    perform pg_notify('indai_job_failures',body::text);
    raise warning 'INDAI job failed: %',new.job;
    begin
      select decrypted_secret into target from vault.decrypted_secrets where name='indai_alert_url';
      if target like 'https://%' then perform net.http_post(url:=target,body:=body); end if;
    exception when others then raise warning 'INDAI external alert enqueue failed'; end;
  end if;
  return new;
end $$;
create trigger indai_job_failed after insert or update of state on public.indai_job_log
for each row execute function public.indai_alert_failure();
revoke all on function public.indai_market_session(timestamptz),public.indai_gex_missing(date),public.indai_gex_tick(timestamptz),public.indai_job_health(),public.indai_alert_failure() from public,anon,authenticated;
grant execute on function public.indai_market_session(timestamptz),public.indai_job_health() to service_role;
-- UTC cron supports either offset. The function checks New York local time and exchange sessions.
select cron.schedule('indai-morning-gex','14,17,20 13,14 * * 1-5',$job$select public.indai_gex_tick()$job$);

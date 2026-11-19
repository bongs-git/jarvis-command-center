-- These tables already exist on the hosted project. Restrict their exposed roles explicitly.
alter table public.indai_private_config enable row level security;
revoke all on public.indai_private_config from public,anon,authenticated;
grant select on public.indai_private_config to service_role;
alter table public.indai_tv_bars enable row level security;
alter table public.indai_tv_alerts enable row level security;
revoke all on public.indai_tv_bars,public.indai_tv_alerts from public,anon,authenticated;
grant all on public.indai_tv_bars,public.indai_tv_alerts to service_role;
create index if not exists indai_tv_bars_retention on public.indai_tv_bars(received_at);
create index if not exists indai_tv_alerts_retention on public.indai_tv_alerts(received_at);
create index if not exists indai_tv_recent_levels on public.indai_tv_alerts(ticker,received_at desc) where levels is not null;

-- Surface a missed watchdog in the read path even if cron itself has stopped.
create or replace function public.indai_job_health() returns table(job text,ok boolean,detail text,at timestamptz,state text)
language sql stable set search_path='' as $$
  with clock as (select now() at time zone 'America/New_York' et),
  due as (select max(s.day) as day from public.indai_sessions s,clock c where s.day<c.et::date or (s.day=c.et::date and c.et::time>=time '09:20')),
  coverage as (select d.day, case when d.day=c.et::date then exists(select 1 from public.indai_gex_missing(d.day)) else false end as missing from due d,clock c),
  latest as (select distinct on(j.job) j.job,j.ok,j.detail,j.at,j.state from public.indai_job_log j order by j.job,j.at desc,j.id)
  select l.job,l.ok,l.detail,l.at,l.state from latest l where l.job<>'gex'
  union all
  select 'gex',coalesce(l.ok and (l.at at time zone 'America/New_York')::date>=d.day and not d.missing,false),
    case when l.at is null or (l.at at time zone 'America/New_York')::date<d.day then 'Scheduled GEX check is missing.'
         when d.missing then 'Some tickers lack current levels.' else l.detail end,
    l.at,case when l.at is null or (l.at at time zone 'America/New_York')::date<d.day then 'stale' else l.state end
    from coverage d left join latest l on l.job='gex'
$$;
grant execute on function public.indai_gex_missing(date) to service_role;

-- Service-owned relations stay inaccessible to both client roles.
do $$ declare t text; begin
  foreach t in array array['indai_job_log','indai_owner','indai_private_config','indai_profile_writes',
    'indai_push_queue','indai_push_subs','indai_rate_events','indai_sessions','indai_signal_events',
    'indai_token_days','indai_token_reservations','indai_tv_alerts','indai_tv_bars'] loop
    execute format('create policy indai_service_only on public.%I for all to service_role using(true) with check(true)',t);
  end loop;
end $$;

-- Each account gets a separate worker deadline. One failed model call cannot starve the next account.
create function public.indai_schedule_memory() returns void language plpgsql set search_path='' as $$
declare owner_id uuid; run_id uuid;
begin
  if to_regprocedure('public.indai_tidy_memory(uuid,jsonb)') is null and exists(select 1 from public.indai_memory) then
    insert into public.indai_job_log(job,state,ok,detail) values('memory','failed',false,'Memory consolidation awaits activation.');
    return;
  end if;
  for owner_id in select distinct user_id from public.indai_memory loop
    run_id:=public.indai_dispatch('memory');
    update public.indai_job_log set args=jsonb_build_object('user',owner_id) where id=run_id;
  end loop;
  if not found then
    insert into public.indai_job_log(job,state,ok,detail) values('memory','done',true,'No saved memories.');
  end if;
end $$;
revoke all on function public.indai_schedule_memory() from public,anon,authenticated;
select cron.schedule('indai-memory-nightly','15 7 * * *',$job$select public.indai_schedule_memory()$job$);

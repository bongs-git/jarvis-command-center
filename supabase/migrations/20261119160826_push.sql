create table public.indai_push_subs (
  endpoint text primary key,keys jsonb not null,user_id uuid not null,updated_at timestamptz not null default now()
);
create index indai_push_user on public.indai_push_subs(user_id);
create table public.indai_signal_events (
  id uuid primary key default gen_random_uuid(),user_id uuid not null,ticker text not null,bar_t bigint not null,
  strat text not null,dir smallint not null,at timestamptz not null default now(),unique(user_id,ticker,bar_t)
);
create index indai_signal_hour on public.indai_signal_events(user_id,at);
create table public.indai_push_queue (
  event_id uuid references public.indai_signal_events on delete cascade,
  endpoint text references public.indai_push_subs on delete cascade,payload jsonb not null,lease uuid,
  available timestamptz not null default now(),expires timestamptz not null default now()+interval '5 minutes',
  primary key(event_id,endpoint)
);
create index indai_push_queue_ready on public.indai_push_queue(available);
create index indai_push_queue_endpoint on public.indai_push_queue(endpoint);
do $$ declare t text; begin
  foreach t in array array['indai_push_subs','indai_signal_events','indai_push_queue'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create function public.indai_register_push(p_user uuid,p_endpoint text,p_keys jsonb) returns boolean language plpgsql set search_path='' as $$
begin
  insert into public.indai_push_subs(endpoint,keys,user_id) values(p_endpoint,p_keys,p_user)
    on conflict(endpoint) do update set keys=excluded.keys,updated_at=now() where public.indai_push_subs.user_id=p_user;
  return found;
end $$;
create function public.indai_queue_signal(p_user uuid,p_ticker text,p_bar bigint,p_strat text,p_dir int,p_hourly int,p_payload jsonb)
returns boolean language plpgsql set search_path='' as $$
declare event uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,10));
  if exists(select 1 from public.indai_signal_events where user_id=p_user and ticker=p_ticker and strat=p_strat and dir=p_dir and at>now()-interval '20 minutes')
     or (select count(*) from public.indai_signal_events where user_id=p_user and at>now()-interval '1 hour') >= p_hourly then return false; end if;
  insert into public.indai_signal_events(user_id,ticker,bar_t,strat,dir) values(p_user,p_ticker,p_bar,p_strat,p_dir)
    on conflict do nothing returning id into event;
  if event is null then return false; end if;
  insert into public.indai_push_queue(event_id,endpoint,payload)
    select event,endpoint,p_payload||jsonb_build_object('tag',event) from public.indai_push_subs where user_id=p_user;
  return true;
end $$;
create function public.indai_claim_push(p_lease uuid) returns table(event_id uuid,endpoint text,keys jsonb,user_id uuid,payload jsonb)
language sql set search_path='' as $$
  with pending as (
    select q.event_id,q.endpoint from public.indai_push_queue q where available<=now() and expires>now()
    order by available limit 40 for update skip locked
  ), claimed as (
    update public.indai_push_queue q set available=now()+interval '1 minute',lease=p_lease from pending p
      where q.event_id=p.event_id and q.endpoint=p.endpoint returning q.*
  ) select c.event_id,c.endpoint,s.keys,s.user_id,c.payload from claimed c join public.indai_push_subs s using(endpoint)
$$;
create function public.indai_push_tick() returns void language plpgsql set search_path='' as $$
declare s jsonb:=public.indai_market_session();
begin
  if (s->>'minute')::int>=570 and (s->>'minute')::int<(s->>'close_min')::int and exists(select 1 from public.indai_push_subs) then
    perform public.indai_dispatch('push');
  end if;
end $$;
create function public.indai_move_owner_push() returns trigger language plpgsql set search_path='' as $$
begin
  update public.indai_push_subs set user_id=new.user_id where user_id=old.user_id;
  update public.indai_signal_events set user_id=new.user_id where user_id=old.user_id;
  return new;
end $$;
create trigger indai_move_owner_push after update of user_id on public.indai_owner for each row execute function public.indai_move_owner_push();
revoke all on function public.indai_register_push(uuid,text,jsonb),public.indai_queue_signal(uuid,text,bigint,text,int,int,jsonb),
 public.indai_claim_push(uuid),public.indai_push_tick(),public.indai_move_owner_push() from public,anon,authenticated;
grant execute on function public.indai_register_push(uuid,text,jsonb),public.indai_queue_signal(uuid,text,bigint,text,int,int,jsonb),
 public.indai_claim_push(uuid) to service_role;
select cron.schedule('indai-push-scan','* 13-20 * * 1-5',$job$select public.indai_push_tick()$job$);

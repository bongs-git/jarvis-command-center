create table public.indai_owner(singleton boolean primary key default true check(singleton),user_id uuid not null);
insert into public.indai_owner(user_id) values('00000000-0000-4000-8000-000000000001');
alter table public.indai_owner enable row level security;
revoke all on public.indai_owner from public,anon,authenticated;
grant select on public.indai_owner to service_role;

-- Run once as the database administrator after the owner's first verified magic-link sign-in.
create function public.indai_link_owner(p_target uuid) returns void language plpgsql set search_path='' as $$
declare old_id uuid; p record;
begin
  select user_id into strict old_id from public.indai_owner for update;
  if old_id=p_target then return; end if;
  if old_id<>'00000000-0000-4000-8000-000000000001' or not exists(
    select 1 from auth.users where id=p_target and email_confirmed_at is not null
  ) then raise exception 'Select the verified owner account'; end if;
  for p in select key,value from public.indai_profile where user_id=old_id loop
    perform public.indai_put_profile(p_target,p.key,p.value,null);
  end loop;
  insert into public.indai_profile_writes select p_target,key,mutation_id,at from public.indai_profile_writes where user_id=old_id on conflict do nothing;
  delete from public.indai_profile_writes where user_id=old_id;
  delete from public.indai_profile where user_id=old_id;
  update public.indai_turns set user_id=p_target where user_id=old_id;
  update public.indai_memory set user_id=p_target where user_id=old_id;
  update public.indai_owner set user_id=p_target;
end $$;
revoke all on function public.indai_link_owner(uuid) from public,anon,authenticated,service_role;

do $policies$ declare t text; begin
  foreach t in array array['indai_memory','indai_profile','indai_turns'] loop
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy own_rows on public.%I for select to authenticated using(user_id=(select auth.uid()))',t);
    -- Restrictive as well in case an older permissive policy existed before this migration.
    execute format('create policy account_boundary on public.%I as restrictive for select to authenticated using(user_id=(select auth.uid()))',t);
  end loop;
end $policies$;

create table public.indai_rate_events(id bigint generated always as identity primary key,user_id uuid not null, bucket text not null, at timestamptz not null default now());
create index indai_rate_window on public.indai_rate_events(user_id,bucket,at);
alter table public.indai_rate_events enable row level security;
revoke all on public.indai_rate_events from public,anon,authenticated;
grant all on public.indai_rate_events to service_role;
grant usage,select on sequence public.indai_rate_events_id_seq to service_role;
create function public.indai_take_request(p_user uuid,p_bucket text default 'brain',p_limit int default 60) returns boolean
language plpgsql set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_bucket,8));
  delete from public.indai_rate_events where user_id=p_user and bucket=p_bucket and at<=now()-interval '1 hour';
  if (select count(*) from public.indai_rate_events where user_id=p_user and bucket=p_bucket)>=p_limit then return false; end if;
  insert into public.indai_rate_events(user_id,bucket) values(p_user,p_bucket);
  return true;
end $$;
revoke all on function public.indai_take_request(uuid,text,int) from public,anon,authenticated;
grant execute on function public.indai_take_request(uuid,text,int) to service_role;

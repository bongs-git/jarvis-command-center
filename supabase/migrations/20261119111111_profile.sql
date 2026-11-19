create table public.indai_profile (
  user_id uuid not null, key text not null, value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(user_id,key), check (octet_length(value::text) <= 65536)
);
create table public.indai_profile_writes (
  user_id uuid not null, key text not null, mutation_id uuid not null, at timestamptz not null default now(),
  primary key(user_id,key,mutation_id)
);
alter table public.indai_profile enable row level security;
alter table public.indai_profile_writes enable row level security;
revoke all on public.indai_profile, public.indai_profile_writes from public, anon, authenticated;
grant all on public.indai_profile, public.indai_profile_writes to service_role;

create function public.indai_put_profile(p_user uuid, p_key text, p_value jsonb, p_mutation uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  old_value jsonb;
  merged jsonb;
  field text;
  counters jsonb;
  result jsonb;
begin
  if jsonb_typeof(p_value) is distinct from 'object' then raise exception 'invalid_profile'; end if;
  if octet_length(p_value::text) > 65536 then raise exception 'profile_too_large'; end if;
  -- A row lock also serializes two devices creating the first version.
  insert into public.indai_profile(user_id,key,value) values(p_user,p_key,'{}') on conflict do nothing;
  select value into strict old_value from public.indai_profile where user_id=p_user and key=p_key for update;
  if p_mutation is not null then
    insert into public.indai_profile_writes(user_id,key,mutation_id) values (p_user,p_key,p_mutation) on conflict do nothing;
    if not found then
      select to_jsonb(p)-'user_id' into result from public.indai_profile p where user_id=p_user and key=p_key;
      return result;
    end if;
  end if;
  -- A new daily plan gets a fresh breaker and goal state. Intra-day updates merge normally.
  if p_key='plan' and p_value ? 'date' and (p_value->>'date') is distinct from (old_value->>'date') then
    merged:=p_value;
  else
    merged:=old_value || p_value;
  end if;
  if p_key = 'indai.speech.v1' then
    foreach field in array array['used','stats'] loop
      if jsonb_typeof(coalesce(p_value->field,'{}')) <> 'object' then raise exception 'invalid_profile'; end if;
      if exists(select 1 from jsonb_each(coalesce(p_value->field,'{}')) c
                where jsonb_typeof(c.value)<>'number' or c.value::text !~ '^[0-9]{1,15}$') then
        raise exception 'invalid_profile';
      end if;
      select coalesce(jsonb_object_agg(k,total),'{}') into counters from (
        select k,sum(v::numeric) total from (
          select key k,value v from jsonb_each_text(coalesce(old_value->field,'{}'))
          union all select key,value from jsonb_each_text(coalesce(p_value->field,'{}'))
        ) input group by k
      ) totals;
      merged := jsonb_set(merged,array[field],counters);
    end loop;
    if jsonb_typeof(coalesce(p_value->'fixes','{}')) <> 'object' then raise exception 'invalid_profile'; end if;
    if exists(select 1 from jsonb_each(coalesce(p_value->'fixes','{}')) f
              where jsonb_typeof(f.value->'to') is distinct from 'string' or coalesce(f.value->>'n','') !~ '^[0-9]{1,15}$') then
      raise exception 'invalid_profile';
    end if;
    select coalesce(jsonb_object_agg(k,v),'{}') into counters from (
      select distinct on (k) k,v from (
        select key k,value v,0 priority from jsonb_each(coalesce(old_value->'fixes','{}'))
        union all select key,value,1 from jsonb_each(coalesce(p_value->'fixes','{}'))
      ) fixes order by k,(v->>'n')::numeric desc,priority desc
    ) winners;
    merged := jsonb_set(merged,'{fixes}',counters);
  end if;
  if octet_length(merged::text) > 65536 then raise exception 'profile_too_large'; end if;
  update public.indai_profile p set value=merged, updated_at=clock_timestamp()
    where user_id=p_user and key=p_key returning to_jsonb(p)-'user_id' into result;
  return result;
end $$;
revoke all on function public.indai_put_profile(uuid,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.indai_put_profile(uuid,text,jsonb,uuid) to service_role;

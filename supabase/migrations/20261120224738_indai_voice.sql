-- INDAI's hosted voice. indai_voice holds which ElevenLabs voice is hers (one row); indai_voice_days counts the
-- characters spoken each New York day, and indai_voice_take refuses a request that would pass the day's limit, so a
-- fault in an app cannot run up the owner's ElevenLabs bill. Only the service role reads or writes any of it.
create table public.indai_voice (
  id text primary key check (id = 'owner'),
  voice_id text not null check (voice_id ~ '^[A-Za-z0-9]{8,64}$'),
  voice_name text not null default '',
  picked text not null default 'owner' check (picked in ('owner', 'auto')),
  updated_at timestamptz not null default now()
);
create table public.indai_voice_days (
  day date primary key,
  chars integer not null default 0 check (chars >= 0),
  requests integer not null default 0
);
alter table public.indai_voice enable row level security;
alter table public.indai_voice_days enable row level security;
revoke all on public.indai_voice, public.indai_voice_days from public, anon, authenticated;
grant select, insert, update, delete on public.indai_voice, public.indai_voice_days to service_role;
create policy indai_service_only on public.indai_voice for all to service_role using (true) with check (true);
create policy indai_service_only on public.indai_voice_days for all to service_role using (true) with check (true);

create function public.indai_voice_take(p_chars integer, p_limit integer) returns boolean
language plpgsql set search_path = '' as $$
declare d date := (now() at time zone 'America/New_York')::date;
begin
  if p_chars <= 0 or p_limit < 0 then raise exception 'Invalid voice allowance'; end if;
  insert into public.indai_voice_days(day) values (d) on conflict do nothing;
  update public.indai_voice_days set chars = chars + p_chars, requests = requests + 1 where day = d and chars + p_chars <= p_limit;
  return found;
end $$;
revoke all on function public.indai_voice_take(integer, integer) from public, anon, authenticated;
grant execute on function public.indai_voice_take(integer, integer) to service_role;

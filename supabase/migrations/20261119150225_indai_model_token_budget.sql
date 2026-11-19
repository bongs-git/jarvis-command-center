create table public.indai_token_days(day date primary key,spent bigint not null default 0,reserved bigint not null default 0);
create table public.indai_token_reservations(id uuid primary key,day date not null references public.indai_token_days,
  amount bigint not null,settled boolean not null default false,at timestamptz not null default now());
create index indai_token_day on public.indai_token_reservations(day);
alter table public.indai_token_days enable row level security;
alter table public.indai_token_reservations enable row level security;
revoke all on public.indai_token_days,public.indai_token_reservations from public,anon,authenticated;
grant all on public.indai_token_days,public.indai_token_reservations to service_role;

create function public.indai_reserve_tokens(p_amount bigint,p_limit bigint) returns uuid language plpgsql set search_path='' as $$
declare d date:=(now() at time zone 'America/New_York')::date; reservation uuid:=gen_random_uuid();
begin
  if p_amount<=0 or p_limit<0 then raise exception 'Invalid token budget'; end if;
  insert into public.indai_token_days(day) values(d) on conflict do nothing;
  update public.indai_token_days set reserved=reserved+p_amount where day=d and spent+reserved+p_amount<=p_limit;
  if not found then return null; end if;
  insert into public.indai_token_reservations(id,day,amount) values(reservation,d,p_amount);
  return reservation;
end $$;
create function public.indai_settle_tokens(p_id uuid,p_actual bigint) returns void language plpgsql set search_path='' as $$
declare r public.indai_token_reservations%rowtype;
begin
  update public.indai_token_reservations set settled=true where id=p_id and not settled returning * into r;
  if found then update public.indai_token_days set reserved=reserved-r.amount,spent=spent+greatest(0,coalesce(p_actual,r.amount)) where day=r.day; end if;
end $$;
revoke all on function public.indai_reserve_tokens(bigint,bigint),public.indai_settle_tokens(uuid,bigint) from public,anon,authenticated;
grant execute on function public.indai_reserve_tokens(bigint,bigint),public.indai_settle_tokens(uuid,bigint) to service_role;

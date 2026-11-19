create table public.indai_turns (
  id bigint generated always as identity primary key, user_id uuid not null,
  session text not null check (length(session) between 1 and 100),
  role text not null check (role in ('user','assistant')), text text not null,
  request_id uuid, created_at timestamptz not null default now(),
  unique(user_id,session,request_id,role)
);
create index indai_turns_recent on public.indai_turns(user_id,session,created_at desc,id desc);
alter table public.indai_turns enable row level security;
revoke all on public.indai_turns from public,anon,authenticated;
grant all on public.indai_turns to service_role;
grant usage,select on sequence public.indai_turns_id_seq to service_role;

-- What the back end remembers about an outside data source that is refusing its servers, so that every instance
-- of a function stops asking until the pause is over. One row per source while it is refusing; no row when it answers.
create table public.indai_feed_gate (
  name text primary key,
  status integer not null,
  wait_ms integer not null check (wait_ms > 0),
  until timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.indai_feed_gate enable row level security;
revoke all on public.indai_feed_gate from public, anon, authenticated;
grant select, insert, update, delete on public.indai_feed_gate to service_role;
create policy indai_service_only on public.indai_feed_gate for all to service_role using (true) with check (true);

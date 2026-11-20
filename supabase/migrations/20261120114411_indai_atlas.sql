-- The Market Pattern Atlas: private reference data the brain reads. Key 'kb' holds the knowledge base.
-- Only the table is defined here. The data is loaded by hand and is never kept in this repository.
create table public.indai_atlas (
  key text primary key,
  value jsonb not null,
  version text,
  updated_at timestamptz not null default now()
);
alter table public.indai_atlas enable row level security;
revoke all on public.indai_atlas from public, anon, authenticated;
grant select on public.indai_atlas to service_role;
create policy indai_service_only on public.indai_atlas for all to service_role using (true) with check (true);

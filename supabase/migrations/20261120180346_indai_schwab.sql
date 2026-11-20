-- The owner's sign-in to his Schwab account: the tokens Schwab issued, where only the back end can read them.
-- One row while he is signed in. Schwab makes him sign in again seven days after signed_in_at.
create table public.indai_schwab (
  id text primary key default 'owner' check (id = 'owner'),
  refresh_token text not null,
  signed_in_at timestamptz not null,
  access_token text,
  access_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.indai_schwab enable row level security;
revoke all on public.indai_schwab from public, anon, authenticated;
grant select, insert, update, delete on public.indai_schwab to service_role;
create policy indai_service_only on public.indai_schwab for all to service_role using (true) with check (true);

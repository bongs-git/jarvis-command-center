-- Every order INDAI is asked to send to the owner's Schwab account, written before Schwab is called and completed
-- with Schwab's answer. `nonce` is made by the page for each tap: a second request with the same one is not sent
-- again. Only the service role reads or writes this; it holds no account number, only the last four digits.
create table public.indai_orders (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  nonce uuid not null unique,
  op text not null check (op in ('place', 'stop', 'close', 'cancel')),
  account_tail text not null,
  request jsonb not null,
  status integer,
  order_id text,
  message text
);
alter table public.indai_orders enable row level security;
revoke all on public.indai_orders from public, anon, authenticated;
grant select, insert, update on public.indai_orders to service_role;
create policy indai_service_only on public.indai_orders for all to service_role using (true) with check (true);

-- The devices allowed to send orders. The passcode alone reads; sending also needs a key that one of the owner's own
-- devices made and keeps. Only its SHA-256 is stored. The first device to ask is approved; a later one waits until
-- an approved device approves it. To start over (all devices lost): delete from public.indai_trade_devices;
create table public.indai_trade_devices (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  label text not null default '',
  approved boolean not null default false,
  added_at timestamptz not null default now()
);
alter table public.indai_trade_devices enable row level security;
revoke all on public.indai_trade_devices from public, anon, authenticated;
grant select, insert, update, delete on public.indai_trade_devices to service_role;
create policy indai_service_only on public.indai_trade_devices for all to service_role using (true) with check (true);

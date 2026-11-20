-- The idea each account last asked INDAI about, so the conversation can go on about it: their words, the parsed
-- idea, the numbers the command center worked out, and her verdict when the research finished. One row per account,
-- replaced by the next idea. Only the service role reads or writes it.
create table public.indai_last_idea (
  user_id uuid primary key,
  at timestamptz not null default now(),
  talked_at timestamptz,
  question text not null default '' check (length(question) <= 600),
  idea jsonb,
  numbers text not null default '' check (length(numbers) <= 24000),
  verdict jsonb
);
alter table public.indai_last_idea enable row level security;
revoke all on public.indai_last_idea from public, anon, authenticated;
grant select, insert, update, delete on public.indai_last_idea to service_role;
create policy indai_service_only on public.indai_last_idea for all to service_role using (true) with check (true);

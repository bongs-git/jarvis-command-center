create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault cascade;

create table public.indai_job_log (
  id uuid primary key default gen_random_uuid(), job text not null, ok boolean not null default false,
  detail text not null default 'queued', at timestamptz not null default now(),
  state text not null default 'queued' check(state in ('queued','running','done','failed')), request_id bigint
);
create index indai_job_latest on public.indai_job_log(job,at desc);
alter table public.indai_job_log enable row level security;
revoke all on public.indai_job_log from public,anon,authenticated;
grant all on public.indai_job_log to service_role;
do $$ begin
  if not exists(select 1 from vault.secrets where name='indai_job_token') then
    perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'indai_job_token');
  end if;
end $$;
-- Store the target URL in Vault at deployment. A local database never contacts production by default.
create function public.indai_job_authorized(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from vault.decrypted_secrets where name='indai_job_token' and decrypted_secret=p_token)
$$;
create function public.indai_dispatch(p_job text) returns uuid language plpgsql security definer set search_path='' as $$
declare run_id uuid; target text; token text; request bigint;
begin
  insert into public.indai_job_log(job) values(p_job) returning id into run_id;
  begin
    select decrypted_secret into strict target from vault.decrypted_secrets where name='indai_project_url';
    select decrypted_secret into strict token from vault.decrypted_secrets where name='indai_job_token';
    select net.http_post(url:=rtrim(target,'/')||'/functions/v1/indai-jobs',
      headers:=jsonb_build_object('content-type','application/json','x-indai-job',token),
      body:=jsonb_build_object('job',p_job,'id',run_id),timeout_milliseconds:=120000) into request;
    update public.indai_job_log set request_id=request where id=run_id;
  exception when others then
    update public.indai_job_log set state='failed',detail='Job scheduling failed. Check Vault and pg_net.' where id=run_id;
  end;
  return run_id;
end $$;
create function public.indai_reconcile_jobs() returns void language sql security definer set search_path='' as $$
  update public.indai_job_log j set state='failed',detail='Job did not complete. Check Edge Function logs.'
  where state in ('queued','running') and (at < now()-interval '5 minutes' or exists(
    select 1 from net._http_response r where r.id=j.request_id and (r.timed_out or r.error_msg is not null or r.status_code>=400)
  ))
$$;
revoke all on function public.indai_job_authorized(text),public.indai_dispatch(text),public.indai_reconcile_jobs() from public,anon,authenticated;
grant execute on function public.indai_job_authorized(text) to service_role;
select cron.schedule('indai-memory-nightly','15 7 * * *',$job$select public.indai_dispatch('memory')$job$);
select cron.schedule('indai-job-reconcile','* * * * *',$job$select public.indai_reconcile_jobs()$job$);

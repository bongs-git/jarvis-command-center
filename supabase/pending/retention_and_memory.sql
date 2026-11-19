-- The model proposes IDs only. Keep an existing fact and scope every write to one account.
create function public.indai_tidy_memory(p_user uuid,p_groups jsonb) returns void language plpgsql set search_path='' as $$
declare grp jsonb; members bigint[]; survivor bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,5));
  for grp in
    select to_jsonb(array_agg(id order by uses desc,created_at,id)) from public.indai_memory
      where user_id=p_user group by lower(btrim(regexp_replace(text,'\s+',' ','g'))) having count(*)>1
    union all select value from jsonb_array_elements(p_groups)
  loop
    select array_agg(id order by uses desc,created_at,id) into members from public.indai_memory
      where user_id=p_user and id in (select value::bigint from jsonb_array_elements_text(grp));
    if cardinality(members)>1 then
      survivor:=members[1];
      update public.indai_memory set uses=(select sum(uses) from public.indai_memory where id=any(members) and user_id=p_user),
        last_used=(select max(last_used) from public.indai_memory where id=any(members) and user_id=p_user)
        where id=survivor and user_id=p_user;
      delete from public.indai_memory where user_id=p_user and id=any(members) and id<>survivor;
    end if;
  end loop;
  delete from public.indai_memory where user_id=p_user and id in (
    select id from public.indai_memory where user_id=p_user
      order by uses desc,coalesce(last_used,created_at) desc,created_at desc,id desc offset 150
  );
end $$;
revoke all on function public.indai_tidy_memory(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.indai_tidy_memory(uuid,jsonb) to service_role;

-- Run once as the database administrator after the owner's first verified magic-link sign-in.
create function public.indai_link_owner(p_target uuid) returns void language plpgsql set search_path='' as $$
declare old_id uuid; p record;
begin
  select user_id into strict old_id from public.indai_owner for update;
  if old_id=p_target then return; end if;
  if old_id<>'00000000-0000-4000-8000-000000000001' or not exists(
    select 1 from auth.users where id=p_target and email_confirmed_at is not null
  ) then raise exception 'Select the verified owner account'; end if;
  for p in select key,value from public.indai_profile where user_id=old_id loop
    perform public.indai_put_profile(p_target,p.key,p.value,null);
  end loop;
  insert into public.indai_profile_writes select p_target,key,mutation_id,at from public.indai_profile_writes where user_id=old_id on conflict do nothing;
  delete from public.indai_profile_writes where user_id=old_id;
  delete from public.indai_profile where user_id=old_id;
  update public.indai_turns set user_id=p_target where user_id=old_id;
  update public.indai_memory set user_id=p_target where user_id=old_id;
  update public.indai_owner set user_id=p_target;
end $$;
revoke all on function public.indai_link_owner(uuid) from public,anon,authenticated,service_role;


create function public.indai_retention() returns void language plpgsql set search_path='' as $$
declare run_id uuid;
begin
  insert into public.indai_job_log(job,state,detail) values('retention','running','running') returning id into run_id;
  begin
    delete from public.indai_tv_bars where received_at<now()-interval '3 days';
    delete from public.indai_tv_alerts where received_at<now()-interval '3 days';
    update public.indai_job_log set ok=true,state='done',detail='Retention completed.' where id=run_id;
  exception when others then
    update public.indai_job_log set state='failed',detail='Retention failed. Check database logs.' where id=run_id;
  end;
end $$;
revoke all on function public.indai_retention() from public,anon,authenticated;
select cron.schedule('indai-retention','45 7 * * *',$job$select public.indai_retention()$job$);



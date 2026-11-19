do $$ begin
  if exists(select 1 from pg_policies where schemaname='public' and tablename='indai_gex_levels'
       and policyname<>'indai_read_levels' and permissive='PERMISSIVE' and cmd='SELECT' and qual='true'
       and roles @> array['anon','authenticated']::name[]) then
    alter policy indai_read_levels on public.indai_gex_levels to service_role;
  end if;
end $$;

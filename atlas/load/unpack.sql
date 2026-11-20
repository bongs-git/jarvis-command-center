-- Loading the private knowledge base into public.indai_atlas, the database's side. See README.md beside this file.
-- Nothing here holds data. Run it in three steps: (1) this top part, (2) the statements pack.py wrote,
-- (3) the two commented blocks at the end, with the fingerprints pack.py printed.

-- (1) A staging area nothing outside the database can reach (the API only serves the public schema).
create schema if not exists indai_stage;
revoke all on schema indai_stage from public, anon, authenticated;
create table if not exists indai_stage.atlas_part (part int primary key, want text not null, body text not null);
alter table indai_stage.atlas_part enable row level security;
revoke all on indai_stage.atlas_part from public, anon, authenticated;

-- Decimals rebuilt from counts must print with every digit. The hosted database prints 15 by default
-- (extra_float_digits = 0), which would silently round win and lift: hence the setting on each function.
create or replace function indai_stage.atlas_num(x float8) returns jsonb language sql immutable set extra_float_digits = 1 as $f$
  select case when x::text ~ '^-?[0-9]+$' then (x::text || '.0')::jsonb else to_jsonb(x) end
$f$;
create or replace function indai_stage.atlas_cell(c jsonb, pooled boolean) returns jsonb language sql immutable as $f$
  select case jsonb_typeof(c)
    when 'object' then c
    when 'number' then case when pooled then '{"n":0,"wins":0,"win":null,"base":null,"net":null,"ci":null,"lift":null}'::jsonb
                            else '{"n":0,"wins":0,"win":null,"base":null,"net":null,"lift":null}'::jsonb end
    else jsonb_build_object('n', c->0, 'wins', c->1,
           'win', indai_stage.atlas_num((c->>1)::float8 / (c->>0)::float8),
           'base', c->2, 'net', c->3,
           'lift', indai_stage.atlas_num((c->>1)::float8 / (c->>0)::float8 - (c->>2)::float8))
         || case when pooled then jsonb_build_object('ci', coalesce(c->4, 'null'::jsonb)) else '{}'::jsonb end
  end
$f$;
create or replace function indai_stage.atlas_unpack(p jsonb) returns jsonb language sql immutable set extra_float_digits = 1 as $f$
  with d as (
    select array(select jsonb_array_elements_text(p->'e')) as e, array(select jsonb_array_elements_text(p->'tv')) as tv,
           array(select jsonb_array_elements_text(p->'h')) as h, array(select jsonb_array_elements_text(p->'gk')) as gk
  ), r as (
    select x.rule->>0 as key, x.rule->1 as meta, x.rule->>2 as grades, x.rule->3 as pooled, x.rule->4 as matrix
    from jsonb_array_elements(p->'r') as x(rule)
  ), built as (
    select r.key, r.meta || jsonb_build_object(
      'pooled', (select jsonb_object_agg(d.e[ei], (select jsonb_object_agg(d.h[hi],
                   indai_stage.atlas_cell(r.pooled -> ((ei-1)*cardinality(d.h) + hi-1), true)) from generate_subscripts(d.h,1) hi))
                 from generate_subscripts(d.e,1) ei),
      'matrix', (select jsonb_object_agg(d.e[ei], (select jsonb_object_agg(d.tv[ti], (select jsonb_object_agg(d.h[hi],
                   indai_stage.atlas_cell(r.matrix -> (((ei-1)*cardinality(d.tv) + ti-1)*cardinality(d.h) + hi-1), false)) from generate_subscripts(d.h,1) hi))
                 from generate_subscripts(d.tv,1) ti)) from generate_subscripts(d.e,1) ei),
      'cell_grades', (select jsonb_object_agg(d.gk[gi], p->'gv'->substr(r.grades, gi, 1)) from generate_subscripts(d.gk,1) gi)
    ) as rule
    from r, d
  )
  select (p->'o') || jsonb_build_object('rules', (select jsonb_object_agg(key, rule) from built))
$f$;

-- (3a) After every statement has answered ok = true for every row: store it, but only if the fingerprint is right.
-- with src as (select indai_stage.atlas_unpack(string_agg(body, '' order by part)::jsonb) as kb from indai_stage.atlas_part),
-- put as (
--   insert into public.indai_atlas (key, value, version)
--   select 'kb', kb, '<version, e.g. rev1.1-corrected>' from src where md5(kb::text) = '<fingerprint of the stored value>'
--   on conflict (key) do update set value = excluded.value, version = excluded.version, updated_at = now()
--   returning 1)
-- select (select count(*) from put) as stored,
--        (select md5(string_agg(body, '' order by part)) from indai_stage.atlas_part) as packed_fingerprint,
--        (select md5(kb::text) from src) as stored_fingerprint;

-- (3b) Then remove the staging area.
-- drop schema indai_stage cascade;

-- One database round trip applies both limits before a stateless guest stream reaches the model.
create function public.indai_admit_guest_stream(p_amount bigint,p_token_limit bigint) returns jsonb
language plpgsql set search_path='' as $$
declare reservation uuid;
begin
  if not public.indai_take_request('00000000-0000-4000-8000-000000000002'::uuid,'brain',60) then
    return jsonb_build_object('error','rate_limited');
  end if;
  reservation:=public.indai_reserve_tokens(p_amount,p_token_limit);
  if reservation is null then return jsonb_build_object('error','budget'); end if;
  return jsonb_build_object('id',reservation);
end $$;
revoke all on function public.indai_admit_guest_stream(bigint,bigint) from public,anon,authenticated;
grant execute on function public.indai_admit_guest_stream(bigint,bigint) to service_role;

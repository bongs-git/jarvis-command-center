-- One-minute candles are what the alert scan, the charts and the price fallback are built from. The bridge table's
-- key is (ticker, t), so a candle from a bridge alert on another timeframe that starts at the same moment used to
-- replace the one-minute candle (on November 20 a second alert on a 5-minute chart was running beside the
-- 1-minute one). A stored one-minute candle now stays: an update that would change its timeframe is skipped.
-- A one-minute candle still replaces a stored candle of another timeframe.
create function public.indai_keep_minute_bar() returns trigger language plpgsql set search_path='' as $$
begin
  if old.tf = '1' and new.tf is distinct from '1' then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.indai_keep_minute_bar() from public,anon,authenticated;
create trigger indai_keep_minute_bar before update on public.indai_tv_bars
  for each row execute function public.indai_keep_minute_bar();

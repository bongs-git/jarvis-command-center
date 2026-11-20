-- Start the setup-alert scan the moment a five-minute candle is complete.
--
-- The TradingView bridge stores each one-minute candle about three seconds after the minute closes. The
-- per-minute timer (indai-push-scan) runs at second 0, so it always just missed the newest candle and found it
-- on the next run, close to a minute later. This trigger starts the same scan as soon as the minute that
-- completes a five-minute candle is stored. The timer stays as the fallback, and the scan itself is unchanged:
-- public.indai_push_tick() still checks the session and that someone is subscribed, and a setup can only be
-- queued once for a user, ticker and candle.
create function public.indai_bars_arrived() returns trigger language plpgsql security definer set search_path='' as $$
begin
  begin
    if exists(
      select 1 from fresh
      where tf='1' and t % 300000 = 240000
        and t > (extract(epoch from clock_timestamp())*1000)::bigint - 420000 -- the scan ignores candles that closed over six minutes ago
    ) then
      perform public.indai_push_tick();
    end if;
  exception when others then
    null; -- Storing the candle must never fail because the scan could not be started. The timer covers it.
  end;
  return null;
end $$;
revoke all on function public.indai_bars_arrived() from public,anon,authenticated;
create trigger indai_bars_arrived after insert on public.indai_tv_bars
  referencing new table as fresh for each statement execute function public.indai_bars_arrived();

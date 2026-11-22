-- Called once a day by the Vercel cron job (api/keepalive.js) so the free
-- Supabase project never counts as inactive and never gets paused.
-- It reads nothing and returns only a timestamp, so it is safe to expose.
create function public.keep_alive() returns timestamptz
language sql stable security invoker set search_path = '' as $$
  select now();
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated, service_role;

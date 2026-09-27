-- Additive and safe to reapply. Apply before deploying the security release.
begin;

-- Application attempts are accessed exclusively by the backend/service role.
alter table public.ready_program_attempts enable row level security;
revoke all on public.ready_program_attempts from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;

create table if not exists public.login_attempt_limits (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  window_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts between 1 and 21)
);
create index if not exists login_attempt_limits_window_idx on public.login_attempt_limits(window_at);
alter table public.login_attempt_limits enable row level security;
revoke all on public.login_attempt_limits from public, anon, authenticated;
grant select, insert, update, delete on public.login_attempt_limits to service_role;

-- One atomic upsert serializes concurrent attempts across server processes.
-- Unknown and known accounts have identical limits; no passwords are stored.
create or replace function public.app_login_attempt_limit(p_email_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare limits public.login_attempt_limits%rowtype;
begin
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login limit key';
  end if;
  delete from public.login_attempt_limits where email_hash in (
    select email_hash from public.login_attempt_limits
    where window_at < now() - interval '1 day'
    order by window_at limit 100 for update skip locked
  );
  insert into public.login_attempt_limits as existing(email_hash) values(p_email_hash)
  on conflict (email_hash) do update set
    attempts = case when existing.window_at <= now() - interval '15 minutes' then 1 else least(existing.attempts + 1, 21) end,
    window_at = case when existing.window_at <= now() - interval '15 minutes' then now() else existing.window_at end
  returning * into limits;
  if limits.attempts > 20 then
    return jsonb_build_object('allowed', false, 'retryAfter', greatest(1,
      ceil(extract(epoch from limits.window_at + interval '15 minutes' - now()))::integer));
  end if;
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.app_login_attempt_limit(text) from public, anon, authenticated;
grant execute on function public.app_login_attempt_limit(text) to service_role;

notify pgrst, 'reload schema';
commit;

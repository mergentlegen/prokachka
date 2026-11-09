-- Levels without XP. 100 miles on level 1 move a participant to level 2 (Капитан) automatically; stars no longer count.
-- Level 3 is given only by a team admin. Everyone who reached a level before this change is back on level 1:
-- after the captain game went from 20 to 10 miles nobody in the team has 100 miles.
-- The team rating is by miles and by stars again (app_ranking), so the per-level standings are removed.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

create or replace function public.app_check_member_level(p_user uuid, p_delay interval default '0 seconds')
returns smallint language plpgsql security definer set search_path = public as $$
declare current_level smallint; member public.users%rowtype;
begin
  select * into member from public.users where id = p_user;
  if member.id is null or member.role <> 'member' then return null; end if;
  current_level := public.app_member_level(p_user);
  -- Only level 1 → 2 is automatic; the same 100 is LEVEL_UP_MILES on the site.
  if current_level <> 1 then return current_level; end if;
  if (select t.miles from public.app_level_totals(p_user, 1::smallint) t) < 100 then return current_level; end if;
  -- A level 2 row that exists here was revoked by a mentor: that decision stays.
  if exists(select 1 from public.member_levels where user_id = p_user and level = 2) then return current_level; end if;
  -- The real clock, not the transaction start: the work that made 100 still belongs to level 1.
  insert into public.member_levels(user_id, level, reached_at) values(p_user, 2, clock_timestamp()) on conflict do nothing;
  if found then perform public.app_level_notify(p_user, 2::smallint, null, p_delay); end if;
  return public.app_member_level(p_user);
end $$;

-- Stars do not move anyone up any more; accepted works and reviews (1 mile each) still do.
drop trigger if exists star_awards_level_check on public.star_awards;

-- One time: everyone back on level 1, with no unsent congratulations. Levels reached after this change stay
-- when the file runs again.
update public.telegram_notification_jobs set cancelled_at = now(), locked_until = null
  where kind = 'level-up' and delivered_at is null and cancelled_at is null and created_at < '2026-11-09 00:00:00+00';
delete from public.member_levels where reached_at < '2026-11-09 00:00:00+00';

drop function if exists public.app_course_standings(uuid);

revoke all on function public.app_check_member_level(uuid, interval) from public, anon, authenticated;
grant execute on function public.app_check_member_level(uuid, interval) to service_role;
notify pgrst, 'reload schema';
commit;

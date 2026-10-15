-- A review brings its author 1 mile. The mile is counted from the review itself: it appears as soon as the review is
-- published (also for reviews written before this change) and goes away when the review is deleted.
-- Every miles total on the site (rating, profile, home, network) is read from app_ranking, so this is the only place to change.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

create or replace function public.app_ranking(p_team_id uuid, p_metric text)
returns table(id uuid, name text, points bigint, avatar_path text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_metric = 'points' then
    return query select u.id, u.name, (coalesce(s.total, 0) + coalesce(rv.total, 0))::bigint, u.avatar_path from public.users u
      left join (select s.user_id, sum(s.points)::bigint total from public.submissions s
        join public.users recipient on recipient.id = s.user_id
        where s.status = 'accepted' and (p_team_id is null or recipient.team_id = p_team_id) group by s.user_id) s on s.user_id = u.id
      -- 1 mile for a published review.
      left join (select r.user_id, count(*)::bigint total from public.reviews r group by r.user_id) rv on rv.user_id = u.id
      where u.role = 'member' and (p_team_id is null or u.team_id = p_team_id);
  elsif p_metric = 'stars' then
    return query select u.id, u.name, coalesce(a.total, 0)::bigint, u.avatar_path from public.users u
      left join (select a.user_id, sum(a.stars)::bigint total from public.star_awards a
        where p_team_id is null or a.team_id = p_team_id group by a.user_id) a on a.user_id = u.id
      where u.role = 'member' and (p_team_id is null or u.team_id = p_team_id);
  else raise exception 'Unknown ranking metric'; end if;
end $$;

revoke all on function public.app_ranking(uuid, text) from public, anon, authenticated;
grant execute on function public.app_ranking(uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;

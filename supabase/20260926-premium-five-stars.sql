-- New Premium awards are worth five stars. Preserve historic Premium awards
-- with three stars so existing leaderboard totals and award history stay unchanged.
begin;

alter table public.star_awards drop constraint if exists star_awards_kind_stars_check;
alter table public.star_awards add constraint star_awards_kind_stars_check check (
  award_kind is null or
  (award_kind = 'starter' and stars = 1) or
  (award_kind = 'classic' and stars = 2) or
  (award_kind = 'premium' and stars in (3, 5))
);

notify pgrst, 'reload schema';
commit;

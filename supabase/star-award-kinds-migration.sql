-- Apply before deploying the Starter / Classic / Premium UI.
-- Existing awards (including 4 and 5 stars) retain their value and history.
begin;

alter table public.star_awards add column if not exists award_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.star_awards'::regclass and conname = 'star_awards_kind_stars_check'
  ) then
    alter table public.star_awards add constraint star_awards_kind_stars_check check (
      award_kind is null or
      (award_kind = 'starter' and stars = 1) or
      (award_kind = 'classic' and stars = 2) or
      (award_kind = 'premium' and stars = 3)
    );
  end if;
end $$;

notify pgrst, 'reload schema';
commit;

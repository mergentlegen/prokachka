-- Only run against a disposable local database, not the application database.
\set ON_ERROR_STOP on
create table public.star_awards (
  id uuid primary key default gen_random_uuid(),
  stars integer not null check (stars between 1 and 5)
);
insert into public.star_awards(stars) values (1), (4), (5);

\ir ../supabase/star-award-kinds-migration.sql
\ir ../supabase/star-award-kinds-migration.sql

insert into public.star_awards(stars,award_kind) values (1,'starter'),(2,'classic'),(3,'premium');
\ir ../supabase/20260926-premium-five-stars.sql
\ir ../supabase/20260926-premium-five-stars.sql

do $$
begin
  if (select sum(stars) from public.star_awards where award_kind is null) <> 10 then
    raise exception 'Legacy totals changed';
  end if;
  if not exists (select 1 from public.star_awards where award_kind = 'premium' and stars = 3) then
    raise exception 'Existing Premium awards must retain their original value';
  end if;
  insert into public.star_awards(stars,award_kind) values (5,'premium');
  if (select sum(stars) from public.star_awards where award_kind in ('starter','premium')) <> 9 then
    raise exception 'New Premium award must add five stars without rewriting history';
  end if;
  begin
    insert into public.star_awards(stars,award_kind) values (4,'premium');
    raise exception 'Invalid Premium awards should fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.star_awards(stars,award_kind) values (1,'unknown');
    raise exception 'Unknown kind should fail';
  exception when check_violation then null;
  end;
  delete from public.star_awards where award_kind = 'starter';
  if (select sum(stars) from public.star_awards) <> 20 then
    raise exception 'Revocation must only remove the selected award';
  end if;
  raise notice 'Passed: repeatable migration, legacy history, additive awards, validation and revocation';
end $$;

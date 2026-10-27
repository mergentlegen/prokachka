-- Brings a database built from bootstrap.sql level with the production one. Production got these objects from
-- the early migration files (hierarchy-, telegram-link-, sequential-tasks-migration.sql) and one by hand; the
-- current bootstrap does not create them. On production every statement here is a no-op.
-- Found while moving the project from Seoul to Frankfurt (2026-10-27).
begin;

create index if not exists team_join_requests_inviter_idx on public.team_join_requests (invited_by_user_id, status, created_at desc);
create index if not exists telegram_link_tokens_user_idx on public.telegram_link_tokens (user_id, created_at desc);
create index if not exists telegram_link_tokens_expiry_idx on public.telegram_link_tokens (expires_at);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_program_fields_check' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_program_fields_check check (
      (publication_type = 'sequential' and program_id is not null and position is not null and position >= 1)
      or publication_type in ('evergreen', 'fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'star_awards_comment_check' and conrelid = 'public.star_awards'::regclass) then
    alter table public.star_awards add constraint star_awards_comment_check check (char_length(comment) <= 500);
  end if;
end $$;

notify pgrst, 'reload schema';
commit;

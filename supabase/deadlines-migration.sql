-- Run once in Supabase SQL Editor for an existing project.
-- Adds optional task deadlines and remembers when a member joined a team.

alter table public.users add column if not exists team_joined_at timestamptz;
update public.users
set team_joined_at = created_at
where team_id is not null and team_joined_at is null;

alter table public.tasks add column if not exists deadline_at timestamptz;
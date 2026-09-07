-- Run once in Supabase SQL Editor for an existing project.
-- This migration preserves existing rows and adds the CEO/team model.

alter type public.user_role add value if not exists 'ceo';
do $$
begin
  create type public.team_request_status as enum ('pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) >= 2),
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.users add column if not exists team_id uuid references public.teams(id) on delete set null;

alter table public.users add column if not exists team_joined_at timestamptz;
update public.users set team_joined_at = created_at where team_id is not null and team_joined_at is null;
create index if not exists users_team_idx on public.users(team_id);

create table if not exists public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  status public.team_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null
);
create unique index if not exists team_join_requests_one_pending_idx on public.team_join_requests(user_id) where status = 'pending';

alter table public.tasks add column if not exists team_id uuid references public.teams(id) on delete cascade;

alter table public.tasks add column if not exists deadline_at timestamptz;
create index if not exists tasks_team_idx on public.tasks(team_id, is_active, created_at desc);

-- Existing tasks remain with team_id = null until the CEO assigns them to a team.
-- Existing users remain without a team and will see the team selection screen.
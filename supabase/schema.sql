create extension if not exists "pgcrypto";

create type public.user_role as enum ('ceo', 'admin', 'member');
create type public.submission_status as enum ('pending', 'accepted', 'revision');
create type public.team_request_status as enum ('pending', 'approved', 'rejected');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) >= 2),
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 2),
  first_name text not null check (char_length(trim(first_name)) >= 2),
  last_name text not null check (char_length(trim(last_name)) >= 2),
  email text not null check (char_length(trim(email)) <= 254),
  -- Legacy alias: new accounts store the normalized email here too.
  login text not null unique check (char_length(trim(login)) >= 3),
  password_hash text not null,
  telegram_id text unique,
  role public.user_role not null default 'member',
  team_id uuid references public.teams(id) on delete set null,
  team_joined_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index users_email_lower_unique_idx on public.users (lower(email));
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  content text not null check (char_length(trim(content)) between 2 and 5000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_team_created_idx on public.announcements(team_id, created_at desc);
create index announcements_active_idx on public.announcements(team_id, is_active, created_at desc);

create table public.star_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  mentor_id uuid references public.users(id) on delete set null,
  stars integer not null check (stars between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

create index star_awards_team_created_idx on public.star_awards(team_id, created_at desc);
create index star_awards_user_idx on public.star_awards(user_id, created_at desc);

create table public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  status public.team_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null
);

create unique index team_join_requests_one_pending_idx on public.team_join_requests(user_id) where status = 'pending';

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  team_id uuid references public.teams(id) on delete cascade,
  max_points integer not null default 10 check (max_points >= 0 and max_points <= 100),
  deadline_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  status public.submission_status not null default 'pending',
  telegram_chat_id text,
  telegram_message_id text,
  telegram_update_id bigint,
  points integer not null default 0 check (points >= 0 and points <= 100),
  comment text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.telegram_contexts (
  telegram_id text primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);

create index users_team_idx on public.users(team_id);
create index tasks_team_idx on public.tasks(team_id, is_active, created_at desc);
create index submissions_status_idx on public.submissions(status);
create index submissions_user_task_idx on public.submissions(user_id, task_id, submitted_at desc);
create unique index submissions_telegram_update_id_idx on public.submissions(telegram_update_id) where telegram_update_id is not null;
create index telegram_contexts_expiry_idx on public.telegram_contexts(expires_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger tasks_touch_updated_at before update on public.tasks for each row execute procedure public.touch_updated_at();
create trigger announcements_touch_updated_at before update on public.announcements for each row execute procedure public.touch_updated_at();

-- All database access currently goes through server routes and service role.
-- Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
-- Sequential programs and per-member timers.
create table public.task_programs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  deadline_hours integer not null default 72 check (deadline_hours between 1 and 720),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks add column publication_type text not null default 'fixed' check (publication_type in ('evergreen','fixed','sequential'));
alter table public.tasks add column program_id uuid references public.task_programs(id) on delete cascade;
alter table public.tasks add column position integer;
alter table public.tasks add column deadline_hours integer;
update public.tasks set publication_type = case when deadline_at is null then 'evergreen' else 'fixed' end;

create table public.member_program_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  program_id uuid not null references public.task_programs(id) on delete cascade,
  current_task_id uuid references public.tasks(id) on delete set null,
  unlocked_at timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'active' check (status in ('active','completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, program_id)
);

create index task_programs_team_idx on public.task_programs(team_id, is_active, created_at desc);
create index tasks_program_position_idx on public.tasks(program_id, position);
create index member_progress_user_idx on public.member_program_progress(user_id, status);
create index member_progress_program_idx on public.member_program_progress(program_id, status);
create trigger task_programs_touch_updated_at before update on public.task_programs for each row execute procedure public.touch_updated_at();
create trigger member_progress_touch_updated_at before update on public.member_program_progress for each row execute procedure public.touch_updated_at();

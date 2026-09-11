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
  parent_user_id uuid references public.users(id) on delete set null,
  can_review boolean not null default false,
  can_publish_tasks boolean not null default false,
  can_invite_members boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index users_email_lower_unique_idx on public.users (lower(email));
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  content text not null check (char_length(trim(content)) between 2 and 5000),
  resource_url text check (resource_url is null or resource_url ~ '^https?://'),
  audience_root_id uuid references public.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_team_created_idx on public.announcements(team_id, created_at desc);
create index announcements_active_idx on public.announcements(team_id, is_active, created_at desc);
create index announcements_audience_root_idx on public.announcements(team_id, audience_root_id, created_at desc);

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
  reviewed_by uuid references public.users(id) on delete set null,
  invited_by_user_id uuid references public.users(id) on delete set null,
  invitation_id uuid
);

create unique index team_join_requests_one_pending_idx on public.team_join_requests(user_id) where status = 'pending';

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  team_id uuid references public.teams(id) on delete cascade,
  max_points integer not null default 10 check (max_points >= 0 and max_points <= 100),
  deadline_at timestamptz,
  resource_url text check (resource_url is null or resource_url ~ '^https?://'),
  publisher_id uuid references public.users(id) on delete set null,
  audience_root_id uuid references public.users(id) on delete set null,
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
  media_type text check (media_type in ('text', 'photo', 'video', 'document')),
  telegram_file_id text,
  answer_text text not null default '' check (char_length(answer_text) <= 10000),
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
create index users_team_parent_idx on public.users(team_id, parent_user_id);
create index tasks_team_idx on public.tasks(team_id, is_active, created_at desc);
create index tasks_audience_root_idx on public.tasks(team_id, audience_root_id, created_at desc);
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
  publisher_id uuid references public.users(id) on delete set null,
  audience_root_id uuid references public.users(id) on delete set null,
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
create index task_programs_audience_root_idx on public.task_programs(team_id, audience_root_id, created_at desc);
create index tasks_program_position_idx on public.tasks(program_id, position);
create index member_progress_user_idx on public.member_program_progress(user_id, status);
create index member_progress_program_idx on public.member_program_progress(program_id, status);

create table public.team_invitation_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  inviter_user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  max_uses integer not null default 0 check (max_uses >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.team_join_requests
  add constraint team_join_requests_invitation_fk foreign key (invitation_id) references public.team_invitation_links(id) on delete set null;

create table public.team_assignment_history (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  previous_parent_user_id uuid references public.users(id) on delete set null,
  new_parent_user_id uuid references public.users(id) on delete set null,
  changed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index team_invitation_links_team_idx on public.team_invitation_links(team_id, inviter_user_id, created_at desc);
create index team_assignment_history_team_idx on public.team_assignment_history(team_id, created_at desc);
create index team_join_requests_invitation_idx on public.team_join_requests(invitation_id);

create or replace function public.validate_user_hierarchy() returns trigger language plpgsql as $$
declare parent_team uuid; current_parent uuid; steps integer := 0;
begin
  if new.parent_user_id is null then return new; end if;
  if new.team_id is null then raise exception 'A parent can only be assigned to a team member'; end if;
  if new.parent_user_id = new.id then raise exception 'A user cannot be their own parent'; end if;
  current_parent := new.parent_user_id;
  loop
    select team_id, parent_user_id into parent_team, current_parent from public.users where id = current_parent;
    if not found or parent_team is null or parent_team is distinct from new.team_id then raise exception 'Parent and child must belong to the same team'; end if;
    steps := steps + 1;
    if current_parent is null then exit; end if;
    if current_parent = new.id or steps > 10000 then raise exception 'A user hierarchy cycle is not allowed'; end if;
  end loop;
  return new;
end;
$$;
create trigger users_hierarchy_consistency before insert or update of team_id, parent_user_id on public.users for each row execute procedure public.validate_user_hierarchy();

create or replace function public.consume_team_invitation(p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare invitation public.team_invitation_links%rowtype;
begin
  select * into invitation from public.team_invitation_links where id = p_invitation_id for update;
  if not found or invitation.revoked_at is not null or (invitation.expires_at is not null and invitation.expires_at <= now()) then return false; end if;
  if invitation.max_uses > 0 and invitation.used_count >= invitation.max_uses then return false; end if;
  update public.team_invitation_links set used_count = used_count + 1 where id = p_invitation_id;
  return true;
end;
$$;
revoke all on function public.consume_team_invitation(uuid) from public;
grant execute on function public.consume_team_invitation(uuid) to service_role;

create or replace function public.approve_team_join_request(p_request_id uuid, p_reviewer_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare join_request public.team_join_requests%rowtype; target_user public.users%rowtype; inviter public.users%rowtype; invitation public.team_invitation_links%rowtype;
begin
  select * into join_request from public.team_join_requests where id = p_request_id for update;
  if not found or join_request.status <> 'pending' then return 'already_processed'; end if;
  select * into target_user from public.users where id = join_request.user_id for update;
  if not found then return 'already_processed'; end if;
  if target_user.team_id is not null then
    if target_user.team_id = join_request.team_id then
      update public.team_join_requests set status = 'approved', reviewed_at = coalesce(reviewed_at, now()), reviewed_by = coalesce(reviewed_by, p_reviewer_id) where id = join_request.id;
      return 'approved';
    end if;
    update public.team_join_requests set status = 'rejected', reviewed_at = coalesce(reviewed_at, now()), reviewed_by = coalesce(reviewed_by, p_reviewer_id) where id = join_request.id;
    return 'already_joined_other_team';
  end if;
  if join_request.invited_by_user_id is not null then
    if join_request.invitation_id is null then
      update public.team_join_requests set status = 'rejected', reviewed_at = coalesce(reviewed_at, now()), reviewed_by = coalesce(reviewed_by, p_reviewer_id) where id = join_request.id;
      return 'invalid_invitation';
    end if;
    select * into inviter from public.users where id = join_request.invited_by_user_id for update;
    select * into invitation from public.team_invitation_links where id = join_request.invitation_id for update;
    if not found or invitation.team_id <> join_request.team_id or invitation.inviter_user_id <> join_request.invited_by_user_id
      or invitation.revoked_at is not null or (invitation.expires_at is not null and invitation.expires_at <= now())
      or (invitation.max_uses > 0 and invitation.used_count >= invitation.max_uses)
      or inviter.team_id is distinct from join_request.team_id
      or inviter.role not in ('admin', 'member') then
      update public.team_join_requests set status = 'rejected', reviewed_at = coalesce(reviewed_at, now()), reviewed_by = coalesce(reviewed_by, p_reviewer_id) where id = join_request.id;
      return 'invalid_invitation';
    end if;
    update public.users set team_id = join_request.team_id, team_joined_at = now(), parent_user_id = join_request.invited_by_user_id where id = target_user.id;
    update public.team_invitation_links set used_count = used_count + 1 where id = invitation.id;
  else
    update public.users set team_id = join_request.team_id, team_joined_at = now(), parent_user_id = null where id = target_user.id;
  end if;
  update public.team_join_requests set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer_id where id = join_request.id;
  return 'approved';
end;
$$;
revoke all on function public.approve_team_join_request(uuid, uuid) from public;
grant execute on function public.approve_team_join_request(uuid, uuid) to service_role;
create trigger task_programs_touch_updated_at before update on public.task_programs for each row execute procedure public.touch_updated_at();
create trigger member_progress_touch_updated_at before update on public.member_program_progress for each row execute procedure public.touch_updated_at();

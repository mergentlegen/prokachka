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
  welcome_video_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.welcome_videos (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 180),
  size_bytes bigint not null check (size_bytes between 1024 and 52428800),
  duration_seconds numeric(7,2) not null check (duration_seconds > 0 and duration_seconds <= 180),
  width integer not null,
  height integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welcome_video_dimensions_sane check (width between 1 and 7680 and height between 1 and 7680)
);
create unique index welcome_videos_owner_unique_idx on public.welcome_videos(team_id, owner_user_id);
alter table public.welcome_videos enable row level security;
revoke all on public.welcome_videos from anon, authenticated, public;
grant select, insert, update, delete on public.welcome_videos to service_role;
create table public.welcome_video_upload_intents (
  storage_path text primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index welcome_video_upload_intents_expiry_idx on public.welcome_video_upload_intents(expires_at);
alter table public.welcome_video_upload_intents enable row level security;
revoke all on public.welcome_video_upload_intents from public, anon, authenticated;
grant select, insert, update, delete on public.welcome_video_upload_intents to service_role;
create function public.welcome_video_upload_path_allowed(p_storage_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.welcome_video_upload_intents i
    where i.storage_path = p_storage_path and i.expires_at > statement_timestamp());
$$;
revoke all on function public.welcome_video_upload_path_allowed(text) from public;
grant execute on function public.welcome_video_upload_path_allowed(text) to anon, authenticated, service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('welcome-videos', 'welcome-videos', false, 52428800, array['video/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy welcome_video_upload_insert_guard on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'welcome-videos' or public.welcome_video_upload_path_allowed(name));
create policy welcome_video_upload_insert_intent on storage.objects as permissive for insert to anon, authenticated
  with check (bucket_id = 'welcome-videos' and public.welcome_video_upload_path_allowed(name));
create policy welcome_videos_select_server_only on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'welcome-videos');
create policy welcome_videos_update_server_only on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'welcome-videos') with check (bucket_id <> 'welcome-videos');
create policy welcome_videos_delete_server_only on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'welcome-videos');
create or replace function public.app_set_welcome_video(
  p_team_id uuid, p_owner_user_id uuid, p_storage_path text, p_file_name text,
  p_size_bytes bigint, p_duration_seconds numeric, p_width integer, p_height integer
) returns text language plpgsql security definer set search_path = public as $$
declare previous_path text;
begin
  select storage_path into previous_path from public.welcome_videos where team_id = p_team_id and owner_user_id = p_owner_user_id for update;
  insert into public.welcome_videos(team_id, owner_user_id, storage_path, file_name, size_bytes, duration_seconds, width, height)
  values (p_team_id, p_owner_user_id, p_storage_path, p_file_name, p_size_bytes, p_duration_seconds, p_width, p_height)
  on conflict (team_id, owner_user_id) do update set storage_path=excluded.storage_path, file_name=excluded.file_name,
    size_bytes=excluded.size_bytes, duration_seconds=excluded.duration_seconds, width=excluded.width, height=excluded.height;
  return previous_path;
end;
$$;
revoke all on function public.app_set_welcome_video(uuid,uuid,text,text,bigint,numeric,integer,integer) from public, anon, authenticated;
grant execute on function public.app_set_welcome_video(uuid,uuid,text,text,bigint,numeric,integer,integer) to service_role;

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
  award_kind text,
  constraint star_awards_kind_stars_check check (
    award_kind is null or (award_kind = 'starter' and stars = 1) or
    (award_kind = 'classic' and stars = 2) or (award_kind = 'premium' and stars = 3)
  ),
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
  interactive_kind text check (interactive_kind is null or interactive_kind in ('dream-plan')),
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
  submission_source text not null default 'telegram' check (submission_source in ('telegram', 'interactive')),
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
create unique index submissions_interactive_accepted_idx on public.submissions(user_id, task_id)
  where submission_source = 'interactive' and status = 'accepted';
create index telegram_contexts_expiry_idx on public.telegram_contexts(expires_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger tasks_touch_updated_at before update on public.tasks for each row execute procedure public.touch_updated_at();
create trigger announcements_touch_updated_at before update on public.announcements for each row execute procedure public.touch_updated_at();
create trigger welcome_videos_touch_updated_at before update on public.welcome_videos for each row execute function public.touch_updated_at();

-- All database access currently goes through server routes and service role.
-- Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
-- Sequential programs and per-member timers.
create table public.task_programs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  deadline_hours integer not null default 72 check (deadline_hours between 1 and 720),
  template_key text check (template_key is null or template_key in ('dream-plan')),
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
create unique index task_programs_team_template_unique_idx on public.task_programs(team_id, template_key) where template_key is not null;
create index tasks_program_position_idx on public.tasks(program_id, position);
create index member_progress_user_idx on public.member_program_progress(user_id, status);
create index member_progress_program_idx on public.member_program_progress(program_id, status);

-- Private PDF attachments are delivered through authenticated application routes.
drop policy if exists task_attachments_server_only on storage.objects;
create policy task_attachments_server_only on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'task-attachments') with check (bucket_id <> 'task-attachments');
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 180),
  content_type text not null default 'application/pdf' check (content_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes between 8 and 15728640),
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index task_attachments_task_created_idx on public.task_attachments(task_id, created_at, id);
alter table public.task_attachments enable row level security;
revoke all on public.task_attachments from anon, authenticated, public;
grant select, insert, delete on public.task_attachments to service_role;

create or replace function public.enforce_task_attachment_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_count integer;
begin
  perform 1 from public.tasks where id = new.task_id for update;
  if not found then raise exception 'task_not_found'; end if;
  select count(*) into current_count from public.task_attachments where task_id = new.task_id;
  if current_count >= 10 then raise exception 'task_attachment_limit'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_task_attachment_limit() from public, anon, authenticated;
create trigger task_attachments_limit_before_insert before insert on public.task_attachments for each row execute function public.enforce_task_attachment_limit();

create or replace function public.broadcast_task_attachment_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare attachment_task uuid; team_id text;
begin
  attachment_task := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  select tasks.team_id::text into team_id from public.tasks where tasks.id = attachment_task;
  perform realtime.send(jsonb_build_object('topics', array['tasks','submissions'], 'teamIds',
    case when team_id is null then array[]::text[] else array[team_id] end, 'userIds', array[]::text[]),
    'changed', 'prokachka:changes', true);
  return null;
exception when others then
  raise log 'Task attachment realtime notification unavailable: SQLSTATE %', sqlstate;
  return null;
end;
$$;
revoke all on function public.broadcast_task_attachment_change() from public, anon, authenticated;
create trigger task_attachments_live_change after insert or delete on public.task_attachments for each row execute function public.broadcast_task_attachment_change();

create table public.ready_program_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  current_step integer not null default 0 check (current_step between 0 and 12),
  status text not null default 'active' check (status in ('active', 'completed')),
  attempt_number integer not null default 1 check (attempt_number >= 1),
  earned_points integer not null default 0 check (earned_points >= 0),
  state jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(user_id, task_id)
);

create index ready_program_attempts_user_idx on public.ready_program_attempts(user_id, status, updated_at desc);
create index ready_program_attempts_task_idx on public.ready_program_attempts(task_id, status, updated_at desc);
create trigger ready_program_attempts_touch_updated_at before update on public.ready_program_attempts
  for each row execute function public.touch_updated_at();

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

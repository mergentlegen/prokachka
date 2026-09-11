-- Run once in the Supabase SQL editor after the existing schema/migrations.
-- The raw invitation token is never stored: the application stores only SHA-256(token).
alter table public.users add column if not exists parent_user_id uuid references public.users(id) on delete set null;
alter table public.users add column if not exists can_review boolean not null default false;
alter table public.users add column if not exists can_publish_tasks boolean not null default false;
alter table public.users add column if not exists can_invite_members boolean not null default false;

alter table public.tasks add column if not exists publisher_id uuid references public.users(id) on delete set null;
alter table public.tasks add column if not exists audience_root_id uuid references public.users(id) on delete set null;
alter table public.task_programs add column if not exists publisher_id uuid references public.users(id) on delete set null;
alter table public.task_programs add column if not exists audience_root_id uuid references public.users(id) on delete set null;
alter table public.announcements add column if not exists audience_root_id uuid references public.users(id) on delete set null;

alter table public.team_join_requests add column if not exists invited_by_user_id uuid references public.users(id) on delete set null;

create table if not exists public.team_invitation_links (
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

alter table public.team_invitation_links alter column expires_at drop not null;
alter table public.team_invitation_links alter column expires_at drop default;
update public.team_invitation_links set expires_at = null where expires_at is not null;

alter table public.team_join_requests add column if not exists invitation_id uuid references public.team_invitation_links(id) on delete set null;

create table if not exists public.team_assignment_history (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  previous_parent_user_id uuid references public.users(id) on delete set null,
  new_parent_user_id uuid references public.users(id) on delete set null,
  changed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists users_team_parent_idx on public.users(team_id, parent_user_id);
create index if not exists tasks_audience_root_idx on public.tasks(team_id, audience_root_id, created_at desc);
create index if not exists task_programs_audience_root_idx on public.task_programs(team_id, audience_root_id, created_at desc);
create index if not exists announcements_audience_root_idx on public.announcements(team_id, audience_root_id, created_at desc);
create index if not exists team_join_requests_inviter_idx on public.team_join_requests(invited_by_user_id, status, created_at desc);
create index if not exists team_join_requests_invitation_idx on public.team_join_requests(invitation_id);
create index if not exists team_invitation_links_team_idx on public.team_invitation_links(team_id, inviter_user_id, created_at desc);
create index if not exists assignment_history_team_idx on public.team_assignment_history(team_id, created_at desc);

create or replace function public.validate_user_hierarchy() returns trigger
language plpgsql
as $$
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
drop trigger if exists users_hierarchy_consistency on public.users;
create trigger users_hierarchy_consistency before insert or update of team_id, parent_user_id on public.users for each row execute procedure public.validate_user_hierarchy();

create or replace function public.consume_team_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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
returns text
language plpgsql
security definer
set search_path = public
as $$
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

-- Existing content has a null audience root and therefore remains visible to the whole team.
-- Existing users are intentionally not auto-assigned: the team owner can review the tree safely.

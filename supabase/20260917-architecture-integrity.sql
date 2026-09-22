-- Apply AFTER schema.sql, telegram-integrity-migration.sql and star-award-kinds-migration.sql.
-- Additive / transactional. Does not rewrite historical answers, awards or membership.
begin;

-- A cross-team edge must be repaired deliberately, never silently reassigned.
do $$ begin
  if exists (select 1 from public.users child join public.users parent on parent.id = child.parent_user_id
    where child.team_id is distinct from parent.team_id or child.team_id is null) then
    raise exception 'Existing cross-team parent links must be repaired before this migration';
  end if;
end $$;

-- Serialize structural edits, including concurrent moves that could otherwise create a cycle.
create or replace function public.app_lock_hierarchy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(20260917, 1);
  return null;
end $$;
drop trigger if exists app_hierarchy_lock on public.users;
create trigger app_hierarchy_lock before insert or delete or update of team_id, parent_user_id
on public.users for each statement execute function public.app_lock_hierarchy();

create or replace function public.app_guard_team_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.team_id is distinct from new.team_id then
    -- A deliberate deletion of the whole team detaches all its users via the FK.
    if old.team_id is not null and not exists(select 1 from public.teams where id = old.team_id) then
      new.parent_user_id := null;
      return new;
    end if;
    if exists(select 1 from public.users where parent_user_id = old.id) then
      raise exception using errcode = '23514', message = 'Reassign this user''s children before changing their team';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists app_guard_team_change on public.users;
create trigger app_guard_team_change before update of team_id on public.users
for each row execute function public.app_guard_team_change();

-- Assignment and request reconciliation now commit (or roll back) together.
create or replace function public.app_sync_join_requests() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null then
    update public.team_join_requests set
      status = case when team_id = new.team_id then 'approved'::public.team_request_status else 'rejected'::public.team_request_status end,
      reviewed_at = now()
    where user_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
drop trigger if exists app_sync_join_requests on public.users;
create trigger app_sync_join_requests after update of team_id on public.users
for each row execute function public.app_sync_join_requests();

-- Deleting an audience root must not turn a branch-only publication into a team-wide one.
alter table public.tasks drop constraint if exists tasks_audience_root_id_fkey;
alter table public.tasks add constraint tasks_audience_root_id_fkey foreign key (audience_root_id) references public.users(id) on delete restrict;
alter table public.task_programs drop constraint if exists task_programs_audience_root_id_fkey;
alter table public.task_programs add constraint task_programs_audience_root_id_fkey foreign key (audience_root_id) references public.users(id) on delete restrict;
alter table public.announcements drop constraint if exists announcements_audience_root_id_fkey;
alter table public.announcements add constraint announcements_audience_root_id_fkey foreign key (audience_root_id) references public.users(id) on delete restrict;

create or replace function public.app_review_join_request(p_id uuid, p_status text, p_reviewer uuid, p_ceo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare req public.team_join_requests%rowtype; actor public.users%rowtype; outcome text;
begin
  perform pg_advisory_xact_lock(20260917, 1);
  if p_status not in ('approved','rejected') or p_status is null then return jsonb_build_object('validationError','Неизвестный статус заявки.'); end if;
  if not p_ceo then
    select * into actor from public.users where id = p_reviewer for share;
    if not found or actor.role <> 'admin' or actor.team_id is null then return jsonb_build_object('forbidden',true); end if;
  end if;
  select * into req from public.team_join_requests where id = p_id for update;
  if not found then return jsonb_build_object('validationError','Заявка не найдена.'); end if;
  if not p_ceo and req.team_id is distinct from actor.team_id then return jsonb_build_object('forbidden',true); end if;
  if req.status <> 'pending' then return jsonb_build_object('validationError','Заявка уже обработана.'); end if;
  if p_status = 'approved' then
    if not exists(select 1 from public.teams where id = req.team_id and is_active) then
      return jsonb_build_object('validationError','Команда недоступна.');
    end if;
    outcome := public.approve_team_join_request(p_id, p_reviewer);
    if outcome <> 'approved' then return jsonb_build_object('validationError',case outcome
      when 'already_joined_other_team' then 'Пользователь уже состоит в другой команде.'
      when 'invalid_invitation' then 'Приглашение больше недоступно.' else 'Заявка уже обработана.' end); end if;
  else
    update public.team_join_requests set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer where id = p_id;
  end if;
  return jsonb_build_object('processed',true);
end $$;

create or replace function public.app_ranking(p_team_id uuid, p_metric text)
returns table(id uuid, name text, points bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_metric = 'points' then
    return query select u.id, u.name, coalesce(s.total,0)::bigint from public.users u
      left join (select s.user_id, sum(s.points)::bigint total from public.submissions s
        join public.users recipient on recipient.id = s.user_id
        where s.status = 'accepted' and (p_team_id is null or recipient.team_id = p_team_id)
        group by s.user_id) s on s.user_id = u.id
      where u.role = 'member' and (p_team_id is null or u.team_id = p_team_id);
  elsif p_metric = 'stars' then
    return query select u.id, u.name, coalesce(a.total,0)::bigint from public.users u
      left join (select a.user_id, sum(a.stars)::bigint total from public.star_awards a
        where p_team_id is null or a.team_id = p_team_id group by a.user_id) a on a.user_id = u.id
      where u.role = 'member' and (p_team_id is null or u.team_id = p_team_id);
  else raise exception 'Unknown ranking metric'; end if;
end $$;

create or replace function public.app_create_program(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare program public.task_programs%rowtype; task jsonb; step integer := 0; steps jsonb;
begin
  if jsonb_typeof(p_input->'tasks') is distinct from 'array' then raise exception 'Tasks must be an array'; end if;
  if jsonb_array_length(p_input->'tasks') not between 1 and 100 then raise exception 'A program must contain 1 to 100 steps'; end if;
  insert into public.task_programs(team_id,title,deadline_hours,publisher_id,audience_root_id,is_active)
    values((p_input->>'teamId')::uuid,trim(p_input->>'title'),(p_input->>'deadlineHours')::int,
      (p_input->>'publisherId')::uuid,(p_input->>'audienceRootId')::uuid,true) returning * into program;
  for task in select value from jsonb_array_elements(p_input->'tasks') loop
    if coalesce(char_length(trim(task->>'title')),0) not between 2 and 160
      or coalesce(char_length(trim(task->>'description')),0) not between 2 and 5000 then
      raise exception using errcode = '23514', message = 'Invalid program step';
    end if;
    step := step + 1;
    insert into public.tasks(team_id,program_id,publication_type,position,title,description,max_points,deadline_at,
      resource_url,publisher_id,audience_root_id,deadline_hours,is_active)
    values(program.team_id,program.id,'sequential',step,trim(task->>'title'),trim(task->>'description'),
      (task->>'maxPoints')::int,null,nullif(task->>'resourceUrl',''),program.publisher_id,program.audience_root_id,program.deadline_hours,true);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.position),'[]') into steps from public.tasks t where program_id = program.id;
  return jsonb_build_object('program',to_jsonb(program),'tasks',steps);
end $$;

create or replace function public.app_update_program(p_id uuid, p_patch jsonb, p_actor uuid, p_ceo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare program public.task_programs%rowtype; actor public.users%rowtype;
begin
  if not p_ceo then
    select * into actor from public.users where id = p_actor for share;
    if not found or actor.team_id is null then return jsonb_build_object('forbidden',true); end if;
  end if;
  select * into program from public.task_programs where id = p_id for update;
  if not found then return jsonb_build_object('forbidden',true); end if;
  if not p_ceo and (actor.team_id is distinct from program.team_id or not
    (actor.role = 'admin' or (actor.can_publish_tasks and program.publisher_id is not distinct from actor.id))) then
    return jsonb_build_object('forbidden',true);
  end if;
  update public.task_programs set
    title = case when p_patch ? 'title' then trim(p_patch->>'title') else title end,
    deadline_hours = case when p_patch ? 'deadlineHours' then (p_patch->>'deadlineHours')::int else deadline_hours end,
    is_active = case when p_patch ? 'isActive' then (p_patch->>'isActive')::boolean else is_active end
    where id = p_id returning * into program;
  if p_patch ? 'deadlineHours' then
    update public.tasks set deadline_hours = program.deadline_hours where program_id = p_id;
  end if;
  return jsonb_build_object('data',to_jsonb(program));
end $$;

-- Structure, audit history and permission notification outbox share one transaction.
create or replace function public.app_update_network_user(p_actor uuid, p_target uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.users%rowtype; target public.users%rowtype; saved public.users%rowtype;
begin
  perform pg_advisory_xact_lock(20260917, 1);
  select * into actor from public.users where id = p_actor for share;
  if not found or actor.role <> 'admin' or actor.team_id is null then return jsonb_build_object('forbidden',true); end if;
  select * into target from public.users where id = p_target for update;
  if not found or target.role <> 'member' or target.team_id is distinct from actor.team_id then
    return jsonb_build_object('forbidden',true);
  end if;
  update public.users set
    parent_user_id = case when p_patch ? 'parent_user_id' then (p_patch->>'parent_user_id')::uuid else parent_user_id end,
    can_review = case when p_patch ? 'can_review' then (p_patch->>'can_review')::boolean else can_review end,
    can_publish_tasks = case when p_patch ? 'can_publish_tasks' then (p_patch->>'can_publish_tasks')::boolean else can_publish_tasks end
    where id = p_target returning * into saved;
  if target.parent_user_id is distinct from saved.parent_user_id then
    insert into public.team_assignment_history(team_id,user_id,previous_parent_user_id,new_parent_user_id,changed_by)
      values(actor.team_id,target.id,target.parent_user_id,saved.parent_user_id,actor.id);
  end if;
  return jsonb_build_object('data',jsonb_build_object(
    'id',saved.id,'name',saved.name,'login',saved.login,'role',saved.role,'team_id',saved.team_id,
    'parent_user_id',saved.parent_user_id,'can_review',saved.can_review,'can_publish_tasks',saved.can_publish_tasks,
    'can_invite_members',saved.can_invite_members,'created_at',saved.created_at));
end $$;
revoke all on function public.app_update_network_user(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.app_update_network_user(uuid,uuid,jsonb) to service_role;

create or replace function public.app_mentor_counts(p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with recursive viewer as (select id,role,team_id,can_review from public.users where id = p_viewer),
  branch(id) as (
    select id from viewer
    union
    select child.id from public.users child join branch parent on child.parent_user_id = parent.id
      join viewer v on child.team_id = v.team_id
  ), visible as (
    select s.status from public.submissions s
      join public.users u on u.id = s.user_id join public.tasks t on t.id = s.task_id
      join viewer v on u.team_id = v.team_id and t.team_id = v.team_id
    where (v.role = 'admin' or (v.can_review and u.id <> v.id and u.id in (select id from branch)))
      and (s.status <> 'pending' or s.media_type is not null or s.answer_text <> '')
  ) select jsonb_build_object(
    'pending',(select count(*) from visible where status = 'pending'),
    'accepted',(select count(*) from visible where status = 'accepted'),
    'requests',(select count(*) from public.team_join_requests r join viewer v on v.team_id = r.team_id
      where v.role = 'admin' and r.status = 'pending')
  );
$$;

revoke all on function public.app_mentor_counts(uuid) from public, anon, authenticated;
grant execute on function public.app_mentor_counts(uuid) to service_role;
revoke all on function public.app_lock_hierarchy(), public.app_guard_team_change(), public.app_sync_join_requests(),
  public.app_review_join_request(uuid,text,uuid,boolean), public.app_ranking(uuid,text), public.app_create_program(jsonb),
  public.app_update_program(uuid,jsonb,uuid,boolean) from public, anon, authenticated;
grant execute on function public.app_review_join_request(uuid,text,uuid,boolean), public.app_ranking(uuid,text),
  public.app_create_program(jsonb), public.app_update_program(uuid,jsonb,uuid,boolean) to service_role;
-- Only the checked wrapper may invoke the historical implementation.
revoke execute on function public.approve_team_join_request(uuid,uuid) from service_role;
notify pgrst, 'reload schema';
commit;

-- Programs open one at a time (user's rule 2026-11-21). On every level the participant works on the first program
-- not passed yet, in the team leader's order («↕ Порядок программ»); the next one opens when that one is passed.
-- The programs after it stay visible but closed: their progress has the status 'locked' and nothing can be sent there —
-- not on the site, not in the bot, not in a game. A program the participant had already started out of turn is closed too;
-- its accepted steps stay accepted. When a program opens, its first step not passed opens with a fresh deadline.
-- Hidden programs, programs not shown to the participant and programs without steps do not hold the queue.
-- Apply once to an existing database after 20261125; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

alter table public.member_program_progress drop constraint if exists member_program_progress_status_check;
alter table public.member_program_progress add constraint member_program_progress_status_check check (status in ('active', 'completed', 'locked'));

-- Puts the participant's programs in their queue: on each level the first program not passed is open, the later ones are closed.
-- Returns how many programs changed. A program of the participant's current level that has no progress yet gets it here.
create or replace function public.app_program_queue(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; team uuid; member_level smallint; level_now smallint; open_ok boolean := true; changed integer := 0;
  stamp timestamptz := now(); next_task public.tasks%rowtype;
begin
  select u.team_id into team from public.users u where u.id = p_user and u.role = 'member';
  if team is null then return 0; end if;
  -- Two queues of one participant at the same moment (two reviews, two open pages) run one after the other.
  perform pg_advisory_xact_lock(hashtext('program-queue:' || p_user::text));
  member_level := public.app_member_level(p_user);
  -- The changes below must not start the queue again from the progress trigger.
  perform set_config('app.program_queue', 'on', true);
  for r in
    select p.id as program_id, coalesce(p.level, 1) as lvl, m.id as progress_id, m.status
    from public.task_programs p
    left join public.member_program_progress m on m.user_id = p_user and m.program_id = p.id
    where p.team_id = team and p.template_key is null and p.is_active
      and (p.audience_root_id is null or p.audience_root_id in (select a.id from public.tg_ancestor_ids(p_user) a))
      and exists (select 1 from public.tasks t where t.program_id = p.id and t.is_active and t.publication_type = 'sequential')
    order by coalesce(p.level, 1), p.position nulls last, p.created_at, p.id
  loop
    if level_now is distinct from r.lvl then level_now := r.lvl; open_ok := true; end if;
    if r.status = 'completed' then continue; end if;
    if r.progress_id is null and r.lvl <> member_level then
      -- Another level the participant never started: nothing after it opens there.
      open_ok := false;
      continue;
    end if;
    if open_ok and coalesce(r.status, 'locked') = 'locked' then
      -- The program opens now: its first step not passed, with a fresh deadline.
      select t.* into next_task from public.tasks t
        where t.program_id = r.program_id and t.is_active and t.publication_type = 'sequential'
          and not exists (select 1 from public.submissions s where s.user_id = p_user and s.task_id = t.id and s.status = 'accepted')
        order by t.position, t.id limit 1;
      if next_task.id is null and r.progress_id is not null then
        -- Every step was accepted while it waited: it is passed, and the queue goes on.
        update public.member_program_progress set status = 'completed', current_task_id = null, completed_at = stamp, updated_at = stamp
          where id = r.progress_id and status = 'locked';
        changed := changed + 1;
        continue;
      elsif next_task.id is not null then
        insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
          values (p_user, r.program_id, next_task.id, stamp,
            case when next_task.interactive_kind is not null then stamp + interval '100 years'
              else stamp + make_interval(hours => coalesce(next_task.deadline_hours, (select deadline_hours from public.task_programs where id = r.program_id), 72)) end,
            'active')
          on conflict (user_id, program_id) do update set status = 'active', current_task_id = excluded.current_task_id,
            unlocked_at = excluded.unlocked_at, due_at = excluded.due_at, updated_at = stamp
          where member_program_progress.status = 'locked';
        changed := changed + 1;
      end if;
      open_ok := false;
    elsif open_ok then
      -- Already open: it stays as it is, with its deadline.
      open_ok := false;
    elsif r.progress_id is null then
      insert into public.member_program_progress(user_id, program_id, current_task_id, unlocked_at, due_at, status)
        select p_user, r.program_id, t.id, stamp, stamp, 'locked' from public.tasks t
          where t.program_id = r.program_id and t.is_active and t.publication_type = 'sequential'
          order by t.position, t.id limit 1
        on conflict (user_id, program_id) do nothing;
      changed := changed + 1;
    elsif r.status = 'active' then
      update public.member_program_progress set status = 'locked', updated_at = stamp where id = r.progress_id and status = 'active';
      changed := changed + 1;
    end if;
  end loop;
  perform set_config('app.program_queue', '', true);
  return changed;
end $$;

-- Every participant of the team who has programs.
create or replace function public.app_program_queue_team(p_team uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare member uuid; changed integer := 0;
begin
  for member in select u.id from public.users u where u.team_id = p_team and u.role = 'member'
      and exists (select 1 from public.member_program_progress m where m.user_id = u.id) order by u.id loop
    changed := changed + public.app_program_queue(member);
  end loop;
  return changed;
end $$;

-- A program was started, passed or opened again (a new step) — the queue of that participant is checked.
create or replace function public.app_program_queue_progress()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.program_queue', true), '') = 'on' then return null; end if;
  perform public.app_program_queue(new.user_id);
  return null;
end $$;
drop trigger if exists member_progress_queue_insert on public.member_program_progress;
create trigger member_progress_queue_insert after insert on public.member_program_progress
  for each row execute function public.app_program_queue_progress();
drop trigger if exists member_progress_queue_status on public.member_program_progress;
create trigger member_progress_queue_status after update of status on public.member_program_progress
  for each row when (old.status is distinct from new.status) execute function public.app_program_queue_progress();

-- A new order, a hidden or shown program, another level or branch: the team's queues follow at once.
create or replace function public.app_program_queue_programs_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare team uuid;
begin
  for team in select distinct n.team_id from changed_new n join changed_old o on o.id = n.id
      where n.template_key is null and (o.position is distinct from n.position or o.is_active is distinct from n.is_active
        or o.level is distinct from n.level or o.audience_root_id is distinct from n.audience_root_id) loop
    perform public.app_program_queue_team(team);
  end loop;
  return null;
end $$;
create or replace function public.app_program_queue_programs_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
declare team uuid;
begin
  for team in select distinct o.team_id from changed_old o where o.template_key is null loop
    perform public.app_program_queue_team(team);
  end loop;
  return null;
end $$;
drop trigger if exists task_programs_queue_update on public.task_programs;
create trigger task_programs_queue_update after update on public.task_programs
  referencing old table as changed_old new table as changed_new for each statement execute function public.app_program_queue_programs_changed();
drop trigger if exists task_programs_queue_delete on public.task_programs;
create trigger task_programs_queue_delete after delete on public.task_programs
  referencing old table as changed_old for each statement execute function public.app_program_queue_programs_deleted();

-- A participant moved to another branch or team may see other programs.
create or replace function public.app_program_queue_member_moved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.app_program_queue(new.id);
  return null;
end $$;
drop trigger if exists users_program_queue on public.users;
create trigger users_program_queue after update of parent_user_id, team_id on public.users
  for each row when (new.role = 'member' and (old.parent_user_id is distinct from new.parent_user_id or old.team_id is distinct from new.team_id))
  execute function public.app_program_queue_member_moved();

-- The same as in 20261122, plus: when a program gets its first step or loses its last one, it joins or leaves the queue.
create or replace function public.app_program_step_catch_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.app_program_catch_up(new.program_id, now());
  perform public.app_program_realign(new.program_id, now());
  if (select count(*) from public.tasks where program_id = new.program_id and is_active and publication_type = 'sequential') <= 1 then
    perform public.app_program_queue_team((select team_id from public.task_programs where id = new.program_id and template_key is null));
  end if;
  return null;
end $$;

-- The same as in 20261117, plus a plain reason for a closed program.
create or replace function public.tg_target_error(p_user_id uuid, p_task_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare account public.users%rowtype; task public.tasks%rowtype; member_level smallint; task_level smallint;
begin
  select * into account from public.users where id = p_user_id;
  select * into task from public.tasks where id = p_task_id;
  if account.id is null or account.role <> 'member' or task.id is null or not task.is_active then return 'Задание недоступно.'; end if;
  if account.team_id is null or account.team_id is distinct from task.team_id then return 'Пользователь не состоит в команде задания.'; end if;
  if not exists (select 1 from public.teams where id = account.team_id and is_active) then return 'Команда недоступна.'; end if;
  if task.audience_root_id is not null and not exists (select 1 from public.tg_ancestor_ids(account.id) a where a.id = task.audience_root_id) then return 'Задание недоступно для вашей ветки.'; end if;
  -- Only the participant's own level; an earlier level only to send a returned work again.
  member_level := public.app_member_level(account.id);
  task_level := coalesce(task.level, 1);
  if task_level > member_level then return 'Это задание следующего уровня.'; end if;
  if task_level < member_level and not public.app_task_returned(account.id, task.id) then
    return 'Это задание прошлого уровня: оно в архиве, отправить ответ уже нельзя.';
  end if;
  if task.publication_type = 'sequential' then
    if exists (select 1 from public.member_program_progress where user_id = account.id and program_id = task.program_id and status = 'locked') then
      return 'Эта программа ещё закрыта: она откроется, когда будет пройдена предыдущая.';
    end if;
    if not exists (select 1 from public.task_programs p where p.id = task.program_id and p.is_active and p.team_id = account.team_id
      and (p.audience_root_id is null or p.audience_root_id in (select a.id from public.tg_ancestor_ids(account.id) a)))
      or not exists (select 1 from public.member_program_progress where user_id = account.id and program_id = task.program_id and current_task_id = task.id and status = 'active') then return 'Сейчас доступен другой шаг программы.'; end if;
  elsif task.deadline_at is not null and task.deadline_at <= now() then return 'Срок отправки уже истёк.';
  end if;
  if exists (select 1 from public.submissions where user_id = account.id and task_id = task.id and status = 'accepted') then return 'Это задание уже принято наставником.'; end if;
  if exists (select 1 from public.submissions where user_id = account.id and task_id = task.id and status = 'pending' and (media_type is not null or btrim(answer_text) <> '')) then return 'Ответ уже отправлен. Дождитесь проверки наставника.'; end if;
  return null;
end;
$$;

-- The same as in 20261024, plus the closed program.
create or replace function public.app_program_game_error(p_user uuid, p_task uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare account public.users%rowtype; task public.tasks%rowtype;
begin
  select * into account from public.users where id = p_user;
  select * into task from public.tasks where id = p_task;
  if account.id is null or account.role <> 'member' then return 'Игра доступна только участникам.'; end if;
  if task.id is null or not task.is_active or task.interactive_kind is null or task.publication_type <> 'sequential' then return 'Игра недоступна.'; end if;
  if account.team_id is null or account.team_id is distinct from task.team_id then return 'Пользователь не состоит в команде программы.'; end if;
  if not exists (select 1 from public.teams where id = account.team_id and is_active) then return 'Команда недоступна.'; end if;
  if not exists (select 1 from public.task_programs p where p.id = task.program_id and p.is_active and p.template_key is null
    and (p.audience_root_id is null or p.audience_root_id in (select a.id from public.tg_ancestor_ids(account.id) a))) then return 'Программа недоступна.'; end if;
  if exists (select 1 from public.ready_program_attempts where user_id = p_user and task_id = p_task and status = 'completed') then return null; end if;
  if exists (select 1 from public.member_program_progress where user_id = p_user and program_id = task.program_id and status = 'locked') then
    return 'Эта программа ещё закрыта: она откроется, когда будет пройдена предыдущая.';
  end if;
  if not exists (select 1 from public.member_program_progress where user_id = p_user and program_id = task.program_id and current_task_id = task.id and status = 'active') then
    return 'Сейчас доступен другой шаг программы.';
  end if;
  return null;
end $$;

revoke all on function public.app_program_queue(uuid), public.app_program_queue_team(uuid), public.app_program_queue_progress(),
  public.app_program_queue_programs_changed(), public.app_program_queue_programs_deleted(), public.app_program_queue_member_moved(),
  public.app_program_step_catch_up(), public.tg_target_error(uuid, uuid), public.app_program_game_error(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.app_program_queue(uuid) to service_role;

-- Once: every participant's programs take their places in the queue.
create temporary table program_queue_result as
  select coalesce(sum(public.app_program_queue(u.id)), 0)::integer as changed from public.users u
    where u.role = 'member' and exists (select 1 from public.member_program_progress m where m.user_id = u.id);

notify pgrst, 'reload schema';
commit;

select changed as "Программ поставлено в очередь" from program_queue_result;
drop table program_queue_result;

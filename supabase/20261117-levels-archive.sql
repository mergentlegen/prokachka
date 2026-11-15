-- Levels done properly before level 2 opens:
--   * a participant answers only tasks of their own level (the bot, the site, «Напомнить», link reminders all ask tg_target_error);
--   * one exception: a work of an earlier level that a mentor returned for changes can still be sent again;
--   * new steps of a program reopen it only for participants who are on that program's level.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

-- 1. A work of this task was returned for changes. Together with the "accepted" and "waiting" checks of tg_target_error
-- it means: returned and not sent again yet.
create or replace function public.app_task_returned(p_user uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.submissions where user_id = p_user and task_id = p_task and status = 'revision'
    and (media_type is not null or btrim(answer_text) <> ''));
$$;

-- 2. Whether the participant may send an answer to the task now; null when yes, otherwise the reason in plain words.
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

-- 3. The last guard on saving a work: the same level rule. A mentor's own record of a completion may be on any level.
create or replace function public.app_submission_level_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare task_level smallint; member_level smallint;
begin
  if new.submission_source = 'mentor' then return new; end if;
  select coalesce(level, 1) into task_level from public.tasks where id = new.task_id;
  if task_level is null then return new; end if;
  member_level := public.app_member_level(new.user_id);
  if task_level = member_level or (task_level < member_level and public.app_task_returned(new.user_id, new.task_id)) then return new; end if;
  raise exception 'Это задание другого уровня: отправить ответ нельзя.' using errcode = '23514';
end $$;

-- 4. New steps reopen a finished program only for participants on its level; for those above it the program is an archive.
create or replace function public.app_program_catch_up(p_program uuid, p_stamp timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare opened integer; program_level smallint;
begin
  select coalesce(level, 1) into program_level from public.task_programs where id = p_program;
  with waiting as (
    select p.id, (select t.id from public.tasks t
        where t.program_id = p.program_id and t.is_active and t.publication_type = 'sequential'
          and not exists (select 1 from public.submissions s where s.user_id = p.user_id and s.task_id = t.id and s.status = 'accepted')
        order by t.position, t.id limit 1) as next_id
      from public.member_program_progress p
      where p.program_id = p_program and (p.status = 'completed' or p.current_task_id is null)
        and public.app_member_level(p.user_id) = program_level
  )
  update public.member_program_progress m set current_task_id = t.id, status = 'active', completed_at = null, unlocked_at = p_stamp,
      due_at = case when t.interactive_kind is not null then p_stamp + interval '100 years'
        else p_stamp + make_interval(hours => coalesce(t.deadline_hours, program.deadline_hours, 72)) end,
      updated_at = p_stamp
    from waiting w join public.tasks t on t.id = w.next_id join public.task_programs program on program.id = t.program_id
    where m.id = w.id;
  get diagnostics opened = row_count;
  return opened;
end $$;

revoke all on function public.app_task_returned(uuid, uuid), public.tg_target_error(uuid, uuid), public.app_submission_level_guard(),
  public.app_program_catch_up(uuid, timestamptz) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;

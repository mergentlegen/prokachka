-- Mentor-recorded completions and a one-hour reminder after a participant opens a task link.
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

-- 1. A mentor may record a completion the participant never submitted (for example an external test).
alter table public.submissions drop constraint if exists submissions_submission_source_check;
alter table public.submissions drop constraint if exists submissions_source_check;
alter table public.submissions add constraint submissions_source_check
  check (submission_source in ('telegram', 'interactive', 'mentor'));

-- Creates the submission and accepts it in one transaction through the regular review path,
-- so miles, program progress and the feedback thread behave exactly like a normal review.
create or replace function public.app_mentor_record_submission(
  p_task uuid, p_member uuid, p_reviewer uuid, p_ceo boolean, p_points integer, p_comment text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  account public.users%rowtype; reviewer public.users%rowtype; task public.tasks%rowtype;
  saved public.submissions%rowtype; result jsonb; comment_text text := btrim(coalesce(p_comment, ''));
begin
  -- Same lock order as tg_review_submission: participant first, so parallel reviews serialize.
  select * into account from public.users where id = p_member for update;
  select * into task from public.tasks where id = p_task;
  if account.id is null or task.id is null then return jsonb_build_object('forbidden', true); end if;
  if not coalesce(p_ceo, false) then
    select * into reviewer from public.users where id = p_reviewer;
    if reviewer.id is null or reviewer.id = account.id or reviewer.team_id is distinct from account.team_id
      or reviewer.team_id is distinct from task.team_id
      or not (reviewer.role = 'admin' or (reviewer.role = 'member' and reviewer.can_review
        and reviewer.id in (select a.id from public.tg_ancestor_ids(account.id) a))) then
      return jsonb_build_object('forbidden', true);
    end if;
  end if;
  if char_length(comment_text) = 0 then return jsonb_build_object('validationError', 'Напишите участнику обратную связь.'); end if;
  if char_length(comment_text) > 4000 then return jsonb_build_object('validationError', 'Комментарий слишком длинный.'); end if;
  if p_points is null or p_points < 0 then return jsonb_build_object('validationError', 'Некорректное количество миль.'); end if;
  if account.role <> 'member' or account.team_id is null or account.team_id is distinct from task.team_id then
    return jsonb_build_object('validationError', 'Участник не состоит в команде задания.');
  end if;
  if task.interactive_kind is not null then return jsonb_build_object('validationError', 'Эта игра засчитывается автоматически.'); end if;
  if not task.is_active then return jsonb_build_object('validationError', 'Задание скрыто. Активируйте его, чтобы засчитать выполнение.'); end if;
  if task.audience_root_id is not null and not exists (select 1 from public.tg_ancestor_ids(account.id) a where a.id = task.audience_root_id) then
    return jsonb_build_object('validationError', 'Задание не публиковалось для ветки этого участника.');
  end if;
  if task.publication_type = 'sequential' and not exists (select 1 from public.member_program_progress
    where user_id = account.id and program_id = task.program_id and current_task_id = task.id and status = 'active') then
    return jsonb_build_object('validationError', 'У участника сейчас открыт другой шаг программы.');
  end if;
  -- The deadline is deliberately not checked: the mentor decides whether a late result counts.
  if exists (select 1 from public.submissions where user_id = account.id and task_id = task.id and status = 'accepted') then
    return jsonb_build_object('validationError', 'Задание у этого участника уже зачтено.');
  end if;
  if exists (select 1 from public.submissions where user_id = account.id and task_id = task.id and status = 'pending'
    and (media_type is not null or btrim(answer_text) <> '')) then
    return jsonb_build_object('validationError', 'Участник уже отправил работу. Проверьте её в разделе «Проверка работ».');
  end if;

  begin
    insert into public.submissions(user_id, task_id, status, submission_source, media_type, answer_text)
      values(account.id, task.id, 'pending', 'mentor', 'text', 'Выполнение отмечено наставником.')
      returning * into saved;
    result := public.app_feedback_review_submission(saved.id, p_reviewer, p_ceo, 'accepted', p_points, comment_text, saved.review_version);
    if not (result ? 'data') then
      raise exception using errcode = 'PMR01', message = coalesce(result->>'validationError', 'forbidden');
    end if;
  exception when sqlstate 'PMR01' then
    -- The savepoint of this block drops the half-created submission.
    if sqlerrm = 'forbidden' then return jsonb_build_object('forbidden', true); end if;
    return jsonb_build_object('validationError', sqlerrm);
  end;
  -- Mentors were queued for a "new work" message by the insert trigger; the work is already checked.
  update public.telegram_notification_jobs set cancelled_at = now(), locked_until = null
    where submission_id = saved.id and kind = 'submission' and delivered_at is null;
  return result;
end;
$$;

-- 2. Participants who open a task link and do not submit within an hour get one Telegram reminder.
create table if not exists public.task_link_opens (
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  opened_at timestamptz not null default now(),
  reminded_at timestamptz,
  primary key (user_id, task_id)
);
create index if not exists task_link_opens_due_idx on public.task_link_opens(opened_at) where reminded_at is null;
alter table public.task_link_opens enable row level security;
revoke all on public.task_link_opens from public, anon, authenticated;
grant select, insert, update, delete on public.task_link_opens to service_role;

alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check
  check(kind in ('permissions','submission','survey','company-voice','captain-screenshot','feedback','task-reminder'));

-- Records only links the participant could still act on; every new open restarts the hour.
create or replace function public.app_record_task_link_open(p_user uuid, p_task uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tasks where id = p_task and interactive_kind is null and nullif(btrim(resource_url), '') is not null)
    or public.tg_target_error(p_user, p_task) is not null then return false; end if;
  insert into public.task_link_opens(user_id, task_id, opened_at, reminded_at) values(p_user, p_task, now(), null)
    on conflict (user_id, task_id) do update set opened_at = excluded.opened_at, reminded_at = null;
  return true;
end;
$$;

-- True while the participant still owes work for the link opened at least an hour ago.
create or replace function public.app_task_reminder_due(p_user uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_link_opens o
    where o.user_id = p_user and o.task_id = p_task and o.opened_at <= now() - interval '1 hour'
      and public.tg_target_error(o.user_id, o.task_id) is null
      and not exists (select 1 from public.submissions s where s.user_id = o.user_id and s.task_id = o.task_id
        and s.submitted_at >= o.opened_at and (s.media_type is not null or btrim(s.answer_text) <> ''))
  );
$$;

-- Called by the minute delivery worker. Links older than a day are no longer worth a reminder.
create or replace function public.app_queue_task_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare queued integer;
begin
  with due as (
    select o.user_id, o.task_id from public.task_link_opens o join public.users u on u.id = o.user_id
    where o.reminded_at is null and o.opened_at <= now() - interval '1 hour' and o.opened_at > now() - interval '1 day'
      and u.telegram_id is not null and public.app_task_reminder_due(o.user_id, o.task_id)
    order by o.opened_at limit 200
    for update of o skip locked
  ), marked as (
    update public.task_link_opens o set reminded_at = now() from due
    where o.user_id = due.user_id and o.task_id = due.task_id returning o.user_id, o.task_id
  )
  insert into public.telegram_notification_jobs(recipient_id, kind, payload)
    select user_id, 'task-reminder', jsonb_build_object('taskId', task_id) from marked;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.app_mentor_record_submission(uuid,uuid,uuid,boolean,integer,text),
  public.app_record_task_link_open(uuid,uuid), public.app_task_reminder_due(uuid,uuid),
  public.app_queue_task_reminders() from public, anon, authenticated;
grant execute on function public.app_mentor_record_submission(uuid,uuid,uuid,boolean,integer,text),
  public.app_record_task_link_open(uuid,uuid), public.app_task_reminder_due(uuid,uuid),
  public.app_queue_task_reminders() to service_role;
notify pgrst, 'reload schema';
commit;

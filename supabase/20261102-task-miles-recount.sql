-- Lowering a task's miles now recounts what participants already received: nobody keeps more than the task is worth now.
-- Each participant whose miles went down gets one Telegram message. Raising the miles changes nothing for past works.
-- Also corrects the program test «На воспроизведение» once (5 → 2 miles, the extra 3 are taken back).
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check
  check(kind in ('permissions','submission','survey','company-voice','captain-screenshot','feedback','task-reminder',
    'task-nudge','announcement','start-reminder','miles-recount'));

-- Accepted works above the task's current miles go down to it; the mentor's decision in the feedback thread shows the same number.
-- Finished games keep their result: their records are protected and their reward never changes from the task editor.
create or replace function public.app_recount_task_miles(p_task uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare task public.tasks%rowtype; affected integer;
begin
  select * into task from public.tasks where id = p_task;
  if task.id is null then return 0; end if;
  with previous as (
    select id, user_id, points from public.submissions
    where task_id = task.id and status = 'accepted' and points > task.max_points and submission_source <> 'interactive'
    for update
  ), lowered as (
    update public.submissions s set points = task.max_points from previous p where s.id = p.id
    returning s.id, p.user_id, p.points as was
  ), decisions as (
    update public.feedback_events e set points = task.max_points from lowered l
    where e.submission_id = l.id and e.points > task.max_points returning e.seq
  ), per_user as (
    select user_id, sum(was)::integer as was, (count(*) * task.max_points)::integer as became from lowered group by user_id
  ), queued as (
    insert into public.telegram_notification_jobs(recipient_id, kind, payload)
    select p.user_id, 'miles-recount', jsonb_build_object('taskId', task.id, 'title', left(task.title, 200), 'from', p.was, 'to', p.became)
    from per_user p join public.users u on u.id = p.user_id where u.telegram_id is not null
    returning id
  ) select count(*) into affected from per_user;
  return affected;
end $$;

create or replace function public.app_task_miles_lowered()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.app_recount_task_miles(new.id);
  return null;
end $$;

drop trigger if exists tasks_miles_lowered on public.tasks;
create trigger tasks_miles_lowered after update of max_points on public.tasks
  for each row when (new.max_points < old.max_points) execute function public.app_task_miles_lowered();

revoke all on function public.app_recount_task_miles(uuid), public.app_task_miles_lowered() from public, anon, authenticated;

-- The test «На воспроизведение» was lowered from 5 to 2 before this rule existed: recount it now.
select public.app_recount_task_miles(t.id) from public.tasks t
  left join public.task_programs p on p.id = t.program_id
  where t.program_id is not null and (t.title ilike '%воспроизвед%' or p.title ilike '%воспроизвед%');

notify pgrst, 'reload schema';
commit;

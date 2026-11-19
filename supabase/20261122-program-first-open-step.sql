-- The step a participant works on is always the first step of the program they have not passed, in the mentor's order.
-- Before, a step added or moved above a participant's current step opened only after the current one was accepted,
-- so the new steps stood closed («откроется после текущего») and the participant stayed on a later step.
-- Now, when a mentor adds a step, adds a game, shows a hidden step, hides one or changes the order, every participant
-- of the program moves to their first step not passed yet, with a fresh deadline.
-- A participant whose work on the current step waits for the review stays on it; after it is accepted
-- app_program_advance already opens the first step not passed.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

create or replace function public.app_program_realign(p_program uuid, p_stamp timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare moved integer; program_level smallint;
begin
  select coalesce(level, 1) into program_level from public.task_programs where id = p_program;
  if program_level is null then return 0; end if;
  with candidates as (
    select p.id, p.user_id, p.current_task_id from public.member_program_progress p
      where p.program_id = p_program and p.status = 'active' and p.current_task_id is not null
        and public.app_member_level(p.user_id) = program_level
      for update of p
  ), waiting as (
    select c.id, (select t.id from public.tasks t
        where t.program_id = p_program and t.is_active and t.publication_type = 'sequential'
          and not exists (select 1 from public.submissions s where s.user_id = c.user_id and s.task_id = t.id and s.status = 'accepted')
        order by t.position, t.id limit 1) as next_id
      from candidates c
      -- A work sent on the current step waits for the mentor: the participant stays on that step.
      where not exists (select 1 from public.submissions s where s.user_id = c.user_id and s.task_id = c.current_task_id and s.status = 'pending'
        and (s.media_type is not null or btrim(coalesce(s.answer_text, '')) <> '' or s.quiz_answers is not null))
  )
  update public.member_program_progress m set current_task_id = t.id, unlocked_at = p_stamp,
      due_at = case when t.interactive_kind is not null then p_stamp + interval '100 years'
        else p_stamp + make_interval(hours => coalesce(t.deadline_hours, program.deadline_hours, 72)) end,
      updated_at = p_stamp
    from waiting w join public.tasks t on t.id = w.next_id join public.task_programs program on program.id = t.program_id
    where m.id = w.id and m.status = 'active' and m.current_task_id is distinct from t.id;
  get diagnostics moved = row_count;
  return moved;
end $$;

-- Any change of the steps — a new step, a game, «Показать»/«Скрыть», a new order — catches finished participants up
-- and moves everyone in progress to their first step not passed.
create or replace function public.app_program_step_catch_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.app_program_catch_up(new.program_id, now());
  perform public.app_program_realign(new.program_id, now());
  return null;
end $$;

drop trigger if exists tasks_program_catch_up on public.tasks;
create trigger tasks_program_catch_up after insert or update of is_active, position on public.tasks
  for each row when (new.program_id is not null and new.publication_type = 'sequential')
  execute function public.app_program_step_catch_up();

-- The same as in 20261103, plus a shared lock on the program: an accepted step waits for a new order or a new step
-- being saved at the same moment, and then picks the next step by that order, never by the old one.
create or replace function public.app_program_advance(p_user uuid, p_task uuid, p_stamp timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare task public.tasks%rowtype; next_task public.tasks%rowtype;
begin
  select * into task from public.tasks where id = p_task;
  if task.program_id is null then return; end if;
  perform 1 from public.task_programs where id = task.program_id for share;
  -- Steps already accepted (e.g. moved down after a reorder) are never opened again. Game steps have no deadline.
  select t.* into next_task from public.tasks t
    where t.program_id = task.program_id and t.is_active and t.publication_type = 'sequential' and t.id <> task.id
      and not exists (select 1 from public.submissions s where s.user_id = p_user and s.task_id = t.id and s.status = 'accepted')
    order by t.position, t.id limit 1;
  if next_task.id is not null then
    update public.member_program_progress set current_task_id = next_task.id, unlocked_at = p_stamp,
      due_at = case when next_task.interactive_kind is not null then p_stamp + interval '100 years'
        else p_stamp + make_interval(hours => coalesce(next_task.deadline_hours, (select deadline_hours from public.task_programs where id = task.program_id), 72)) end,
      updated_at = p_stamp
      where user_id = p_user and program_id = task.program_id and current_task_id = task.id and status = 'active';
  else
    update public.member_program_progress set current_task_id = null, status = 'completed', completed_at = p_stamp, updated_at = p_stamp
      where user_id = p_user and program_id = task.program_id and current_task_id = task.id and status = 'active';
  end if;
end $$;

revoke all on function public.app_program_realign(uuid, timestamptz), public.app_program_step_catch_up(), public.app_program_advance(uuid, uuid, timestamptz)
  from public, anon, authenticated;

-- Once: everyone already standing on a later step while a step above is not passed moves to that step.
create temporary table program_realign_result as
  select coalesce(sum(public.app_program_realign(id, now())), 0)::integer as moved from public.task_programs where template_key is null;

notify pgrst, 'reload schema';
commit;

select moved as "Переведено участников" from program_realign_result;
drop table program_realign_result;

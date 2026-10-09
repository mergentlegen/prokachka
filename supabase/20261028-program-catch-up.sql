-- Participants who finished a program always get its new steps: whenever an active step appears in a program
-- (added, or a hidden step shown again), whoever had finished it continues from the first step they have not done.
-- Also catches up once on steps added before this rule existed.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

-- Moves everyone who finished the program (or whose current step disappeared) to their first active step without
-- an accepted answer. Returns how many participants got a step opened.
create or replace function public.app_program_catch_up(p_program uuid, p_stamp timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare opened integer;
begin
  with waiting as (
    select p.id, (select t.id from public.tasks t
        where t.program_id = p.program_id and t.is_active and t.publication_type = 'sequential'
          and not exists (select 1 from public.submissions s where s.user_id = p.user_id and s.task_id = t.id and s.status = 'accepted')
        order by t.position, t.id limit 1) as next_id
      from public.member_program_progress p
      where p.program_id = p_program and (p.status = 'completed' or p.current_task_id is null)
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

-- Kept for add_step / add_game: catches the program up and says how many got exactly this step.
create or replace function public.app_program_reopen(p_task uuid, p_stamp timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare program uuid;
begin
  select program_id into program from public.tasks where id = p_task;
  if program is null then return 0; end if;
  perform public.app_program_catch_up(program, p_stamp);
  return (select count(*) from public.member_program_progress
    where program_id = program and current_task_id = p_task and status = 'active' and unlocked_at = p_stamp)::integer;
end $$;

-- Any way a step becomes active in a program — a new step, a ready game, «Показать» on a hidden step.
create or replace function public.app_program_step_catch_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.app_program_catch_up(new.program_id, now());
  return null;
end $$;

drop trigger if exists tasks_program_catch_up on public.tasks;
create trigger tasks_program_catch_up after insert or update of is_active on public.tasks
  for each row when (new.program_id is not null and new.is_active and new.publication_type = 'sequential')
  execute function public.app_program_step_catch_up();

revoke all on function public.app_program_catch_up(uuid, timestamptz), public.app_program_reopen(uuid, timestamptz),
  public.app_program_step_catch_up() from public, anon, authenticated;

-- One-time catch-up for steps added before this rule.
create temporary table program_catch_up_result as
  select coalesce(sum(public.app_program_catch_up(id, now())), 0)::integer as opened from public.task_programs where template_key is null;

notify pgrst, 'reload schema';
commit;

select opened as "Участникам открыты новые шаги" from program_catch_up_result;
drop table program_catch_up_result;

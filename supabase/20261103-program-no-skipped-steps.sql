-- No step of a program is skipped any more. After a passed step the participant gets the first step of the program
-- they have not passed yet, wherever it stands: a step added or moved above their current one used to be passed by,
-- and the program counted as finished without it.
-- Also reopens, once, everyone who was marked as finished while a step of the program is still not passed.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

create or replace function public.app_program_advance(p_user uuid, p_task uuid, p_stamp timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare task public.tasks%rowtype; next_task public.tasks%rowtype;
begin
  select * into task from public.tasks where id = p_task;
  if task.program_id is null then return; end if;
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

revoke all on function public.app_program_advance(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Everyone finished with a step still not passed continues from that step.
create temporary table program_gap_result as
  select coalesce(sum(public.app_program_catch_up(id, now())), 0)::integer as opened from public.task_programs where template_key is null;

notify pgrst, 'reload schema';
commit;

select opened as "Участникам открыты пропущенные шаги" from program_gap_result;
drop table program_gap_result;

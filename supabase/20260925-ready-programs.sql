-- Ready interactive programs. Apply once to an existing Supabase database.
begin;

alter table public.task_programs add column if not exists template_key text;
alter table public.tasks add column if not exists interactive_kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_programs_template_key_check') then
    alter table public.task_programs add constraint task_programs_template_key_check
      check (template_key is null or template_key in ('dream-plan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_interactive_kind_check') then
    alter table public.tasks add constraint tasks_interactive_kind_check
      check (interactive_kind is null or interactive_kind in ('dream-plan'));
  end if;
end $$;

create unique index if not exists task_programs_team_template_unique_idx
  on public.task_programs(team_id, template_key) where template_key is not null;

create or replace function public.app_create_program(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare program public.task_programs%rowtype; task jsonb; step integer := 0; steps jsonb; publication text; interactive text;
begin
  if jsonb_typeof(p_input->'tasks') is distinct from 'array' then raise exception 'Tasks must be an array'; end if;
  if jsonb_array_length(p_input->'tasks') not between 1 and 100 then raise exception 'A program must contain 1 to 100 steps'; end if;
  insert into public.task_programs(team_id,title,deadline_hours,template_key,publisher_id,audience_root_id,is_active)
    values((p_input->>'teamId')::uuid,trim(p_input->>'title'),(p_input->>'deadlineHours')::int,
      nullif(trim(p_input->>'templateKey'),''),(p_input->>'publisherId')::uuid,(p_input->>'audienceRootId')::uuid,true) returning * into program;
  for task in select value from jsonb_array_elements(p_input->'tasks') loop
    if coalesce(char_length(trim(task->>'title')),0) not between 2 and 160
      or coalesce(char_length(trim(task->>'description')),0) not between 2 and 5000 then
      raise exception using errcode = '23514', message = 'Invalid program step';
    end if;
    publication := coalesce(nullif(task->>'publicationType',''),'sequential');
    interactive := nullif(trim(task->>'interactiveKind'),'');
    if publication not in ('evergreen','fixed','sequential') then raise exception using errcode = '23514', message = 'Invalid program step type'; end if;
    if interactive is not null and interactive not in ('dream-plan') then raise exception using errcode = '23514', message = 'Invalid interactive step'; end if;
    step := step + 1;
    insert into public.tasks(team_id,program_id,publication_type,position,title,description,max_points,deadline_at,
      resource_url,publisher_id,audience_root_id,deadline_hours,interactive_kind,is_active)
    values(program.team_id,program.id,publication,step,trim(task->>'title'),trim(task->>'description'),
      (task->>'maxPoints')::int,null,nullif(task->>'resourceUrl',''),program.publisher_id,program.audience_root_id,
      case when publication = 'sequential' then program.deadline_hours else null end,interactive,true);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.position),'[]') into steps from public.tasks t where program_id = program.id;
  return jsonb_build_object('program',to_jsonb(program),'tasks',steps);
end $$;

revoke all on function public.app_create_program(jsonb) from public, anon, authenticated;
grant execute on function public.app_create_program(jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

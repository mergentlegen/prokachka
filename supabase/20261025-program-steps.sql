-- New steps in a running program: a mentor adds a normal step (or a ready game) to the end,
-- and participants who had already finished the program get the new step opened for them.
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

-- Opens a step just added to a program for everyone who had finished it. The step gets the usual time;
-- a game step has no deadline.
create or replace function public.app_program_reopen(p_task uuid, p_stamp timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare task public.tasks%rowtype; reopened integer;
begin
  select * into task from public.tasks where id = p_task;
  if task.program_id is null then return 0; end if;
  update public.member_program_progress set current_task_id = task.id, status = 'active', completed_at = null, unlocked_at = p_stamp,
    due_at = case when task.interactive_kind is not null then p_stamp + interval '100 years'
      else p_stamp + make_interval(hours => coalesce(task.deadline_hours, (select deadline_hours from public.task_programs where id = task.program_id), 72)) end,
    updated_at = p_stamp
    where program_id = task.program_id and status = 'completed';
  get diagnostics reopened = row_count;
  return reopened;
end $$;

-- Adds a normal step as the last one of a program. Video, questions and PDF files are attached to it afterwards,
-- exactly as for any task.
create or replace function public.app_program_add_step(p_actor uuid, p_program uuid, p_title text, p_description text, p_resource_url text, p_max_points integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare program public.task_programs%rowtype; saved public.tasks%rowtype; stamp timestamptz := now(); reopened integer;
begin
  if not public.app_program_can_manage(p_actor, p_program) then return jsonb_build_object('forbidden', true); end if;
  if coalesce(char_length(btrim(p_title)), 0) not between 2 and 160 or coalesce(char_length(btrim(p_description)), 0) not between 2 and 5000 then
    return jsonb_build_object('validationError', 'Название шага — от 2 до 160 символов, описание — от 2 до 5000.');
  end if;
  if p_max_points is null or p_max_points < 0 then return jsonb_build_object('validationError', 'Некорректное количество миль.'); end if;
  select * into program from public.task_programs where id = p_program for update;
  if (select count(*) from public.tasks where program_id = p_program) >= 100 then
    return jsonb_build_object('validationError', 'В программе уже 100 шагов — это максимум.');
  end if;
  insert into public.tasks(title, description, team_id, max_points, publication_type, program_id, position, deadline_hours, resource_url, publisher_id, audience_root_id, is_active)
    values (btrim(p_title), btrim(p_description), program.team_id, p_max_points, 'sequential', program.id,
      coalesce((select max(position) from public.tasks where program_id = program.id), 0) + 1,
      program.deadline_hours, nullif(btrim(coalesce(p_resource_url, '')), ''), program.publisher_id, program.audience_root_id, true)
    returning * into saved;
  reopened := public.app_program_reopen(saved.id, stamp);
  return jsonb_build_object('data', to_jsonb(saved), 'reopened', reopened);
end $$;

-- The ready game follows the same rule: added to the end, opened for those who had finished.
create or replace function public.app_program_add_game(p_actor uuid, p_program uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare program public.task_programs%rowtype; saved public.tasks%rowtype; reopened integer;
begin
  if not public.app_program_can_manage(p_actor, p_program) then return jsonb_build_object('forbidden', true); end if;
  if p_kind is distinct from 'first-year' then return jsonb_build_object('validationError', 'Такой игры нет в каталоге.'); end if;
  select * into program from public.task_programs where id = p_program for update;
  if exists (select 1 from public.tasks where program_id = p_program and interactive_kind = p_kind) then
    return jsonb_build_object('validationError', 'Эта игра уже есть в программе.');
  end if;
  if (select count(*) from public.tasks where program_id = p_program) >= 100 then
    return jsonb_build_object('validationError', 'В программе уже 100 шагов — это максимум.');
  end if;
  insert into public.tasks(title, description, team_id, max_points, publication_type, program_id, position, publisher_id, audience_root_id, interactive_kind, is_active)
    values ('Мой первый год в клубе',
      'Проживи первый год в клубе за 7 минут: 12 месяцев, 12 решений и правила, которые помогают доплыть до круиза мечты.',
      program.team_id, 2, 'sequential', program.id,
      coalesce((select max(position) from public.tasks where program_id = program.id), 0) + 1,
      program.publisher_id, program.audience_root_id, p_kind, true)
    returning * into saved;
  reopened := public.app_program_reopen(saved.id, now());
  return jsonb_build_object('data', to_jsonb(saved), 'reopened', reopened);
end $$;

revoke all on function public.app_program_reopen(uuid, timestamptz), public.app_program_add_step(uuid, uuid, text, text, text, integer),
  public.app_program_add_game(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.app_program_add_step(uuid, uuid, text, text, text, integer), public.app_program_add_game(uuid, uuid, text) to service_role;
notify pgrst, 'reload schema';
commit;

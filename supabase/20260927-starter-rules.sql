-- Adds a second ready game without changing existing attempts or earned miles.
begin;

alter table public.task_programs drop constraint if exists task_programs_template_key_check;
alter table public.task_programs add constraint task_programs_template_key_check
  check (template_key is null or template_key in ('dream-plan', 'starter-rules'));
alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check
  check (interactive_kind is null or interactive_kind in ('dream-plan', 'starter-rules'));

-- Answer keys stay server-only. No database table or public API exposes them.
create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path = public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"answers":[1,1,0,1,2]}'::jsonb
    else null end;
$$;

create or replace function public.app_ready_task_error(p_user_id uuid, p_task_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare account public.users%rowtype; task public.tasks%rowtype; team public.teams%rowtype; spec jsonb;
begin
  select * into account from public.users where id = p_user_id;
  select * into task from public.tasks where id = p_task_id;
  if account.id is null or account.role <> 'member' then return 'Готовая программа доступна только участникам.'; end if;
  spec := public.app_ready_program_spec(task.interactive_kind);
  if task.id is null or not task.is_active or spec is null then return 'Готовая программа недоступна.'; end if;
  if task.publication_type <> 'evergreen' or task.deadline_at is not null then return 'У готовой программы не должно быть дедлайна.'; end if;
  if task.max_points <> jsonb_array_length(spec->'answers') then return 'Награда программы настроена неверно.'; end if;
  if account.team_id is null or task.team_id is distinct from account.team_id then return 'Пользователь не состоит в команде программы.'; end if;
  select * into team from public.teams where id = account.team_id;
  if team.id is null or not team.is_active then return 'Команда недоступна.'; end if;
  if task.audience_root_id is not null and not exists (
    select 1 from public.tg_ancestor_ids(account.id) a where a.id = task.audience_root_id
  ) then return 'Программа недоступна для вашей ветки.'; end if;
  if task.program_id is null or not exists (
    select 1 from public.task_programs p where p.id = task.program_id and p.is_active and p.team_id = account.team_id
      and p.template_key = task.interactive_kind
      and (p.audience_root_id is null or exists (select 1 from public.tg_ancestor_ids(account.id) a where a.id = p.audience_root_id))
  ) then return 'Программа недоступна.'; end if;
  return null;
end $$;

create or replace function public.app_advance_ready_program(p_user_id uuid, p_task_id uuid, p_step integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text; spec jsonb;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  select public.app_ready_program_spec(interactive_kind) into spec from public.tasks where id = p_task_id;
  if p_step is null or p_step not between 1 and (spec->>'steps')::int then
    return jsonb_build_object('validationError', 'Некорректный шаг программы.');
  end if;
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if not found or attempt.status <> 'active' then return jsonb_build_object('validationError', 'Сначала начните программу.'); end if;
  if p_step <> attempt.current_step + 1 then return jsonb_build_object('validationError', 'Шаг программы выполняется в другом порядке.'); end if;
  update public.ready_program_attempts set current_step = p_step, state = '{}'::jsonb
    where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt);
end $$;

-- The optional question index prevents a retried request from answering the next question.
-- Existing callers with three arguments remain compatible with the default.
drop function if exists public.app_answer_ready_program(uuid, uuid, integer);
create or replace function public.app_answer_ready_program(
  p_user_id uuid, p_task_id uuid, p_answer integer, p_expected_question_index integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text; spec jsonb; question_index integer; correct_answer integer; total integer;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  if p_answer is null or p_answer not between 0 and 2 then return jsonb_build_object('validationError', 'Некорректный вариант ответа.'); end if;
  select public.app_ready_program_spec(interactive_kind) into spec from public.tasks where id = p_task_id;
  total := jsonb_array_length(spec->'answers');
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if not found or attempt.status <> 'active' or attempt.current_step <> (spec->>'steps')::int then
    return jsonb_build_object('validationError', 'Сначала пройдите все шаги программы.');
  end if;
  question_index := coalesce((attempt.state->>'questionIndex')::integer, 0);
  if p_expected_question_index is not null and p_expected_question_index <> question_index then
    if p_expected_question_index = question_index - 1
      and (attempt.state->>'lastQuestionIndex')::int = p_expected_question_index
      and (attempt.state->>'lastAnswer')::int = p_answer and not coalesce((attempt.state->>'failed')::boolean,false) then
      return public.app_ready_attempt_json(attempt);
    end if;
    return jsonb_build_object('validationError', 'Вопрос уже изменился. Откройте игру снова, чтобы обновить прогресс.');
  end if;
  if coalesce((attempt.state->>'failed')::boolean, false) then
    return public.app_ready_attempt_json(attempt) || jsonb_build_object('message', 'Нажмите «Пройти заново», чтобы повторить тест.');
  end if;
  if question_index not between 0 and total - 1 then return jsonb_build_object('validationError', 'Все вопросы программы уже отвечены.'); end if;
  correct_answer := (spec->'answers'->>question_index)::int;
  if p_answer <> correct_answer then
    update public.ready_program_attempts set state = jsonb_build_object(
      'questionIndex', question_index, 'lastQuestionIndex', question_index, 'lastAnswer', p_answer, 'failed', true, 'ready', false
    ) where id = attempt.id returning * into attempt;
    return public.app_ready_attempt_json(attempt) || jsonb_build_object('message', 'Ответ неверный. Нажмите «Пройти заново», чтобы повторить тест и получить максимум миль.');
  end if;
  update public.ready_program_attempts set earned_points = question_index + 1, state = jsonb_build_object(
    'questionIndex', question_index + 1, 'lastQuestionIndex', question_index, 'lastAnswer', p_answer, 'ready', question_index + 1 = total
  ) where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt);
end $$;

create or replace function public.app_restart_ready_program_quiz(p_user_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text; spec jsonb;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  select public.app_ready_program_spec(interactive_kind) into spec from public.tasks where id = p_task_id;
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if not found or attempt.status <> 'active' or attempt.current_step <> (spec->>'steps')::int then
    return jsonb_build_object('validationError', 'Сначала пройдите все шаги программы.');
  end if;
  if not coalesce((attempt.state->>'failed')::boolean, false) then return jsonb_build_object('validationError', 'Тест не требует перезапуска.'); end if;
  update public.ready_program_attempts set earned_points = 0, state = jsonb_build_object('questionIndex', 0),
    attempt_number = attempt.attempt_number + 1 where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt);
end $$;

create or replace function public.app_complete_ready_program(p_user_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; error_text text; spec jsonb; total integer;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if not found then return jsonb_build_object('validationError', 'Сначала начните программу.'); end if;
  if attempt.status = 'completed' then
    select * into saved from public.submissions where user_id = p_user_id and task_id = p_task_id
      and submission_source = 'interactive' and status = 'accepted' order by created_at desc limit 1;
    return public.app_ready_attempt_json(attempt) || jsonb_build_object('submission', to_jsonb(saved));
  end if;
  select * into task from public.tasks where id = p_task_id for share;
  spec := public.app_ready_program_spec(task.interactive_kind);
  total := jsonb_array_length(spec->'answers');
  if attempt.current_step <> (spec->>'steps')::int or (attempt.state->>'ready')::boolean is distinct from true
    or coalesce((attempt.state->>'failed')::boolean,false) or attempt.earned_points <> total
    or coalesce((attempt.state->>'questionIndex')::int,0) <> total then
    return jsonb_build_object('validationError', 'Сначала правильно ответьте на все пять вопросов.');
  end if;
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, comment, reviewed_at, submission_source)
    values (p_user_id, p_task_id, 'accepted', 'text', 'Интерактивная программа «' || task.title || '» завершена.', total,
      'Зачтено автоматически после прохождения программы.', now(), 'interactive') returning * into saved;
  update public.ready_program_attempts set status = 'completed', completed_at = now(), earned_points = total
    where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt) || jsonb_build_object('submission', to_jsonb(saved));
end $$;

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
    if interactive is not null and public.app_ready_program_spec(interactive) is null then raise exception using errcode = '23514', message = 'Invalid interactive step'; end if;
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


revoke all on function public.app_ready_program_spec(text) from public, anon, authenticated;
revoke all on function public.app_ready_task_error(uuid,uuid) from public, anon, authenticated;
revoke all on function public.app_advance_ready_program(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.app_answer_ready_program(uuid,uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.app_restart_ready_program_quiz(uuid,uuid) from public, anon, authenticated;
revoke all on function public.app_complete_ready_program(uuid,uuid) from public, anon, authenticated;
revoke all on function public.app_create_program(jsonb) from public, anon, authenticated;
grant execute on function public.app_advance_ready_program(uuid,uuid,integer) to service_role;
grant execute on function public.app_answer_ready_program(uuid,uuid,integer,integer) to service_role;
grant execute on function public.app_restart_ready_program_quiz(uuid,uuid) to service_role;
grant execute on function public.app_complete_ready_program(uuid,uuid) to service_role;
grant execute on function public.app_create_program(jsonb) to service_role;

notify pgrst, 'reload schema';
commit;

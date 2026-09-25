-- Follow-up for installations that already applied 20260925-ready-programs.sql.
-- A wrong answer remains visible until the participant explicitly restarts the quiz.
begin;

create or replace function public.app_ready_attempt_json(p_attempt public.ready_program_attempts)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'attemptId', p_attempt.id,
    'step', p_attempt.current_step,
    'status', p_attempt.status,
    'attemptNumber', p_attempt.attempt_number,
    'earnedPoints', p_attempt.earned_points,
    'maxPoints', 5,
    'questionIndex', coalesce((p_attempt.state->>'questionIndex')::integer, 0),
    'answeredQuestions', coalesce((p_attempt.state->>'questionIndex')::integer, 0),
    'ready', coalesce((p_attempt.state->>'ready')::boolean, false),
    'failed', coalesce((p_attempt.state->>'failed')::boolean, false),
    'lastAnswer', case when p_attempt.state ? 'lastAnswer' then (p_attempt.state->>'lastAnswer')::integer else null end,
    'completed', p_attempt.status = 'completed'
  );
$$;

create or replace function public.app_answer_ready_program(p_user_id uuid, p_task_id uuid, p_answer integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text; question_index integer; correct_answer integer; next_points integer;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  if p_answer not between 0 and 2 then return jsonb_build_object('validationError', 'Некорректный вариант ответа.'); end if;
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if not found or attempt.status <> 'active' or attempt.current_step <> 12 then
    return jsonb_build_object('validationError', 'Сначала пройдите все шаги программы.');
  end if;
  question_index := coalesce((attempt.state->>'questionIndex')::integer, 0);
  if coalesce((attempt.state->>'failed')::boolean, false) then
    return jsonb_build_object('validationError', 'Нажмите «Пройти заново», чтобы начать новую попытку теста.');
  end if;
  if question_index not between 0 and 4 then
    return jsonb_build_object('validationError', 'Все вопросы программы уже отвечены.');
  end if;
  correct_answer := case question_index
    when 0 then 1
    when 1 then 2
    when 2 then 1
    when 3 then 2
    else 2
  end;
  if p_answer <> correct_answer then
    update public.ready_program_attempts set state = jsonb_build_object(
      'questionIndex', question_index, 'lastAnswer', p_answer, 'failed', true, 'ready', false, 'lastResult', 'wrong-answer'
    ) where id = attempt.id returning * into attempt;
    return public.app_ready_attempt_json(attempt) || jsonb_build_object(
      'failed', true, 'message', 'Ответ неверный. Нажмите «Пройти заново», чтобы повторить тест и получить максимум миль.'
    );
  end if;
  next_points := least(5, attempt.earned_points + 1);
  update public.ready_program_attempts set state = jsonb_build_object('questionIndex', question_index + 1, 'lastAnswer', p_answer, 'ready', question_index = 4), earned_points = next_points
    where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt) || jsonb_build_object(
    'ready', question_index = 4,
    'questionIndex', question_index + 1,
    'message', case when question_index = 4 then 'Отлично! Теперь завершите программу.' else 'Верно! Переходите к следующему вопросу.' end
  );
end $$;

create or replace function public.app_restart_ready_program_quiz(p_user_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if not found or attempt.status <> 'active' or attempt.current_step <> 12 then
    return jsonb_build_object('validationError', 'Сначала пройдите все 12 месяцев программы.');
  end if;
  if not coalesce((attempt.state->>'failed')::boolean, false) then
    return jsonb_build_object('validationError', 'Тест не требует перезапуска.');
  end if;
  update public.ready_program_attempts set earned_points = 0, state = jsonb_build_object('questionIndex', 0),
    attempt_number = attempt.attempt_number + 1 where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt);
end $$;

revoke all on function public.app_ready_attempt_json(public.ready_program_attempts) from public, anon, authenticated;
revoke all on function public.app_answer_ready_program(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.app_restart_ready_program_quiz(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app_answer_ready_program(uuid, uuid, integer) to service_role;
grant execute on function public.app_restart_ready_program_quiz(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;

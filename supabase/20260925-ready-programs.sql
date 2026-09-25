-- Ready interactive programs. Apply once to an existing Supabase database.
begin;

alter table public.task_programs add column if not exists template_key text;
alter table public.tasks add column if not exists interactive_kind text;
alter table public.submissions add column if not exists submission_source text not null default 'telegram';

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
  if not exists (select 1 from pg_constraint where conname = 'submissions_source_check') then
    alter table public.submissions add constraint submissions_source_check
      check (submission_source in ('telegram', 'interactive'));
  end if;
end $$;

create unique index if not exists task_programs_team_template_unique_idx
  on public.task_programs(team_id, template_key) where template_key is not null;

create unique index if not exists submissions_interactive_accepted_idx
  on public.submissions(user_id, task_id)
  where submission_source = 'interactive' and status = 'accepted';

create table if not exists public.ready_program_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  current_step integer not null default 0 check (current_step between 0 and 12),
  status text not null default 'active' check (status in ('active', 'completed')),
  attempt_number integer not null default 1 check (attempt_number >= 1),
  earned_points integer not null default 0 check (earned_points >= 0),
  state jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(user_id, task_id)
);

create index if not exists ready_program_attempts_user_idx
  on public.ready_program_attempts(user_id, status, updated_at desc);
create index if not exists ready_program_attempts_task_idx
  on public.ready_program_attempts(task_id, status, updated_at desc);
drop trigger if exists ready_program_attempts_touch_updated_at on public.ready_program_attempts;
create trigger ready_program_attempts_touch_updated_at before update on public.ready_program_attempts
  for each row execute function public.touch_updated_at();

create or replace function public.app_guard_interactive_submission_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.submission_source = 'interactive' and (
    new.user_id is distinct from old.user_id
    or new.task_id is distinct from old.task_id
    or new.status is distinct from old.status
    or new.points is distinct from old.points
    or new.submission_source is distinct from old.submission_source
  ) then
    raise exception 'Interactive submissions are immutable';
  end if;
  return new;
end $$;

drop trigger if exists submissions_interactive_immutable on public.submissions;
create trigger submissions_interactive_immutable before update on public.submissions
  for each row execute function public.app_guard_interactive_submission_update();

create or replace function public.app_ready_task_error(p_user_id uuid, p_task_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare account public.users%rowtype; task public.tasks%rowtype; team public.teams%rowtype;
begin
  select * into account from public.users where id = p_user_id;
  select * into task from public.tasks where id = p_task_id;
  if account.id is null or account.role <> 'member' then return 'Готовая программа доступна только участникам.'; end if;
  if task.id is null or not task.is_active or task.interactive_kind <> 'dream-plan' then return 'Готовая программа недоступна.'; end if;
  if task.publication_type <> 'evergreen' then return 'У готовой программы не должно быть дедлайна.'; end if;
  if account.team_id is null or task.team_id is distinct from account.team_id then return 'Пользователь не состоит в команде программы.'; end if;
  select * into team from public.teams where id = account.team_id;
  if team.id is null or not team.is_active then return 'Команда недоступна.'; end if;
  if task.audience_root_id is not null and not exists (
    select 1 from public.tg_ancestor_ids(account.id) a where a.id = task.audience_root_id
  ) then return 'Программа недоступна для вашей ветки.'; end if;
  if task.program_id is not null and not exists (
    select 1 from public.task_programs p where p.id = task.program_id and p.is_active and p.team_id = account.team_id
      and (p.audience_root_id is null or exists (select 1 from public.tg_ancestor_ids(account.id) a where a.id = p.audience_root_id))
  ) then return 'Программа недоступна.'; end if;
  return null;
end $$;

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

create or replace function public.app_start_ready_program(p_user_id uuid, p_task_id uuid, p_restart boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  perform 1 from public.users where id = p_user_id for update;
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if found and attempt.status = 'completed' then
    return public.app_ready_attempt_json(attempt) || jsonb_build_object(
      'submission', (select to_jsonb(s) from public.submissions s where s.user_id = p_user_id and s.task_id = p_task_id
        and s.submission_source = 'interactive' and s.status = 'accepted' order by s.created_at desc limit 1)
    );
  end if;
  if not found then
    insert into public.ready_program_attempts(user_id, task_id) values (p_user_id, p_task_id) returning * into attempt;
  elsif p_restart then
    update public.ready_program_attempts set current_step = 0, status = 'active', attempt_number = attempt.attempt_number + 1,
      earned_points = 0, state = '{}'::jsonb, completed_at = null where id = attempt.id returning * into attempt;
  end if;
  return public.app_ready_attempt_json(attempt);
end $$;

create or replace function public.app_advance_ready_program(p_user_id uuid, p_task_id uuid, p_step integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  if p_step not between 1 and 12 then return jsonb_build_object('validationError', 'Некорректный шаг программы.'); end if;
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if not found or attempt.status <> 'active' then return jsonb_build_object('validationError', 'Сначала начните программу.'); end if;
  if p_step <> attempt.current_step + 1 then return jsonb_build_object('validationError', 'Шаг программы выполняется в другом порядке.'); end if;
  update public.ready_program_attempts set current_step = p_step, state = jsonb_build_object('months', p_step)
    where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt);
end $$;

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

create or replace function public.app_complete_ready_program(p_user_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; error_text text;
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
  if attempt.current_step <> 12 or attempt.state->>'ready' <> 'true' or attempt.earned_points <> 5 then
    return jsonb_build_object('validationError', 'Сначала правильно ответьте на все пять вопросов.');
  end if;
  select * into task from public.tasks where id = p_task_id for share;
  insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, comment, reviewed_at, submission_source)
    values (p_user_id, p_task_id, 'accepted', 'text', 'Интерактивная программа «Мечта с планом» завершена.', 5,
      'Зачтено автоматически после прохождения программы.', now(), 'interactive') returning * into saved;
  update public.ready_program_attempts set status = 'completed', completed_at = now(), earned_points = 5
    where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt) || jsonb_build_object('submission', to_jsonb(saved));
end $$;

revoke all on function public.app_ready_task_error(uuid, uuid) from public, anon, authenticated;
revoke all on function public.app_ready_attempt_json(public.ready_program_attempts) from public, anon, authenticated;
revoke all on function public.app_start_ready_program(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.app_advance_ready_program(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.app_answer_ready_program(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.app_restart_ready_program_quiz(uuid, uuid) from public, anon, authenticated;
revoke all on function public.app_complete_ready_program(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app_start_ready_program(uuid, uuid, boolean) to service_role;
grant execute on function public.app_advance_ready_program(uuid, uuid, integer) to service_role;
grant execute on function public.app_answer_ready_program(uuid, uuid, integer) to service_role;
grant execute on function public.app_restart_ready_program_quiz(uuid, uuid) to service_role;
grant execute on function public.app_complete_ready_program(uuid, uuid) to service_role;

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

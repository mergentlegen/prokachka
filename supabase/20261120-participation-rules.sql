-- «Правила участия» replace «Правила игры» (ready game kind starter-rules): ten rules of the platform and five questions.
-- One try per question; the first answer is kept and gives 1 mile if right, up to 5 miles when the fifth is answered.
-- Published games get the new name and text (texts edited by a mentor stay). Finished games keep their result and miles;
-- unfinished ones start the new questions. The old quiz path (retry until all right) no longer completes this game.
-- Apply once to an existing database after 20261119; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

-- Every game of the catalog stays here: this function is the one list of rewards. starter-rules: the first option is right.
create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[0,0,0,0,0]}'::jsonb
    when 'company-voyage' then '{"steps":9,"reward":2,"answers":[1,1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    when 'captain-cruise' then '{"steps":1,"reward":10,"answers":[]}'::jsonb
    when 'count-your-dream' then '{"steps":12,"reward":10,"answers":[]}'::jsonb
    when 'dream-route' then '{"steps":11,"reward":10,"answers":[]}'::jsonb
    when 'first-year' then '{"steps":12,"reward":2,"answers":[]}'::jsonb
    when 'safety-watch' then '{"steps":4,"reward":2,"answers":[]}'::jsonb
    when 'free-membership' then '{"steps":7,"reward":2,"answers":[1,1,1,1,0]}'::jsonb
    when 'marketing-director' then '{"steps":6,"reward":2,"answers":[0,1,1,1]}'::jsonb
    else null end;
$$;

-- The first answer of each question; a question is never answered twice.
create table if not exists public.participation_rule_answers (
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  question smallint not null check (question between 0 and 4),
  answer smallint not null check (answer between 0 and 2),
  answered_at timestamptz not null default now(),
  primary key (user_id, task_id, question)
);
alter table public.participation_rule_answers enable row level security;
revoke all on table public.participation_rule_answers from public, anon, authenticated;

create or replace function public.app_complete_ready_program(p_user_id uuid,p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare attempt public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; error_text text; spec jsonb; total int; reward int;
begin
  error_text:=public.app_ready_task_error(p_user_id,p_task_id);
  if error_text is not null then return jsonb_build_object('validationError',error_text); end if;
  select * into attempt from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  if not found then return jsonb_build_object('validationError','Сначала начните программу.'); end if;
  if attempt.status='completed' then
    select * into saved from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and status='accepted' order by created_at desc limit 1;
    return public.app_ready_attempt_json(attempt)||jsonb_build_object('submission',to_jsonb(saved));
  end if;
  select * into task from public.tasks where id=p_task_id for share;
  -- «Правила участия» give their miles in app_participation_rules: 1 per right first answer, not for a retried quiz.
  if task.interactive_kind = 'starter-rules' then return jsonb_build_object('validationError','Обновите страницу: правила участия проходятся по-новому.'); end if;
  spec:=public.app_ready_program_spec(task.interactive_kind);
  total:=jsonb_array_length(spec->'answers'); reward:=coalesce((spec->>'reward')::int,total);
  if attempt.current_step<>(spec->>'steps')::int or (attempt.state->>'ready')::boolean is distinct from true
    or coalesce((attempt.state->>'failed')::boolean,false) or attempt.earned_points<>total
    or coalesce((attempt.state->>'questionIndex')::int,0)<>total then
    return jsonb_build_object('validationError','Сначала правильно ответьте на все вопросы.');
  end if;
  if task.interactive_kind = 'company-voyage' then
    update public.ready_program_attempts set status='completed',completed_at=now(),earned_points=0 where id=attempt.id returning * into attempt;
    return public.app_ready_attempt_json(attempt);
  end if;
  insert into public.submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source)
    values(p_user_id,p_task_id,'accepted','text','Интерактивная программа «'||task.title||'» завершена.',reward,
      'Зачтено автоматически после прохождения программы.',now(),'interactive') returning * into saved;
  update public.ready_program_attempts set status='completed',completed_at=now(),earned_points=reward where id=attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt)||jsonb_build_object('submission',to_jsonb(saved));
end $$;

-- start: what is answered; answer: the one try for a question. The right options are told only for answered questions
-- (all of them once the game is finished). The fifth answer finishes the game: an accepted result with the miles earned.
create or replace function public.app_participation_rules(p_user_id uuid, p_task_id uuid, p_action text, p_question integer, p_answer integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; problem text;
  key jsonb; answered jsonb; rights jsonb; right_count integer; answer_count integer; total integer;
begin
  problem := public.app_ready_task_error(p_user_id, p_task_id);
  if problem is not null then return jsonb_build_object('validationError', problem); end if;
  select * into task from public.tasks where id = p_task_id;
  if task.interactive_kind is distinct from 'starter-rules' then return jsonb_build_object('validationError', 'Тест недоступен для этого задания.'); end if;
  if p_action is null or p_action not in ('start', 'answer') then return jsonb_build_object('validationError', 'Некорректное действие.'); end if;
  key := public.app_ready_program_spec('starter-rules')->'answers';
  total := jsonb_array_length(key);
  perform 1 from public.users where id = p_user_id for update;
  insert into public.ready_program_attempts(user_id, task_id) values (p_user_id, p_task_id) on conflict (user_id, task_id) do nothing;
  select * into a from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if p_action = 'answer' and a.status <> 'completed' then
    if p_question is null or p_question not between 0 and total - 1 or p_answer is null or p_answer not between 0 and 2 then
      return jsonb_build_object('validationError', 'Некорректный вариант ответа.');
    end if;
    -- Only the first answer counts: a second one for the same question changes nothing.
    insert into public.participation_rule_answers(user_id, task_id, question, answer) values (p_user_id, p_task_id, p_question, p_answer)
      on conflict (user_id, task_id, question) do nothing;
  end if;
  select coalesce(jsonb_object_agg(r.question::text, r.answer), '{}'::jsonb),
      count(*) filter (where r.answer = (key->>r.question::int)::int), count(*)
    into answered, right_count, answer_count
    from public.participation_rule_answers r where r.user_id = p_user_id and r.task_id = p_task_id;
  if a.status <> 'completed' and answer_count >= total then
    insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, comment, reviewed_at, submission_source)
      values (p_user_id, p_task_id, 'accepted', 'text', 'Правила участия: верных ответов ' || right_count || ' из ' || total || '.', right_count,
        'Зачтено автоматически: 1 миля за каждый верный ответ с первой попытки.', now(), 'interactive') returning * into saved;
    update public.ready_program_attempts set status = 'completed', completed_at = now(), earned_points = right_count, updated_at = now()
      where id = a.id returning * into a;
  elsif a.status = 'completed' then
    select * into saved from public.submissions where user_id = p_user_id and task_id = p_task_id
      and submission_source = 'interactive' and status = 'accepted' order by created_at desc limit 1;
  end if;
  select coalesce(jsonb_object_agg(i::text, (key->>i)::int), '{}'::jsonb) into rights
    from generate_series(0, total - 1) i where a.status = 'completed' or answered ? i::text;
  return jsonb_build_object('answers', answered, 'rights', rights,
    'earnedPoints', case when a.status = 'completed' then a.earned_points else right_count end,
    'maxPoints', task.max_points, 'completed', a.status = 'completed',
    'submission', case when saved.id is null then null else to_jsonb(saved) end);
end $$;

-- Unfinished games start the new questions.
update public.ready_program_attempts a set earned_points = 0, current_step = 0, state = '{}'::jsonb, updated_at = now()
  from public.tasks t
  where t.id = a.task_id and t.interactive_kind = 'starter-rules' and a.status = 'active'
    and (a.earned_points > 0 or a.current_step > 0 or a.state <> '{}'::jsonb);

-- Published games get the new name and text, unless a mentor changed them.
update public.tasks set title = 'Правила участия' where interactive_kind = 'starter-rules' and title = 'Правила игры';
update public.tasks set description = 'Как проходить «Прокачку»: 10 правил участия и 5 вопросов. За каждый верный ответ с первой попытки — 1 миля, всего до 5 миль автоматически.'
  where interactive_kind = 'starter-rules' and description = 'Мили, звёзды и XP: узнай, как устроен твой прогресс в «Старте новичка», и ответь на пять вопросов. Пройди тест без ошибок и получи 5 миль автоматически.';
update public.task_programs set title = 'Правила участия' where template_key = 'starter-rules' and title = 'Правила игры';

revoke all on function public.app_ready_program_spec(text), public.app_complete_ready_program(uuid, uuid),
  public.app_participation_rules(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.app_complete_ready_program(uuid, uuid), public.app_participation_rules(uuid, uuid, text, integer, integer) to service_role;
notify pgrst, 'reload schema';
commit;

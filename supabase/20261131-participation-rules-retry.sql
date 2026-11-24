-- «Правила участия»: a wrong answer can be changed until it is right (the user's request of 2026-11-24), so everyone can
-- collect all 5 miles. A right answer stays as it is; the right option is told only after a right answer, so a wrong
-- pick does not give the answer away. The miles (5) come once, when all five answers are right; mistakes are counted
-- for the mentors. Unfinished games keep their answers, and a saved wrong one can now be changed.
-- Finished games are not changed here.
-- Apply once to an existing database after 20261130; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

alter table public.participation_rule_answers add column if not exists mistakes integer not null default 0;

create or replace function public.app_participation_rules(p_user_id uuid, p_task_id uuid, p_action text, p_question integer, p_answer integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; problem text;
  key jsonb; answered jsonb; rights jsonb; right_count integer; mistake_count integer; total integer;
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
    -- A wrong answer may be changed as many times as needed; a right one stays. Each wrong pick is a mistake.
    insert into public.participation_rule_answers(user_id, task_id, question, answer, mistakes)
      values (p_user_id, p_task_id, p_question, p_answer, case when p_answer = (key->>p_question)::int then 0 else 1 end)
      on conflict (user_id, task_id, question) do update set answer = excluded.answer, answered_at = now(),
        mistakes = participation_rule_answers.mistakes + excluded.mistakes
      where participation_rule_answers.answer is distinct from (key->>participation_rule_answers.question::int)::int
        and participation_rule_answers.answer is distinct from excluded.answer;
  end if;
  select coalesce(jsonb_object_agg(r.question::text, r.answer), '{}'::jsonb),
      count(*) filter (where r.answer = (key->>r.question::int)::int), coalesce(sum(r.mistakes), 0)
    into answered, right_count, mistake_count
    from public.participation_rule_answers r where r.user_id = p_user_id and r.task_id = p_task_id;
  if a.status <> 'completed' and right_count >= total then
    insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, comment, reviewed_at, submission_source)
      values (p_user_id, p_task_id, 'accepted', 'text', 'Правила участия: все ' || total || ' ответов верные. Ошибок: ' || mistake_count || '.', total,
        'Зачтено автоматически: 1 миля за каждый верный ответ.', now(), 'interactive') returning * into saved;
    update public.ready_program_attempts set status = 'completed', completed_at = now(), earned_points = total, updated_at = now()
      where id = a.id returning * into a;
  elsif a.status = 'completed' then
    select * into saved from public.submissions where user_id = p_user_id and task_id = p_task_id
      and submission_source = 'interactive' and status = 'accepted' order by created_at desc limit 1;
  end if;
  -- The right option: for every question once finished, before that only where the answer is already right.
  select coalesce(jsonb_object_agg(i::text, (key->>i)::int), '{}'::jsonb) into rights
    from generate_series(0, total - 1) i where a.status = 'completed' or (answered->>i::text)::int = (key->>i)::int;
  return jsonb_build_object('answers', answered, 'rights', rights,
    'earnedPoints', case when a.status = 'completed' then a.earned_points else right_count end,
    'maxPoints', task.max_points, 'completed', a.status = 'completed',
    'submission', case when saved.id is null then null else to_jsonb(saved) end);
end $$;

-- Published games get the new text, unless a mentor changed it.
update public.tasks set description = 'Как проходить «Прокачку»: 10 правил участия и 5 вопросов. Ошибку можно исправить: за каждый верный ответ — 1 миля, всего 5 миль автоматически.'
  where interactive_kind = 'starter-rules'
    and description = 'Как проходить «Прокачку»: 10 правил участия и 5 вопросов. За каждый верный ответ с первой попытки — 1 миля, всего до 5 миль автоматически.';

revoke all on function public.app_participation_rules(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.app_participation_rules(uuid, uuid, text, integer, integer) to service_role;
notify pgrst, 'reload schema';
commit;

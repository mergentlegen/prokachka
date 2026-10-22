-- «Правила игры» for the XP logic: new texts and five new questions (миля / звезда / XP / цель 300 XP / активность).
-- Only the answer key changes here: the right option of each question by its index in the site's list.
-- Finished games keep their result and miles. A quiz that was started but not finished starts again from the
-- first question, because the questions are new.
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[0,1,0,0,0]}'::jsonb
    when 'company-voyage' then '{"steps":9,"reward":2,"answers":[1,1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    when 'captain-cruise' then '{"steps":1,"reward":20,"answers":[]}'::jsonb
    when 'count-your-dream' then '{"steps":12,"reward":10,"answers":[]}'::jsonb
    when 'dream-route' then '{"steps":11,"reward":10,"answers":[]}'::jsonb
    when 'first-year' then '{"steps":12,"reward":2,"answers":[]}'::jsonb
    when 'safety-watch' then '{"steps":4,"reward":2,"answers":[]}'::jsonb
    else null end;
$$;

-- Unfinished quizzes start from the first new question; the introduction stays read.
update public.ready_program_attempts a set earned_points = 0, state = jsonb_build_object('questionIndex', 0)
  from public.tasks t
  where t.id = a.task_id and t.interactive_kind = 'starter-rules' and a.status = 'active' and a.current_step >= 1
    and coalesce((a.state->>'questionIndex')::int, 0) + a.earned_points > 0;

-- Published games that still carry the old catalog text get the new one; texts edited by a mentor stay.
update public.tasks set description = 'Мили, звёзды и XP: узнай, как устроен твой прогресс в «Старте новичка», и ответь на пять вопросов. Пройди тест без ошибок и получи 5 миль автоматически.'
  where interactive_kind = 'starter-rules'
    and description = 'Познакомься с правилами «Старта новичка» и ответь на пять вопросов. Пройди тест без ошибок и получи 5 миль автоматически.';

revoke all on function public.app_ready_program_spec(text) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;

-- Fourth ready game for programs: the cabinet trainer «Путь к Маркетинг директору» (6 missions + a check of 4 questions, 2 miles).
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check
  check (interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise','count-your-dream','dream-route','first-year','safety-watch','free-membership','marketing-director'));

-- Every game of the catalog stays here: this function is the one list of rewards (see 20261112-captain-cruise-v2.sql).
create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[0,1,0,0,0]}'::jsonb
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

-- Program games: one copy of each per program, added to the end and opened for those who had finished the program.
create or replace function public.app_program_add_game(p_actor uuid, p_program uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare program public.task_programs%rowtype; saved public.tasks%rowtype; reopened integer; game_title text; game_text text;
begin
  if not public.app_program_can_manage(p_actor, p_program) then return jsonb_build_object('forbidden', true); end if;
  if p_kind = 'first-year' then
    game_title := 'Мой первый год в клубе';
    game_text := 'Проживи первый год в клубе за 7 минут: 12 месяцев, 12 решений и правила, которые помогают доплыть до круиза мечты.';
  elsif p_kind = 'safety-watch' then
    game_title := 'Вахта безопасности';
    game_text := 'Стань офицером безопасности лайнера: 4 палубы и 25 ситуаций о том, как защитить свой аккаунт, свои баллы и свои выплаты.';
  elsif p_kind = 'free-membership' then
    game_title := 'Безоплатное членство';
    game_text := 'Тренажёр кабинета: за 3 минуты научись проверять, подтверждается ли твоё безоплатное членство в этом месяце, — личный месяц, прямой объём и кто из приглашённых уже оплатил.';
  elsif p_kind = 'marketing-director' then
    game_title := 'Путь к Маркетинг директору';
    game_text := 'Тренажёр кабинета: за 5 минут научись находить в кабинете свой путь к рангу Маркетинг директор — два условия месяца, лимит на одну ветку и где всё это смотреть.';
  else
    return jsonb_build_object('validationError', 'Такой игры нет в каталоге.');
  end if;
  select * into program from public.task_programs where id = p_program for update;
  if exists (select 1 from public.tasks where program_id = p_program and interactive_kind = p_kind) then
    return jsonb_build_object('validationError', 'Эта игра уже есть в программе.');
  end if;
  if (select count(*) from public.tasks where program_id = p_program) >= 100 then
    return jsonb_build_object('validationError', 'В программе уже 100 шагов — это максимум.');
  end if;
  insert into public.tasks(title, description, team_id, max_points, publication_type, program_id, position, publisher_id, audience_root_id, interactive_kind, is_active)
    values (game_title, game_text, program.team_id, (public.app_ready_program_spec(p_kind)->>'reward')::integer, 'sequential', program.id,
      coalesce((select max(position) from public.tasks where program_id = program.id), 0) + 1,
      program.publisher_id, program.audience_root_id, p_kind, true)
    returning * into saved;
  reopened := public.app_program_reopen(saved.id, now());
  return jsonb_build_object('data', to_jsonb(saved), 'reopened', reopened);
end $$;

-- The right option of the question after a mission (shared/domain/marketing-director.ts); null — the mission has none.
create or replace function public.app_marketing_director_key(p_mission integer)
returns integer language sql immutable security definer set search_path = public as $$
  select case p_mission when 4 then 1 when 5 then 1 when 6 then 1 else null end;
$$;

-- Mistakes and hints of the participant, kept only to show them their results again: small numbers under known keys.
create or replace function public.app_marketing_director_stats(p_payload jsonb)
returns jsonb language sql immutable security definer set search_path = public as $$
  select jsonb_build_object(
    'errors', case when (p_payload->>'errors') ~ '^[0-9]{1,3}$' then (p_payload->>'errors')::integer else 0 end,
    'hints', case when (p_payload->>'hints') ~ '^[0-9]{1,3}$' then (p_payload->>'hints')::integer else 0 end,
    'log', coalesce((select jsonb_object_agg(key, value::integer) from jsonb_each_text(
      case when jsonb_typeof(p_payload->'log') = 'object' then p_payload->'log' else '{}'::jsonb end)
      where key ~ '^(m[1-6]|q[1-4])$' and value ~ '^[0-9]{1,3}$'), '{}'::jsonb));
$$;

-- The trainer: missions are passed in order (a mission with a question only with the right answer); after the sixth
-- mission the check is sent once with every answer right, and the miles come once.
create or replace function public.app_marketing_director(p_user_id uuid, p_task_id uuid, p_action text, p_step integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; problem text; stamp timestamptz := now();
  key integer;
begin
  problem := public.app_program_game_error(p_user_id, p_task_id);
  if problem is not null then return jsonb_build_object('validationError', problem); end if;
  select * into task from public.tasks where id = p_task_id;
  if task.interactive_kind is distinct from 'marketing-director' then return jsonb_build_object('validationError', 'Игра недоступна для этого шага.'); end if;
  if p_action is null or p_action not in ('start', 'save', 'complete') then return jsonb_build_object('validationError', 'Некорректное действие.'); end if;
  if p_payload is not null and (jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text) > 1000) then
    return jsonb_build_object('validationError', 'Некорректные данные тренажёра.');
  end if;
  perform 1 from public.users where id = p_user_id for update;
  insert into public.ready_program_attempts(user_id, task_id) values (p_user_id, p_task_id) on conflict (user_id, task_id) do nothing;
  select * into a from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if a.status = 'completed' then
    select * into saved from public.submissions where user_id = p_user_id and task_id = p_task_id
      and submission_source = 'interactive' and status = 'accepted' order by created_at desc limit 1;
    return jsonb_build_object('step', 6, 'stats', coalesce(a.state->'stats', '{}'::jsonb), 'completed', true, 'earnedPoints', a.earned_points, 'submission', to_jsonb(saved));
  end if;
  if p_action = 'save' then
    -- One mission at a time; a mission with a question counts only with its right answer.
    key := public.app_marketing_director_key(p_step);
    if p_step is null or p_step not between 1 and 6 or p_step > a.current_step + 1
      or (key is not null and (p_payload->>'answer') is distinct from key::text) then
      return jsonb_build_object('validationError', 'Пройди миссию, чтобы перейти к следующей.');
    end if;
    update public.ready_program_attempts set current_step = greatest(current_step, p_step),
      state = jsonb_build_object('stats', public.app_marketing_director_stats(p_payload))
      where id = a.id returning * into a;
    return jsonb_build_object('step', a.current_step, 'stats', a.state->'stats', 'completed', false, 'earnedPoints', 0);
  elsif p_action = 'complete' then
    if a.current_step <> 6 then return jsonb_build_object('validationError', 'Пройди все 6 миссий, чтобы закончить тренажёр.'); end if;
    if (p_payload->'answers') is distinct from public.app_ready_program_spec('marketing-director')->'answers' then
      return jsonb_build_object('validationError', 'Ответь правильно на все вопросы проверки.');
    end if;
    insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, comment, reviewed_at, submission_source)
      values (p_user_id, p_task_id, 'accepted', 'text', 'Тренажёр «Путь к Маркетинг директору» пройден.', task.max_points,
        task.max_points || ' мили за прохождение тренажёра.', stamp, 'interactive') returning * into saved;
    update public.ready_program_attempts set status = 'completed', completed_at = stamp, earned_points = task.max_points,
      state = jsonb_build_object('stats', public.app_marketing_director_stats(p_payload))
      where id = a.id returning * into a;
    perform public.app_program_advance(p_user_id, p_task_id, stamp);
    return jsonb_build_object('step', 6, 'stats', a.state->'stats', 'completed', true, 'earnedPoints', a.earned_points, 'submission', to_jsonb(saved));
  end if;
  return jsonb_build_object('step', a.current_step, 'stats', coalesce(a.state->'stats', '{}'::jsonb), 'completed', false, 'earnedPoints', 0);
end $$;

revoke all on function public.app_ready_program_spec(text), public.app_program_add_game(uuid, uuid, text), public.app_marketing_director_key(integer),
  public.app_marketing_director_stats(jsonb), public.app_marketing_director(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.app_program_add_game(uuid, uuid, text), public.app_marketing_director(uuid, uuid, text, integer, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

-- Second ready game for programs: «Вахта безопасности» (4 decks, 25 situations, 2 miles).
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check
  check (interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise','count-your-dream','dream-route','first-year','safety-watch'));

create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[1,1,0,1,2]}'::jsonb
    when 'company-voyage' then '{"steps":8,"reward":2,"answers":[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    when 'captain-cruise' then '{"steps":1,"reward":20,"answers":[]}'::jsonb
    when 'count-your-dream' then '{"steps":12,"reward":10,"answers":[]}'::jsonb
    when 'dream-route' then '{"steps":11,"reward":10,"answers":[]}'::jsonb
    when 'first-year' then '{"steps":12,"reward":2,"answers":[]}'::jsonb
    when 'safety-watch' then '{"steps":4,"reward":2,"answers":[]}'::jsonb
    else null end;
$$;

-- The correct answers of each deck, in the order of shared/domain/safety-watch.ts.
create or replace function public.app_safety_watch_key(p_deck integer)
returns jsonb language sql immutable security definer set search_path = public as $$
  select case p_deck
    when 1 then '[0,1,0,1,1,1,1]'::jsonb
    when 2 then '[0,1,0,1,1,0,1]'::jsonb
    when 3 then '[1,1,2,1,2,1,1]'::jsonb
    when 4 then '[1,1,2,0]'::jsonb
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

-- The game: decks are finished in order; a deck counts only with all its answers right. After the fourth deck the miles come once.
create or replace function public.app_safety_watch(p_user_id uuid, p_task_id uuid, p_action text, p_deck integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; problem text; stamp timestamptz := now();
  fixes integer; seen integer;
begin
  problem := public.app_program_game_error(p_user_id, p_task_id);
  if problem is not null then return jsonb_build_object('validationError', problem); end if;
  select * into task from public.tasks where id = p_task_id;
  if task.interactive_kind is distinct from 'safety-watch' then return jsonb_build_object('validationError', 'Игра недоступна для этого шага.'); end if;
  if p_action is null or p_action not in ('start', 'save', 'complete') then return jsonb_build_object('validationError', 'Некорректное действие.'); end if;
  perform 1 from public.users where id = p_user_id for update;
  insert into public.ready_program_attempts(user_id, task_id) values (p_user_id, p_task_id) on conflict (user_id, task_id) do nothing;
  select * into a from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if a.status = 'completed' then
    select * into saved from public.submissions where user_id = p_user_id and task_id = p_task_id
      and submission_source = 'interactive' and status = 'accepted' order by created_at desc limit 1;
    return jsonb_build_object('step', 4, 'stats', coalesce(a.state->'stats', '{}'::jsonb), 'completed', true, 'earnedPoints', a.earned_points, 'submission', to_jsonb(saved));
  end if;
  if p_action = 'save' then
    -- One deck at a time, and only with every answer of the deck right.
    if p_deck is null or p_deck not between 1 and 4 or p_deck > a.current_step + 1
      or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text) > 1000
      or (p_payload->'answers') is distinct from public.app_safety_watch_key(p_deck) then
      return jsonb_build_object('validationError', 'Ответь правильно на все ситуации палубы, чтобы пройти дальше.');
    end if;
    fixes := case when (p_payload->>'fixes') ~ '^[0-9]{1,3}$' then (p_payload->>'fixes')::integer else 0 end;
    seen := case when (p_payload->>'seen') ~ '^[0-9]{1,3}$' then (p_payload->>'seen')::integer else 0 end;
    update public.ready_program_attempts set current_step = greatest(current_step, p_deck),
      state = jsonb_build_object('stats', jsonb_build_object('fixes', fixes, 'seen', seen))
      where id = a.id returning * into a;
    return jsonb_build_object('step', a.current_step, 'stats', a.state->'stats', 'completed', false, 'earnedPoints', 0);
  elsif p_action = 'complete' then
    if a.current_step <> 4 then return jsonb_build_object('validationError', 'Пройди все 4 палубы, чтобы сдать вахту.'); end if;
    insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, comment, reviewed_at, submission_source)
      values (p_user_id, p_task_id, 'accepted', 'text', 'Игра «Вахта безопасности» пройдена.', task.max_points,
        task.max_points || ' мили за прохождение игры.', stamp, 'interactive') returning * into saved;
    update public.ready_program_attempts set status = 'completed', completed_at = stamp, earned_points = task.max_points where id = a.id returning * into a;
    perform public.app_program_advance(p_user_id, p_task_id, stamp);
    return jsonb_build_object('step', 4, 'stats', coalesce(a.state->'stats', '{}'::jsonb), 'completed', true, 'earnedPoints', a.earned_points, 'submission', to_jsonb(saved));
  end if;
  return jsonb_build_object('step', a.current_step, 'stats', coalesce(a.state->'stats', '{}'::jsonb), 'completed', false, 'earnedPoints', 0);
end $$;

revoke all on function public.app_ready_program_spec(text), public.app_safety_watch_key(integer), public.app_program_add_game(uuid, uuid, text),
  public.app_safety_watch(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.app_program_add_game(uuid, uuid, text), public.app_safety_watch(uuid, uuid, text, integer, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

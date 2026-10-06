-- Ready games as steps of a program ("Мой первый год в клубе"), and reordering of program steps.
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check
  check (interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise','count-your-dream','dream-route','first-year'));

create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[1,1,0,1,2]}'::jsonb
    when 'company-voyage' then '{"steps":8,"reward":10,"answers":[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    when 'captain-cruise' then '{"steps":1,"reward":20,"answers":[]}'::jsonb
    when 'count-your-dream' then '{"steps":12,"reward":10,"answers":[]}'::jsonb
    when 'dream-route' then '{"steps":11,"reward":10,"answers":[]}'::jsonb
    when 'first-year' then '{"steps":12,"reward":2,"answers":[]}'::jsonb
    else null end;
$$;

-- Who may change a program: the team leader or the participant who published it.
create or replace function public.app_program_can_manage(p_actor uuid, p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_programs p join public.users a on a.id = p_actor
    where p.id = p_program and p.template_key is null and a.team_id = p.team_id
      and (a.role = 'admin' or (a.can_publish_tasks and p.publisher_id = a.id))
  );
$$;

-- Moves a participant past a finished step. Steps already accepted (possible after a reorder) are skipped,
-- so nobody is sent back to a step they cannot answer again. Game steps have no deadline.
create or replace function public.app_program_advance(p_user uuid, p_task uuid, p_stamp timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare task public.tasks%rowtype; next_task public.tasks%rowtype;
begin
  select * into task from public.tasks where id = p_task;
  if task.program_id is null then return; end if;
  select t.* into next_task from public.tasks t
    where t.program_id = task.program_id and t.is_active and t.id <> task.id
      and (t.position > task.position or (t.position = task.position and t.id > task.id))
      and not exists (select 1 from public.submissions s where s.user_id = p_user and s.task_id = t.id and s.status = 'accepted')
    order by t.position, t.id limit 1;
  if next_task.id is not null then
    update public.member_program_progress set current_task_id = next_task.id, unlocked_at = p_stamp,
      due_at = case when next_task.interactive_kind is not null then p_stamp + interval '100 years'
        else p_stamp + make_interval(hours => coalesce(next_task.deadline_hours, (select deadline_hours from public.task_programs where id = task.program_id), 72)) end,
      updated_at = p_stamp
      where user_id = p_user and program_id = task.program_id and current_task_id = task.id and status = 'active';
  else
    update public.member_program_progress set current_task_id = null, status = 'completed', completed_at = p_stamp, updated_at = p_stamp
      where user_id = p_user and program_id = task.program_id and current_task_id = task.id and status = 'active';
  end if;
end $$;

-- The review keeps its rules; only the move to the next step now goes through app_program_advance.
create or replace function public.tg_review_submission(p_id uuid, p_reviewer uuid, p_ceo boolean, p_status text, p_points integer, p_comment text, p_expected_version integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.submissions%rowtype; task public.tasks%rowtype; stamp timestamptz := now(); participant_id uuid;
begin
  select user_id into participant_id from public.submissions where id = p_id;
  perform 1 from public.users where id = participant_id for update;
  select * into saved from public.submissions where id = p_id for update;
  if not found or saved.user_id = p_reviewer or (not coalesce(p_ceo,false) and not public.tg_can_review(p_reviewer,p_id)) then return jsonb_build_object('forbidden', true); end if;
  if saved.media_type is null and btrim(saved.answer_text) = '' then return jsonb_build_object('validationError', 'Участник ещё не отправил ответ.'); end if;
  if p_expected_version is null or saved.review_version <> p_expected_version then return jsonb_build_object('validationError', 'Работа уже изменена другим наставником. Обновите список.'); end if;
  if exists(select 1 from public.submissions newer where newer.user_id = saved.user_id and newer.task_id = saved.task_id and newer.id <> saved.id
    and (newer.media_type is not null or btrim(newer.answer_text) <> '')
    and (newer.submitted_at > saved.submitted_at or (newer.submitted_at = saved.submitted_at
      and (case when newer.telegram_message_id ~ '^[0-9]{1,18}$' then newer.telegram_message_id::bigint else 0 end)
        > (case when saved.telegram_message_id ~ '^[0-9]{1,18}$' then saved.telegram_message_id::bigint else 0 end)))) then
    return jsonb_build_object('validationError', 'Участник уже отправил новую попытку. Проверьте её.');
  end if;
  if p_status not in ('accepted','revision') or p_points is null or p_points < 0 or char_length(coalesce(p_comment,'')) > 4000 then return jsonb_build_object('validationError', 'Некорректная оценка.'); end if;
  select * into task from public.tasks where id = saved.task_id;
  if p_status = 'revision' and saved.status = 'accepted' and task.program_id is not null and exists(
    select 1 from public.submissions later join public.tasks step on step.id = later.task_id
    where later.user_id = saved.user_id and step.program_id = task.program_id and step.position > task.position and (later.media_type is not null or btrim(later.answer_text) <> '')
  ) then return jsonb_build_object('validationError', 'Участник уже выполняет следующие шаги. Нельзя откатить этот шаг и нарушить прогресс программы.'); end if;
  if p_status = 'accepted' and exists(select 1 from public.submissions where user_id = saved.user_id and task_id = saved.task_id and status = 'accepted' and id <> saved.id) then return jsonb_build_object('validationError', 'Это задание уже зачтено.'); end if;
  if p_status = 'revision' and saved.status = 'accepted' and task.program_id is not null then
    update public.member_program_progress set current_task_id = task.id, status = 'active', completed_at = null, unlocked_at = stamp,
      due_at = stamp + make_interval(hours => coalesce(task.deadline_hours,(select deadline_hours from public.task_programs where id = task.program_id),72)), updated_at = stamp
      where user_id = saved.user_id and program_id = task.program_id;
  end if;
  update public.submissions set status = p_status::public.submission_status, points = case when p_status = 'accepted' then least(p_points,task.max_points) else 0 end,
    comment = btrim(coalesce(p_comment,'')), reviewed_at = stamp, review_version = review_version + 1 where id = saved.id returning * into saved;
  if p_status = 'accepted' and task.program_id is not null then
    perform public.app_program_advance(saved.user_id, task.id, stamp);
  end if;
  return jsonb_build_object('data', to_jsonb(saved) || jsonb_build_object('tasks', jsonb_build_object('title',task.title,'max_points',task.max_points)));
end;
$$;

-- Adds a ready game as the last step of a program. One copy of each game per program.
create or replace function public.app_program_add_game(p_actor uuid, p_program uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare program public.task_programs%rowtype; saved public.tasks%rowtype;
begin
  if not public.app_program_can_manage(p_actor, p_program) then return jsonb_build_object('forbidden', true); end if;
  if p_kind is distinct from 'first-year' then return jsonb_build_object('validationError', 'Такой игры нет в каталоге.'); end if;
  select * into program from public.task_programs where id = p_program for update;
  if exists (select 1 from public.tasks where program_id = p_program and interactive_kind = p_kind) then
    return jsonb_build_object('validationError', 'Эта игра уже есть в программе.');
  end if;
  insert into public.tasks(title, description, team_id, max_points, publication_type, program_id, position, publisher_id, audience_root_id, interactive_kind, is_active)
    values ('Мой первый год в клубе',
      'Проживи первый год в клубе за 7 минут: 12 месяцев, 12 решений и правила, которые помогают доплыть до круиза мечты.',
      program.team_id, 2, 'sequential', program.id,
      coalesce((select max(position) from public.tasks where program_id = program.id), 0) + 1,
      program.publisher_id, program.audience_root_id, p_kind, true)
    returning * into saved;
  return jsonb_build_object('data', to_jsonb(saved));
end $$;

-- New order of the steps: exactly the program's own steps, each once. Participants keep their current step.
create or replace function public.app_program_reorder(p_actor uuid, p_program uuid, p_task_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.app_program_can_manage(p_actor, p_program) then return jsonb_build_object('forbidden', true); end if;
  perform 1 from public.task_programs where id = p_program for update;
  if coalesce(array_length(p_task_ids, 1), 0) <> (select count(*) from public.tasks where program_id = p_program)
    or (select count(distinct id) from unnest(p_task_ids) id) <> coalesce(array_length(p_task_ids, 1), 0)
    or exists (select 1 from unnest(p_task_ids) id where not exists (select 1 from public.tasks t where t.id = id and t.program_id = p_program)) then
    return jsonb_build_object('validationError', 'Список шагов устарел. Обновите страницу и попробуйте снова.');
  end if;
  update public.tasks t set position = ordered.position
    from unnest(p_task_ids) with ordinality as ordered(id, position) where t.id = ordered.id;
  return jsonb_build_object('data', true);
end $$;

-- Access to the game step: the participant's current step of an active program; after finishing, the result stays readable.
create or replace function public.app_program_game_error(p_user uuid, p_task uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare account public.users%rowtype; task public.tasks%rowtype;
begin
  select * into account from public.users where id = p_user;
  select * into task from public.tasks where id = p_task;
  if account.id is null or account.role <> 'member' then return 'Игра доступна только участникам.'; end if;
  if task.id is null or not task.is_active or task.interactive_kind is null or task.publication_type <> 'sequential' then return 'Игра недоступна.'; end if;
  if account.team_id is null or account.team_id is distinct from task.team_id then return 'Пользователь не состоит в команде программы.'; end if;
  if not exists (select 1 from public.teams where id = account.team_id and is_active) then return 'Команда недоступна.'; end if;
  if not exists (select 1 from public.task_programs p where p.id = task.program_id and p.is_active and p.template_key is null
    and (p.audience_root_id is null or p.audience_root_id in (select a.id from public.tg_ancestor_ids(account.id) a))) then return 'Программа недоступна.'; end if;
  if exists (select 1 from public.ready_program_attempts where user_id = p_user and task_id = p_task and status = 'completed') then return null; end if;
  if not exists (select 1 from public.member_program_progress where user_id = p_user and program_id = task.program_id and current_task_id = task.id and status = 'active') then
    return 'Сейчас доступен другой шаг программы.';
  end if;
  return null;
end $$;

-- A finished year: twelve choices, none of them leaving the club.
create or replace function public.app_first_year_valid(p_answers jsonb)
returns boolean language plpgsql immutable security definer set search_path = public as $$
declare allowed integer[][] := array[[0,1,-9],[0,1,-9],[1,-9,-9],[1,-9,-9],[0,1,-9],[0,1,-9],[0,1,-9],[0,1,2],[0,1,-9],[0,1,2],[0,1,-9],[0,-9,-9]];
  choice jsonb; month integer := 0;
begin
  if jsonb_typeof(p_answers) is distinct from 'object' or jsonb_typeof(p_answers->'choices') is distinct from 'array'
    or jsonb_array_length(p_answers->'choices') <> 12 then return false; end if;
  for choice in select value from jsonb_array_elements(p_answers->'choices') loop
    month := month + 1;
    if jsonb_typeof(choice) is distinct from 'number' or (choice #>> '{}') !~ '^[0-9]$'
      or not ((choice #>> '{}')::integer = any(allowed[month:month][1:3])) then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.app_first_year(p_user_id uuid, p_task_id uuid, p_action text, p_step integer, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; problem text; stamp timestamptz := now();
begin
  problem := public.app_program_game_error(p_user_id, p_task_id);
  if problem is not null then return jsonb_build_object('validationError', problem); end if;
  select * into task from public.tasks where id = p_task_id;
  if task.interactive_kind is distinct from 'first-year' then return jsonb_build_object('validationError', 'Игра недоступна для этого шага.'); end if;
  if p_action is null or p_action not in ('start', 'save', 'complete') then return jsonb_build_object('validationError', 'Некорректное действие.'); end if;
  perform 1 from public.users where id = p_user_id for update;
  insert into public.ready_program_attempts(user_id, task_id) values (p_user_id, p_task_id) on conflict (user_id, task_id) do nothing;
  select * into a from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if a.status = 'completed' then
    select * into saved from public.submissions where user_id = p_user_id and task_id = p_task_id
      and submission_source = 'interactive' and status = 'accepted' order by created_at desc limit 1;
    return jsonb_build_object('step', 12, 'answers', coalesce(a.state->'yearAnswers', '{}'::jsonb), 'completed', true, 'earnedPoints', a.earned_points, 'submission', to_jsonb(saved));
  end if;
  if p_action = 'save' then
    -- One month at a time: the year cannot be skipped to the end.
    if p_step is null or p_step not between 1 and 12 or p_step > a.current_step + 1
      or jsonb_typeof(p_answers) is distinct from 'object' or jsonb_typeof(p_answers->'choices') is distinct from 'array'
      or jsonb_array_length(p_answers->'choices') <> p_step or length(p_answers::text) > 2000 then
      return jsonb_build_object('validationError', 'Некорректный шаг игры.');
    end if;
    update public.ready_program_attempts set current_step = greatest(current_step, p_step), state = jsonb_build_object('yearAnswers', p_answers)
      where id = a.id returning * into a;
    return jsonb_build_object('step', a.current_step, 'answers', p_answers, 'completed', false, 'earnedPoints', 0);
  elsif p_action = 'complete' then
    if a.current_step <> 12 or public.app_first_year_valid(a.state->'yearAnswers') is distinct from true then
      return jsonb_build_object('validationError', 'Проживи все 12 месяцев, чтобы завершить игру.');
    end if;
    insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, comment, reviewed_at, submission_source)
      values (p_user_id, p_task_id, 'accepted', 'text', 'Игра «Мой первый год в клубе» пройдена.', task.max_points,
        task.max_points || ' мили за прохождение игры.', stamp, 'interactive') returning * into saved;
    update public.ready_program_attempts set status = 'completed', completed_at = stamp, earned_points = task.max_points where id = a.id returning * into a;
    -- A game is checked by the site, so the program moves on at once.
    perform public.app_program_advance(p_user_id, p_task_id, stamp);
    return jsonb_build_object('step', 12, 'answers', a.state->'yearAnswers', 'completed', true, 'earnedPoints', a.earned_points, 'submission', to_jsonb(saved));
  end if;
  return jsonb_build_object('step', a.current_step, 'answers', coalesce(a.state->'yearAnswers', '{}'::jsonb), 'completed', false, 'earnedPoints', 0);
end $$;

revoke all on function public.app_ready_program_spec(text), public.app_program_can_manage(uuid, uuid), public.app_program_advance(uuid, uuid, timestamptz),
  public.tg_review_submission(uuid, uuid, boolean, text, integer, text, integer), public.app_program_add_game(uuid, uuid, text),
  public.app_program_reorder(uuid, uuid, uuid[]), public.app_program_game_error(uuid, uuid), public.app_first_year_valid(jsonb),
  public.app_first_year(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.app_program_can_manage(uuid, uuid), public.tg_review_submission(uuid, uuid, boolean, text, integer, text, integer),
  public.app_program_add_game(uuid, uuid, text), public.app_program_reorder(uuid, uuid, uuid[]),
  public.app_first_year(uuid, uuid, text, integer, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

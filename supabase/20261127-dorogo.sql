-- Seventh ready game for programs: «Тренажёр «Дорого»» (from the user's file «dorogo-sayt.html», 1 mile).
-- Five dialogue rounds and one sorting round about the objection «Дорого / нет денег». The same rules as «Я подумаю»
-- (20261125): the site checks each pick, the mile comes once at the finish, then one voice to the mentors through the bot.
-- Apply once to an existing database after 20261126; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check
  check (interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise','count-your-dream','dream-route','first-year','safety-watch','free-membership','marketing-director','final-voyage-1','podumayu','dorogo'));

-- Every game of the catalog stays here: this function is the one list of rewards. dorogo: the right option of each dialogue
-- round and, for the sorting round, which phrases help (true) and which harm (false).
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
    when 'final-voyage-1' then '{"steps":12,"reward":5,"answers":[0,2,1,2,0,2,2,0,1,2,0]}'::jsonb
    when 'podumayu' then '{"steps":4,"reward":1,"answers":[2,2,2],"sort":[true,false,true,false]}'::jsonb
    when 'dorogo' then '{"steps":6,"reward":1,"answers":[1,2,1,2,1],"sort":[true,false,true,false,true,false]}'::jsonb
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
  elsif p_kind = 'final-voyage-1' then
    game_title := 'Финальный рейс уровня 1';
    game_text := 'Проверь себя в жизненных ситуациях: 6 портов, 11 вопросов и своя мечта с ценой и сроком. Ошибка — шаг назад, на финише 5 миль.';
  elsif p_kind = 'podumayu' then
    game_title := 'Тренажёр «Я подумаю»';
    game_text := '4 раунда о самом частом возражении: как не отпустить человека «подумать» и узнать настоящую причину. На финише 1 миля.';
  elsif p_kind = 'dorogo' then
    game_title := 'Тренажёр «Дорого»';
    game_text := '6 раундов о возражении «Дорого»: как понять, что стоит за этим словом, и ответить честно, без давления и обещаний. На финише 1 миля.';
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

-- The trainer, the same rules as «Я подумаю». Steps 0–4 are the five dialogue rounds (one right option of four), step 5 sorts
-- six phrases («Помогает» / «Вредит»), 6 is the finish. A wrong option is counted and the round stays; the right one opens the next.
-- In step 5 every phrase is marked once (a wrong mark is counted too); a second mark of the same phrase changes nothing.
-- The mile comes once, at «Забрать милю».
create or replace function public.app_dorogo(p_user_id uuid, p_task_id uuid, p_action text, p_step integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; problem text; stamp timestamptz := now();
  spec jsonb := public.app_ready_program_spec('dorogo'); total integer; sort_step constant integer := 5; right_answer boolean; item text;
  mistakes integer; log jsonb; marks jsonb;
begin
  problem := public.app_program_game_error(p_user_id, p_task_id);
  if problem is not null then return jsonb_build_object('validationError', problem); end if;
  select * into task from public.tasks where id = p_task_id;
  if task.interactive_kind is distinct from 'dorogo' then return jsonb_build_object('validationError', 'Тренажёр недоступен для этого шага.'); end if;
  if p_action is null or p_action not in ('start', 'answer', 'mark', 'complete') then return jsonb_build_object('validationError', 'Некорректное действие.'); end if;
  if p_payload is not null and (jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text) > 200) then
    return jsonb_build_object('validationError', 'Некорректные данные тренажёра.');
  end if;
  total := (spec->>'steps')::integer;
  perform 1 from public.users where id = p_user_id for update;
  insert into public.ready_program_attempts(user_id, task_id) values (p_user_id, p_task_id) on conflict (user_id, task_id) do nothing;
  select * into a from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  mistakes := coalesce((a.state->>'mistakes')::integer, 0);
  log := coalesce(a.state->'log', '{}'::jsonb);
  marks := coalesce(a.state->'marks', '{}'::jsonb);
  if a.status <> 'completed' and p_action in ('answer', 'mark') then
    if p_step is distinct from a.current_step then return jsonb_build_object('validationError', 'Тренажёр открыт в другом окне — обновите страницу.'); end if;
    if a.current_step >= total then return jsonb_build_object('validationError', 'Тренажёр уже на финише.'); end if;
  end if;
  if a.status = 'completed' then
    select * into saved from public.submissions where user_id = p_user_id and task_id = p_task_id
      and submission_source = 'interactive' and status = 'accepted' order by created_at desc limit 1;
  elsif p_action = 'answer' then
    if a.current_step = sort_step then return jsonb_build_object('validationError', 'В этом раунде отметь каждую фразу.'); end if;
    if coalesce(p_payload->>'answer', '') !~ '^[0-3]$' then return jsonb_build_object('validationError', 'Некорректный вариант ответа.'); end if;
    right_answer := (p_payload->>'answer')::integer = (spec->'answers'->>a.current_step)::integer;
    if not right_answer then
      mistakes := mistakes + 1;
      log := log || jsonb_build_object(a.current_step::text, coalesce((log->>a.current_step::text)::integer, 0) + 1);
    end if;
    update public.ready_program_attempts set current_step = case when right_answer then current_step + 1 else current_step end,
      state = state || jsonb_build_object('mistakes', mistakes, 'log', log), updated_at = stamp
      where id = a.id returning * into a;
  elsif p_action = 'mark' then
    if a.current_step <> sort_step then return jsonb_build_object('validationError', 'Сейчас другой раунд тренажёра.'); end if;
    item := coalesce(p_payload->>'item', '');
    if item !~ '^[0-5]$' or jsonb_typeof(p_payload->'good') is distinct from 'boolean' then
      return jsonb_build_object('validationError', 'Отметь фразу: помогает или вредит.');
    end if;
    right_answer := (p_payload->>'good')::boolean = (spec->'sort'->>item::integer)::boolean;
    if not marks ? item then
      marks := marks || jsonb_build_object(item, (p_payload->>'good')::boolean);
      if not right_answer then
        mistakes := mistakes + 1;
        log := log || jsonb_build_object(sort_step::text, coalesce((log->>sort_step::text)::integer, 0) + 1);
      end if;
      update public.ready_program_attempts set current_step = case when (select count(*) from jsonb_object_keys(marks)) >= 6 then total else current_step end,
        state = state || jsonb_build_object('mistakes', mistakes, 'log', log, 'marks', marks), updated_at = stamp
        where id = a.id returning * into a;
    end if;
  elsif p_action = 'complete' then
    if a.current_step < total then return jsonb_build_object('validationError', 'Сначала пройди все 6 раундов.'); end if;
    insert into public.submissions(user_id, task_id, status, media_type, answer_text, points, comment, reviewed_at, submission_source)
      values (p_user_id, p_task_id, 'accepted', 'text', 'Тренажёр «Дорого» пройден. Ошибок: ' || mistakes || '.',
        task.max_points, 'Мили за тренажёр «Дорого»: ' || task.max_points || '.', stamp, 'interactive') returning * into saved;
    update public.ready_program_attempts set status = 'completed', completed_at = stamp, earned_points = task.max_points, updated_at = stamp
      where id = a.id returning * into a;
    perform public.app_program_advance(p_user_id, p_task_id, stamp);
  end if;
  -- For each phrase already marked: what was chosen and whether it was right (the page shows it again after a reload).
  marks := coalesce(a.state->'marks', '{}'::jsonb);
  return jsonb_build_object('step', a.current_step, 'mistakes', coalesce((a.state->>'mistakes')::integer, 0), 'log', coalesce(a.state->'log', '{}'::jsonb),
    'marks', coalesce((select jsonb_object_agg(m.key, jsonb_build_object('good', m.value, 'right', m.value = spec->'sort'->(m.key::integer)))
      from jsonb_each(marks) as m(key, value)), '{}'::jsonb),
    'completed', a.status = 'completed', 'earnedPoints', a.earned_points,
    'right', case when p_action in ('answer', 'mark') and a.status <> 'completed' then right_answer end,
    'keys', case when a.status = 'completed' then jsonb_build_object('answers', spec->'answers', 'sort', spec->'sort') end,
    'submission', case when saved.id is null then null else to_jsonb(saved) end);
end $$;

-- The voice to the mentors after the game: «Финальный рейс», «Я подумаю» and «Дорого» are program steps, so their access is the program game's.
create or replace function public.tg_company_voice_error(p_user_id uuid,p_task_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare problem text; kind text;
begin
  select interactive_kind into kind from public.tasks where id=p_task_id;
  problem:=case when kind in ('final-voyage-1','podumayu','dorogo') then public.app_program_game_error(p_user_id,p_task_id) else public.app_ready_task_error(p_user_id,p_task_id) end;
  if problem is not null then return problem; end if;
  if kind not in ('company-voyage','count-your-dream','dream-route','final-voyage-1','podumayu','dorogo') then return 'Голосовое недоступно для этого задания.'; end if;
  if not exists(select 1 from public.users mentor where mentor.id<>p_user_id and (mentor.role='admin' or (mentor.role='member' and mentor.can_review))
    and mentor.id in (select a.id from public.tg_ancestor_ids(p_user_id) a)) then return 'В вашей ветке пока нет наставника для получения голосового.'; end if;
  if kind = 'company-voyage' and not public.app_company_voyage_legacy(p_user_id, p_task_id) then
    if not exists(select 1 from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id and status='completed') then return 'Сначала пройди игру «Правда или миф» на сайте.'; end if;
    if exists(select 1 from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source<>'interactive' and status='pending') then return 'Твоё голосовое уже у наставника. Дождись ответа.'; end if;
    if exists(select 1 from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source<>'interactive' and status='accepted') then return 'Наставник уже принял твоё голосовое, мили начислены.'; end if;
    return null;
  end if;
  if not exists(select 1 from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id and status='completed')
    or not exists(select 1 from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and status='accepted') then return 'Сначала завершите задание на сайте.'; end if;
  if exists(select 1 from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and company_voice_file_id is not null) then return 'Голосовое уже сохранено для доставки наставникам.'; end if;
  return null;
end $$;

create or replace function public.tg_can_receive_company_voice(p_recipient uuid,p_submission uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.submissions s join public.users member on member.id=s.user_id
    join public.users recipient on recipient.id=p_recipient join public.tasks task on task.id=s.task_id
    where s.id=p_submission and s.submission_source='interactive' and s.status='accepted' and s.company_voice_file_id is not null
      and task.interactive_kind in ('company-voyage','count-your-dream','dream-route','final-voyage-1','podumayu','dorogo')
      and (case when task.interactive_kind in ('final-voyage-1','podumayu','dorogo') then public.app_program_game_error(member.id,task.id) else public.app_ready_task_error(member.id,task.id) end) is null
      and recipient.id<>member.id and recipient.team_id=member.team_id
      and (recipient.role='admin' or (recipient.role='member' and recipient.can_review))
      and recipient.id in (select a.id from public.tg_ancestor_ids(member.id) a));
$$;

revoke all on function public.app_ready_program_spec(text), public.app_program_add_game(uuid, uuid, text),
  public.app_dorogo(uuid, uuid, text, integer, jsonb), public.tg_company_voice_error(uuid, uuid), public.tg_can_receive_company_voice(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.app_program_add_game(uuid, uuid, text), public.app_dorogo(uuid, uuid, text, integer, jsonb),
  public.tg_company_voice_error(uuid, uuid), public.tg_can_receive_company_voice(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
commit;

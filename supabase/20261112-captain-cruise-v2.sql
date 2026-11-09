-- «Капитан ищет свой круиз», new version (2026-11-09): 15 cruise lines with the river line AmaWaterways and a
-- question about it, and 10 miles instead of 20 — 9 for the training (was 19) + 1 for the real screenshot.
-- Everyone who already played gives back the extra 10 miles: 20 → 10 with the screenshot, 19 → 9 without it.
-- Unfinished trainings keep their place: the river question comes right after the 👑 question, so every later
-- step moves one place on, and the miles collected so far follow the new table.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

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
    else null end;
$$;

-- Sixteen checkpoints, in the order of the game (shared/domain/captain-cruise.ts CAPTAIN_STAGES):
--  0 home · 1 offers on the banner · 2 how many lines · 3 crown · 4 river · 5 Disney · 6 destination · 7 card read
--  8 date · 9 «от» price · 10 cabins · 11 route · 12 mother 57 · 13 daughter 18 · 14 family price · 15 cabin choice.
-- keys: the right option (-1 — no question); weights: miles of each checkpoint, 9 in all.
create or replace function public.app_captain_cruise(p_user_id uuid,p_task_id uuid,p_action text,p_expected_index integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; problem text; idx int; answer int;
  keys int[]:=array[0,2,1,1,1,2,-1,-1,1,1,1,2,1,1,1,-1];
  weights int[]:=array[1,0,0,0,0,2,1,0,0,1,0,1,0,1,1,1]; next_state jsonb; details jsonb;
begin
  problem:=public.app_ready_task_error(p_user_id,p_task_id);
  if problem is not null then return jsonb_build_object('validationError',problem); end if;
  select * into task from public.tasks where id=p_task_id;
  if task.interactive_kind is distinct from 'captain-cruise' then return jsonb_build_object('validationError','Тренировка недоступна для этого задания.'); end if;
  if p_action not in ('start','checkpoint','retry','finish','save-details') or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' then return jsonb_build_object('validationError','Некорректное действие тренировки.'); end if;
  -- Same lock order as the existing ready-game and Telegram flows.
  perform 1 from public.users where id=p_user_id for update;
  insert into public.ready_program_attempts(user_id,task_id,state) values(p_user_id,p_task_id,'{"captainVersion":2}') on conflict(user_id,task_id) do nothing;
  select * into a from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  idx:=coalesce((a.state->>'captainIndex')::int,0);
  if p_action='start' then return public.app_captain_attempt_json(a); end if;
  if p_action='save-details' then
    if (a.state->>'trainingDone')::boolean is distinct from true then return jsonb_build_object('validationError','Сначала завершите тренировку.'); end if;
    if coalesce((a.state->>'screenshotSent')::boolean,false) then return public.app_captain_attempt_json(a); end if;
    details:=p_payload->'details';
    if public.app_captain_details_valid(details) is distinct from true then return jsonb_build_object('validationError','Заполните направление, линию, пассажиров и цену. До 120 символов в каждом поле.'); end if;
    select jsonb_object_agg(key,btrim(details->>key)) into details from unnest(array['direction','line','who','price']) key;
    update public.ready_program_attempts set state=jsonb_set(state,'{details}',details) where id=a.id returning * into a;
    return public.app_captain_attempt_json(a);
  end if;
  if p_action='finish' then
    if (a.state->>'trainingDone')::boolean=true then return public.app_captain_attempt_json(a); end if;
    if idx<>16 or coalesce((a.state->>'failed')::boolean,false) or coalesce((a.state->>'trainingPoints')::int,0)<>9 then return jsonb_build_object('validationError','Сначала пройдите все шаги тренировки.'); end if;
    update public.ready_program_attempts set status='completed',earned_points=9,completed_at=now(),state=state||'{"trainingDone":true}'::jsonb where id=a.id returning * into a;
    insert into public.submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source,interactive_completed)
      values(p_user_id,p_task_id,'accepted','text','Тренировка «Капитан ищет свой круиз» завершена.',9,'9 миль за тренировку. Ещё 1 — после отправки скриншота.',now(),'interactive',false);
    return public.app_captain_attempt_json(a);
  end if;
  if a.status<>'active' then return jsonb_build_object('validationError','Тренировка уже завершена.'); end if;
  if p_expected_index is null or p_expected_index<>idx then
    if p_action='checkpoint' and p_expected_index=idx-1 and a.state->'lastPayload'=p_payload then return public.app_captain_attempt_json(a); end if;
    return jsonb_build_object('validationError','Шаг уже изменился. Откройте тренировку снова.');
  end if;
  if p_action='retry' then
    if not coalesce((a.state->>'failed')::boolean,false) then return public.app_captain_attempt_json(a); end if;
    update public.ready_program_attempts set state=state-'failed'-'lastAnswer',attempt_number=attempt_number+1 where id=a.id returning * into a;
    return public.app_captain_attempt_json(a);
  end if;
  if idx not between 0 and 15 then return jsonb_build_object('validationError','Все шаги уже выполнены. Нажмите «Завершить».'); end if;
  if coalesce((a.state->>'failed')::boolean,false) then return public.app_captain_attempt_json(a); end if;
  next_state:=a.state;
  if idx=6 then
    if not (p_payload->>'direction'=any(array['Восточное Средиземноморье','Египет и Красное море','Европа','Фиджи','Гавайи','Пиренейский полуостров','Индия','Средиземное море','Мексика','Ближний Восток','Северная Америка','Северная Европа','Океания','Тихоокеанский регион','Панамский канал','Приполярные регионы','Скандинавия'])) or p_payload->>'direction' is null then return jsonb_build_object('validationError','Выберите направление из списка.'); end if;
    next_state:=next_state||jsonb_build_object('direction',p_payload->>'direction');
  elsif idx=7 then
    if jsonb_typeof(p_payload->'readKeys') is distinct from 'array' or not (p_payload->'readKeys' @> '["line","ship","port","nights","dates","price"]'::jsonb) then return jsonb_build_object('validationError','Сначала прочитайте все строки карточки.'); end if;
  else
    if jsonb_typeof(p_payload->'answer') is distinct from 'number' or (p_payload->>'answer') !~ '^[0-3]$' then return jsonb_build_object('validationError','Выберите вариант ответа.'); end if;
    answer:=(p_payload->>'answer')::int;
    if idx=10 and (jsonb_typeof(p_payload->'readCabins') is distinct from 'array' or not (p_payload->'readCabins' @> '[0,1,2,3]'::jsonb)) then return jsonb_build_object('validationError','Сначала изучите все четыре категории кают.'); end if;
    if idx=12 then
      if jsonb_typeof(p_payload->'guests') is distinct from 'array' or jsonb_array_length(p_payload->'guests')<>3
        or exists(select 1 from jsonb_array_elements(p_payload->'guests') g where jsonb_typeof(g) is distinct from 'number' or g::text !~ '^[0-8]$')
        or (p_payload->'guests'->>0)::int+(p_payload->'guests'->>1)::int+(p_payload->'guests'->>2)::int<1 then return jsonb_build_object('validationError','Укажите хотя бы одного пассажира.'); end if;
      next_state:=next_state||jsonb_build_object('guests',p_payload->'guests');
    end if;
    if (idx=15 and answer not between 0 and 1) or (idx<>15 and answer<>keys[idx+1]) then
      update public.ready_program_attempts set state=next_state||jsonb_build_object('failed',true,'lastAnswer',answer) where id=a.id returning * into a;
      return public.app_captain_attempt_json(a);
    end if;
    if idx=15 then next_state:=next_state||jsonb_build_object('cabin',answer); end if;
  end if;
  update public.ready_program_attempts set state=(next_state-'failed'-'lastAnswer')||jsonb_build_object('captainIndex',idx+1,'lastPayload',p_payload,'trainingPoints',coalesce((a.state->>'trainingPoints')::int,0)+weights[idx+1]) where id=a.id returning * into a;
  return public.app_captain_attempt_json(a);
end $$;

-- Allow only the one extra screenshot mile (9 → 10), matched to the completed attempt and its saved Telegram
-- attachment. Keep the existing survey exception intact.
create or replace function public.app_guard_interactive_submission_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.submission_source='interactive' and (new.user_id is distinct from old.user_id or new.task_id is distinct from old.task_id or new.status is distinct from old.status or new.points is distinct from old.points or new.submission_source is distinct from old.submission_source or new.interactive_completed is distinct from old.interactive_completed) then
    if old.status='accepted' and not old.interactive_completed and new.user_id=old.user_id and new.task_id=old.task_id and new.status=old.status and new.submission_source=old.submission_source and new.points=old.points+1
      and exists(select 1 from public.ready_program_attempts a join public.tasks t on t.id=a.task_id where a.user_id=old.user_id and a.task_id=old.task_id and a.earned_points=new.points and (
        (t.interactive_kind='heart-survey' and (a.status='completed')=new.interactive_completed and jsonb_array_length(a.state->'answers')=new.points)
        or (t.interactive_kind='captain-cruise' and old.points=9 and new.points=10 and new.interactive_completed and a.status='completed' and (a.state->>'screenshotSent')::boolean=true and exists(select 1 from public.ready_program_attachments where submission_id=old.id and kind='captain-screenshot')))) then return new; end if;
    raise exception 'Interactive submissions are immutable';
  end if;
  return new;
end $$;

create or replace function public.tg_captain_screenshot_error(p_user_id uuid,p_task_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare problem text; a public.ready_program_attempts%rowtype;
begin
  problem:=public.app_ready_task_error(p_user_id,p_task_id);
  if problem is not null then return problem; end if;
  if (select interactive_kind from public.tasks where id=p_task_id) is distinct from 'captain-cruise' then return 'Скриншот недоступен для этого задания.'; end if;
  select * into a from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id;
  if a.status is distinct from 'completed' or (a.state->>'trainingDone')::boolean is distinct from true then return 'Сначала завершите тренировку на сайте.'; end if;
  if coalesce((a.state->>'screenshotSent')::boolean,false) then return 'Скриншот уже сохранён для доставки наставникам. Все 10 миль начислены.'; end if;
  if public.app_captain_details_valid(a.state->'details') is distinct from true then return 'Сначала заполните сведения о настоящем круизе на сайте.'; end if;
  if not exists(select 1 from public.users m where m.id<>p_user_id and (m.role='admin' or (m.role='member' and m.can_review)) and m.id in (select id from public.tg_ancestor_ids(p_user_id))) then return 'В вашей ветке пока нет наставника для получения скриншота.'; end if;
  return null;
end $$;

-- Same as 20261109-voice-answers-flow.sql, only the screenshot miles: 9 → 10 (was 19 → 20).
create or replace function public.tg_submit_answer(p_telegram_id text,p_chat_id text,p_message_id bigint,p_update_id bigint,p_media_type text,p_answer_text text,p_file_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare session public.telegram_submission_sessions%rowtype; context public.telegram_submission_contexts%rowtype; saved public.submissions%rowtype; attachment public.ready_program_attachments%rowtype; problem text; review boolean := false; retry text; quiz jsonb;
begin
  if p_telegram_id is distinct from p_chat_id or p_update_id is null or p_message_id is null or p_media_type is null or p_media_type not in ('text','photo','video','document','voice') or char_length(coalesce(p_answer_text,''))>10000 or (p_media_type='text' and btrim(coalesce(p_answer_text,''))='') or (p_media_type<>'text' and coalesce(p_file_id,'')='') then return jsonb_build_object('validationError','Некорректный ответ.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tg:'||p_telegram_id,0));
  select * into attachment from public.ready_program_attachments where telegram_update_id=p_update_id;
  if found then
    if attachment.telegram_chat_id=p_chat_id and attachment.telegram_message_id=p_message_id then return jsonb_build_object('data',jsonb_build_object('id',attachment.submission_id),'duplicate',true,'purpose','captain-screenshot'); end if;
    return jsonb_build_object('validationError','Обновление уже обработано.');
  end if;
  select * into saved from public.submissions where telegram_update_id=p_update_id or company_voice_update_id=p_update_id;
  if found then
    if saved.company_voice_update_id=p_update_id and saved.company_voice_chat_id=p_chat_id and saved.company_voice_message_id=p_message_id then return jsonb_build_object('data',jsonb_build_object('id',saved.id),'duplicate',true,'purpose','company-voice'); end if;
    if saved.telegram_update_id=p_update_id and saved.telegram_chat_id=p_chat_id and saved.telegram_message_id=p_message_id::text then
      return jsonb_build_object('data',to_jsonb(saved),'duplicate',true,'purpose',case when saved.media_type='voice' then 'company-voice' else 'answer' end,'review',saved.media_type='voice');
    end if;
    return jsonb_build_object('validationError','Обновление уже обработано.');
  end if;
  select * into context from public.telegram_submission_contexts where telegram_id=p_telegram_id for update;
  select * into session from public.telegram_submission_sessions where token_hash=context.session_hash for update;
  if session.token_hash is not null and session.consumed_at is null and session.expires_at<=now() then
    return jsonb_build_object('validationError',E'⏰ Время на отправку вышло (30 минут) — задание не отправлено.\n\nОткройте задание на сайте и нажмите кнопку отправки ещё раз.');
  end if;
  if session.token_hash is null or session.consumed_at is not null or p_message_id<=context.last_start_message_id then return jsonb_build_object('validationError',E'Сначала выберите задание на сайте и нажмите кнопку отправки — потом отправьте ответ сюда.\n\nЕсли вы уже отправили ответ, он сохранён: повторно отправлять не нужно.'); end if;
  -- Every mistake below keeps the link alive: the participant just sends again.
  retry := E'\n\n↻ Отправьте ещё раз прямо сюда — время до '||to_char(session.expires_at at time zone 'Asia/Almaty','HH24:MI')||'.';
  perform 1 from public.users where id=session.user_id for update;
  if session.telegram_id<>p_telegram_id or not exists(select 1 from public.users where id=session.user_id and telegram_id=p_telegram_id) then return jsonb_build_object('validationError','Telegram не связан с аккаунтом отправителя.'); end if;
  if session.purpose='captain-screenshot' then
    if p_media_type<>'photo' then return jsonb_build_object('validationError',E'❌ Нужен один скриншот как фото (не файл и не альбом).\n\nКак: нажмите 📎 → Фото → выберите скриншот. Текст о круизе уже подготовлен автоматически.'||retry); end if;
    problem:=public.tg_captain_screenshot_error(session.user_id,session.task_id);
    if problem is not null then return jsonb_build_object('validationError',problem); end if;
    if coalesce(session.metadata->>'summary','')='' then return jsonb_build_object('validationError','Откройте ссылку на Telegram с сайта ещё раз.'); end if;
    select * into saved from public.submissions where user_id=session.user_id and task_id=session.task_id and submission_source='interactive' and status='accepted' and points=9 and not interactive_completed for update;
    if not found then return jsonb_build_object('validationError','Не найден результат тренировки. Откройте игру на сайте.'); end if;
    insert into public.ready_program_attachments(submission_id,kind,telegram_file_id,telegram_chat_id,telegram_message_id,telegram_update_id,summary) values(saved.id,'captain-screenshot',p_file_id,p_chat_id,p_message_id,p_update_id,session.metadata->>'summary');
    update public.ready_program_attempts set earned_points=10,state=state||'{"screenshotSent":true}'::jsonb where user_id=session.user_id and task_id=session.task_id;
    update public.submissions set points=10,interactive_completed=true where id=saved.id;
    insert into public.telegram_notification_jobs(recipient_id,submission_id,kind) select m.id,saved.id,'captain-screenshot' from public.users m where m.id<>session.user_id and (m.role='admin' or (m.role='member' and m.can_review)) and m.id in (select id from public.tg_ancestor_ids(session.user_id)) on conflict(recipient_id,submission_id) do nothing;
  elsif session.purpose='company-voice' then
    if p_media_type<>'voice' then return jsonb_build_object('validationError',E'❌ Для этого шага нужно голосовое сообщение — текст и файлы его не заменяют.\n\nКак: нажмите и удерживайте микрофон 🎤 справа внизу, скажите ответ и отпустите.'||retry); end if;
    problem:=public.tg_company_voice_error(session.user_id,session.task_id);
    if problem is not null then return jsonb_build_object('validationError',problem); end if;
    review := public.tg_voice_for_review(session.user_id,session.task_id);
    if review then
      -- The voice is the work itself: it goes to «Проверка работ», and the mentor's acceptance gives the miles.
      insert into public.submissions(user_id,task_id,status,telegram_chat_id,telegram_message_id,telegram_update_id,media_type,telegram_file_id,answer_text)
        values(session.user_id,session.task_id,'pending',p_chat_id,p_message_id::text,p_update_id,'voice',p_file_id,'Голосовое: рассказ о компании своими словами.') returning * into saved;
    else
      select * into saved from public.submissions where user_id=session.user_id and task_id=session.task_id and submission_source='interactive' and status='accepted' for update;
      update public.submissions set company_voice_file_id=p_file_id,company_voice_chat_id=p_chat_id,company_voice_message_id=p_message_id,company_voice_update_id=p_update_id where id=saved.id;
      insert into public.telegram_notification_jobs(recipient_id,submission_id,kind) select m.id,saved.id,'company-voice' from public.users m where m.id<>session.user_id and (m.role='admin' or (m.role='member' and m.can_review)) and m.id in (select id from public.tg_ancestor_ids(session.user_id)) on conflict(recipient_id,submission_id) do nothing;
    end if;
  else
    if coalesce((select t.voice_answer from public.tasks t where t.id=session.task_id),false) then
      if p_media_type<>'voice' then return jsonb_build_object('validationError',E'❌ Это задание принимает только голосовое сообщение — текст, фото и файлы не подойдут.\n\nКак: нажмите и удерживайте микрофон 🎤 справа внизу, скажите ответ и отпустите — сообщение уйдёт само.'||retry); end if;
    else
      if p_media_type='voice' then return jsonb_build_object('validationError',E'❌ Это задание не принимает голосовые.\n\nОтправьте ответ одним сообщением: текстом, фото, видео или файлом. Пояснение к файлу добавьте в подпись.'||retry); end if;
    end if;
    -- A task with a test on the site: the test answers come with the participant's link; without them nothing is sent.
    quiz := session.metadata->'quiz';
    if quiz is null and exists(select 1 from public.task_quizzes q where q.task_id=session.task_id) then
      return jsonb_build_object('validationError',E'❌ Сначала ответьте на вопросы теста на сайте.\n\nОткройте задание, ответьте на вопросы и нажмите «Ответить и записать голосовое» — бот снова откроется здесь.');
    end if;
    problem:=public.tg_target_error(session.user_id,session.task_id);
    if problem is not null then return jsonb_build_object('validationError',problem); end if;
    insert into public.submissions(user_id,task_id,status,telegram_chat_id,telegram_message_id,telegram_update_id,media_type,telegram_file_id,answer_text,quiz_score,quiz_total,quiz_answers)
      values(session.user_id,session.task_id,'pending',p_chat_id,p_message_id::text,p_update_id,p_media_type,p_file_id,
        case when quiz is null then coalesce(p_answer_text,'') else coalesce(quiz->>'text','') end,
        (quiz->>'score')::int,(quiz->>'total')::int,quiz->'answers') returning * into saved;
    if quiz is not null then delete from public.task_quiz_drafts where user_id=session.user_id and task_id=session.task_id; end if;
  end if;
  update public.telegram_submission_sessions set consumed_at=now() where token_hash=session.token_hash;
  update public.telegram_submission_contexts set session_hash=null where telegram_id=p_telegram_id;
  return jsonb_build_object('data',case when session.purpose='answer' then to_jsonb(saved) else jsonb_build_object('id',saved.id) end,'duplicate',false,'purpose',session.purpose,'review',review);
end $$;

-- Results already given: the extra 10 miles go back. The guard above forbids changing a finished game, so it is
-- switched off for this one update only (the table stays locked until commit, nobody else writes meanwhile).
alter table public.submissions disable trigger submissions_interactive_immutable;
update public.submissions s set points = s.points - 10,
    comment = case when s.comment = '19 миль за тренировку. Ещё 1 — после отправки скриншота.'
      then '9 миль за тренировку. Ещё 1 — после отправки скриншота.' else s.comment end
  from public.tasks t
  where t.id = s.task_id and t.interactive_kind = 'captain-cruise' and s.submission_source = 'interactive' and s.points in (19, 20);
alter table public.submissions enable trigger submissions_interactive_immutable;

update public.ready_program_attempts a
  set earned_points = a.earned_points - 10, state = a.state || '{"trainingPoints":9,"captainVersion":2}'::jsonb
  from public.tasks t
  where t.id = a.task_id and t.interactive_kind = 'captain-cruise' and a.status = 'completed' and a.earned_points in (19, 20)
    and a.state->>'captainVersion' is null;

-- Unfinished trainings: the step after the 👑 question is now the river question, later steps move one place on.
-- The miles so far are the new weights of the passed steps. A wrong answer waiting for a retry is cleared.
with moved as (
  select a.id, case when coalesce((a.state->>'captainIndex')::int, 0) <= 4 then coalesce((a.state->>'captainIndex')::int, 0)
    else (a.state->>'captainIndex')::int + 1 end as idx
  from public.ready_program_attempts a join public.tasks t on t.id = a.task_id
  where t.interactive_kind = 'captain-cruise' and a.status = 'active' and a.state->>'captainVersion' is null
)
update public.ready_program_attempts a
  set state = (a.state - 'failed' - 'lastAnswer' - 'lastPayload') || jsonb_build_object('captainIndex', moved.idx,
    'trainingPoints', (select coalesce(sum(w), 0) from unnest(array[1,0,0,0,0,2,1,0,0,1,0,1,0,1,1,1]) with ordinality u(w, n) where n <= moved.idx),
    'captainVersion', 2)
  from moved where a.id = moved.id;

-- Published games: the task is worth 10 now. The old catalog text gets the new one; texts edited by a mentor stay.
update public.tasks set max_points = 10 where interactive_kind = 'captain-cruise' and max_points = 20;
update public.tasks set description = 'Пройди тренировку и получи 9 миль. Найди круиз в своём кабинете inCruises и отправь скриншот наставникам через Telegram — ещё 1 миля автоматически.'
  where interactive_kind = 'captain-cruise'
    and description = 'Пройди тренировку и получи 19 миль. Найди круиз в своём кабинете inCruises и отправь скриншот наставникам через Telegram — ещё 1 миля автоматически.';

revoke all on function public.app_ready_program_spec(text), public.app_captain_cruise(uuid, uuid, text, integer, jsonb),
  public.app_guard_interactive_submission_update(), public.tg_captain_screenshot_error(uuid, uuid),
  public.tg_submit_answer(text, text, bigint, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.app_captain_cruise(uuid, uuid, text, integer, jsonb), public.tg_captain_screenshot_error(uuid, uuid),
  public.tg_submit_answer(text, text, bigint, bigint, text, text, text) to service_role;
notify pgrst, 'reload schema';
commit;

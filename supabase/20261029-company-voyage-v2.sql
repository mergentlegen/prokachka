-- «Корабль, на который ты поднялся», new version: 9 cards, 18 questions, a wrong answer is answered again
-- (with a hint to the card), and the 2 miles come from the mentor who listens to the participant's voice message.
-- Participants who finished the old version keep their result and miles; unfinished games start over (new questions).
-- Apply once to an existing database; bootstrap.sql includes it for new ones.
begin;

-- A voice message can now be a work for review.
alter table public.submissions drop constraint if exists submissions_media_type_check;
alter table public.submissions add constraint submissions_media_type_check
  check (media_type is null or media_type in ('text', 'photo', 'video', 'document', 'voice'));

create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[1,1,0,1,2]}'::jsonb
    when 'company-voyage' then '{"steps":9,"reward":2,"answers":[1,1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    when 'captain-cruise' then '{"steps":1,"reward":20,"answers":[]}'::jsonb
    when 'count-your-dream' then '{"steps":12,"reward":10,"answers":[]}'::jsonb
    when 'dream-route' then '{"steps":11,"reward":10,"answers":[]}'::jsonb
    when 'first-year' then '{"steps":12,"reward":2,"answers":[]}'::jsonb
    when 'safety-watch' then '{"steps":4,"reward":2,"answers":[]}'::jsonb
    else null end;
$$;

update public.tasks set max_points = 2,
  description = 'Познакомься с компанией, пройди игру «Правда или миф» и расскажи о компании своими словами в голосовом наставнику. Когда наставник послушает, он начислит 2 мили.'
  where interactive_kind = 'company-voyage';

-- Unfinished games were on the old cards and questions: they start over. Finished ones are not touched.
update public.ready_program_attempts a set current_step = 0, earned_points = 0, state = '{}'::jsonb, attempt_number = a.attempt_number + 1
  from public.tasks t where t.id = a.task_id and t.interactive_kind = 'company-voyage' and a.status = 'active';

-- Old version: miles were given by the site (an accepted interactive record). New version: by the mentor.
create or replace function public.app_company_voyage_legacy(p_user_id uuid, p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.submissions where user_id = p_user_id and task_id = p_task_id and submission_source = 'interactive' and status = 'accepted');
$$;

create or replace function public.app_ready_attempt_json(p_attempt public.ready_program_attempts)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'attemptId',p_attempt.id,'step',p_attempt.current_step,'status',p_attempt.status,'attemptNumber',p_attempt.attempt_number,
    -- Company quiz correctness is a question count, not earned miles.
    'earnedPoints',case when t.interactive_kind='company-voyage' and p_attempt.status='active' then 0 else p_attempt.earned_points end,
    'maxPoints',t.max_points,'questionIndex',coalesce((p_attempt.state->>'questionIndex')::int,0),
    'answeredQuestions',coalesce((p_attempt.state->>'questionIndex')::int,0),
    'ready',coalesce((p_attempt.state->>'ready')::boolean,false),'failed',coalesce((p_attempt.state->>'failed')::boolean,false),
    'lastAnswer',case when p_attempt.state ? 'lastAnswer' then (p_attempt.state->>'lastAnswer')::int else null end,
    'completed',p_attempt.status='completed','storyChoices',p_attempt.state->'storyChoices',
    'wrong',coalesce((p_attempt.state->>'wrong')::boolean,false),
    'mistakes',coalesce((p_attempt.state->>'mistakes')::int,0),'firstTry',coalesce((p_attempt.state->>'firstTry')::int,0)
  ) || case when t.interactive_kind = 'company-voyage' then jsonb_build_object(
    'legacy', public.app_company_voyage_legacy(p_attempt.user_id, p_attempt.task_id),
    'voice', (select jsonb_build_object('id', s.id, 'status', s.status, 'points', s.points, 'comment', s.comment, 'submittedAt', s.submitted_at)
      from public.submissions s where s.user_id = p_attempt.user_id and s.task_id = p_attempt.task_id and s.submission_source <> 'interactive'
      order by s.submitted_at desc, s.id desc limit 1)) else '{}'::jsonb end
  from public.tasks t where t.id=p_attempt.task_id;
$$;

-- Quiz answers. Company game: a wrong answer stays on the question (counted as a mistake) and is answered again.
-- Other games keep the old rule: a wrong answer means «Пройти заново».
create or replace function public.app_answer_ready_program(
  p_user_id uuid, p_task_id uuid, p_answer integer, p_expected_question_index integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text; spec jsonb; question_index integer; correct_answer integer; total integer; kind text;
  tried boolean;
begin
  error_text := public.app_ready_task_error(p_user_id, p_task_id);
  if error_text is not null then return jsonb_build_object('validationError', error_text); end if;
  if p_answer is null or p_answer not between 0 and 2 then return jsonb_build_object('validationError', 'Некорректный вариант ответа.'); end if;
  select interactive_kind, public.app_ready_program_spec(interactive_kind) into kind, spec from public.tasks where id = p_task_id;
  total := jsonb_array_length(spec->'answers');
  select * into attempt from public.ready_program_attempts where user_id = p_user_id and task_id = p_task_id for update;
  if not found or attempt.status <> 'active' or attempt.current_step <> (spec->>'steps')::int then
    return jsonb_build_object('validationError', 'Сначала пройдите все шаги программы.');
  end if;
  question_index := coalesce((attempt.state->>'questionIndex')::integer, 0);
  if p_expected_question_index is not null and p_expected_question_index <> question_index then
    if p_expected_question_index = question_index - 1
      and (attempt.state->>'lastQuestionIndex')::int = p_expected_question_index
      and (attempt.state->>'lastAnswer')::int = p_answer and not coalesce((attempt.state->>'failed')::boolean,false) then
      return public.app_ready_attempt_json(attempt);
    end if;
    return jsonb_build_object('validationError', 'Вопрос уже изменился. Откройте игру снова, чтобы обновить прогресс.');
  end if;
  if question_index not between 0 and total - 1 then return jsonb_build_object('validationError', 'Все вопросы программы уже отвечены.'); end if;
  correct_answer := (spec->'answers'->>question_index)::int;
  if kind = 'company-voyage' then
    tried := coalesce((attempt.state->>'tried')::boolean, false);
    if p_answer <> correct_answer then
      update public.ready_program_attempts set state = state || jsonb_build_object(
        'questionIndex', question_index, 'lastQuestionIndex', question_index, 'lastAnswer', p_answer, 'wrong', true, 'tried', true, 'ready', false,
        'mistakes', coalesce((state->>'mistakes')::int, 0) + 1
      ) where id = attempt.id returning * into attempt;
      return public.app_ready_attempt_json(attempt);
    end if;
    update public.ready_program_attempts set earned_points = question_index + 1, state = state || jsonb_build_object(
      'questionIndex', question_index + 1, 'lastQuestionIndex', question_index, 'lastAnswer', p_answer, 'wrong', false, 'tried', false,
      'ready', question_index + 1 = total, 'firstTry', coalesce((state->>'firstTry')::int, 0) + case when tried then 0 else 1 end
    ) where id = attempt.id returning * into attempt;
    return public.app_ready_attempt_json(attempt);
  end if;
  if coalesce((attempt.state->>'failed')::boolean, false) then
    return public.app_ready_attempt_json(attempt) || jsonb_build_object('message', 'Нажмите «Пройти заново», чтобы повторить тест.');
  end if;
  if p_answer <> correct_answer then
    update public.ready_program_attempts set state = jsonb_build_object(
      'questionIndex', question_index, 'lastQuestionIndex', question_index, 'lastAnswer', p_answer, 'failed', true, 'ready', false
    ) where id = attempt.id returning * into attempt;
    return public.app_ready_attempt_json(attempt) || jsonb_build_object('message', 'Ответ неверный. Нажмите «Пройти заново», чтобы повторить тест и получить максимум миль.');
  end if;
  update public.ready_program_attempts set earned_points = question_index + 1, state = jsonb_build_object(
    'questionIndex', question_index + 1, 'lastQuestionIndex', question_index, 'lastAnswer', p_answer, 'ready', question_index + 1 = total
  ) where id = attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt);
end $$;

-- Finishing the quiz. Company game: the game is done, but no miles yet — they come with the mentor's review of the voice.
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

-- Who may record the voice now. Company game (new version): after the quiz; again after «На доработку»; not while it waits or after miles.
create or replace function public.tg_company_voice_error(p_user_id uuid,p_task_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare problem text; kind text;
begin
  problem:=public.app_ready_task_error(p_user_id,p_task_id);
  if problem is not null then return problem; end if;
  select interactive_kind into kind from public.tasks where id=p_task_id;
  if kind not in ('company-voyage','count-your-dream','dream-route') then return 'Голосовое недоступно для этого задания.'; end if;
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

-- True when the voice of this session becomes a work for the mentor's review (company game, new version).
create or replace function public.tg_voice_for_review(p_user_id uuid, p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select interactive_kind from public.tasks where id = p_task_id) = 'company-voyage' and not public.app_company_voyage_legacy(p_user_id, p_task_id);
$$;

create or replace function public.tg_begin_submission(p_token_hash text,p_telegram_id text,p_message_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare session public.telegram_submission_sessions%rowtype; problem text; last_id bigint; summary text;
begin
  perform pg_advisory_xact_lock(hashtextextended('tg:'||p_telegram_id,0));
  select last_start_message_id into last_id from public.telegram_submission_contexts where telegram_id=p_telegram_id;
  if last_id is not null and p_message_id<=last_id then return jsonb_build_object('duplicate',true); end if;
  insert into public.telegram_submission_contexts(telegram_id,session_hash,last_start_message_id) values(p_telegram_id,null,p_message_id) on conflict(telegram_id) do update set session_hash=null,last_start_message_id=excluded.last_start_message_id;
  select * into session from public.telegram_submission_sessions where token_hash=p_token_hash for update;
  if not found or session.consumed_at is not null or session.expires_at<=now() then return jsonb_build_object('validationError','Ссылка отправки устарела. Откройте задание на сайте и нажмите кнопку отправки ещё раз.'); end if;
  if session.telegram_id<>p_telegram_id or not exists(select 1 from public.users where id=session.user_id and telegram_id=p_telegram_id) then return jsonb_build_object('validationError','Этот Telegram не связан с аккаунтом, из которого выбрано задание. Войдите на сайте в правильный аккаунт.'); end if;
  problem:=case session.purpose when 'company-voice' then public.tg_company_voice_error(session.user_id,session.task_id) when 'captain-screenshot' then public.tg_captain_screenshot_error(session.user_id,session.task_id) else public.tg_target_error(session.user_id,session.task_id) end;
  if problem is not null then return jsonb_build_object('validationError',problem); end if;
  if session.purpose='captain-screenshot' then
    select public.app_captain_message(a.state->'details')||E'\n\nУчастник: '||left(u.name,200) into summary from public.ready_program_attempts a join public.users u on u.id=a.user_id where a.user_id=session.user_id and a.task_id=session.task_id;
    -- Freeze the exact message displayed when this Telegram session is selected.
    update public.telegram_submission_sessions set metadata=jsonb_build_object('summary',summary) where token_hash=session.token_hash;
  end if;
  update public.telegram_submission_contexts set session_hash=session.token_hash where telegram_id=p_telegram_id;
  return jsonb_build_object('ready',true,'purpose',session.purpose,'summary',summary,
    'review',session.purpose='company-voice' and public.tg_voice_for_review(session.user_id,session.task_id));
end $$;

create or replace function public.tg_submit_answer(p_telegram_id text,p_chat_id text,p_message_id bigint,p_update_id bigint,p_media_type text,p_answer_text text,p_file_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare session public.telegram_submission_sessions%rowtype; context public.telegram_submission_contexts%rowtype; saved public.submissions%rowtype; attachment public.ready_program_attachments%rowtype; problem text; review boolean := false;
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
  if session.token_hash is null or session.consumed_at is not null or session.expires_at<=now() or p_message_id<=context.last_start_message_id then return jsonb_build_object('validationError','Сначала выберите задание на сайте, затем отправьте ответ сюда.'); end if;
  perform 1 from public.users where id=session.user_id for update;
  if session.telegram_id<>p_telegram_id or not exists(select 1 from public.users where id=session.user_id and telegram_id=p_telegram_id) then return jsonb_build_object('validationError','Telegram не связан с аккаунтом отправителя.'); end if;
  if session.purpose='captain-screenshot' then
    if p_media_type<>'photo' then return jsonb_build_object('validationError','Отправьте один скриншот как фото (не файл и не альбом). Текст о круизе уже подготовлен автоматически.'); end if;
    problem:=public.tg_captain_screenshot_error(session.user_id,session.task_id);
    if problem is not null then return jsonb_build_object('validationError',problem); end if;
    if coalesce(session.metadata->>'summary','')='' then return jsonb_build_object('validationError','Откройте ссылку на Telegram с сайта ещё раз.'); end if;
    select * into saved from public.submissions where user_id=session.user_id and task_id=session.task_id and submission_source='interactive' and status='accepted' and points=19 and not interactive_completed for update;
    if not found then return jsonb_build_object('validationError','Не найден результат тренировки. Откройте игру на сайте.'); end if;
    insert into public.ready_program_attachments(submission_id,kind,telegram_file_id,telegram_chat_id,telegram_message_id,telegram_update_id,summary) values(saved.id,'captain-screenshot',p_file_id,p_chat_id,p_message_id,p_update_id,session.metadata->>'summary');
    update public.ready_program_attempts set earned_points=20,state=state||'{"screenshotSent":true}'::jsonb where user_id=session.user_id and task_id=session.task_id;
    update public.submissions set points=20,interactive_completed=true where id=saved.id;
    insert into public.telegram_notification_jobs(recipient_id,submission_id,kind) select m.id,saved.id,'captain-screenshot' from public.users m where m.id<>session.user_id and (m.role='admin' or (m.role='member' and m.can_review)) and m.id in (select id from public.tg_ancestor_ids(session.user_id)) on conflict(recipient_id,submission_id) do nothing;
  elsif session.purpose='company-voice' then
    if p_media_type<>'voice' then return jsonb_build_object('validationError','Для этого шага запишите одно голосовое сообщение через микрофон Telegram. Текст и файлы его не заменяют.'); end if;
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
    if p_media_type='voice' then return jsonb_build_object('validationError','Это задание ожидает текст, фото, видео или документ. Для голосового откройте кнопку в конце игры «Корабль, на который ты поднялся».'); end if;
    problem:=public.tg_target_error(session.user_id,session.task_id);
    if problem is not null then return jsonb_build_object('validationError',problem); end if;
    insert into public.submissions(user_id,task_id,status,telegram_chat_id,telegram_message_id,telegram_update_id,media_type,telegram_file_id,answer_text) values(session.user_id,session.task_id,'pending',p_chat_id,p_message_id::text,p_update_id,p_media_type,p_file_id,coalesce(p_answer_text,'')) returning * into saved;
  end if;
  update public.telegram_submission_sessions set consumed_at=now() where token_hash=session.token_hash;
  update public.telegram_submission_contexts set session_hash=null where telegram_id=p_telegram_id;
  return jsonb_build_object('data',case when session.purpose='answer' then to_jsonb(saved) else jsonb_build_object('id',saved.id) end,'duplicate',false,'purpose',session.purpose,'review',review);
end $$;

revoke all on function public.app_company_voyage_legacy(uuid, uuid), public.app_ready_attempt_json(public.ready_program_attempts),
  public.app_answer_ready_program(uuid, uuid, integer, integer), public.app_complete_ready_program(uuid, uuid), public.app_ready_program_spec(text),
  public.tg_company_voice_error(uuid, uuid), public.tg_voice_for_review(uuid, uuid), public.tg_begin_submission(text, text, bigint),
  public.tg_submit_answer(text, text, bigint, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.app_answer_ready_program(uuid, uuid, integer, integer), public.app_complete_ready_program(uuid, uuid),
  public.tg_company_voice_error(uuid, uuid), public.tg_begin_submission(text, text, bigint),
  public.tg_submit_answer(text, text, bigint, bigint, text, text, text) to service_role;
notify pgrst, 'reload schema';
commit;

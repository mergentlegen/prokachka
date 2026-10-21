-- Voice answers, all cases. A task with a test and a voice answer: the test is checked on the site, kept with the
-- 30-minute Telegram link and saved as the work only when the voice message arrives. Links last 30 minutes; if nothing
-- arrives, the task stays not sent and the bot says so (job kind submission-timeout). Every bot mistake message says
-- what was wrong, how to do it right and that the participant can simply send again before the time shown.
-- The two bot functions are the 20261108 versions with only these changes. Running it again changes nothing.
begin;

alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check
  check(kind in ('permissions','submission','survey','company-voice','captain-screenshot','feedback','task-reminder',
    'task-nudge','announcement','start-reminder','miles-recount','review','level-up','submission-timeout'));

-- The checks of a test sent together with a voice message, without saving anything yet.
create or replace function public.app_task_quiz_check(p_user uuid, p_task uuid, p_answer_text text)
returns text language plpgsql stable security definer set search_path = public as $$
declare problem text;
begin
  if not exists (select 1 from public.task_quizzes where task_id = p_task) then return 'У задания нет вопросов на сайте.'; end if;
  problem := public.tg_target_error(p_user, p_task);
  if problem is not null then return problem; end if;
  if exists (select 1 from public.task_videos where task_id = p_task and video_path is not null)
    and not exists (select 1 from public.task_video_views where user_id = p_user and task_id = p_task and completed_at is not null) then
    return 'Сначала досмотрите видео до конца.';
  end if;
  if char_length(btrim(coalesce(p_answer_text, ''))) = 0 or char_length(p_answer_text) > 100000 then return 'Ответы не заполнены.'; end if;
  return null;
end $$;

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
  -- If nothing arrives before the link expires, the participant hears that the task was not sent.
  if not exists(select 1 from public.telegram_notification_jobs j where j.kind='submission-timeout' and j.payload->>'session'=session.token_hash) then
    insert into public.telegram_notification_jobs(recipient_id,kind,payload,available_at)
      values(session.user_id,'submission-timeout',jsonb_build_object('session',session.token_hash),session.expires_at+interval '1 minute');
  end if;
  return jsonb_build_object('ready',true,'purpose',session.purpose,'summary',summary,
    'title',(select t.title from public.tasks t where t.id=session.task_id),'expiresAt',session.expires_at,'quiz',session.metadata ? 'quiz',
    'review',session.purpose='company-voice' and public.tg_voice_for_review(session.user_id,session.task_id),
    'voice',session.purpose='answer' and coalesce((select t.voice_answer from public.tasks t where t.id=session.task_id),false));
end $$;

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
    select * into saved from public.submissions where user_id=session.user_id and task_id=session.task_id and submission_source='interactive' and status='accepted' and points=19 and not interactive_completed for update;
    if not found then return jsonb_build_object('validationError','Не найден результат тренировки. Откройте игру на сайте.'); end if;
    insert into public.ready_program_attachments(submission_id,kind,telegram_file_id,telegram_chat_id,telegram_message_id,telegram_update_id,summary) values(saved.id,'captain-screenshot',p_file_id,p_chat_id,p_message_id,p_update_id,session.metadata->>'summary');
    update public.ready_program_attempts set earned_points=20,state=state||'{"screenshotSent":true}'::jsonb where user_id=session.user_id and task_id=session.task_id;
    update public.submissions set points=20,interactive_completed=true where id=saved.id;
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

revoke all on function public.app_task_quiz_check(uuid, uuid, text), public.tg_begin_submission(text, text, bigint),
  public.tg_submit_answer(text, text, bigint, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.app_task_quiz_check(uuid, uuid, text), public.tg_begin_submission(text, text, bigint),
  public.tg_submit_answer(text, text, bigint, bigint, text, text, text) to service_role;
notify pgrst, 'reload schema';
commit;

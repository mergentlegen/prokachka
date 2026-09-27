-- Apply after 20261005-company-voyage.sql. Voice is practice, never another reward.
begin;
alter table public.telegram_submission_sessions add column if not exists purpose text not null default 'answer';
alter table public.telegram_submission_sessions drop constraint if exists telegram_submission_sessions_purpose_check;
alter table public.telegram_submission_sessions add constraint telegram_submission_sessions_purpose_check check(purpose in ('answer','company-voice'));
alter table public.submissions add column if not exists company_voice_file_id text;
alter table public.submissions add column if not exists company_voice_chat_id text;
alter table public.submissions add column if not exists company_voice_message_id bigint;
alter table public.submissions add column if not exists company_voice_update_id bigint;
create unique index if not exists submissions_company_voice_update_idx on public.submissions(company_voice_update_id) where company_voice_update_id is not null;
alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check check(kind in ('permissions','submission','survey','company-voice'));

create or replace function public.tg_company_voice_error(p_user_id uuid,p_task_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare problem text;
begin
  problem:=public.app_ready_task_error(p_user_id,p_task_id);
  if problem is not null then return problem; end if;
  if (select interactive_kind from public.tasks where id=p_task_id) is distinct from 'company-voyage' then return 'Голосовое недоступно для этого задания.'; end if;
  if not exists(select 1 from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id and status='completed')
    or not exists(select 1 from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and status='accepted') then return 'Сначала завершите тест на сайте.'; end if;
  if exists(select 1 from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and company_voice_file_id is not null) then return 'Голосовое уже сохранено для доставки наставникам. Повторно отправлять его не нужно.'; end if;
  if not exists(select 1 from public.users mentor where mentor.id<>p_user_id and (mentor.role='admin' or (mentor.role='member' and mentor.can_review))
    and mentor.id in (select a.id from public.tg_ancestor_ids(p_user_id) a)) then return 'В вашей ветке пока нет наставника для получения голосового.'; end if;
  return null;
end $$;

create or replace function public.tg_can_receive_company_voice(p_recipient uuid,p_submission uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.submissions s join public.users member on member.id=s.user_id
    join public.users recipient on recipient.id=p_recipient join public.tasks task on task.id=s.task_id
    where s.id=p_submission and s.submission_source='interactive' and s.status='accepted' and s.company_voice_file_id is not null
      and task.interactive_kind='company-voyage' and public.app_ready_task_error(member.id,task.id) is null
      and recipient.id<>member.id and recipient.team_id=member.team_id
      and (recipient.role='admin' or (recipient.role='member' and recipient.can_review))
      and recipient.id in (select a.id from public.tg_ancestor_ids(member.id) a));
$$;

create or replace function public.tg_begin_submission(p_token_hash text,p_telegram_id text,p_message_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare session public.telegram_submission_sessions%rowtype; problem text; last_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('tg:'||p_telegram_id,0));
  select last_start_message_id into last_id from public.telegram_submission_contexts where telegram_id=p_telegram_id;
  if last_id is not null and p_message_id<=last_id then return jsonb_build_object('duplicate',true); end if;
  -- A single ordered context serves ordinary answers and voice: never both.
  insert into public.telegram_submission_contexts(telegram_id,session_hash,last_start_message_id) values(p_telegram_id,null,p_message_id)
    on conflict(telegram_id) do update set session_hash=null,last_start_message_id=excluded.last_start_message_id;
  select * into session from public.telegram_submission_sessions where token_hash=p_token_hash for update;
  if not found or session.consumed_at is not null or session.expires_at<=now() then return jsonb_build_object('validationError','Ссылка отправки устарела. Откройте задание на сайте и нажмите кнопку отправки ещё раз.'); end if;
  if session.telegram_id<>p_telegram_id or not exists(select 1 from public.users where id=session.user_id and telegram_id=p_telegram_id) then return jsonb_build_object('validationError','Этот Telegram не связан с аккаунтом, из которого выбрано задание. Войдите на сайте в правильный аккаунт.'); end if;
  problem:=case when session.purpose='company-voice' then public.tg_company_voice_error(session.user_id,session.task_id) else public.tg_target_error(session.user_id,session.task_id) end;
  if problem is not null then return jsonb_build_object('validationError',problem); end if;
  update public.telegram_submission_contexts set session_hash=session.token_hash where telegram_id=p_telegram_id;
  return jsonb_build_object('ready',true,'purpose',session.purpose);
end $$;

create or replace function public.tg_submit_answer(p_telegram_id text,p_chat_id text,p_message_id bigint,p_update_id bigint,p_media_type text,p_answer_text text,p_file_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare session public.telegram_submission_sessions%rowtype; context public.telegram_submission_contexts%rowtype; saved public.submissions%rowtype; problem text;
begin
  if p_telegram_id is distinct from p_chat_id or p_update_id is null or p_message_id is null or p_media_type not in ('text','photo','video','document','voice')
    or char_length(coalesce(p_answer_text,''))>10000 or (p_media_type='text' and btrim(coalesce(p_answer_text,''))='')
    or (p_media_type<>'text' and coalesce(p_file_id,'')='') then return jsonb_build_object('validationError','Некорректный ответ.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tg:'||p_telegram_id,0));
  select * into saved from public.submissions where telegram_update_id=p_update_id or company_voice_update_id=p_update_id;
  if found then
    if saved.company_voice_update_id=p_update_id and saved.company_voice_chat_id=p_chat_id and saved.company_voice_message_id=p_message_id then
      return jsonb_build_object('data',jsonb_build_object('id',saved.id),'duplicate',true,'purpose','company-voice');
    end if;
    if saved.telegram_update_id=p_update_id and saved.telegram_chat_id=p_chat_id and saved.telegram_message_id=p_message_id::text then return jsonb_build_object('data',to_jsonb(saved),'duplicate',true); end if;
    return jsonb_build_object('validationError','Обновление уже обработано.');
  end if;
  select * into context from public.telegram_submission_contexts where telegram_id=p_telegram_id for update;
  select * into session from public.telegram_submission_sessions where token_hash=context.session_hash for update;
  if session.token_hash is null or session.consumed_at is not null or session.expires_at<=now() or p_message_id<=context.last_start_message_id then return jsonb_build_object('validationError','Сначала выберите задание на сайте, затем отправьте ответ сюда.'); end if;
  perform 1 from public.users where id=session.user_id for update;
  if session.telegram_id<>p_telegram_id or not exists(select 1 from public.users where id=session.user_id and telegram_id=p_telegram_id) then return jsonb_build_object('validationError','Telegram не связан с аккаунтом отправителя.'); end if;
  if session.purpose='company-voice' then
    if p_media_type<>'voice' then return jsonb_build_object('validationError','Для этого шага запишите одно голосовое сообщение через микрофон Telegram. Текст и файлы его не заменяют.'); end if;
    problem:=public.tg_company_voice_error(session.user_id,session.task_id);
    if problem is not null then return jsonb_build_object('validationError',problem); end if;
    select * into saved from public.submissions where user_id=session.user_id and task_id=session.task_id and submission_source='interactive' and status='accepted' for update;
    update public.submissions set company_voice_file_id=p_file_id,company_voice_chat_id=p_chat_id,company_voice_message_id=p_message_id,company_voice_update_id=p_update_id where id=saved.id;
    insert into public.telegram_notification_jobs(recipient_id,submission_id,kind)
      select mentor.id,saved.id,'company-voice' from public.users mentor
      where mentor.id<>session.user_id and (mentor.role='admin' or (mentor.role='member' and mentor.can_review))
        and mentor.id in (select a.id from public.tg_ancestor_ids(session.user_id) a)
      on conflict(recipient_id,submission_id) do nothing;
  else
    if p_media_type='voice' then return jsonb_build_object('validationError','Это задание ожидает текст, фото, видео или документ. Для голосового откройте кнопку в конце игры «Корабль, на который ты поднялся».'); end if;
    problem:=public.tg_target_error(session.user_id,session.task_id);
    if problem is not null then return jsonb_build_object('validationError',problem); end if;
    insert into public.submissions(user_id,task_id,status,telegram_chat_id,telegram_message_id,telegram_update_id,media_type,telegram_file_id,answer_text)
      values(session.user_id,session.task_id,'pending',p_chat_id,p_message_id::text,p_update_id,p_media_type,p_file_id,coalesce(p_answer_text,'')) returning * into saved;
  end if;
  update public.telegram_submission_sessions set consumed_at=now() where token_hash=session.token_hash;
  update public.telegram_submission_contexts set session_hash=null where telegram_id=p_telegram_id;
  return jsonb_build_object('data',case when session.purpose='company-voice' then jsonb_build_object('id',saved.id) else to_jsonb(saved) end,'duplicate',false,'purpose',session.purpose);
end $$;

revoke all on function public.tg_company_voice_error(uuid,uuid),public.tg_can_receive_company_voice(uuid,uuid),public.tg_begin_submission(text,text,bigint),public.tg_submit_answer(text,text,bigint,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.tg_company_voice_error(uuid,uuid),public.tg_can_receive_company_voice(uuid,uuid),public.tg_begin_submission(text,text,bigint),public.tg_submit_answer(text,text,bigint,bigint,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;

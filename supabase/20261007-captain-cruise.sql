-- Fifth ready game. Apply after 20261006-company-voice.sql; safe to replay.
begin;
alter table public.task_programs drop constraint if exists task_programs_template_key_check;
alter table public.task_programs add constraint task_programs_template_key_check check(template_key is null or template_key in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise'));
alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check check(interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise'));
alter table public.telegram_submission_sessions drop constraint if exists telegram_submission_sessions_purpose_check;
alter table public.telegram_submission_sessions add constraint telegram_submission_sessions_purpose_check check(purpose in ('answer','company-voice','captain-screenshot'));
alter table public.telegram_submission_sessions add column if not exists metadata jsonb not null default '{}';
alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check check(kind in ('permissions','submission','survey','company-voice','captain-screenshot'));

create table if not exists public.ready_program_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  kind text not null check(kind='captain-screenshot'),
  telegram_file_id text not null,
  telegram_chat_id text not null,
  telegram_message_id bigint not null,
  telegram_update_id bigint not null unique,
  summary text not null check(char_length(summary) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.ready_program_attachments enable row level security;
revoke all on public.ready_program_attachments from public,anon,authenticated;
grant select,insert on public.ready_program_attachments to service_role;

create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[1,1,0,1,2]}'::jsonb
    when 'company-voyage' then '{"steps":8,"reward":10,"answers":[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    -- Dedicated checkpoints validate this game. Ordinary quiz RPCs cannot finish it.
    when 'captain-cruise' then '{"steps":1,"reward":20,"answers":[]}'::jsonb
    else null end;
$$;

create or replace function public.app_captain_details_valid(p_details jsonb)
returns boolean language sql immutable security definer set search_path=public as $$
  select jsonb_typeof(p_details)='object' and not exists(
    select 1 from unnest(array['direction','line','who','price']) key
    where jsonb_typeof(p_details->key) is distinct from 'string'
      or char_length(btrim(p_details->>key)) not between 1 and 120
      or (p_details->>key) ~ '[[:cntrl:]]');
$$;
create or replace function public.app_captain_message(p_details jsonb)
returns text language sql immutable security definer set search_path=public as $$
  select 'Привет! Я прошёл(ла) тренировку «Капитан ищет свой круиз» 🚢'||E'\n'
    ||'Выбрал(а) направление: '||(p_details->>'direction')||E'\n'
    ||'Круизная линия: '||(p_details->>'line')||E'\n'
    ||'Едем: '||(p_details->>'who')||E'\n'
    ||'Цена за всех: '||(p_details->>'price')||E'\nСкриншот прикрепляю 📸';
$$;
create or replace function public.app_captain_attempt_json(p_attempt public.ready_program_attempts)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('index',coalesce((p_attempt.state->>'captainIndex')::int,0),
    'failed',coalesce((p_attempt.state->>'failed')::boolean,false),'lastAnswer',p_attempt.state->'lastAnswer',
    'trainingDone',coalesce((p_attempt.state->>'trainingDone')::boolean,false),
    'screenshotSent',coalesce((p_attempt.state->>'screenshotSent')::boolean,false),
    'trainingPoints',coalesce((p_attempt.state->>'trainingPoints')::int,0),'earnedPoints',p_attempt.earned_points,
    'direction',coalesce(p_attempt.state->>'direction',''),'guests',p_attempt.state->'guests',
    'cabin',p_attempt.state->'cabin','details',p_attempt.state->'details',
    'submission',(select to_jsonb(s) from public.submissions s where s.user_id=p_attempt.user_id and s.task_id=p_attempt.task_id and s.submission_source='interactive' and s.status='accepted' limit 1));
$$;

create or replace function public.app_captain_cruise(p_user_id uuid,p_task_id uuid,p_action text,p_expected_index integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; problem text; idx int; answer int;
  keys int[]:=array[0,2,1,1,2,-1,-1,1,1,1,2,1,1,1,-1];
  weights int[]:=array[2,1,1,1,1,1,2,1,1,1,1,1,1,3,1]; next_state jsonb; details jsonb;
begin
  problem:=public.app_ready_task_error(p_user_id,p_task_id);
  if problem is not null then return jsonb_build_object('validationError',problem); end if;
  select * into task from public.tasks where id=p_task_id;
  if task.interactive_kind is distinct from 'captain-cruise' then return jsonb_build_object('validationError','Тренировка недоступна для этого задания.'); end if;
  if p_action not in ('start','checkpoint','retry','finish','save-details') or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' then return jsonb_build_object('validationError','Некорректное действие тренировки.'); end if;
  -- Same lock order as the existing ready-game and Telegram flows.
  perform 1 from public.users where id=p_user_id for update;
  insert into public.ready_program_attempts(user_id,task_id) values(p_user_id,p_task_id) on conflict(user_id,task_id) do nothing;
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
    if idx<>15 or coalesce((a.state->>'failed')::boolean,false) or coalesce((a.state->>'trainingPoints')::int,0)<>19 then return jsonb_build_object('validationError','Сначала пройдите все шаги тренировки.'); end if;
    update public.ready_program_attempts set status='completed',earned_points=19,completed_at=now(),state=state||'{"trainingDone":true}'::jsonb where id=a.id returning * into a;
    insert into public.submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source,interactive_completed)
      values(p_user_id,p_task_id,'accepted','text','Тренировка «Капитан ищет свой круиз» завершена.',19,'19 миль за тренировку. Ещё 1 — после отправки скриншота.',now(),'interactive',false);
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
  if idx not between 0 and 14 then return jsonb_build_object('validationError','Все шаги уже выполнены. Нажмите «Завершить».'); end if;
  if coalesce((a.state->>'failed')::boolean,false) then return public.app_captain_attempt_json(a); end if;
  next_state:=a.state;
  if idx=5 then
    if not (p_payload->>'direction'=any(array['Восточное Средиземноморье','Египет и Красное море','Европа','Фиджи','Гавайи','Пиренейский полуостров','Индия','Средиземное море','Мексика','Ближний Восток','Северная Америка','Северная Европа','Океания','Тихоокеанский регион','Панамский канал','Приполярные регионы','Скандинавия'])) or p_payload->>'direction' is null then return jsonb_build_object('validationError','Выберите направление из списка.'); end if;
    next_state:=next_state||jsonb_build_object('direction',p_payload->>'direction');
  elsif idx=6 then
    if jsonb_typeof(p_payload->'readKeys') is distinct from 'array' or not (p_payload->'readKeys' @> '["line","ship","port","nights","dates","price"]'::jsonb) then return jsonb_build_object('validationError','Сначала прочитайте все строки карточки.'); end if;
  else
    if jsonb_typeof(p_payload->'answer') is distinct from 'number' or (p_payload->>'answer') !~ '^[0-3]$' then return jsonb_build_object('validationError','Выберите вариант ответа.'); end if;
    answer:=(p_payload->>'answer')::int;
    if idx=9 and (jsonb_typeof(p_payload->'readCabins') is distinct from 'array' or not (p_payload->'readCabins' @> '[0,1,2,3]'::jsonb)) then return jsonb_build_object('validationError','Сначала изучите все четыре категории кают.'); end if;
    if idx=11 then
      if jsonb_typeof(p_payload->'guests') is distinct from 'array' or jsonb_array_length(p_payload->'guests')<>3
        or exists(select 1 from jsonb_array_elements(p_payload->'guests') g where jsonb_typeof(g) is distinct from 'number' or g::text !~ '^[0-8]$')
        or (p_payload->'guests'->>0)::int+(p_payload->'guests'->>1)::int+(p_payload->'guests'->>2)::int<1 then return jsonb_build_object('validationError','Укажите хотя бы одного пассажира.'); end if;
      next_state:=next_state||jsonb_build_object('guests',p_payload->'guests');
    end if;
    if (idx=14 and answer not between 0 and 1) or (idx<>14 and answer<>keys[idx+1]) then
      update public.ready_program_attempts set state=next_state||jsonb_build_object('failed',true,'lastAnswer',answer) where id=a.id returning * into a;
      return public.app_captain_attempt_json(a);
    end if;
    if idx=14 then next_state:=next_state||jsonb_build_object('cabin',answer); end if;
  end if;
  update public.ready_program_attempts set state=(next_state-'failed'-'lastAnswer')||jsonb_build_object('captainIndex',idx+1,'lastPayload',p_payload,'trainingPoints',coalesce((a.state->>'trainingPoints')::int,0)+weights[idx+1]) where id=a.id returning * into a;
  return public.app_captain_attempt_json(a);
end $$;

-- Allow only the one extra screenshot mile, matched to the completed attempt
-- and its saved Telegram attachment. Keep the existing survey exception intact.
create or replace function public.app_guard_interactive_submission_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.submission_source='interactive' and (new.user_id is distinct from old.user_id or new.task_id is distinct from old.task_id or new.status is distinct from old.status or new.points is distinct from old.points or new.submission_source is distinct from old.submission_source or new.interactive_completed is distinct from old.interactive_completed) then
    if old.status='accepted' and not old.interactive_completed and new.user_id=old.user_id and new.task_id=old.task_id and new.status=old.status and new.submission_source=old.submission_source and new.points=old.points+1
      and exists(select 1 from public.ready_program_attempts a join public.tasks t on t.id=a.task_id where a.user_id=old.user_id and a.task_id=old.task_id and a.earned_points=new.points and (
        (t.interactive_kind='heart-survey' and (a.status='completed')=new.interactive_completed and jsonb_array_length(a.state->'answers')=new.points)
        or (t.interactive_kind='captain-cruise' and old.points=19 and new.points=20 and new.interactive_completed and a.status='completed' and (a.state->>'screenshotSent')::boolean=true and exists(select 1 from public.ready_program_attachments where submission_id=old.id and kind='captain-screenshot')))) then return new; end if;
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
  if coalesce((a.state->>'screenshotSent')::boolean,false) then return 'Скриншот уже сохранён для доставки наставникам. Все 20 миль начислены.'; end if;
  if public.app_captain_details_valid(a.state->'details') is distinct from true then return 'Сначала заполните сведения о настоящем круизе на сайте.'; end if;
  if not exists(select 1 from public.users m where m.id<>p_user_id and (m.role='admin' or (m.role='member' and m.can_review)) and m.id in (select id from public.tg_ancestor_ids(p_user_id))) then return 'В вашей ветке пока нет наставника для получения скриншота.'; end if;
  return null;
end $$;
create or replace function public.tg_can_receive_captain_screenshot(p_recipient uuid,p_submission uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.submissions s join public.ready_program_attachments att on att.submission_id=s.id join public.tasks t on t.id=s.task_id join public.users member on member.id=s.user_id join public.users recipient on recipient.id=p_recipient
    where att.kind='captain-screenshot' and s.status='accepted' and s.submission_source='interactive' and s.interactive_completed and t.interactive_kind='captain-cruise' and public.app_ready_task_error(member.id,t.id) is null
      and recipient.id<>member.id and recipient.team_id=member.team_id and (recipient.role='admin' or (recipient.role='member' and recipient.can_review)) and recipient.id in (select id from public.tg_ancestor_ids(member.id)));
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
  return jsonb_build_object('ready',true,'purpose',session.purpose,'summary',summary);
end $$;

create or replace function public.tg_submit_answer(p_telegram_id text,p_chat_id text,p_message_id bigint,p_update_id bigint,p_media_type text,p_answer_text text,p_file_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare session public.telegram_submission_sessions%rowtype; context public.telegram_submission_contexts%rowtype; saved public.submissions%rowtype; attachment public.ready_program_attachments%rowtype; problem text;
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
    if saved.telegram_update_id=p_update_id and saved.telegram_chat_id=p_chat_id and saved.telegram_message_id=p_message_id::text then return jsonb_build_object('data',to_jsonb(saved),'duplicate',true); end if;
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
    select * into saved from public.submissions where user_id=session.user_id and task_id=session.task_id and submission_source='interactive' and status='accepted' for update;
    update public.submissions set company_voice_file_id=p_file_id,company_voice_chat_id=p_chat_id,company_voice_message_id=p_message_id,company_voice_update_id=p_update_id where id=saved.id;
    insert into public.telegram_notification_jobs(recipient_id,submission_id,kind) select m.id,saved.id,'company-voice' from public.users m where m.id<>session.user_id and (m.role='admin' or (m.role='member' and m.can_review)) and m.id in (select id from public.tg_ancestor_ids(session.user_id)) on conflict(recipient_id,submission_id) do nothing;
  else
    if p_media_type='voice' then return jsonb_build_object('validationError','Это задание ожидает текст, фото, видео или документ. Для голосового откройте кнопку в конце игры «Корабль, на который ты поднялся».'); end if;
    problem:=public.tg_target_error(session.user_id,session.task_id);
    if problem is not null then return jsonb_build_object('validationError',problem); end if;
    insert into public.submissions(user_id,task_id,status,telegram_chat_id,telegram_message_id,telegram_update_id,media_type,telegram_file_id,answer_text) values(session.user_id,session.task_id,'pending',p_chat_id,p_message_id::text,p_update_id,p_media_type,p_file_id,coalesce(p_answer_text,'')) returning * into saved;
  end if;
  update public.telegram_submission_sessions set consumed_at=now() where token_hash=session.token_hash;
  update public.telegram_submission_contexts set session_hash=null where telegram_id=p_telegram_id;
  return jsonb_build_object('data',case when session.purpose='answer' then to_jsonb(saved) else jsonb_build_object('id',saved.id) end,'duplicate',false,'purpose',session.purpose);
end $$;

revoke all on function public.app_ready_program_spec(text),public.app_captain_details_valid(jsonb),public.app_captain_message(jsonb),public.app_captain_attempt_json(public.ready_program_attempts),public.app_guard_interactive_submission_update(),public.app_captain_cruise(uuid,uuid,text,integer,jsonb),public.tg_captain_screenshot_error(uuid,uuid),public.tg_can_receive_captain_screenshot(uuid,uuid),public.tg_begin_submission(text,text,bigint),public.tg_submit_answer(text,text,bigint,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.app_captain_cruise(uuid,uuid,text,integer,jsonb),public.tg_captain_screenshot_error(uuid,uuid),public.tg_can_receive_captain_screenshot(uuid,uuid),public.tg_begin_submission(text,text,bigint),public.tg_submit_answer(text,text,bigint,bigint,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;

-- Apply after schema.sql (or all existing migrations). Back up first.
-- No user, submission or historical score is deleted or reassigned.
begin;

create unique index if not exists users_telegram_identity_idx on public.users(telegram_id) where telegram_id is not null;
alter table public.submissions add column if not exists review_version integer not null default 0;

create table if not exists public.telegram_submission_sessions (
  token_hash text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  telegram_id text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists telegram_sessions_expiry_idx on public.telegram_submission_sessions(expires_at);
create table if not exists public.telegram_submission_contexts (
  telegram_id text primary key,
  session_hash text references public.telegram_submission_sessions(token_hash) on delete set null,
  last_start_message_id bigint not null
);

create or replace function public.tg_link_account(p_token text, p_telegram_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare link public.telegram_link_tokens%rowtype; account public.users%rowtype;
begin
  if p_telegram_id !~ '^[1-9][0-9]{0,15}$' then return jsonb_build_object('validationError', 'Некорректный Telegram.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tg:' || p_telegram_id, 0));
  select * into link from public.telegram_link_tokens where token = p_token for update;
  if not found or link.expires_at <= now() then return jsonb_build_object('validationError', 'Ссылка привязки устарела. Создайте новую на сайте.'); end if;
  select * into account from public.users where id = link.user_id for update;
  if not found then return jsonb_build_object('validationError', 'Аккаунт больше недоступен.'); end if;
  if exists (select 1 from public.users where telegram_id = p_telegram_id and id <> account.id) then
    -- Also clear an earlier task selection: a failed account switch must not submit to it.
    update public.telegram_submission_contexts set session_hash = null where telegram_id = p_telegram_id;
    return jsonb_build_object('validationError', 'Этот Telegram уже привязан к другому аккаунту. Войдите на сайте в связанный аккаунт или используйте другой Telegram.');
  end if;
  if account.telegram_id is not null and account.telegram_id <> p_telegram_id then return jsonb_build_object('validationError', 'К этому аккаунту уже привязан другой Telegram.'); end if;
  if link.used_at is not null then
    if account.telegram_id = p_telegram_id then return jsonb_build_object('userId', account.id); end if;
    return jsonb_build_object('validationError', 'Ссылка уже использована.');
  end if;
  update public.users set telegram_id = p_telegram_id where id = account.id;
  update public.telegram_link_tokens set used_at = now() where token = p_token;
  return jsonb_build_object('userId', account.id);
end;
$$;

-- UNION (not UNION ALL) terminates safely even for damaged legacy cycles.
create or replace function public.tg_ancestor_ids(p_user_id uuid)
returns table(id uuid) language sql stable security definer set search_path = public as $$
  with recursive chain(id, parent_id, team_id) as (
    select u.id, u.parent_user_id, u.team_id from public.users u where u.id = p_user_id
    union
    select u.id, u.parent_user_id, u.team_id from public.users u join chain c on u.id = c.parent_id and u.team_id = c.team_id
  ) select chain.id from chain;
$$;

create or replace function public.tg_target_error(p_user_id uuid, p_task_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare account public.users%rowtype; task public.tasks%rowtype;
begin
  select * into account from public.users where id = p_user_id;
  select * into task from public.tasks where id = p_task_id;
  if account.id is null or account.role <> 'member' or task.id is null or not task.is_active then return 'Задание недоступно.'; end if;
  if account.team_id is null or account.team_id is distinct from task.team_id then return 'Пользователь не состоит в команде задания.'; end if;
  if not exists (select 1 from public.teams where id = account.team_id and is_active) then return 'Команда недоступна.'; end if;
  if task.audience_root_id is not null and not exists (select 1 from public.tg_ancestor_ids(account.id) a where a.id = task.audience_root_id) then return 'Задание недоступно для вашей ветки.'; end if;
  if task.publication_type = 'sequential' then
    if not exists (select 1 from public.task_programs p where p.id = task.program_id and p.is_active and p.team_id = account.team_id
      and (p.audience_root_id is null or p.audience_root_id in (select a.id from public.tg_ancestor_ids(account.id) a)))
      or not exists (select 1 from public.member_program_progress where user_id = account.id and program_id = task.program_id and current_task_id = task.id and status = 'active') then return 'Сейчас доступен другой шаг программы.'; end if;
  elsif task.deadline_at is not null and task.deadline_at <= now() then return 'Срок отправки уже истёк.';
  end if;
  if exists (select 1 from public.submissions where user_id = account.id and task_id = task.id and status = 'accepted') then return 'Это задание уже принято наставником.'; end if;
  if exists (select 1 from public.submissions where user_id = account.id and task_id = task.id and status = 'pending' and (media_type is not null or btrim(answer_text) <> '')) then return 'Ответ уже отправлен. Дождитесь проверки наставника.'; end if;
  return null;
end;
$$;

create or replace function public.tg_begin_submission(p_token_hash text, p_telegram_id text, p_message_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare session public.telegram_submission_sessions%rowtype; problem text; last_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('tg:' || p_telegram_id, 0));
  select last_start_message_id into last_id from public.telegram_submission_contexts where telegram_id = p_telegram_id;
  if last_id is not null and p_message_id <= last_id then return jsonb_build_object('duplicate', true); end if;
  -- Invalid, foreign and legacy starts cancel the previous selection as well.
  insert into public.telegram_submission_contexts(telegram_id, session_hash, last_start_message_id) values(p_telegram_id, null, p_message_id)
    on conflict(telegram_id) do update set session_hash = null, last_start_message_id = excluded.last_start_message_id;
  select * into session from public.telegram_submission_sessions where token_hash = p_token_hash for update;
  if not found or session.consumed_at is not null or session.expires_at <= now() then return jsonb_build_object('validationError', 'Ссылка отправки устарела. Нажмите «Отправить работу» на сайте ещё раз.'); end if;
  if session.telegram_id <> p_telegram_id or not exists (select 1 from public.users where id = session.user_id and telegram_id = p_telegram_id) then
    return jsonb_build_object('validationError', 'Этот Telegram не связан с аккаунтом, из которого выбрано задание. Войдите на сайте в правильный аккаунт.');
  end if;
  problem := public.tg_target_error(session.user_id, session.task_id);
  if problem is not null then return jsonb_build_object('validationError', problem); end if;
  update public.telegram_submission_contexts set session_hash = session.token_hash where telegram_id = p_telegram_id;
  return jsonb_build_object('ready', true);
end;
$$;

create or replace function public.tg_submit_answer(p_telegram_id text, p_chat_id text, p_message_id bigint, p_update_id bigint, p_media_type text, p_answer_text text, p_file_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare session public.telegram_submission_sessions%rowtype; context public.telegram_submission_contexts%rowtype; saved public.submissions%rowtype; problem text;
begin
  if p_telegram_id is distinct from p_chat_id or p_update_id is null or p_message_id is null or p_media_type not in ('text','photo','video','document')
    or char_length(coalesce(p_answer_text,'')) > 10000 or (p_media_type = 'text' and btrim(coalesce(p_answer_text,'')) = '')
    or (p_media_type <> 'text' and coalesce(p_file_id,'') = '') then return jsonb_build_object('validationError', 'Некорректный ответ.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tg:' || p_telegram_id, 0));
  select * into saved from public.submissions where telegram_update_id = p_update_id;
  if found then
    if saved.telegram_chat_id = p_chat_id and saved.telegram_message_id = p_message_id::text then return jsonb_build_object('data', to_jsonb(saved), 'duplicate', true); end if;
    return jsonb_build_object('validationError', 'Обновление уже обработано.');
  end if;
  select * into context from public.telegram_submission_contexts where telegram_id = p_telegram_id for update;
  select * into session from public.telegram_submission_sessions where token_hash = context.session_hash for update;
  if session.token_hash is null or session.consumed_at is not null or session.expires_at <= now() or p_message_id <= context.last_start_message_id then
    return jsonb_build_object('validationError', 'Сначала выберите задание на сайте, затем отправьте ответ сюда.');
  end if;
  -- Locks serialize sending and checking work for this participant.
  perform 1 from public.users where id = session.user_id for update;
  if session.telegram_id <> p_telegram_id or not exists (select 1 from public.users where id = session.user_id and telegram_id = p_telegram_id) then return jsonb_build_object('validationError', 'Telegram не связан с аккаунтом отправителя.'); end if;
  problem := public.tg_target_error(session.user_id, session.task_id);
  if problem is not null then return jsonb_build_object('validationError', problem); end if;
  insert into public.submissions(user_id,task_id,status,telegram_chat_id,telegram_message_id,telegram_update_id,media_type,telegram_file_id,answer_text)
    values(session.user_id,session.task_id,'pending',p_chat_id,p_message_id::text,p_update_id,p_media_type,p_file_id,coalesce(p_answer_text,'')) returning * into saved;
  update public.telegram_submission_sessions set consumed_at = now() where token_hash = session.token_hash;
  update public.telegram_submission_contexts set session_hash = null where telegram_id = p_telegram_id;
  return jsonb_build_object('data', to_jsonb(saved), 'duplicate', false);
end;
$$;

create or replace function public.tg_can_review(p_reviewer uuid, p_submission uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.submissions s join public.users participant on participant.id = s.user_id
    join public.tasks t on t.id = s.task_id join public.users reviewer on reviewer.id = p_reviewer
    where s.id = p_submission and reviewer.id <> participant.id and reviewer.team_id = participant.team_id and reviewer.team_id = t.team_id
    and (reviewer.role = 'admin' or (reviewer.role = 'member' and reviewer.can_review and reviewer.id in (select a.id from public.tg_ancestor_ids(participant.id) a)))
  );
$$;

-- Review, score and next program step commit together; competing reviewers cannot overwrite each other.
drop function if exists public.tg_review_submission(uuid,uuid,boolean,text,integer,text);
create or replace function public.tg_review_submission(p_id uuid, p_reviewer uuid, p_ceo boolean, p_status text, p_points integer, p_comment text, p_expected_version integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.submissions%rowtype; task public.tasks%rowtype; next_task public.tasks%rowtype; stamp timestamptz := now(); participant_id uuid;
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
    select * into next_task from public.tasks where program_id = task.program_id and position > task.position and is_active order by position, id limit 1;
    if next_task.id is not null then
      update public.member_program_progress set current_task_id = next_task.id, unlocked_at = stamp,
        due_at = stamp + make_interval(hours => coalesce(next_task.deadline_hours,(select deadline_hours from public.task_programs where id = task.program_id),72)), updated_at = stamp
        where user_id = saved.user_id and program_id = task.program_id and current_task_id = task.id and status = 'active';
    else
      update public.member_program_progress set current_task_id = null, status = 'completed', completed_at = stamp, updated_at = stamp
        where user_id = saved.user_id and program_id = task.program_id and current_task_id = task.id and status = 'active';
    end if;
  end if;
  return jsonb_build_object('data', to_jsonb(saved) || jsonb_build_object('tasks', jsonb_build_object('title',task.title,'max_points',task.max_points)));
end;
$$;

create table if not exists public.telegram_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.users(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete cascade,
  kind text not null check(kind in ('permissions','submission')),
  payload jsonb not null default '{}',
  summary_sent boolean not null default false,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  lock_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  unique(recipient_id,submission_id)
);
create index if not exists telegram_jobs_pending_idx on public.telegram_notification_jobs(available_at,created_at) where delivered_at is null and cancelled_at is null;

create or replace function public.tg_queue_submission(p_id uuid)
returns void language sql security definer set search_path = public as $$
  with answer as materialized (
    select s.id,s.user_id,t.team_id from public.submissions s join public.tasks t on t.id = s.task_id join public.users participant on participant.id = s.user_id
    where s.id = p_id and participant.team_id = t.team_id and s.status = 'pending' and (s.media_type is not null or btrim(s.answer_text) <> '')
  ), chain as materialized (select a.id from public.tg_ancestor_ids((select user_id from answer)) a)
  insert into public.telegram_notification_jobs(recipient_id,submission_id,kind)
    select u.id,s.id,'submission' from answer s join public.users u on u.team_id = s.team_id
    where u.id <> s.user_id and (u.role = 'admin' or (u.role = 'member' and u.can_review and u.id in (select id from chain)))
    on conflict(recipient_id,submission_id) do update set cancelled_at = null, available_at = now(), last_error = null
      where telegram_notification_jobs.cancelled_at is not null and telegram_notification_jobs.delivered_at is null;
$$;
create or replace function public.tg_submission_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.tg_queue_submission(new.id); return new; end;
$$;
drop trigger if exists submissions_telegram_event on public.submissions;
create trigger submissions_telegram_event after insert on public.submissions for each row execute function public.tg_submission_event();

create or replace function public.tg_access_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare review_granted boolean; publish_granted boolean; pending record;
begin
  review_granted := (new.role = 'admin' or new.can_review) and not (old.role = 'admin' or old.can_review);
  publish_granted := (new.role = 'admin' or new.can_publish_tasks) and not (old.role = 'admin' or old.can_publish_tasks);
  if review_granted or publish_granted then
    insert into public.telegram_notification_jobs(recipient_id,kind,payload) values(new.id,'permissions',jsonb_build_object('canReview',review_granted,'canPublishTasks',publish_granted));
  end if;
  -- Backfill pending work on grants, team/parent changes or first Telegram linking.
  -- Re-evaluate the whole team's pending list so new ancestors of a moved branch get it too.
  if new.team_id is not null and (review_granted or new.parent_user_id is distinct from old.parent_user_id or new.team_id is distinct from old.team_id or new.telegram_id is distinct from old.telegram_id) then
    for pending in select s.id from public.submissions s join public.tasks t on t.id = s.task_id where t.team_id = new.team_id and s.status = 'pending' loop
      perform public.tg_queue_submission(pending.id);
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists users_telegram_access_event on public.users;
create trigger users_telegram_access_event after update of role,can_review,can_publish_tasks,parent_user_id,team_id,telegram_id on public.users for each row execute function public.tg_access_event();

create or replace function public.tg_claim_notification()
returns setof public.telegram_notification_jobs language sql security definer set search_path = public as $$
  with candidate as (
    select j.id from public.telegram_notification_jobs j join public.users u on u.id = j.recipient_id
    where j.delivered_at is null and j.cancelled_at is null and j.available_at <= now() and (j.locked_until is null or j.locked_until < now())
      and u.telegram_id is not null
    order by j.created_at,j.id for update of j skip locked limit 1
  ) update public.telegram_notification_jobs j set locked_until = now() + interval '2 minutes', lock_token = gen_random_uuid(), attempts = attempts + 1
    from candidate c where j.id = c.id returning j.*;
$$;

-- This app uses server routes + service_role only. Browser roles must never read tokens,
-- password hashes, private answers, or invoke the privileged RPCs directly.
do $$
declare table_name text; func record;
begin
  foreach table_name in array array['users','teams','tasks','submissions','announcements','star_awards','team_join_requests','team_invitation_links','team_assignment_history','task_programs','member_program_progress','telegram_link_tokens','telegram_contexts','telegram_submission_sessions','telegram_submission_contexts','telegram_notification_jobs'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from anon, authenticated',table_name);
    execute format('grant all on table public.%I to service_role',table_name);
  end loop;
  for func in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'tg\_%' escape '\' or p.proname in ('consume_team_invitation','approve_team_join_request')) loop
    execute format('revoke all on function %s from public, anon, authenticated',func.signature);
    execute format('grant execute on function %s to service_role',func.signature);
  end loop;
end;
$$;
commit;

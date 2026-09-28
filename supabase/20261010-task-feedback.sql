-- Task feedback is an append-only conversation. Only server-side RPCs may read or write it.
begin;

create table public.feedback_threads (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  member_user_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'task' check (kind in ('task', 'personal')),
  task_id uuid references public.tasks(id) on delete set null,
  task_title text not null,
  created_at timestamptz not null default now()
);
create unique index feedback_threads_task_unique on public.feedback_threads(member_user_id, task_id) where task_id is not null;
create index feedback_threads_team_idx on public.feedback_threads(team_id, member_user_id);

create table public.feedback_events (
  seq bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  thread_id uuid not null references public.feedback_threads(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  kind text not null check (kind in ('submission', 'review', 'message')),
  author_user_id uuid references public.users(id) on delete set null,
  author_name text not null,
  body text not null default '' check (char_length(body) <= 10000),
  review_status text check (review_status in ('accepted', 'revision')),
  points integer check (points between 0 and 100),
  review_version integer,
  client_nonce uuid,
  created_at timestamptz not null default now(),
  constraint feedback_event_shape check (
    (kind = 'submission' and review_status is null and client_nonce is null)
    or (kind = 'review' and review_status is not null and review_version is not null and client_nonce is null)
    or (kind = 'message' and char_length(btrim(body)) between 1 and 4000 and review_status is null and client_nonce is not null)
  )
);
create index feedback_events_thread_seq_idx on public.feedback_events(thread_id, seq);
create unique index feedback_events_submission_once on public.feedback_events(submission_id) where kind = 'submission' and submission_id is not null;
create unique index feedback_events_review_once on public.feedback_events(submission_id, review_version) where kind = 'review' and submission_id is not null;
create unique index feedback_events_message_nonce on public.feedback_events(thread_id, client_nonce) where kind = 'message';

create table public.feedback_reads (
  thread_id uuid not null references public.feedback_threads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  last_seen_seq bigint not null default 0,
  primary key(thread_id, user_id)
);

alter table public.feedback_threads enable row level security;
alter table public.feedback_events enable row level security;
alter table public.feedback_reads enable row level security;
revoke all on public.feedback_threads, public.feedback_events, public.feedback_reads from public, anon, authenticated;
grant select, insert, update, delete on public.feedback_threads, public.feedback_events, public.feedback_reads to service_role;
grant usage, select on sequence public.feedback_events_seq_seq to service_role;

create or replace function public.app_feedback_can_access(p_thread uuid, p_actor uuid, p_ceo boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.feedback_threads f
    join public.users member on member.id = f.member_user_id
    where f.id = p_thread and (
      p_ceo and p_actor is null
      or member.id = p_actor
      or exists (
        select 1 from public.users reviewer
        where reviewer.id = p_actor and reviewer.id <> member.id
          and reviewer.team_id = member.team_id and reviewer.team_id = f.team_id
          and (reviewer.role = 'admin' or
            (reviewer.role = 'member' and reviewer.can_review and
              reviewer.id in (select a.id from public.tg_ancestor_ids(member.id) a)))
      )
    )
  );
$$;

-- The legacy submission RPC remains the single authority for points and program progress.
create or replace function public.app_feedback_review_submission(
  p_id uuid, p_reviewer uuid, p_ceo boolean, p_status text, p_points integer,
  p_comment text, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; saved public.submissions%rowtype; thread_id uuid; reviewer_name text;
begin
  select * into saved from public.submissions where id = p_id;
  if saved.id is not null and saved.submission_source = 'interactive' then
    return jsonb_build_object('validationError', 'Эта игра засчитывается автоматически.');
  end if;
  if p_status = 'revision' and char_length(btrim(coalesce(p_comment, ''))) = 0 then
    return jsonb_build_object('validationError', 'Напишите участнику, что нужно исправить.');
  end if;
  result := public.tg_review_submission(p_id, p_reviewer, p_ceo, p_status, p_points, p_comment, p_expected_version);
  if not (result ? 'data') then return result; end if;
  select * into saved from public.submissions where id = p_id;
  select id into thread_id from public.feedback_threads where member_user_id = saved.user_id and task_id = saved.task_id;
  if thread_id is null then
    -- Covers legacy submissions predating the backfill, including those created during migration.
    insert into public.feedback_threads(team_id, member_user_id, task_id, task_title)
      select t.team_id, saved.user_id, t.id, t.title from public.tasks t where t.id = saved.task_id
      on conflict (member_user_id, task_id) where task_id is not null do update set task_title = excluded.task_title
      returning id into thread_id;
  end if;
  select name into reviewer_name from public.users where id = p_reviewer;
  insert into public.feedback_events(thread_id, submission_id, kind, author_user_id, author_name, body, review_status, points, review_version)
    values(thread_id, p_id, 'review', p_reviewer, coalesce(reviewer_name, 'Главный наставник'), btrim(coalesce(p_comment, '')),
      p_status, saved.points, saved.review_version);
  return result;
end;
$$;

create or replace function public.app_feedback_submission_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare thread_id uuid; task_record public.tasks%rowtype; member_name text;
begin
  if new.submission_source = 'interactive' or (new.media_type is null and btrim(new.answer_text) = '') then return new; end if;
  select * into task_record from public.tasks where id = new.task_id;
  if task_record.team_id is null then return new; end if;
  select name into member_name from public.users where id = new.user_id;
  insert into public.feedback_threads(team_id, member_user_id, task_id, task_title)
    values(task_record.team_id, new.user_id, new.task_id, task_record.title)
    on conflict (member_user_id, task_id) where task_id is not null do update set task_title = excluded.task_title
    returning id into thread_id;
  insert into public.feedback_events(thread_id, submission_id, kind, author_user_id, author_name, body, created_at)
    values(thread_id, new.id, 'submission', new.user_id, coalesce(member_name, 'Участник'),
      case when new.media_type = 'text' then new.answer_text else coalesce(nullif(new.answer_text, ''), 'Ответ отправлен в Telegram') end,
      new.submitted_at)
    on conflict do nothing;
  return new;
end;
$$;
create trigger submissions_feedback_event after insert on public.submissions
  for each row execute function public.app_feedback_submission_event();

-- Existing participants must not receive a new notification for old work.
insert into public.feedback_threads(team_id, member_user_id, task_id, task_title, created_at)
  select t.team_id, s.user_id, t.id, t.title, min(s.submitted_at)
  from public.submissions s join public.tasks t on t.id = s.task_id
  where t.team_id is not null and s.submission_source <> 'interactive' and (s.media_type is not null or btrim(s.answer_text) <> '')
  group by t.team_id, s.user_id, t.id, t.title
  on conflict (member_user_id, task_id) where task_id is not null do nothing;
insert into public.feedback_events(thread_id, submission_id, kind, author_user_id, author_name, body, created_at)
  select f.id, s.id, 'submission', s.user_id, u.name,
    case when s.media_type = 'text' then s.answer_text else coalesce(nullif(s.answer_text, ''), 'Ответ отправлен в Telegram') end,
    s.submitted_at
  from public.submissions s join public.feedback_threads f on f.task_id = s.task_id and f.member_user_id = s.user_id
  join public.users u on u.id = s.user_id
  where s.submission_source <> 'interactive' and (s.media_type is not null or btrim(s.answer_text) <> '')
  on conflict do nothing;
insert into public.feedback_events(thread_id, submission_id, kind, author_name, body, review_status, points, review_version, created_at)
  select f.id, s.id, 'review', 'Наставник', s.comment, s.status::text, s.points, s.review_version, coalesce(s.reviewed_at, s.submitted_at)
  from public.submissions s join public.feedback_threads f on f.task_id = s.task_id and f.member_user_id = s.user_id
  where s.submission_source <> 'interactive' and s.status in ('accepted', 'revision')
  on conflict do nothing;

create or replace function public.app_feedback_list(p_actor uuid, p_ceo boolean default false, p_limit integer default 50,
  p_offset integer default 0, p_only_reply boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'lastAt' desc, (row_data->>'lastSeq')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', f.id, 'taskId', f.task_id, 'taskTitle', f.task_title,
      'memberId', f.member_user_id, 'memberName', member.name, 'lastAt', latest.created_at,
      'lastKind', latest.kind, 'lastBody', left(latest.body, 180),
      'needsReply', latest.kind = 'message' and latest.author_user_id = f.member_user_id,
      'unread', latest.seq > coalesce(r.last_seen_seq, 0) and latest.author_user_id is distinct from p_actor,
      'lastSeq', latest.seq) as row_data
    from public.feedback_threads f join public.users member on member.id = f.member_user_id
    join lateral (select e.* from public.feedback_events e where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where public.app_feedback_can_access(f.id, p_actor, p_ceo)
      and (not p_only_reply or (latest.kind = 'message' and latest.author_user_id = f.member_user_id))
    order by latest.created_at desc, latest.seq desc limit least(greatest(p_limit, 1), 100)
      offset least(greatest(p_offset, 0), 10000)
  ) rows;
$$;

create or replace function public.app_feedback_detail(p_thread uuid, p_actor uuid, p_ceo boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.app_feedback_can_access(p_thread, p_actor, p_ceo) then return jsonb_build_object('forbidden', true); end if;
  select jsonb_build_object('id', f.id, 'taskId', f.task_id, 'taskTitle', f.task_title,
    'memberId', f.member_user_id, 'memberName', u.name,
    'events', coalesce((select jsonb_agg(jsonb_build_object('seq', e.seq, 'id', e.id, 'kind', e.kind,
      'submissionId', e.submission_id, 'authorId', e.author_user_id, 'authorName', e.author_name,
      'body', e.body, 'reviewStatus', e.review_status, 'points', e.points, 'createdAt', e.created_at)
      order by e.seq) from public.feedback_events e where e.thread_id = f.id), '[]'::jsonb))
    into result from public.feedback_threads f join public.users u on u.id = f.member_user_id where f.id = p_thread;
  return result;
end;
$$;

create or replace function public.app_feedback_counts(p_actor uuid, p_ceo boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('unread', count(*) filter (where latest.seq > coalesce(r.last_seen_seq, 0)
    and latest.author_user_id is distinct from p_actor),
    'needsReply', count(*) filter (where latest.kind = 'message' and latest.author_user_id = f.member_user_id))
  from public.feedback_threads f
  join lateral (select e.seq, e.kind, e.author_user_id from public.feedback_events e
    where e.thread_id = f.id order by e.seq desc limit 1) latest on true
  left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
  where public.app_feedback_can_access(f.id, p_actor, p_ceo);
$$;

create or replace function public.app_feedback_send(p_thread uuid, p_actor uuid, p_ceo boolean, p_body text, p_nonce uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare thread_record public.feedback_threads%rowtype; seq_id bigint; actor_name text;
begin
  if p_nonce is null or char_length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then
    return jsonb_build_object('validationError', 'Сообщение должно содержать от 1 до 4000 символов.');
  end if;
  select * into thread_record from public.feedback_threads where id = p_thread for update;
  if not found or not public.app_feedback_can_access(p_thread, p_actor, p_ceo) then return jsonb_build_object('forbidden', true); end if;
  select name into actor_name from public.users where id = p_actor;
  insert into public.feedback_events(thread_id, kind, author_user_id, author_name, body, client_nonce)
    values(p_thread, 'message', p_actor, coalesce(actor_name, 'Главный наставник'), btrim(p_body), p_nonce)
    on conflict (thread_id, client_nonce) where kind = 'message' do nothing returning seq into seq_id;
  if seq_id is null then
    select seq into seq_id from public.feedback_events where thread_id = p_thread and client_nonce = p_nonce and author_user_id is not distinct from p_actor;
  end if;
  return jsonb_build_object('seq', seq_id);
end;
$$;

create or replace function public.app_feedback_mark_read(p_thread uuid, p_actor uuid, p_ceo boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare last_seq bigint;
begin
  if p_actor is null or not public.app_feedback_can_access(p_thread, p_actor, p_ceo) then return false; end if;
  select coalesce(max(seq), 0) into last_seq from public.feedback_events where thread_id = p_thread;
  insert into public.feedback_reads(thread_id, user_id, last_seen_seq) values(p_thread, p_actor, last_seq)
    on conflict (thread_id, user_id) do update set last_seen_seq = greatest(public.feedback_reads.last_seen_seq, excluded.last_seen_seq);
  return true;
end;
$$;

-- Queue generic Telegram notices only for NEW review/message events; never send private text.
alter table public.telegram_notification_jobs add column feedback_event_seq bigint references public.feedback_events(seq) on delete cascade;
create unique index telegram_jobs_feedback_event_unique on public.telegram_notification_jobs(recipient_id, feedback_event_seq) where feedback_event_seq is not null;
alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check
  check(kind in ('permissions','submission','survey','company-voice','captain-screenshot','feedback'));

create or replace function public.app_feedback_event_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare thread_record public.feedback_threads%rowtype;
begin
  select * into thread_record from public.feedback_threads where id = new.thread_id;
  if new.kind in ('review', 'message') then
    if new.author_user_id is distinct from thread_record.member_user_id then
      insert into public.telegram_notification_jobs(recipient_id, kind, feedback_event_seq)
        values(thread_record.member_user_id, 'feedback', new.seq) on conflict do nothing;
    else
      insert into public.telegram_notification_jobs(recipient_id, kind, feedback_event_seq)
        select u.id, 'feedback', new.seq from public.users u
        where u.id <> thread_record.member_user_id and u.team_id = thread_record.team_id
          and (u.role = 'admin' or (u.can_review and u.id in (select a.id from public.tg_ancestor_ids(thread_record.member_user_id) a)))
        on conflict do nothing;
    end if;
  end if;
  begin
    perform realtime.send(jsonb_build_object('topics', array['feedback'], 'teamIds', array[thread_record.team_id::text],
      'userIds', array[thread_record.member_user_id::text]), 'changed', 'prokachka:changes', true);
  exception when others then
    raise log 'Feedback realtime notification unavailable: SQLSTATE %', sqlstate;
  end;
  return new;
end;
$$;
create trigger feedback_event_notify after insert on public.feedback_events
  for each row execute function public.app_feedback_event_notify();

do $$ declare name text; signature text; begin
  foreach signature in array array[
    'app_feedback_can_access(uuid,uuid,boolean)', 'app_feedback_review_submission(uuid,uuid,boolean,text,integer,text,integer)',
    'app_feedback_list(uuid,boolean,integer,integer,boolean)', 'app_feedback_detail(uuid,uuid,boolean)',
    'app_feedback_counts(uuid,boolean)',
    'app_feedback_send(uuid,uuid,boolean,text,uuid)', 'app_feedback_mark_read(uuid,uuid,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', signature);
    execute format('grant execute on function public.%s to service_role', signature);
  end loop;
end $$;
revoke all on function public.app_feedback_submission_event(), public.app_feedback_event_notify() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;

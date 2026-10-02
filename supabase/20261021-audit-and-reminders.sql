-- CEO action journal, mentor Telegram broadcasts (task nudges, announcements) and automatic
-- "start your first task" reminders. Apply once to an existing database; bootstrap.sql includes it.
begin;

-- 1. Action journal. Append-only: the server can add and read rows, never change or erase them.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references public.users(id) on delete set null,
  actor_name text not null check (char_length(actor_name) between 1 and 200),
  actor_role text not null check (actor_role in ('ceo','admin','member')),
  action text not null check (action ~ '^[a-z]+\.[a-z]+$' and char_length(action) <= 60),
  target_id text check (char_length(target_id) <= 100),
  target_label text check (char_length(target_label) <= 300),
  team_id uuid references public.teams(id) on delete set null,
  team_label text check (char_length(team_label) <= 200),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 4000)
);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to service_role;

-- The team name is copied so the entry stays readable after the team is renamed or deleted.
create or replace function public.app_record_audit(p_actor_id uuid, p_actor_name text, p_actor_role text, p_action text,
  p_target_id text, p_target_label text, p_team_id uuid, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(actor_id, actor_name, actor_role, action, target_id, target_label, team_id, team_label, details)
  values ((select id from public.users where id = p_actor_id), left(coalesce(nullif(btrim(p_actor_name), ''), 'Без имени'), 200),
    p_actor_role, p_action, left(p_target_id, 100), left(p_target_label, 300),
    (select id from public.teams where id = p_team_id), (select left(name, 200) from public.teams where id = p_team_id),
    coalesce(p_details, '{}'));
$$;

-- 2. New Telegram notification kinds.
alter table public.telegram_notification_jobs drop constraint if exists telegram_notification_jobs_kind_check;
alter table public.telegram_notification_jobs add constraint telegram_notification_jobs_kind_check
  check(kind in ('permissions','submission','survey','company-voice','captain-screenshot','feedback','task-reminder',
    'task-nudge','announcement','start-reminder'));

-- Personal notifications (new work to review, feedback) go before mass mailings,
-- so a broadcast to the whole team never delays a mentor's review queue.
create or replace function public.tg_claim_notification()
returns setof public.telegram_notification_jobs language sql security definer set search_path = public as $$
  with candidate as (
    select j.id from public.telegram_notification_jobs j join public.users u on u.id = j.recipient_id
    where j.delivered_at is null and j.cancelled_at is null and j.available_at <= now() and (j.locked_until is null or j.locked_until < now())
      and u.telegram_id is not null
    order by (j.kind in ('task-nudge','announcement','start-reminder')), j.created_at, j.id for update of j skip locked limit 1
  ) update public.telegram_notification_jobs j set locked_until = now() + interval '2 minutes', lock_token = gen_random_uuid(), attempts = attempts + 1
    from candidate c where j.id = c.id returning j.*;
$$;

-- 3. "Remind those who have not sent": a mentor nudges participants who never answered a task.
create table if not exists public.task_nudges (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  sent_by uuid references public.users(id) on delete set null,
  recipients integer not null check (recipients >= 0),
  created_at timestamptz not null default now()
);
create index if not exists task_nudges_task_idx on public.task_nudges(task_id, created_at desc);
alter table public.task_nudges enable row level security;
revoke all on public.task_nudges from public, anon, authenticated;
grant select on public.task_nudges to service_role;

-- True while the participant can still send the task and has never sent anything for it.
create or replace function public.app_task_nudge_due(p_user uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.tg_target_error(p_user, p_task) is null
    and not exists (select 1 from public.submissions s where s.user_id = p_user and s.task_id = p_task);
$$;

-- The team leader nudges the whole team; a member-reviewer or publisher only their own branch.
create or replace function public.app_task_nudge_targets(p_actor uuid, p_task uuid)
returns table(user_id uuid, has_telegram boolean) language sql stable security definer set search_path = public as $$
  select u.id, u.telegram_id is not null
  from public.tasks t
  join public.users actor on actor.id = p_actor and actor.team_id = t.team_id
  join public.users u on u.team_id = t.team_id and u.role = 'member' and u.id <> actor.id
  where t.id = p_task and t.publication_type is distinct from 'sequential'
    and (actor.role = 'admin' or (actor.role = 'member' and (actor.can_review or actor.can_publish_tasks)
      and exists (select 1 from public.tg_ancestor_ids(u.id) a where a.id = actor.id)))
    and public.app_task_nudge_due(u.id, t.id);
$$;

-- p_send = false only previews the numbers. One nudge per task every 12 hours, whoever sends it.
create or replace function public.app_task_nudge(p_actor uuid, p_task uuid, p_send boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.users%rowtype; task public.tasks%rowtype; last_sent timestamptz; reachable integer; unreachable integer; queued integer := 0;
begin
  select * into actor from public.users where id = p_actor;
  select * into task from public.tasks where id = p_task;
  if actor.id is null or task.id is null or actor.team_id is distinct from task.team_id
    or not (actor.role = 'admin' or (actor.role = 'member' and (actor.can_review or actor.can_publish_tasks))) then
    return jsonb_build_object('forbidden', true);
  end if;
  -- Two mentors pressing the button at the same moment send one nudge.
  if p_send then perform pg_advisory_xact_lock(hashtext('task-nudge:' || p_task::text)); end if;
  select max(created_at) into last_sent from public.task_nudges where task_id = p_task;
  select count(*) filter (where has_telegram), count(*) filter (where not has_telegram) into reachable, unreachable
    from public.app_task_nudge_targets(p_actor, p_task);
  if p_send then
    if last_sent > now() - interval '12 hours' then
      return jsonb_build_object('validationError', 'По этому заданию уже напоминали. Повторить можно через 12 часов после прошлого напоминания.');
    end if;
    if reachable = 0 then return jsonb_build_object('validationError', 'Некому отправить: у тех, кто не сдал, не подключён Telegram.'); end if;
    insert into public.telegram_notification_jobs(recipient_id, kind, payload)
      select user_id, 'task-nudge', jsonb_build_object('taskId', p_task) from public.app_task_nudge_targets(p_actor, p_task) where has_telegram;
    get diagnostics queued = row_count;
    insert into public.task_nudges(task_id, sent_by, recipients) values (p_task, p_actor, queued);
    last_sent := now();
  end if;
  return jsonb_build_object('data', jsonb_build_object('reachable', reachable, 'unreachable', unreachable, 'queued', queued,
    'lastSentAt', last_sent, 'nextAllowedAt', last_sent + interval '12 hours'));
end $$;

-- 4. "Send to participants in Telegram" when an announcement is published.
create or replace function public.app_announcement_recipient_ok(p_user uuid, p_announcement uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.announcements a join public.users u on u.id = p_user
    where a.id = p_announcement and a.is_active and u.role = 'member' and u.team_id = a.team_id and u.id is distinct from a.author_id
      and exists (select 1 from public.teams t where t.id = a.team_id and t.is_active)
      and (a.audience_root_id is null or exists (select 1 from public.tg_ancestor_ids(u.id) x where x.id = a.audience_root_id))
  );
$$;

-- Only the author, once per announcement, and only to the audience that sees it on the site.
create or replace function public.app_queue_announcement(p_actor uuid, p_announcement uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare queued integer;
begin
  if not exists (select 1 from public.announcements where id = p_announcement and author_id = p_actor and is_active) then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('announcement:' || p_announcement::text));
  if exists (select 1 from public.telegram_notification_jobs where kind = 'announcement' and payload->>'announcementId' = p_announcement::text) then return 0; end if;
  insert into public.telegram_notification_jobs(recipient_id, kind, payload)
    select u.id, 'announcement', jsonb_build_object('announcementId', p_announcement) from public.users u
    where u.telegram_id is not null and public.app_announcement_recipient_ok(u.id, p_announcement);
  get diagnostics queued = row_count;
  return queued;
end $$;

-- 5. Participants who joined a team but have not sent a single answer get up to three gentle reminders:
-- a day, three days and a week after joining, never twice within two days.
-- The delivery worker calls the queue only in the Almaty daytime, so nobody is woken up at night.
create table if not exists public.member_start_reminders (
  user_id uuid primary key references public.users(id) on delete cascade,
  sent_count smallint not null check (sent_count between 1 and 3),
  last_sent_at timestamptz not null
);
alter table public.member_start_reminders enable row level security;
revoke all on public.member_start_reminders from public, anon, authenticated;
grant select on public.member_start_reminders to service_role;

create or replace function public.app_start_reminder_due(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u join public.teams t on t.id = u.team_id and t.is_active
    where u.id = p_user and u.role = 'member'
      and exists (select 1 from public.tasks k where k.team_id = u.team_id and k.is_active)
      and not exists (select 1 from public.submissions s where s.user_id = u.id)
  );
$$;

create or replace function public.app_queue_start_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare queued integer;
begin
  -- One queueing run at a time; a parallel worker simply skips this minute.
  if not pg_try_advisory_xact_lock(hashtext('start-reminders')) then return 0; end if;
  with candidates as (
    select u.id, greatest(coalesce(u.team_joined_at, u.created_at), u.welcome_video_completed_at) as started,
      coalesce(r.sent_count, 0) as sent, r.last_sent_at
    from public.users u left join public.member_start_reminders r on r.user_id = u.id
    where u.role = 'member' and u.team_id is not null and u.telegram_id is not null and coalesce(r.sent_count, 0) < 3
  ), due as (
    -- People who joined long ago are not chased: only the first three weeks count.
    select id, sent from candidates
    where started > now() - interval '21 days'
      and started <= now() - case sent when 0 then interval '1 day' when 1 then interval '3 days' else interval '7 days' end
      and (last_sent_at is null or last_sent_at <= now() - interval '2 days')
      and public.app_start_reminder_due(id)
    order by started limit 100
  ), marked as (
    insert into public.member_start_reminders(user_id, sent_count, last_sent_at) select id, sent + 1, now() from due
    on conflict (user_id) do update set sent_count = excluded.sent_count, last_sent_at = excluded.last_sent_at
    returning user_id, sent_count
  )
  insert into public.telegram_notification_jobs(recipient_id, kind, payload)
    select user_id, 'start-reminder', jsonb_build_object('step', sent_count) from marked;
  get diagnostics queued = row_count;
  return queued;
end $$;

revoke all on function public.app_record_audit(uuid,text,text,text,text,text,uuid,jsonb), public.tg_claim_notification(),
  public.app_task_nudge_due(uuid,uuid), public.app_task_nudge_targets(uuid,uuid), public.app_task_nudge(uuid,uuid,boolean),
  public.app_announcement_recipient_ok(uuid,uuid), public.app_queue_announcement(uuid,uuid),
  public.app_start_reminder_due(uuid), public.app_queue_start_reminders() from public, anon, authenticated;
grant execute on function public.app_record_audit(uuid,text,text,text,text,text,uuid,jsonb), public.tg_claim_notification(),
  public.app_task_nudge_due(uuid,uuid), public.app_task_nudge_targets(uuid,uuid), public.app_task_nudge(uuid,uuid,boolean),
  public.app_announcement_recipient_ok(uuid,uuid), public.app_queue_announcement(uuid,uuid),
  public.app_start_reminder_due(uuid), public.app_queue_start_reminders() to service_role;
notify pgrst, 'reload schema';
commit;

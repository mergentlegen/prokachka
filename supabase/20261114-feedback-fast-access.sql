-- Mentor feedback lists were slow: the right to see a conversation was checked once per conversation
-- (app_feedback_scope_access → app_feedback_can_access → tg_ancestor_ids), ~0.6 ms × every thread in the table.
-- Now the visible conversations are found once per request: the reader's row, one walk down their branch,
-- one join. The rules are the same as in app_feedback_scope_access; tests/feedback-fast-access.sql compares
-- both for every user. Opening, sending, «Прочитано» and «Ответ не нужен» check one conversation and keep
-- the old function. Re-running this file is safe.
begin;

create or replace function public.app_feedback_scope_threads(p_actor uuid, p_ceo boolean, p_scope text)
returns setof uuid language sql stable security definer set search_path = public as $$
  with recursive me as (
    select u.id, u.role, u.team_id, coalesce(u.can_review, false) as can_review
    from public.users u where u.id = p_actor
  ), branch(id) as (
    -- Everyone below a reviewing member, never leaving the team (the mirror of tg_ancestor_ids).
    select u.id from me join public.users u on u.parent_user_id = me.id and u.team_id = me.team_id
    where me.role = 'member' and me.can_review
    union
    select u.id from branch b cross join me
    join public.users u on u.parent_user_id = b.id and u.team_id = me.team_id
  )
  select f.id from public.feedback_threads f
  where p_scope = 'personal' and f.member_user_id = p_actor
  union all
  -- The CEO panel has no account of its own and reads every team.
  select f.id from public.feedback_threads f join public.users member on member.id = f.member_user_id
  where p_scope = 'mentor' and p_ceo and p_actor is null
  union all
  select f.id from me
  join public.feedback_threads f on f.team_id = me.team_id and f.member_user_id <> me.id
  join public.users member on member.id = f.member_user_id and member.team_id = me.team_id
  where p_scope = 'mentor'
    and (me.role = 'admin' or (me.role = 'member' and me.can_review and member.id in (select b.id from branch b)));
$$;

create or replace function public.app_feedback_list_scoped(p_actor uuid, p_ceo boolean, p_scope text,
  p_limit integer default 50, p_offset integer default 0, p_only_reply boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'lastAt' desc, (row_data->>'lastSeq')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', f.id, 'taskId', f.task_id, 'taskTitle', f.task_title,
      'memberId', f.member_user_id, 'memberName', member.name, 'avatar_path', member.avatar_path, 'lastAt', latest.created_at,
      'lastKind', latest.kind, 'lastBody', left(latest.body, 180),
      'needsReply', public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq),
      'unread', latest.seq > coalesce(r.last_seen_seq, 0) and latest.author_user_id is distinct from p_actor,
      'lastSeq', latest.seq) as row_data
    from public.app_feedback_scope_threads(p_actor, p_ceo, p_scope) visible(id)
    join public.feedback_threads f on f.id = visible.id
    join public.users member on member.id = f.member_user_id
    join lateral (select e.* from public.feedback_events e where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where not p_only_reply or public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq)
    order by latest.created_at desc, latest.seq desc limit least(greatest(p_limit, 1), 100)
      offset least(greatest(p_offset, 0), 10000)
  ) rows;
$$;

create or replace function public.app_feedback_counts_scoped(p_actor uuid, p_ceo boolean, p_scope text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('unread', count(*) filter (where latest.seq > coalesce(r.last_seen_seq, 0)
    and latest.author_user_id is distinct from p_actor),
    'needsReply', count(*) filter (where public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq)))
  from public.app_feedback_scope_threads(p_actor, p_ceo, p_scope) visible(id)
  join public.feedback_threads f on f.id = visible.id
  join lateral (select e.seq, e.kind, e.author_user_id from public.feedback_events e
    where e.thread_id = f.id order by e.seq desc limit 1) latest on true
  left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor;
$$;

create or replace function public.app_feedback_task_groups(p_actor uuid, p_ceo boolean,
  p_limit integer default 50, p_offset integer default 0, p_only_reply boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with eligible as (
    select coalesce(f.task_id, f.id) as task_key, f.task_title, latest.created_at, latest.seq,
      public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq) as needs_reply,
      latest.seq > coalesce(r.last_seen_seq, 0) and latest.author_user_id is distinct from p_actor as unread
    from public.app_feedback_scope_threads(p_actor, p_ceo, 'mentor') visible(id)
    join public.feedback_threads f on f.id = visible.id
    join lateral (select e.seq, e.kind, e.author_user_id, e.created_at from public.feedback_events e
      where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
  ), grouped as (
    select task_key, max(task_title) as title, count(*) as participants,
      count(*) filter (where needs_reply) as needs_reply,
      count(*) filter (where unread) as unread,
      max(created_at) as last_at, max(seq) as last_seq
    from eligible where not p_only_reply or needs_reply
    group by task_key
    order by last_at desc, last_seq desc
    limit least(greatest(p_limit, 1), 100) offset least(greatest(p_offset, 0), 10000)
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', task_key, 'title', title,
    'participants', participants, 'needsReply', needs_reply, 'unread', unread, 'lastAt', last_at)
    order by last_at desc, last_seq desc), '[]'::jsonb) from grouped;
$$;

create or replace function public.app_feedback_list_task(p_actor uuid, p_ceo boolean, p_task_key uuid,
  p_limit integer default 50, p_offset integer default 0, p_only_reply boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'lastAt' desc, (row_data->>'lastSeq')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', f.id, 'taskId', f.task_id, 'taskTitle', f.task_title,
      'memberId', f.member_user_id, 'memberName', member.name, 'avatar_path', member.avatar_path, 'lastAt', latest.created_at,
      'lastKind', latest.kind, 'lastBody', left(latest.body, 180),
      'needsReply', public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq),
      'unread', latest.seq > coalesce(r.last_seen_seq, 0) and latest.author_user_id is distinct from p_actor,
      'lastSeq', latest.seq) as row_data
    from public.app_feedback_scope_threads(p_actor, p_ceo, 'mentor') visible(id)
    join public.feedback_threads f on f.id = visible.id
    join public.users member on member.id = f.member_user_id
    join lateral (select e.* from public.feedback_events e where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where coalesce(f.task_id, f.id) = p_task_key
      and (not p_only_reply or public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq))
    order by latest.created_at desc, latest.seq desc
    limit least(greatest(p_limit, 1), 100) offset least(greatest(p_offset, 0), 10000)
  ) rows;
$$;

create or replace function public.app_feedback_mentor_threads(p_actor uuid, p_ceo boolean, p_query text default '',
  p_only_reply boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  with found as (
    select f.id, f.task_id, f.task_title, f.member_user_id, member.name, member.avatar_path,
      latest.created_at, latest.kind, latest.body, latest.seq,
      public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq) as needs_reply,
      latest.seq > coalesce(r.last_seen_seq, 0) and latest.author_user_id is distinct from p_actor as unread,
      f.reply_dismissed_seq
    from public.app_feedback_scope_threads(p_actor, p_ceo, 'mentor') visible(id)
    join public.feedback_threads f on f.id = visible.id
    join public.users member on member.id = f.member_user_id
    join lateral (select e.* from public.feedback_events e where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where btrim(coalesce(p_query, '')) = '' or strpos(lower(member.name collate "und-x-icu"), lower(btrim(p_query) collate "und-x-icu")) > 0
  ), timed as (
    select found.*, case when needs_reply then coalesce((
        select min(e.created_at) from public.feedback_events e
        where e.thread_id = found.id and e.kind = 'message' and e.author_user_id = found.member_user_id
          and e.seq > greatest(coalesce(found.reply_dismissed_seq, 0), coalesce((select max(o.seq) from public.feedback_events o
            where o.thread_id = found.id and o.author_user_id is distinct from found.member_user_id), 0))
      ), found.created_at) end as waiting_since
    from found where not p_only_reply or needs_reply
  ), picked as (
    select * from timed
    order by case when p_only_reply then waiting_since end asc, created_at desc, seq desc
    limit least(greatest(p_limit, 1), 100) offset least(greatest(p_offset, 0), 10000)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'taskId', task_id, 'taskTitle', task_title,
    'memberId', member_user_id, 'memberName', name, 'avatar_path', avatar_path, 'lastAt', created_at,
    'lastKind', kind, 'lastBody', left(body, 180), 'needsReply', needs_reply, 'unread', unread, 'lastSeq', seq,
    'waitingSince', waiting_since)
    order by case when p_only_reply then waiting_since end asc, created_at desc, seq desc), '[]'::jsonb)
  from picked;
$$;

revoke all on function public.app_feedback_scope_threads(uuid,boolean,text),
  public.app_feedback_mentor_threads(uuid,boolean,text,boolean,integer,integer),
  public.app_feedback_list_scoped(uuid,boolean,text,integer,integer,boolean),
  public.app_feedback_counts_scoped(uuid,boolean,text),
  public.app_feedback_task_groups(uuid,boolean,integer,integer,boolean),
  public.app_feedback_list_task(uuid,boolean,uuid,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.app_feedback_scope_threads(uuid,boolean,text),
  public.app_feedback_mentor_threads(uuid,boolean,text,boolean,integer,integer),
  public.app_feedback_list_scoped(uuid,boolean,text,integer,integer,boolean),
  public.app_feedback_counts_scoped(uuid,boolean,text),
  public.app_feedback_task_groups(uuid,boolean,integer,integer,boolean),
  public.app_feedback_list_task(uuid,boolean,uuid,integer,integer,boolean) to service_role;
notify pgrst, 'reload schema';
commit;

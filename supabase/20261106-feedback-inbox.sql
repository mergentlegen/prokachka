-- Feedback inbox for mentors: «Ответ не нужен», «Ждут ответа» across all tasks, participant search,
-- photos in the lists and «Прочитано» under the mentor's message. Re-running it is safe.
begin;

-- The last event a mentor marked as needing no answer; a newer participant message asks again.
alter table public.feedback_threads add column if not exists reply_dismissed_seq bigint;

create or replace function public.app_feedback_needs_reply(p_kind text, p_author uuid, p_member uuid, p_seq bigint, p_dismissed bigint)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_kind = 'message' and p_author = p_member and p_seq > coalesce(p_dismissed, 0), false);
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
    from public.feedback_threads f join public.users member on member.id = f.member_user_id
    join lateral (select e.* from public.feedback_events e where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where public.app_feedback_scope_access(f.id, p_actor, p_ceo, p_scope)
      and (not p_only_reply or public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq))
    order by latest.created_at desc, latest.seq desc limit least(greatest(p_limit, 1), 100)
      offset least(greatest(p_offset, 0), 10000)
  ) rows;
$$;

create or replace function public.app_feedback_counts_scoped(p_actor uuid, p_ceo boolean, p_scope text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('unread', count(*) filter (where latest.seq > coalesce(r.last_seen_seq, 0)
    and latest.author_user_id is distinct from p_actor),
    'needsReply', count(*) filter (where public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq)))
  from public.feedback_threads f
  join lateral (select e.seq, e.kind, e.author_user_id from public.feedback_events e
    where e.thread_id = f.id order by e.seq desc limit 1) latest on true
  left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
  where public.app_feedback_scope_access(f.id, p_actor, p_ceo, p_scope);
$$;

create or replace function public.app_feedback_task_groups(p_actor uuid, p_ceo boolean,
  p_limit integer default 50, p_offset integer default 0, p_only_reply boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with eligible as (
    select coalesce(f.task_id, f.id) as task_key, f.task_title, latest.created_at, latest.seq,
      public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq) as needs_reply,
      latest.seq > coalesce(r.last_seen_seq, 0) and latest.author_user_id is distinct from p_actor as unread
    from public.feedback_threads f
    join lateral (select e.seq, e.kind, e.author_user_id, e.created_at from public.feedback_events e
      where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where public.app_feedback_scope_access(f.id, p_actor, p_ceo, 'mentor')
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
    from public.feedback_threads f join public.users member on member.id = f.member_user_id
    join lateral (select e.* from public.feedback_events e where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where coalesce(f.task_id, f.id) = p_task_key
      and public.app_feedback_scope_access(f.id, p_actor, p_ceo, 'mentor')
      and (not p_only_reply or public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq))
    order by latest.created_at desc, latest.seq desc
    limit least(greatest(p_limit, 1), 100) offset least(greatest(p_offset, 0), 10000)
  ) rows;
$$;

-- One list across all tasks. «Ждут ответа» puts the longest wait first; a name search finds a participant anywhere.
create or replace function public.app_feedback_mentor_threads(p_actor uuid, p_ceo boolean, p_query text default '',
  p_only_reply boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  with found as (
    select f.id, f.task_id, f.task_title, f.member_user_id, member.name, member.avatar_path,
      latest.created_at, latest.kind, latest.body, latest.seq,
      public.app_feedback_needs_reply(latest.kind, latest.author_user_id, f.member_user_id, latest.seq, f.reply_dismissed_seq) as needs_reply,
      latest.seq > coalesce(r.last_seen_seq, 0) and latest.author_user_id is distinct from p_actor as unread,
      f.reply_dismissed_seq
    from public.feedback_threads f join public.users member on member.id = f.member_user_id
    join lateral (select e.* from public.feedback_events e where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where public.app_feedback_scope_access(f.id, p_actor, p_ceo, 'mentor')
      and (btrim(coalesce(p_query, '')) = '' or strpos(lower(member.name collate "und-x-icu"), lower(btrim(p_query) collate "und-x-icu")) > 0)
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

-- The conversation, plus who took part (for photos), whether it waits for an answer
-- and, for mentors, how far the participant has read.
create or replace function public.app_feedback_detail_scoped(p_thread uuid, p_actor uuid, p_ceo boolean, p_scope text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; thread_record public.feedback_threads%rowtype; latest public.feedback_events%rowtype;
begin
  if not public.app_feedback_scope_access(p_thread, p_actor, p_ceo, p_scope) then
    return jsonb_build_object('forbidden', true);
  end if;
  result := public.app_feedback_detail(p_thread, p_actor, p_ceo);
  if result ? 'forbidden' then return result; end if;
  select * into thread_record from public.feedback_threads where id = p_thread;
  select * into latest from public.feedback_events where thread_id = p_thread order by seq desc limit 1;
  result := result || jsonb_build_object(
    'needsReply', public.app_feedback_needs_reply(latest.kind, latest.author_user_id, thread_record.member_user_id, latest.seq, thread_record.reply_dismissed_seq),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'avatar_path', u.avatar_path))
      from public.users u where u.id = thread_record.member_user_id
        or u.id in (select e.author_user_id from public.feedback_events e where e.thread_id = p_thread)), '[]'::jsonb));
  if p_scope = 'mentor' then
    result := result || jsonb_build_object('memberSeenSeq', coalesce((select r.last_seen_seq from public.feedback_reads r
      where r.thread_id = p_thread and r.user_id = thread_record.member_user_id), 0));
  end if;
  return result;
end;
$$;

-- «Ответ не нужен»: the conversation leaves the waiting list until the participant writes again.
create or replace function public.app_feedback_dismiss_reply(p_thread uuid, p_actor uuid, p_ceo boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare last_seq bigint; thread_record public.feedback_threads%rowtype;
begin
  if not public.app_feedback_scope_access(p_thread, p_actor, p_ceo, 'mentor') then return false; end if;
  select coalesce(max(seq), 0) into last_seq from public.feedback_events where thread_id = p_thread;
  update public.feedback_threads set reply_dismissed_seq = greatest(coalesce(reply_dismissed_seq, 0), last_seq)
    where id = p_thread returning * into thread_record;
  if p_actor is not null then perform public.app_feedback_mark_read(p_thread, p_actor, p_ceo); end if;
  begin
    perform realtime.send(jsonb_build_object('topics', array['feedback'], 'teamIds', array[thread_record.team_id::text],
      'userIds', array[]::text[]), 'changed', 'prokachka:changes', true);
  exception when others then
    raise log 'Feedback realtime notification unavailable: SQLSTATE %', sqlstate;
  end;
  return true;
end;
$$;

revoke all on function public.app_feedback_needs_reply(text,uuid,uuid,bigint,bigint),
  public.app_feedback_mentor_threads(uuid,boolean,text,boolean,integer,integer),
  public.app_feedback_dismiss_reply(uuid,uuid,boolean),
  public.app_feedback_list_scoped(uuid,boolean,text,integer,integer,boolean),
  public.app_feedback_counts_scoped(uuid,boolean,text),
  public.app_feedback_detail_scoped(uuid,uuid,boolean,text),
  public.app_feedback_task_groups(uuid,boolean,integer,integer,boolean),
  public.app_feedback_list_task(uuid,boolean,uuid,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.app_feedback_needs_reply(text,uuid,uuid,bigint,bigint),
  public.app_feedback_mentor_threads(uuid,boolean,text,boolean,integer,integer),
  public.app_feedback_dismiss_reply(uuid,uuid,boolean),
  public.app_feedback_list_scoped(uuid,boolean,text,integer,integer,boolean),
  public.app_feedback_counts_scoped(uuid,boolean,text),
  public.app_feedback_detail_scoped(uuid,uuid,boolean,text),
  public.app_feedback_task_groups(uuid,boolean,integer,integer,boolean),
  public.app_feedback_list_task(uuid,boolean,uuid,integer,integer,boolean) to service_role;
notify pgrst, 'reload schema';
commit;

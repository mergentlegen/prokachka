-- Separate a reviewer's own conversations from the branch inbox.
-- This migration is additive so it also works if task-feedback was applied already.
begin;

create or replace function public.app_feedback_scope_access(p_thread uuid, p_actor uuid, p_ceo boolean, p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_scope
    when 'personal' then exists (
      select 1 from public.feedback_threads f where f.id = p_thread and f.member_user_id = p_actor
    )
    when 'mentor' then exists (
      select 1 from public.feedback_threads f where f.id = p_thread
        and f.member_user_id is distinct from p_actor
        and public.app_feedback_can_access(f.id, p_actor, p_ceo)
    )
    else false
  end;
$$;

create or replace function public.app_feedback_list_scoped(p_actor uuid, p_ceo boolean, p_scope text,
  p_limit integer default 50, p_offset integer default 0, p_only_reply boolean default false)
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
    where public.app_feedback_scope_access(f.id, p_actor, p_ceo, p_scope)
      and (not p_only_reply or (latest.kind = 'message' and latest.author_user_id = f.member_user_id))
    order by latest.created_at desc, latest.seq desc limit least(greatest(p_limit, 1), 100)
      offset least(greatest(p_offset, 0), 10000)
  ) rows;
$$;

create or replace function public.app_feedback_counts_scoped(p_actor uuid, p_ceo boolean, p_scope text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('unread', count(*) filter (where latest.seq > coalesce(r.last_seen_seq, 0)
    and latest.author_user_id is distinct from p_actor),
    'needsReply', count(*) filter (where latest.kind = 'message' and latest.author_user_id = f.member_user_id))
  from public.feedback_threads f
  join lateral (select e.seq, e.kind, e.author_user_id from public.feedback_events e
    where e.thread_id = f.id order by e.seq desc limit 1) latest on true
  left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
  where public.app_feedback_scope_access(f.id, p_actor, p_ceo, p_scope);
$$;

-- A task inbox is paged independently of its participant conversations.
create or replace function public.app_feedback_task_groups(p_actor uuid, p_ceo boolean,
  p_limit integer default 50, p_offset integer default 0, p_only_reply boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with eligible as (
    select coalesce(f.task_id, f.id) as task_key, f.task_title, latest.created_at, latest.seq,
      latest.kind = 'message' and latest.author_user_id = f.member_user_id as needs_reply,
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
      'memberId', f.member_user_id, 'memberName', member.name, 'lastAt', latest.created_at,
      'lastKind', latest.kind, 'lastBody', left(latest.body, 180),
      'needsReply', latest.kind = 'message' and latest.author_user_id = f.member_user_id,
      'unread', latest.seq > coalesce(r.last_seen_seq, 0) and latest.author_user_id is distinct from p_actor,
      'lastSeq', latest.seq) as row_data
    from public.feedback_threads f join public.users member on member.id = f.member_user_id
    join lateral (select e.* from public.feedback_events e where e.thread_id = f.id order by e.seq desc limit 1) latest on true
    left join public.feedback_reads r on r.thread_id = f.id and r.user_id = p_actor
    where coalesce(f.task_id, f.id) = p_task_key
      and public.app_feedback_scope_access(f.id, p_actor, p_ceo, 'mentor')
      and (not p_only_reply or (latest.kind = 'message' and latest.author_user_id = f.member_user_id))
    order by latest.created_at desc, latest.seq desc
    limit least(greatest(p_limit, 1), 100) offset least(greatest(p_offset, 0), 10000)
  ) rows;
$$;

create or replace function public.app_feedback_detail_scoped(p_thread uuid, p_actor uuid, p_ceo boolean, p_scope text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.app_feedback_scope_access(p_thread, p_actor, p_ceo, p_scope) then
    return jsonb_build_object('forbidden', true);
  end if;
  return public.app_feedback_detail(p_thread, p_actor, p_ceo);
end;
$$;

create or replace function public.app_feedback_send_scoped(p_thread uuid, p_actor uuid, p_ceo boolean,
  p_scope text, p_body text, p_nonce uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.app_feedback_scope_access(p_thread, p_actor, p_ceo, p_scope) then
    return jsonb_build_object('forbidden', true);
  end if;
  return public.app_feedback_send(p_thread, p_actor, p_ceo, p_body, p_nonce);
end;
$$;

create or replace function public.app_feedback_mark_read_scoped(p_thread uuid, p_actor uuid, p_ceo boolean, p_scope text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.app_feedback_scope_access(p_thread, p_actor, p_ceo, p_scope) then return false; end if;
  return public.app_feedback_mark_read(p_thread, p_actor, p_ceo);
end;
$$;

revoke all on function public.app_feedback_scope_access(uuid,uuid,boolean,text),
  public.app_feedback_list_scoped(uuid,boolean,text,integer,integer,boolean),
  public.app_feedback_counts_scoped(uuid,boolean,text),
  public.app_feedback_detail_scoped(uuid,uuid,boolean,text),
  public.app_feedback_send_scoped(uuid,uuid,boolean,text,text,uuid),
  public.app_feedback_mark_read_scoped(uuid,uuid,boolean,text),
  public.app_feedback_task_groups(uuid,boolean,integer,integer,boolean),
  public.app_feedback_list_task(uuid,boolean,uuid,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.app_feedback_scope_access(uuid,uuid,boolean,text),
  public.app_feedback_list_scoped(uuid,boolean,text,integer,integer,boolean),
  public.app_feedback_counts_scoped(uuid,boolean,text),
  public.app_feedback_detail_scoped(uuid,uuid,boolean,text),
  public.app_feedback_send_scoped(uuid,uuid,boolean,text,text,uuid),
  public.app_feedback_mark_read_scoped(uuid,uuid,boolean,text),
  public.app_feedback_task_groups(uuid,boolean,integer,integer,boolean),
  public.app_feedback_list_task(uuid,boolean,uuid,integer,integer,boolean) to service_role;
notify pgrst, 'reload schema';
commit;

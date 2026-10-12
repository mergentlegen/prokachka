-- The mentor's list of works, prepared in the database in one request: only the mentor's own team or branch,
-- and no texts of accepted works (they open on demand). It used to be ~1 MB per load, growing with every work.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

create or replace function public.app_mentor_submissions(p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with viewer as (
    select id, role, team_id, can_review from public.users where id = p_viewer
  ), visible as (
    select s.*, t.title as task_title, t.max_points as task_max_points
    from public.submissions s
    join public.tasks t on t.id = s.task_id
    join public.users member on member.id = s.user_id
    join viewer v on v.team_id is not null and t.team_id = v.team_id and member.team_id = v.team_id
    -- Placeholders that were never answered are not works.
    where (s.status <> 'pending' or s.media_type is not null or s.answer_text <> '')
      and (v.role = 'admin' or (v.role = 'member' and v.can_review and member.id <> v.id
        and v.id in (select a.id from public.tg_ancestor_ids(member.id) a)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'user_id', user_id, 'task_id', task_id, 'status', status, 'submission_source', submission_source,
      'interactive_completed', interactive_completed, 'media_type', media_type,
      -- Works waiting for review come whole, works sent back as a preview; accepted ones without texts —
      -- the answer and the comment open on demand (/api/submissions/:id/answer).
      'answer_text', case status when 'pending' then answer_text when 'revision' then left(answer_text, 300) else '' end,
      'answer_truncated', case status when 'pending' then false when 'revision' then char_length(answer_text) > 300 else answer_text <> '' end,
      'quiz_score', quiz_score, 'quiz_total', quiz_total, 'points', points,
      'comment', case when status = 'accepted' then '' else comment end, 'comment_omitted', status = 'accepted' and coalesce(comment, '') <> '',
      'submitted_at', submitted_at, 'reviewed_at', reviewed_at, 'review_version', review_version,
      'tasks', jsonb_build_object('title', task_title, 'max_points', task_max_points)
    ) order by submitted_at desc, id desc), '[]'::jsonb)
  from visible;
$$;

revoke all on function public.app_mentor_submissions(uuid) from public, anon, authenticated;
grant execute on function public.app_mentor_submissions(uuid) to service_role;
notify pgrst, 'reload schema';
commit;

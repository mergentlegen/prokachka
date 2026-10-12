-- Profile, stage 2: the participant's programs with progress, unlinking Telegram, and the mentor's branch size.
-- Apply once to an existing database; bootstrap.sql includes it for new ones. Running it again changes nothing.
begin;

-- «Мои программы»: every program the participant has started, with the step they are on.
create or replace function public.app_member_programs(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with steps as (
    select t.id, t.program_id, row_number() over (partition by t.program_id order by t.position, t.id) as number, count(*) over (partition by t.program_id) as total
    from public.tasks t join public.member_program_progress p on p.program_id = t.program_id and p.user_id = p_user
    where t.is_active and t.publication_type = 'sequential'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'programId', program.id, 'title', program.title, 'status', progress.status, 'currentTaskId', progress.current_task_id,
      'currentStep', (select number from steps where steps.id = progress.current_task_id),
      'totalSteps', (select max(total) from steps where steps.program_id = program.id), 'completedAt', progress.completed_at
    ) order by progress.status = 'completed', program.is_pinned desc, program.created_at), '[]'::jsonb)
  from public.member_program_progress progress join public.task_programs program on program.id = progress.program_id
  join public.users member on member.id = progress.user_id
  where progress.user_id = p_user and program.is_active and program.template_key is null and program.team_id = member.team_id
    and exists (select 1 from steps where steps.program_id = program.id);
$$;

-- Unlink Telegram from the own account. Answers and notifications through the bot stop until it is linked again.
create or replace function public.app_unlink_telegram(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare previous text;
begin
  select telegram_id into previous from public.users where id = p_user for update;
  if not found then return jsonb_build_object('forbidden', true); end if;
  if previous is null then return jsonb_build_object('unlinked', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('tg:' || previous, 0));
  update public.users set telegram_id = null where id = p_user;
  -- No task chosen on the site may be answered from that Telegram any more.
  update public.telegram_submission_contexts set session_hash = null where telegram_id = previous;
  update public.telegram_submission_sessions set consumed_at = now() where user_id = p_user and consumed_at is null;
  return jsonb_build_object('unlinked', true);
end $$;

-- Profile header, now also the size of the mentor's branch (the team leader: the whole team).
create or replace function public.app_own_profile_extras(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'phone', (select phone from public.user_contacts where user_id = u.id),
    'teamName', (select name from public.teams where id = u.team_id),
    'mentorName', (select mentor.name from public.users mentor where mentor.id = u.parent_user_id and mentor.team_id = u.team_id),
    'branchSize', case
      when u.team_id is null then 0
      when u.role = 'admin' then (select count(*) from public.users m where m.team_id = u.team_id and m.id <> u.id and m.role = 'member')
      when u.can_review then (select count(*) from public.users m where m.team_id = u.team_id and m.id <> u.id and u.id in (select a.id from public.tg_ancestor_ids(m.id) a))
      else 0 end
  ) from public.users u where u.id = p_user;
$$;

revoke all on function public.app_member_programs(uuid), public.app_unlink_telegram(uuid), public.app_own_profile_extras(uuid) from public, anon, authenticated;
grant execute on function public.app_member_programs(uuid), public.app_unlink_telegram(uuid), public.app_own_profile_extras(uuid) to service_role;
notify pgrst, 'reload schema';
commit;

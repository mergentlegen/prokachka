-- Delegated reviewers may process only applications from invitation links in
-- their current network branch. Team-wide applications remain admin-only.
begin;

create index if not exists team_join_requests_branch_pending_idx
  on public.team_join_requests(team_id, invited_by_user_id, created_at desc, id)
  where status = 'pending' and invitation_id is not null;

create or replace function public.app_review_join_request(p_id uuid, p_status text, p_reviewer uuid, p_ceo boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare req public.team_join_requests%rowtype; actor public.users%rowtype; outcome text;
begin
  perform pg_catalog.pg_advisory_xact_lock(20260917, 1);
  if p_status not in ('approved','rejected') or p_status is null then
    return pg_catalog.jsonb_build_object('validationError','Неизвестный статус заявки.');
  end if;
  if not p_ceo then
    select * into actor from public.users where id = p_reviewer for share;
    if not found or actor.team_id is null or not (actor.role = 'admin' or (actor.role = 'member' and actor.can_review)) then
      return pg_catalog.jsonb_build_object('forbidden',true);
    end if;
  end if;
  select * into req from public.team_join_requests where id = p_id for update;
  if not found then return pg_catalog.jsonb_build_object('validationError','Заявка не найдена.'); end if;
  if not p_ceo and req.team_id is distinct from actor.team_id then
    return pg_catalog.jsonb_build_object('forbidden',true);
  end if;
  if not p_ceo and actor.role = 'member' then
    if req.invitation_id is null or req.invited_by_user_id is null then
      return pg_catalog.jsonb_build_object('forbidden',true);
    end if;
    if not exists (
      with recursive branch(id) as (
        select actor.id
        union
        select child.id from public.users child join branch parent on child.parent_user_id = parent.id
          where child.team_id = actor.team_id
      ) select 1 from branch where id = req.invited_by_user_id
    ) then return pg_catalog.jsonb_build_object('forbidden',true); end if;
  end if;
  if req.status <> 'pending' then return pg_catalog.jsonb_build_object('validationError','Заявка уже обработана.'); end if;
  if p_status = 'approved' then
    if not exists(select 1 from public.teams where id = req.team_id and is_active) then
      return pg_catalog.jsonb_build_object('validationError','Команда недоступна.');
    end if;
    outcome := public.approve_team_join_request(p_id, p_reviewer);
    if outcome <> 'approved' then return pg_catalog.jsonb_build_object('validationError',case outcome
      when 'already_joined_other_team' then 'Пользователь уже состоит в другой команде.'
      when 'invalid_invitation' then 'Приглашение больше недоступно.'
      else 'Заявка уже обработана.' end); end if;
  else
    update public.team_join_requests set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer where id = p_id;
  end if;
  return pg_catalog.jsonb_build_object('processed',true);
end;
$$;
revoke all on function public.app_review_join_request(uuid,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.app_review_join_request(uuid,text,uuid,boolean) to service_role;

-- This RPC is intentionally available only to the server. The browser cannot
-- obtain a team-wide result and filter it locally after the fact.
create or replace function public.app_reviewable_join_requests(p_viewer uuid, p_offset integer default 0, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor public.users%rowtype; result jsonb;
begin
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Invalid join-request page';
  end if;
  select * into actor from public.users where id = p_viewer;
  if not found or actor.role <> 'member' or not actor.can_review or actor.team_id is null then
    return '[]'::jsonb;
  end if;
  with recursive branch(id) as (
    select actor.id
    union
    select child.id from public.users child join branch parent on child.parent_user_id = parent.id
      where child.team_id = actor.team_id
  ), page as (
    select r.* from public.team_join_requests r
    where r.team_id = actor.team_id and r.status = 'pending' and r.invitation_id is not null
      and r.invited_by_user_id in (select id from branch)
    order by r.created_at desc, r.id
    limit p_limit offset p_offset
  )
  select coalesce(jsonb_agg(to_jsonb(r) || pg_catalog.jsonb_build_object(
    'users',pg_catalog.jsonb_build_object('name',u.name,'team_id',u.team_id,'avatar_path',u.avatar_path),
    'teams',pg_catalog.jsonb_build_object('name',t.name)) order by r.created_at desc,r.id), '[]'::jsonb)
    into result from page r join public.users u on u.id = r.user_id join public.teams t on t.id = r.team_id;
  return result;
end;
$$;
revoke all on function public.app_reviewable_join_requests(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.app_reviewable_join_requests(uuid,integer,integer) to service_role;

create or replace function public.app_mentor_counts(p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with recursive viewer as (select id,role,team_id,can_review from public.users where id = p_viewer),
  branch(id) as (
    select id from viewer
    union
    select child.id from public.users child join branch parent on child.parent_user_id = parent.id
      join viewer v on child.team_id = v.team_id
  ), visible as (
    select s.status from public.submissions s
      join public.users u on u.id = s.user_id join public.tasks t on t.id = s.task_id
      join viewer v on u.team_id = v.team_id and t.team_id = v.team_id
    where (v.role = 'admin' or (v.can_review and u.id <> v.id and u.id in (select id from branch)))
      and (s.status <> 'pending' or s.media_type is not null or s.answer_text <> '')
  ) select pg_catalog.jsonb_build_object(
    'pending',(select count(*) from visible where status = 'pending'),
    'accepted',(select count(*) from visible where status = 'accepted'),
    'requests',(select count(*) from public.team_join_requests r join viewer v on v.team_id = r.team_id
      where r.status = 'pending' and (v.role = 'admin' or
        (v.role = 'member' and v.can_review and r.invitation_id is not null
          and r.invited_by_user_id in (select id from branch))))
  );
$$;
revoke all on function public.app_mentor_counts(uuid) from public, anon, authenticated;
grant execute on function public.app_mentor_counts(uuid) to service_role;

notify pgrst, 'reload schema';
commit;

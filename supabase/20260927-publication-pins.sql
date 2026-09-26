-- Safe for an existing database; does not change publication dates or earned miles.
begin;

alter table public.tasks add column if not exists is_pinned boolean not null default false;
alter table public.task_programs add column if not exists is_pinned boolean not null default false;
alter table public.announcements add column if not exists is_pinned boolean not null default false;

create or replace function public.app_update_program(p_id uuid, p_patch jsonb, p_actor uuid, p_ceo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare program public.task_programs%rowtype; actor public.users%rowtype;
begin
  if not p_ceo then
    select * into actor from public.users where id = p_actor for share;
    if not found or actor.team_id is null then return jsonb_build_object('forbidden',true); end if;
  end if;
  select * into program from public.task_programs where id = p_id for update;
  if not found then return jsonb_build_object('forbidden',true); end if;
  if not p_ceo and (actor.team_id is distinct from program.team_id or not
    (actor.role = 'admin' or (actor.can_publish_tasks and program.publisher_id is not distinct from actor.id))) then
    return jsonb_build_object('forbidden',true);
  end if;
  if p_patch ? 'isPinned' and jsonb_typeof(p_patch->'isPinned') is distinct from 'boolean' then
    raise exception 'isPinned must be a boolean' using errcode = '22023';
  end if;
  update public.task_programs set
    title = case when p_patch ? 'title' then trim(p_patch->>'title') else title end,
    deadline_hours = case when p_patch ? 'deadlineHours' then (p_patch->>'deadlineHours')::int else deadline_hours end,
    is_active = case when p_patch ? 'isActive' then (p_patch->>'isActive')::boolean else is_active end,
    is_pinned = case when p_patch ? 'isPinned' then (p_patch->>'isPinned')::boolean else is_pinned end
    where id = p_id returning * into program;
  if p_patch ? 'deadlineHours' then
    update public.tasks set deadline_hours = program.deadline_hours where program_id = p_id;
  end if;
  return jsonb_build_object('data',to_jsonb(program));
end $$;
revoke all on function public.app_update_program(uuid,jsonb,uuid,boolean) from public, anon, authenticated;
grant execute on function public.app_update_program(uuid,jsonb,uuid,boolean) to service_role;

notify pgrst, 'reload schema';
commit;

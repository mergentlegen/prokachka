-- Apply after 20260927-heart-survey.sql. Keep all existing scopes, tasks and miles.
begin;

drop index if exists public.task_programs_team_template_unique_idx;
create unique index if not exists task_programs_team_ready_unique_idx
  on public.task_programs(team_id,template_key) where template_key is not null and audience_root_id is null;
create unique index if not exists task_programs_branch_ready_unique_idx
  on public.task_programs(team_id,template_key,audience_root_id) where template_key is not null and audience_root_id is not null;

create or replace function public.app_create_program(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  program public.task_programs%rowtype; actor public.users%rowtype;
  team uuid:=(p_input->>'teamId')::uuid; publisher uuid:=(p_input->>'publisherId')::uuid;
  audience uuid:=(p_input->>'audienceRootId')::uuid; template text:=nullif(trim(p_input->>'templateKey'),'');
  task jsonb; step integer:=0; steps jsonb; publication text; interactive text;
begin
  if not exists(select 1 from public.teams where id=team and is_active) then
    raise exception 'Publication team is unavailable' using errcode='23514';
  end if;
  if publisher is not null then
    select * into actor from public.users where id=publisher for share;
    if actor.id is null or actor.team_id is distinct from team
      or not (actor.role='admin' or (actor.role='member' and actor.can_publish_tasks))
      or (audience is distinct from (case when actor.role='member' then actor.id else null end)) then
      raise exception 'Invalid publisher or audience' using errcode='42501';
    end if;
  elsif audience is not null then
    raise exception 'A branch publication requires its publisher' using errcode='42501';
  end if;
  if jsonb_typeof(p_input->'tasks') is distinct from 'array' then raise exception 'Tasks must be an array' using errcode='23514'; end if;
  if jsonb_array_length(p_input->'tasks') not between 1 and 100 then raise exception 'A program must contain 1 to 100 steps' using errcode='23514'; end if;
  if template is not null and (not public.app_program_interactive_valid(template) or jsonb_array_length(p_input->'tasks')<>1) then
    raise exception 'Invalid ready publication' using errcode='23514';
  end if;
  insert into public.task_programs(team_id,title,deadline_hours,template_key,publisher_id,audience_root_id,is_active)
    values(team,trim(p_input->>'title'),(p_input->>'deadlineHours')::int,template,publisher,audience,true) returning * into program;
  for task in select value from jsonb_array_elements(p_input->'tasks') loop
    if coalesce(char_length(trim(task->>'title')),0) not between 2 and 160
      or coalesce(char_length(trim(task->>'description')),0) not between 2 and 5000 then
      raise exception 'Invalid program step' using errcode='23514';
    end if;
    publication:=coalesce(nullif(task->>'publicationType',''),'sequential'); interactive:=nullif(trim(task->>'interactiveKind'),'');
    if publication not in ('evergreen','fixed','sequential') or (interactive is not null and not public.app_program_interactive_valid(interactive)) then
      raise exception 'Invalid program step type' using errcode='23514';
    end if;
    if (template is not null and (interactive is distinct from template or publication<>'evergreen' or (task->>'maxPoints')::int is distinct from 5))
      or (template is null and interactive is not null) then
      raise exception 'Interactive step must match its ready publication' using errcode='23514';
    end if;
    step:=step+1;
    insert into public.tasks(team_id,program_id,publication_type,position,title,description,max_points,deadline_at,
      resource_url,publisher_id,audience_root_id,deadline_hours,interactive_kind,is_active)
    values(program.team_id,program.id,publication,step,trim(task->>'title'),trim(task->>'description'),
      (task->>'maxPoints')::int,null,nullif(task->>'resourceUrl',''),program.publisher_id,program.audience_root_id,
      case when publication='sequential' then program.deadline_hours else null end,interactive,true);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.position),'[]') into steps from public.tasks t where program_id=program.id;
  return jsonb_build_object('program',to_jsonb(program),'tasks',steps);
end $$;

-- Re-adding a ready publication also restores a step hidden by a legacy API.
-- The parent and step changes commit together; progress/history are untouched.
create or replace function public.app_update_program(p_id uuid,p_patch jsonb,p_actor uuid,p_ceo boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare program public.task_programs%rowtype; actor public.users%rowtype;
begin
  if not p_ceo then
    select * into actor from public.users where id=p_actor for share;
    if actor.id is null or actor.team_id is null then return jsonb_build_object('forbidden',true); end if;
  end if;
  select * into program from public.task_programs where id=p_id for update;
  if program.id is null then return jsonb_build_object('forbidden',true); end if;
  if not p_ceo and (actor.team_id is distinct from program.team_id or not
    (actor.role='admin' or (actor.role='member' and actor.can_publish_tasks
      and program.publisher_id is not distinct from actor.id and program.audience_root_id is not distinct from actor.id))) then
    return jsonb_build_object('forbidden',true);
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
    or (p_patch ? 'isActive' and jsonb_typeof(p_patch->'isActive') is distinct from 'boolean')
    or (p_patch ? 'isPinned' and jsonb_typeof(p_patch->'isPinned') is distinct from 'boolean') then
    raise exception 'Invalid publication patch' using errcode='22023';
  end if;
  if program.template_key is not null and (p_patch ? 'title' or p_patch ? 'deadlineHours') then
    raise exception 'Ready publications cannot be edited as ordinary programs' using errcode='23514';
  end if;
  update public.task_programs set
    title=case when p_patch ? 'title' then trim(p_patch->>'title') else title end,
    deadline_hours=case when p_patch ? 'deadlineHours' then (p_patch->>'deadlineHours')::int else deadline_hours end,
    is_active=case when p_patch ? 'isActive' then (p_patch->>'isActive')::boolean else is_active end,
    is_pinned=case when p_patch ? 'isPinned' then (p_patch->>'isPinned')::boolean else is_pinned end
    where id=p_id returning * into program;
  if p_patch ? 'deadlineHours' then update public.tasks set deadline_hours=program.deadline_hours where program_id=p_id; end if;
  if program.template_key is not null and program.is_active and p_patch ? 'isActive' then
    update public.tasks set is_active=true where program_id=p_id;
  end if;
  return jsonb_build_object('data',to_jsonb(program));
end $$;

revoke all on function public.app_create_program(jsonb) from public,anon,authenticated;
grant execute on function public.app_create_program(jsonb) to service_role;
revoke all on function public.app_update_program(uuid,jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.app_update_program(uuid,jsonb,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;

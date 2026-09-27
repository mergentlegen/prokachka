-- Fourth ready task; preserves existing publications, attempts and rewards.
begin;
alter table public.task_programs drop constraint if exists task_programs_template_key_check;
alter table public.task_programs add constraint task_programs_template_key_check
  check (template_key is null or template_key in ('dream-plan','starter-rules','heart-survey','company-voyage'));
alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check
  check (interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey','company-voyage'));

-- Stable option indices: truth=0, myth=1, partly=2. Keys stay server-only.
create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[1,1,0,1,2]}'::jsonb
    when 'company-voyage' then '{"steps":8,"reward":10,"answers":[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    else null end;
$$;

-- Publication validation uses the same server reward spec as completion.
-- Preserve the canonical team/branch authorization and atomic step creation.
create or replace function public.app_create_program(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  program public.task_programs%rowtype; actor public.users%rowtype;
  team uuid:=(p_input->>'teamId')::uuid; publisher uuid:=(p_input->>'publisherId')::uuid;
  audience uuid:=(p_input->>'audienceRootId')::uuid; template text:=nullif(trim(p_input->>'templateKey'),'');
  task jsonb; step integer:=0; steps jsonb; publication text; interactive text; reward integer;
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
  reward:=coalesce((public.app_ready_program_spec(template)->>'reward')::int,5);
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
    if (template is not null and (interactive is distinct from template or publication<>'evergreen' or (task->>'maxPoints')::int is distinct from reward))
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

create or replace function public.app_ready_task_error(p_user_id uuid,p_task_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare account public.users%rowtype; task public.tasks%rowtype; team public.teams%rowtype; spec jsonb;
begin
  select * into account from public.users where id=p_user_id;
  select * into task from public.tasks where id=p_task_id;
  if account.id is null or account.role<>'member' then return 'Готовая программа доступна только участникам.'; end if;
  spec:=public.app_ready_program_spec(task.interactive_kind);
  if task.id is null or not task.is_active or spec is null then return 'Готовая программа недоступна.'; end if;
  if task.publication_type<>'evergreen' or task.deadline_at is not null then return 'У готовой программы не должно быть дедлайна.'; end if;
  if task.max_points<>coalesce((spec->>'reward')::int,jsonb_array_length(spec->'answers')) then return 'Награда программы настроена неверно.'; end if;
  if account.team_id is null or task.team_id is distinct from account.team_id then return 'Пользователь не состоит в команде программы.'; end if;
  select * into team from public.teams where id=account.team_id;
  if team.id is null or not team.is_active then return 'Команда недоступна.'; end if;
  if task.audience_root_id is not null and not exists(select 1 from public.tg_ancestor_ids(account.id) a where a.id=task.audience_root_id) then return 'Программа недоступна для вашей ветки.'; end if;
  if task.program_id is null or not exists(
    select 1 from public.task_programs p where p.id=task.program_id and p.is_active and p.team_id=account.team_id
      and p.template_key=task.interactive_kind
      and (p.audience_root_id is null or exists(select 1 from public.tg_ancestor_ids(account.id) a where a.id=p.audience_root_id))
  ) then return 'Программа недоступна.'; end if;
  return null;
end $$;

create or replace function public.app_ready_attempt_json(p_attempt public.ready_program_attempts)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'attemptId',p_attempt.id,'step',p_attempt.current_step,'status',p_attempt.status,'attemptNumber',p_attempt.attempt_number,
    -- Company quiz correctness is a question count, not 17 earned miles.
    'earnedPoints',case when t.interactive_kind='company-voyage' and p_attempt.status='active' then 0 else p_attempt.earned_points end,
    'maxPoints',t.max_points,'questionIndex',coalesce((p_attempt.state->>'questionIndex')::int,0),
    'answeredQuestions',coalesce((p_attempt.state->>'questionIndex')::int,0),
    'ready',coalesce((p_attempt.state->>'ready')::boolean,false),'failed',coalesce((p_attempt.state->>'failed')::boolean,false),
    'lastAnswer',case when p_attempt.state ? 'lastAnswer' then (p_attempt.state->>'lastAnswer')::int else null end,
    'completed',p_attempt.status='completed','storyChoices',p_attempt.state->'storyChoices'
  ) from public.tasks t where t.id=p_attempt.task_id;
$$;

create or replace function public.app_complete_ready_program(p_user_id uuid,p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare attempt public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype; error_text text; spec jsonb; total int; reward int;
begin
  error_text:=public.app_ready_task_error(p_user_id,p_task_id);
  if error_text is not null then return jsonb_build_object('validationError',error_text); end if;
  select * into attempt from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  if not found then return jsonb_build_object('validationError','Сначала начните программу.'); end if;
  if attempt.status='completed' then
    select * into saved from public.submissions where user_id=p_user_id and task_id=p_task_id and submission_source='interactive' and status='accepted' order by created_at desc limit 1;
    return public.app_ready_attempt_json(attempt)||jsonb_build_object('submission',to_jsonb(saved));
  end if;
  select * into task from public.tasks where id=p_task_id for share;
  spec:=public.app_ready_program_spec(task.interactive_kind);
  total:=jsonb_array_length(spec->'answers'); reward:=coalesce((spec->>'reward')::int,total);
  if attempt.current_step<>(spec->>'steps')::int or (attempt.state->>'ready')::boolean is distinct from true
    or coalesce((attempt.state->>'failed')::boolean,false) or attempt.earned_points<>total
    or coalesce((attempt.state->>'questionIndex')::int,0)<>total then
    return jsonb_build_object('validationError','Сначала правильно ответьте на все вопросы.');
  end if;
  insert into public.submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source)
    values(p_user_id,p_task_id,'accepted','text','Интерактивная программа «'||task.title||'» завершена.',reward,
      'Зачтено автоматически после прохождения программы.',now(),'interactive') returning * into saved;
  update public.ready_program_attempts set status='completed',completed_at=now(),earned_points=reward where id=attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt)||jsonb_build_object('submission',to_jsonb(saved));
end $$;

-- An optional story never changes quiz answers, status, submissions or mileage.
create or replace function public.app_save_company_story(p_user_id uuid,p_task_id uuid,p_choices integer[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare attempt public.ready_program_attempts%rowtype; error_text text;
begin
  error_text:=public.app_ready_task_error(p_user_id,p_task_id);
  if error_text is not null then return jsonb_build_object('validationError',error_text); end if;
  if (select interactive_kind from public.tasks where id=p_task_id) is distinct from 'company-voyage' then return jsonb_build_object('validationError','Рассказ недоступен для этого задания.'); end if;
  if p_choices is null or array_ndims(p_choices) is distinct from 1 or array_lower(p_choices,1) is distinct from 1 or cardinality(p_choices)<>3
    or p_choices[1] is null or p_choices[1] not between 0 and 2
    or p_choices[2] is null or p_choices[2] not between 0 and 4
    or p_choices[3] is null or p_choices[3] not between 0 and 2 then return jsonb_build_object('validationError','Выберите по одной фразе в каждой части рассказа.'); end if;
  select * into attempt from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  if not found or attempt.status<>'completed' then return jsonb_build_object('validationError','Сначала завершите тест.'); end if;
  update public.ready_program_attempts set state=jsonb_set(state,'{storyChoices}',to_jsonb(p_choices)) where id=attempt.id returning * into attempt;
  return public.app_ready_attempt_json(attempt);
end $$;

revoke all on function public.app_create_program(jsonb),public.app_ready_program_spec(text),public.app_ready_task_error(uuid,uuid),public.app_ready_attempt_json(public.ready_program_attempts),public.app_complete_ready_program(uuid,uuid),public.app_save_company_story(uuid,uuid,integer[]) from public,anon,authenticated;
grant execute on function public.app_create_program(jsonb),public.app_complete_ready_program(uuid,uuid),public.app_save_company_story(uuid,uuid,integer[]) to service_role;
notify pgrst,'reload schema';
commit;

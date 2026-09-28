-- One-play, three-round organization environment game. Apply after 20261013-user-deletion.sql.
begin;

alter table public.task_programs drop constraint if exists task_programs_template_key_check;
alter table public.task_programs add constraint task_programs_template_key_check
  check (template_key is null or template_key in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise','count-your-dream','org-environment'));
alter table public.tasks drop constraint if exists tasks_interactive_kind_check;
alter table public.tasks add constraint tasks_interactive_kind_check
  check (interactive_kind is null or interactive_kind in ('dream-plan','starter-rules','heart-survey','company-voyage','captain-cruise','count-your-dream','org-environment'));

-- Ordinary task creation and manual review still enforce 0..100 in the API.
-- This game's raw score can legitimately exceed that range.
alter table public.tasks drop constraint if exists tasks_max_points_check;
alter table public.tasks add constraint tasks_max_points_check
  check (max_points between 0 and 15900);
alter table public.submissions drop constraint if exists submissions_points_check;
alter table public.submissions add constraint submissions_points_check
  check (points between 0 and 15900);
alter table public.feedback_events drop constraint if exists feedback_events_points_check;
alter table public.feedback_events add constraint feedback_events_points_check
  check (points between 0 and 15900);

create or replace function public.app_ready_program_spec(p_kind text)
returns jsonb language sql immutable security definer set search_path=public as $$
  select case p_kind
    when 'dream-plan' then '{"steps":12,"reward":5,"answers":[1,2,1,2,2]}'::jsonb
    when 'starter-rules' then '{"steps":1,"reward":5,"answers":[1,1,0,1,2]}'::jsonb
    when 'company-voyage' then '{"steps":8,"reward":10,"answers":[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1]}'::jsonb
    when 'captain-cruise' then '{"steps":1,"reward":20,"answers":[]}'::jsonb
    when 'count-your-dream' then '{"steps":12,"reward":10,"answers":[]}'::jsonb
    when 'org-environment' then '{"steps":0,"reward":15900,"answers":[]}'::jsonb
    else null end;
$$;

-- Prevent the older generic start/restart endpoint from wiping an active score.
create or replace function public.app_org_attempt_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (select interactive_kind from public.tasks where id=old.task_id)='org-environment'
    and old.state ? 'orgPhase'
    and (not (new.state ? 'orgPhase') or new.attempt_number<>old.attempt_number
      or new.earned_points<old.earned_points or new.current_step<>old.current_step
      or (old.status='completed' and new.status<>'completed')) then
    raise exception 'Organization game progress cannot be reset';
  end if;
  return new;
end $$;
drop trigger if exists ready_program_attempts_org_guard on public.ready_program_attempts;
create trigger ready_program_attempts_org_guard before update on public.ready_program_attempts
  for each row execute function public.app_org_attempt_guard();

create or replace function public.app_org_attempt_json(p_attempt public.ready_program_attempts)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'serverNow',clock_timestamp(),
    'phase',p_attempt.state->>'orgPhase','index',coalesce((p_attempt.state->>'index')::int,0),
    'quizOrder',p_attempt.state->'quizOrder','sortOrder',p_attempt.state->'sortOrder',
    'blitzOrder',p_attempt.state->'blitzOrder','questionStarted',p_attempt.state->>'questionStarted',
    'blitzStarted',p_attempt.state->>'blitzStarted','last',p_attempt.state->'last',
    'awaitNext',coalesce((p_attempt.state->>'awaitNext')::boolean,false),
    'score',p_attempt.earned_points,'streak',coalesce((p_attempt.state->>'streak')::int,0),
    'best',coalesce((p_attempt.state->>'best')::int,0),
    'correct',coalesce((p_attempt.state->>'correct')::int,0),
    'answered',coalesce((p_attempt.state->>'answered')::int,0),
    'rounds',coalesce(p_attempt.state->'rounds','[0,0,0]'::jsonb),
    'completed',p_attempt.status='completed',
    'submission',(select to_jsonb(s) from public.submissions s where s.user_id=p_attempt.user_id and s.task_id=p_attempt.task_id and s.submission_source='interactive' and s.status='accepted' limit 1));
$$;

create or replace function public.app_org_environment(
  p_user_id uuid,p_task_id uuid,p_action text,p_index integer default null,p_answer integer default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.ready_program_attempts%rowtype; task public.tasks%rowtype; saved public.submissions%rowtype;
  problem text; phase text; idx int; item_id int; expected int; streak int; combo int; multiplier numeric;
  points int:=0; score int; correct boolean; elapsed numeric; started timestamptz; v_now timestamptz;
  next_phase text; next_index int; round_index int; rounds jsonb; quiz_order jsonb; sort_order jsonb; blitz_order jsonb;
  sort_answers int[]:=array[0,0,0,0,0,1,1,1,1,1,2,2,2,2,2];
  blitz_answers int[]:=array[1,1,0,1,1,0,1,0,1,0,1,1,0,1,0,1,1,0,1,0];
begin
  problem:=public.app_ready_task_error(p_user_id,p_task_id);
  if problem is not null then return jsonb_build_object('validationError',problem); end if;
  select * into task from public.tasks where id=p_task_id;
  if task.interactive_kind is distinct from 'org-environment' then return jsonb_build_object('validationError','Ойын бұл тапсырмаға қолжетімсіз.'); end if;
  if p_action is null or p_action not in ('start','begin','answer','advance','finish') then return jsonb_build_object('validationError','Белгісіз әрекет.'); end if;

  perform 1 from public.users where id=p_user_id for update;
  insert into public.ready_program_attempts(user_id,task_id) values(p_user_id,p_task_id)
    on conflict(user_id,task_id) do nothing;
  select * into a from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  if not (a.state ? 'orgPhase') then
    select jsonb_agg(n order by md5(n::text||a.id::text)) into quiz_order from generate_series(0,13) n;
    select jsonb_agg(n order by md5(n::text||a.id::text)) into sort_order from generate_series(0,14) n;
    select jsonb_agg(n order by md5(n::text||a.id::text)) into blitz_order from generate_series(0,19) n;
    update public.ready_program_attempts set state=jsonb_build_object(
      'orgPhase','intro1','index',0,'quizOrder',quiz_order,'sortOrder',sort_order,'blitzOrder',blitz_order,
      'streak',0,'best',0,'correct',0,'answered',0,'rounds','[0,0,0]'::jsonb,'awaitNext',false)
      where id=a.id returning * into a;
  end if;
  if a.status='completed' or p_action='start' then return public.app_org_attempt_json(a); end if;
  phase:=a.state->>'orgPhase'; idx:=(a.state->>'index')::int; v_now:=clock_timestamp();
  if p_action='begin' then
    if phase not in ('intro1','intro2','intro3') then return jsonb_build_object('validationError','Раунд басталып қойған.'); end if;
    next_phase:=case phase when 'intro1' then 'quiz' when 'intro2' then 'sort' else 'blitz' end;
    update public.ready_program_attempts set state=state||jsonb_build_object(
      'orgPhase',next_phase,'index',0,'questionStarted',v_now,
      'blitzStarted',case when next_phase='blitz' then v_now else null end,'last',null,'awaitNext',false)
      where id=a.id returning * into a;
    return public.app_org_attempt_json(a);
  end if;
  if p_action='advance' then
    if phase not in ('quiz','sort','blitz') or coalesce((a.state->>'awaitNext')::boolean,false) is not true then
      return jsonb_build_object('validationError','Келесі сұрақ әлі дайын емес.'); end if;
    update public.ready_program_attempts set state=state||jsonb_build_object('awaitNext',false,'questionStarted',v_now,'last',null)
      where id=a.id returning * into a;
    return public.app_org_attempt_json(a);
  end if;
  if p_action='finish' then
    if phase<>'blitz' then return jsonb_build_object('validationError','Алдымен барлық раундтан өтіңіз.'); end if;
    if v_now < (a.state->>'blitzStarted')::timestamptz + interval '45 seconds' then
      return jsonb_build_object('validationError','Блиц әлі аяқталған жоқ.'); end if;
    score:=a.earned_points;
    insert into public.submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source)
      values(p_user_id,p_task_id,'accepted','text','«Ұйым ортасы: Миль жарысы» ойыны аяқталды.',score,
        'Жиналған миль бір рет сақталды.',now(),'interactive') returning * into saved;
    update public.ready_program_attempts set status='completed',completed_at=now(),state=state||'{"orgPhase":"done"}'::jsonb
      where id=a.id returning * into a;
    return public.app_org_attempt_json(a);
  end if;
  if phase not in ('quiz','sort','blitz') or p_index is distinct from idx then
    if p_index=idx-1 and a.state->'last'->>'phase'=phase
      and (a.state->'last'->>'index')::int=p_index
      and (a.state->'last'->>'choice')::int is not distinct from p_answer then
      return public.app_org_attempt_json(a); end if;
    return jsonb_build_object('validationError','Сұрақ өзгерді. Ойынды қайта ашыңыз.');
  end if;
  if coalesce((a.state->>'awaitNext')::boolean,false) then return jsonb_build_object('validationError','Келесі сұраққа өтіңіз.'); end if;
  if (phase='quiz' and idx>=10) or (phase='sort' and idx>=15) or idx<0 or idx>500 then
    return jsonb_build_object('validationError','Раунд аяқталған.'); end if;
  if (phase='quiz' and p_answer is not null and p_answer not between 0 and 3)
    or (phase='sort' and (p_answer is null or p_answer not between 0 and 2))
    or (phase='blitz' and (p_answer is null or p_answer not between 0 and 1)) then
    return jsonb_build_object('validationError','Жауап қате берілді.'); end if;
  started:=(a.state->>'questionStarted')::timestamptz;
  elapsed:=greatest(0,extract(epoch from v_now-started));
  streak:=coalesce((a.state->>'streak')::int,0);
  rounds:=a.state->'rounds'; next_index:=idx+1; next_phase:=phase;
  if phase='quiz' then
    item_id:=(a.state->'quizOrder'->>idx)::int;
    expected:=0; correct:=p_answer=expected and elapsed<=20;
    round_index:=0;
    if correct then points:=round((100+50*greatest(0,1-elapsed/20))*(case when streak+1>=5 then 2 when streak+1>=3 then 1.5 else 1 end)); end if;
    if next_index=10 then next_phase:='intro2'; end if;
  elsif phase='sort' then
    item_id:=(a.state->'sortOrder'->>idx)::int;
    expected:=sort_answers[item_id+1]; correct:=p_answer=expected;
    round_index:=1;
    if correct then points:=round((50+greatest(0,20-elapsed*4))*(case when streak+1>=5 then 2 when streak+1>=3 then 1.5 else 1 end)); end if;
    if next_index=15 then next_phase:='intro3'; end if;
  else
    if v_now >= (a.state->>'blitzStarted')::timestamptz + interval '45 seconds' then
      return public.app_org_attempt_json(a)||jsonb_build_object('expired',true); end if;
    item_id:=(a.state->'blitzOrder'->>(idx%20))::int;
    expected:=blitz_answers[item_id+1]; correct:=p_answer=expected; round_index:=2;
    combo:=coalesce((a.state->>'combo')::int,0);
    if correct then points:=30+least(30,combo*5); end if;
  end if;
  if correct then streak:=streak+1; else streak:=0; end if;
  points:=least(points,15900-a.earned_points);
  rounds:=jsonb_set(rounds,array[round_index::text],to_jsonb((rounds->>round_index)::int+points));
  blitz_order:=a.state->'blitzOrder';
  if phase='blitz' and next_index%20=0 then
    select jsonb_agg(n order by md5(n::text||a.id::text||(next_index/20)::text))
      into blitz_order from generate_series(0,19) n;
  end if;
  update public.ready_program_attempts set earned_points=earned_points+points,
    state=state||jsonb_build_object(
      'orgPhase',next_phase,'index',next_index,'awaitNext',next_phase=phase,
      'blitzOrder',blitz_order,
      'streak',streak,'best',greatest(coalesce((state->>'best')::int,0),streak),
      'combo',case when phase='blitz' and correct then coalesce((state->>'combo')::int,0)+1 else 0 end,
      'correct',coalesce((state->>'correct')::int,0)+case when correct then 1 else 0 end,
      'answered',coalesce((state->>'answered')::int,0)+1,'rounds',rounds,
      'last',jsonb_build_object('phase',phase,'index',idx,'choice',p_answer,
        'correct',correct,'expected',expected,'delta',points,'timedOut',phase='quiz' and elapsed>20))
    where id=a.id returning * into a;
  return public.app_org_attempt_json(a);
end $$;

revoke all on function public.app_org_environment(uuid,uuid,text,integer,integer),public.app_org_attempt_json(public.ready_program_attempts),public.app_org_attempt_guard() from public,anon,authenticated;
grant execute on function public.app_org_environment(uuid,uuid,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;

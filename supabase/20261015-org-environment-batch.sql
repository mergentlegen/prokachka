-- Keep gameplay local; persist the verified result in one transaction at the end.
-- Apply after 20261014-org-environment.sql.
begin;

create or replace function public.app_org_batch_start(p_user_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.ready_program_attempts%rowtype; result jsonb; orders jsonb;
begin
  result:=public.app_org_environment(p_user_id,p_task_id,'start');
  if result ? 'validationError' then return result; end if;
  select * into a from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  if a.status='completed' then return result||jsonb_build_object('attemptId',a.id); end if;
  if a.state ? 'batchMode' then return result||jsonb_build_object('attemptId',a.id); end if;
  if a.earned_points<>0 or a.state->>'orgPhase'<>'intro1' then
    return jsonb_build_object('validationError','Начатая до обновления игра не может быть перенесена автоматически. Обратитесь к наставнику.');
  end if;
  select jsonb_agg(n order by cycle, md5(n::text||a.id::text||cycle::text)) into orders
    from generate_series(0,4) cycle cross join generate_series(0,19) n;
  update public.ready_program_attempts set state=state||jsonb_build_object(
    'batchMode',true,'batchStartedAt',clock_timestamp(),'blitzOrder',orders)
    where id=a.id returning * into a;
  return public.app_org_attempt_json(a)||jsonb_build_object('attemptId',a.id);
end $$;

create or replace function public.app_org_batch_submit(p_user_id uuid, p_task_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.ready_program_attempts%rowtype; entry jsonb; quiz jsonb; sort_items jsonb; blitz jsonb;
  i int; item_id int; answer int; elapsed_ms int; at_ms int; previous_ms int:=-1;
  elapsed_total bigint:=45000; points int; score int:=0; streak int:=0; best int:=0;
  combo int:=0; correct_count int:=0; answered_count int:=0;
  quiz_score int:=0; sort_score int:=0; blitz_score int:=0; correct boolean;
  sort_answers int[]:=array[0,0,0,0,0,1,1,1,1,1,2,2,2,2,2];
  blitz_answers int[]:=array[1,1,0,1,1,0,1,0,1,0,1,1,0,1,0,1,1,0,1,0];
begin
  if public.app_ready_task_error(p_user_id,p_task_id) is not null then
    return jsonb_build_object('validationError','Игра недоступна.'); end if;
  perform 1 from public.users where id=p_user_id for update;
  select * into a from public.ready_program_attempts where user_id=p_user_id and task_id=p_task_id for update;
  if not found or coalesce((a.state->>'batchMode')::boolean,false) is not true then
    return jsonb_build_object('validationError','Сначала откройте игру.'); end if;
  if a.status='completed' then
    return public.app_org_attempt_json(a)||jsonb_build_object('attemptId',a.id); end if;
  if a.earned_points<>0 then return jsonb_build_object('validationError','Результат уже записан.'); end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then return jsonb_build_object('validationError','Неверный протокол игры.'); end if;
  quiz:=p_payload->'quiz'; sort_items:=p_payload->'sort'; blitz:=p_payload->'blitz';
  if jsonb_typeof(quiz) is distinct from 'array' or jsonb_typeof(sort_items) is distinct from 'array'
    or jsonb_typeof(blitz) is distinct from 'array' then
    return jsonb_build_object('validationError','Неполный протокол игры.'); end if;
  if jsonb_array_length(quiz)<>10 or jsonb_array_length(sort_items)<>15 or jsonb_array_length(blitz)>100 then
    return jsonb_build_object('validationError','Неполный протокол игры.'); end if;

  for i in 0..9 loop
    entry:=quiz->i;
    if jsonb_typeof(entry) is distinct from 'object' or not (entry ? 'answer')
      or coalesce(entry->>'id','') !~ '^[0-9]{1,2}$'
      or (entry->>'id')::int<>(a.state->'quizOrder'->>i)::int
      or coalesce(entry->>'ms','') !~ '^[0-9]{1,5}$' then
      return jsonb_build_object('validationError','Вопросы не совпадают с попыткой.'); end if;
    elapsed_ms:=(entry->>'ms')::int;
    if elapsed_ms>20000 or (jsonb_typeof(entry->'answer')<>'null'
      and (coalesce(entry->>'answer','') !~ '^[0-3]$' or elapsed_ms>=20000))
      or (jsonb_typeof(entry->'answer')='null' and elapsed_ms<>20000) then
      return jsonb_build_object('validationError','Неверный ответ или время квиза.'); end if;
    elapsed_total:=elapsed_total+elapsed_ms;
    answer:=case when jsonb_typeof(entry->'answer')='null' then null else (entry->>'answer')::int end;
    correct:=answer=0;
    if correct then streak:=streak+1; else streak:=0; end if;
    points:=case when correct then round((100+50*(1-elapsed_ms::numeric/20000))
      *(case when streak>=5 then 2 when streak>=3 then 1.5 else 1 end))::int else 0 end;
    quiz_score:=quiz_score+points; score:=score+points;
    best:=greatest(best,streak); correct_count:=correct_count+case when correct then 1 else 0 end;
    answered_count:=answered_count+1;
  end loop;

  for i in 0..14 loop
    entry:=sort_items->i;
    if jsonb_typeof(entry) is distinct from 'object' or coalesce(entry->>'id','') !~ '^[0-9]{1,2}$'
      or (entry->>'id')::int<>(a.state->'sortOrder'->>i)::int
      or coalesce(entry->>'ms','') !~ '^[0-9]{1,7}$'
      or coalesce(entry->>'answer','') !~ '^[0-2]$' then
      return jsonb_build_object('validationError','Неверный протокол сортировки.'); end if;
    elapsed_ms:=(entry->>'ms')::int; answer:=(entry->>'answer')::int;
    if elapsed_ms>3600000 then return jsonb_build_object('validationError','Неверное время сортировки.'); end if;
    elapsed_total:=elapsed_total+elapsed_ms;
    item_id:=(entry->>'id')::int; correct:=answer=sort_answers[item_id+1];
    if correct then streak:=streak+1; else streak:=0; end if;
    points:=case when correct then round((50+greatest(0,20-elapsed_ms::numeric/250))
      *(case when streak>=5 then 2 when streak>=3 then 1.5 else 1 end))::int else 0 end;
    sort_score:=sort_score+points; score:=score+points;
    best:=greatest(best,streak); correct_count:=correct_count+case when correct then 1 else 0 end;
    answered_count:=answered_count+1;
  end loop;

  for i in 0..jsonb_array_length(blitz)-1 loop
    entry:=blitz->i;
    if jsonb_typeof(entry) is distinct from 'object' or coalesce(entry->>'id','') !~ '^[0-9]{1,2}$'
      or (entry->>'id')::int<>(a.state->'blitzOrder'->>i)::int
      or coalesce(entry->>'answer','') !~ '^[01]$'
      or coalesce(entry->>'atMs','') !~ '^[0-9]{1,5}$' then
      return jsonb_build_object('validationError','Неверный протокол блица.'); end if;
    at_ms:=(entry->>'atMs')::int;
    if at_ms<=previous_ms or at_ms>=45000 then
      return jsonb_build_object('validationError','Неверное время блица.'); end if;
    previous_ms:=at_ms; item_id:=(entry->>'id')::int; answer:=(entry->>'answer')::int;
    correct:=answer=blitz_answers[item_id+1];
    if correct then streak:=streak+1; else streak:=0; end if;
    points:=case when correct then 30+least(30,combo*5) else 0 end;
    if correct then combo:=combo+1; else combo:=0; end if;
    blitz_score:=blitz_score+points; score:=score+points;
    best:=greatest(best,streak); correct_count:=correct_count+case when correct then 1 else 0 end;
    answered_count:=answered_count+1;
  end loop;
  if clock_timestamp()< (a.state->>'batchStartedAt')::timestamptz + elapsed_total * interval '1 millisecond' then
    return jsonb_build_object('validationError','Время игры ещё не истекло.'); end if;
  if score>15900 then return jsonb_build_object('validationError','Неверный счёт игры.'); end if;
  insert into public.submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source)
    values(p_user_id,p_task_id,'accepted','text','«Ұйым ортасы: Миль жарысы» ойыны аяқталды.',score,
      'Жиналған миль бір рет сақталды.',now(),'interactive');
  update public.ready_program_attempts set earned_points=score,status='completed',completed_at=now(),
    state=state||jsonb_build_object('orgPhase','done','rounds',jsonb_build_array(quiz_score,sort_score,blitz_score),
      'correct',correct_count,'answered',answered_count,'best',best,'streak',streak)
    where id=a.id returning * into a;
  return public.app_org_attempt_json(a)||jsonb_build_object('attemptId',a.id);
end $$;

revoke all on function public.app_org_batch_start(uuid,uuid), public.app_org_batch_submit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.app_org_batch_start(uuid,uuid), public.app_org_batch_submit(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

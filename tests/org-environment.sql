\set ON_ERROR_STOP on
-- Older integration suites replay older game migrations, so restore the latest catalog first.
\ir ../supabase/20261014-org-environment.sql
\ir ../supabase/20261014-org-environment.sql
begin;
do $$
declare team uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  task_id uuid; result jsonb; saved_id uuid; first_score int; i int; item_id int; correct_answer int;
begin
  insert into teams(id,name) values(team,'org-'||team),(other_team,'org-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,mentor),
    (outsider,'Other','Other','Test',outsider||'@test.invalid',outsider::text,'test','member',other_team,null);
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Ұйым ортасы: Миль жарысы','templateKey','org-environment','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Ұйым ортасы: Миль жарысы','description','Three rounds','maxPoints',15900,'publicationType','evergreen','interactiveKind','org-environment'))));
  task_id:=(result->'tasks'->0->>'id')::uuid;
  if task_id is null then raise exception 'Game not published: %',result; end if;
  if not (app_org_environment(outsider,task_id,'start') ? 'validationError') then raise exception 'Outside team played'; end if;
  if not (app_org_environment(member_id,task_id,'finish') ? 'validationError') then raise exception 'Premature finish'; end if;
  result:=app_org_environment(member_id,task_id,'start');
  if result->>'phase'<>'intro1' or result->>'score'<>'0' then raise exception 'Bad initial state: %',result; end if;
  result:=app_org_environment(member_id,task_id,'begin');
  if result->>'phase'<>'quiz' then raise exception 'Quiz did not begin'; end if;
  result:=app_org_environment(member_id,task_id,'answer',0,1);
  if result->>'index'<>'1' or result->>'score'<>'0' or result->'last'->>'correct'<>'false' then raise exception 'Wrong answer restarted or earned points: %',result; end if;
  if app_org_environment(member_id,task_id,'answer',0,1)->>'index' is distinct from '1' then raise exception 'Retry counted twice'; end if;
  if not (app_org_environment(member_id,task_id,'answer',1,0) ? 'validationError') then raise exception 'Skipped next-question transition'; end if;
  begin
    perform app_start_ready_program(member_id,task_id,true);
    raise exception 'Generic restart bypassed one-play rule';
  exception when others then
    if sqlerrm='Generic restart bypassed one-play rule' then raise; end if;
  end;
  if app_complete_ready_program(member_id,task_id) ? 'submission' then raise exception 'Generic completion awarded early'; end if;
  perform app_org_environment(member_id,task_id,'advance');
  update ready_program_attempts set state=jsonb_set(state,'{questionStarted}',to_jsonb((now()-interval '21 seconds')::text)) where user_id=member_id;
  result:=app_org_environment(member_id,task_id,'answer',1,null);
  if result->>'score'<>'0' or result->'last'->>'timedOut'<>'true' then raise exception 'Quiz timeout awarded points'; end if;
  for i in 2..9 loop
    perform app_org_environment(member_id,task_id,'advance');
    result:=app_org_environment(member_id,task_id,'answer',i,0);
  end loop;
  if result->>'phase'<>'intro2' or (result->>'score')::int<=0 then raise exception 'Quiz transition failed: %',result; end if;
  result:=app_org_environment(member_id,task_id,'begin');
  if result->>'phase'<>'sort' then raise exception 'Sort did not begin'; end if;
  item_id:=(result->'sortOrder'->>0)::int;
  correct_answer:=case when item_id<5 then 0 when item_id<10 then 1 else 2 end;
  first_score:=(result->>'score')::int;
  result:=app_org_environment(member_id,task_id,'answer',0,(correct_answer+1)%3);
  if result->>'index'<>'1' or (result->>'score')::int<>first_score then raise exception 'Sort error restarted or scored'; end if;
  for i in 1..14 loop
    item_id:=(result->'sortOrder'->>i)::int;
    perform app_org_environment(member_id,task_id,'advance');
    result:=app_org_environment(member_id,task_id,'answer',i,case when item_id<5 then 0 when item_id<10 then 1 else 2 end);
  end loop;
  if result->>'phase'<>'intro3' then raise exception 'Sort transition failed'; end if;
  result:=app_org_environment(member_id,task_id,'begin');
  if result->>'phase'<>'blitz' then raise exception 'Blitz did not begin'; end if;
  item_id:=(result->'blitzOrder'->>0)::int;
  correct_answer:=case when item_id in (0,1,3,4,6,8,10,11,13,15,16,18) then 1 else 0 end;
  first_score:=(result->>'score')::int;
  result:=app_org_environment(member_id,task_id,'answer',0,1-correct_answer);
  if result->>'index'<>'1' or (result->>'score')::int<>first_score then raise exception 'Blitz error restarted or scored'; end if;
  perform app_org_environment(member_id,task_id,'advance');
  item_id:=(result->'blitzOrder'->>1)::int;
  result:=app_org_environment(member_id,task_id,'answer',1,case when item_id in (0,1,3,4,6,8,10,11,13,15,16,18) then 1 else 0 end);
  if result->>'index'<>'2' or (result->>'score')::int<=first_score then raise exception 'Blitz correct answer not scored'; end if;
  update ready_program_attempts set state=jsonb_set(state,'{blitzStarted}',to_jsonb((now()-interval '46 seconds')::text)) where user_id=member_id;
  result:=app_org_environment(member_id,task_id,'finish');
  first_score:=(result->>'score')::int; saved_id:=(result->'submission'->>'id')::uuid;
  if result->>'completed'<>'true' or saved_id is null or first_score<=100 then raise exception 'Actual score not saved: %',result; end if;
  result:=app_org_environment(member_id,task_id,'start');
  if (result->'submission'->>'id')::uuid is distinct from saved_id or (result->>'score')::int<>first_score
    or (select count(*) from submissions where user_id=member_id)<>1 then raise exception 'Completed score replaced'; end if;
  if has_function_privilege('authenticated','app_org_environment(uuid,uuid,text,integer,integer)','execute') then raise exception 'Public scoring RPC'; end if;
end $$;
rollback;

\set ON_ERROR_STOP on
-- Migrations can be safely replayed after a production hotfix.
\ir ../supabase/20261014-org-environment.sql
\ir ../supabase/20261015-org-environment-batch.sql
\ir ../supabase/20261015-org-environment-batch.sql
begin;
do $$
declare team uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  task_id uuid; result jsonb; saved_id uuid; first_score int; i int; item_id int; correct_answer int;
  quiz jsonb:='[]'; sort_items jsonb:='[]'; blitz jsonb:='[]'; transcript jsonb;
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
  if not (app_org_batch_start(outsider,task_id) ? 'validationError') then raise exception 'Outside team played'; end if;
  result:=app_org_batch_start(member_id,task_id);
  if result->>'score'<>'0' or result->>'attemptId' is null or jsonb_array_length(result->'blitzOrder')<>100 then
    raise exception 'Bad initial state: %',result; end if;
  if not (app_org_batch_submit(member_id,task_id,'{}'::jsonb) ? 'validationError') then raise exception 'Incomplete result accepted'; end if;
  if (select earned_points from ready_program_attempts where user_id=member_id)<>0 then
    raise exception 'Start wrote miles'; end if;
  begin
    perform app_start_ready_program(member_id,task_id,true);
    raise exception 'Generic restart bypassed one-play rule';
  exception when others then
    if sqlerrm='Generic restart bypassed one-play rule' then raise; end if;
  end;
  if app_complete_ready_program(member_id,task_id) ? 'submission' then raise exception 'Generic completion awarded early'; end if;
  for i in 0..9 loop
    item_id:=(result->'quizOrder'->>i)::int;
    quiz:=quiz||jsonb_build_array(jsonb_build_object('id',item_id,'answer',case when i=1 then null when i=0 then 1 else 0 end,
      'ms',case when i=1 then 20000 else 1000 end));
  end loop;
  for i in 0..14 loop
    item_id:=(result->'sortOrder'->>i)::int;
    correct_answer:=case when item_id<5 then 0 when item_id<10 then 1 else 2 end;
    sort_items:=sort_items||jsonb_build_array(jsonb_build_object('id',item_id,'answer',case when i=0 then (correct_answer+1)%3 else correct_answer end,'ms',500));
  end loop;
  for i in 0..1 loop
    item_id:=(result->'blitzOrder'->>i)::int;
    correct_answer:=case when item_id in (0,1,3,4,6,8,10,11,13,15,16,18) then 1 else 0 end;
    blitz:=blitz||jsonb_build_array(jsonb_build_object('id',item_id,'answer',case when i=0 then 1-correct_answer else correct_answer end,'atMs',1000+i*1000));
  end loop;
  transcript:=jsonb_build_object('quiz',quiz,'sort',sort_items,'blitz',blitz);
  if not (app_org_batch_submit(member_id,task_id,jsonb_set(transcript,'{quiz,0,id}','99')) ? 'validationError') then
    raise exception 'Forged question order accepted'; end if;
  if not (app_org_batch_submit(member_id,task_id,transcript) ? 'validationError') then
    raise exception 'Result accepted before enough wall time'; end if;
  update ready_program_attempts set state=jsonb_set(state,'{batchStartedAt}',to_jsonb((now()-interval '2 minutes')::text))
    where user_id=member_id;
  result:=app_org_batch_submit(member_id,task_id,transcript);
  first_score:=(result->>'score')::int; saved_id:=(result->'submission'->>'id')::uuid;
  if result->>'completed'<>'true' or saved_id is null or first_score<>3648 or result->>'answered'<>'27'
    or result->>'correct'<>'23' then raise exception 'Actual score not saved: %',result; end if;
  if (select count(*) from submissions where user_id=member_id)<>1 then raise exception 'Submission duplicated'; end if;
  result:=app_org_batch_submit(member_id,task_id,jsonb_build_object('quiz','[]'::jsonb,'sort','[]'::jsonb,'blitz','[]'::jsonb));
  if (result->'submission'->>'id')::uuid is distinct from saved_id or (result->>'score')::int<>first_score then
    raise exception 'Completed score replaced'; end if;
  result:=app_org_batch_start(member_id,task_id);
  if result->>'completed'<>'true' or (result->>'score')::int<>first_score then raise exception 'Completed game restarted'; end if;
  if has_function_privilege('authenticated','app_org_batch_submit(uuid,uuid,jsonb)','execute') then raise exception 'Public scoring RPC'; end if;
end $$;
rollback;

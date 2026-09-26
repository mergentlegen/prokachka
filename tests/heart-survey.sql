\set ON_ERROR_STOP on
begin;
do $$ <<survey_test>>
declare
  team uuid:=gen_random_uuid(); root_id uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid();
  sibling uuid:=gen_random_uuid(); no_review uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid();
  task_id uuid; program_id uuid; result jsonb; saved_id uuid; definition jsonb; i integer; blocked boolean;
begin
  insert into teams(id,name) values(team,'survey-'||team),(other_team,'foreign-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_review,telegram_id) values
    (root_id,'Root','Root','Mentor',root_id||'@test.invalid',root_id::text,'test','admin',team,null,false,'123000'),
    (mentor,'Mentor','Branch','Mentor',mentor||'@test.invalid',mentor::text,'test','member',team,root_id,true,null),
    (no_review,'No rights','No','Rights',no_review||'@test.invalid',no_review::text,'test','member',team,mentor,false,null),
    (member_id,'Survey Member','Survey','Member',member_id||'@test.invalid',member_id::text,'test','member',team,no_review,false,null),
    (sibling,'Other admin','Other','Admin',sibling||'@test.invalid',sibling::text,'test','admin',team,root_id,false,'123001'),
    (foreign_id,'Foreign','Foreign','Member',foreign_id||'@test.invalid',foreign_id::text,'test','member',other_team,null,true,'123002');
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'audienceRootId',mentor,'title','Heart survey','templateKey','heart-survey','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Heart survey','description','Five personal questions.','maxPoints',5,'publicationType','evergreen','interactiveKind','heart-survey'))));
  task_id:=(result->'tasks'->0->>'id')::uuid; program_id:=(result->'program'->>'id')::uuid;
  select jsonb_build_object('title','Куда зовёт твоё сердце?','questions',jsonb_agg(jsonb_build_object('title','Question '||q,'options',
    (select jsonb_agg(jsonb_build_object('emoji','✈','text','Choice '||a)) from generate_series(0,4) a))),
    'finals',(select jsonb_agg(jsonb_build_object('title','Reason '||a,'text','Personal result')) from generate_series(0,4) a)) into definition from generate_series(1,5) q;
  if not (app_heart_survey(foreign_id,task_id,'start',null,null,definition)?'validationError') then raise exception 'Foreign access'; end if;
  if not (app_heart_survey(sibling,task_id,'start',null,null,definition)?'validationError') then raise exception 'Sibling access'; end if;
  if not (app_start_ready_program(member_id,task_id)?'validationError') then raise exception 'Quiz RPC accepts survey'; end if;
  result:=app_heart_survey(member_id,task_id,'start',null,null,definition);
  if (result->>'earnedPoints')::int is distinct from 0 then raise exception 'Reward before answering'; end if;
  result:=app_heart_survey(member_id,task_id,'answer',4,0,definition); saved_id:=(result->'submission'->>'id')::uuid;
  if (result->'submission'->>'points')::int is distinct from 1 or (result->'submission'->>'interactive_completed')::boolean is distinct from false then raise exception 'First mile not immediately awarded'; end if;
  if (select count(*) from telegram_notification_jobs where submission_id=saved_id)<>0 then raise exception 'Partial survey sent'; end if;
  result:=app_heart_survey(member_id,task_id,'answer',4,0,definition);
  if (result->>'earnedPoints')::int is distinct from 1 then raise exception 'Duplicate mile'; end if;
  if not (app_heart_survey(member_id,task_id,'answer',2,0,definition)?'validationError') then raise exception 'Saved answer changed'; end if;
  if not (app_heart_survey(member_id,task_id,'answer',4,2,definition)?'validationError') then raise exception 'Skipped question'; end if;
  result:=app_heart_survey(member_id,task_id,'start',null,null,'{}');
  if result->'answers' is distinct from '[4]'::jsonb or (result->>'questionIndex')::int is distinct from 1 or result->'definition' is distinct from definition then raise exception 'Resume did not preserve snapshot'; end if;
  blocked:=false;
  begin update submissions set points=5 where id=saved_id; exception when others then blocked:=true; end;
  if not blocked then raise exception 'Partial survey score editable'; end if;
  for i in 1..4 loop result:=app_heart_survey(member_id,task_id,'answer',i,i,definition); end loop;
  if (result->>'completed')::boolean is distinct from true or (result->'submission'->>'points')::int is distinct from 5 then raise exception 'Final reward'; end if;
  if (select count(*) from submissions s where s.user_id=member_id and s.task_id=survey_test.task_id)<>1 then raise exception 'Multiple reward rows'; end if;
  if (select count(*) from telegram_notification_jobs where submission_id=saved_id and kind='survey')<>2 then raise exception 'Missing ancestor recipients'; end if;
  if exists(select 1 from telegram_notification_jobs where submission_id=saved_id and recipient_id not in (root_id,mentor)) then raise exception 'Survey leaked to wrong recipient'; end if;
  if tg_can_receive_survey(sibling,saved_id) or tg_can_receive_survey(no_review,saved_id) or tg_can_receive_survey(foreign_id,saved_id) then raise exception 'Unauthorized delivery'; end if;
  if (result->'delivery'->>'waiting')::int is distinct from 1 then raise exception 'Unlinked mentor was not queued'; end if;
  if (result->'submission'->>'answer_text' like '%5. Question 5%Ответ: Choice 4%Моя причина: Reason 4%') is distinct from true then raise exception 'Survey summary missing answers'; end if;
  result:=app_heart_survey(member_id,task_id,'answer',4,4,definition);
  if (result->>'earnedPoints')::int is distinct from 5 or (select count(*) from telegram_notification_jobs where submission_id=saved_id)<>2 then raise exception 'Final replay duplicates rewards/jobs'; end if;
  update users set telegram_id='123003' where id=mentor;
  if not tg_can_receive_survey(mentor,saved_id) then raise exception 'Linked ancestor excluded'; end if;
  update users set can_review=false where id=mentor;
  if tg_can_receive_survey(mentor,saved_id) then raise exception 'Revoked mentor access'; end if;
  update task_programs set is_active=false where id=program_id;
  if not (app_heart_survey(member_id,task_id,'start',null,null,definition)?'validationError') then raise exception 'Hidden survey accessible'; end if;
  if has_function_privilege('anon','app_heart_survey(uuid,uuid,text,integer,integer,jsonb)','execute') or has_function_privilege('authenticated','tg_can_receive_survey(uuid,uuid)','execute') then raise exception 'Public survey RPC'; end if;
end $$;
rollback;

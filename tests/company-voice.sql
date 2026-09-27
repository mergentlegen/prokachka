\set ON_ERROR_STOP on
\ir ../supabase/20261006-company-voice.sql
\ir ../supabase/20261006-company-voice.sql
begin;
do $$
declare team uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid(); publisher uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid();
  task_id uuid; ordinary_task uuid:=gen_random_uuid(); reward_id uuid; result jsonb; i int;
  answers int[]:=array[1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1];
begin
  insert into teams(id,name) values(team,'voice-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_review,can_publish_tasks,telegram_id) values
    (mentor,'Root','Root','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false,false,null),
    (publisher,'Branch','Branch','Test',publisher||'@test.invalid',publisher::text,'test','member',team,mentor,true,true,null),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,publisher,false,false,'810000000000001'),
    (sibling,'Sibling','Sibling','Test',sibling||'@test.invalid',sibling::text,'test','member',team,mentor,true,true,'810000000000002');
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Company voice','templateKey','company-voyage','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Company voice','description','Test the company','maxPoints',10,'publicationType','evergreen','interactiveKind','company-voyage'))));
  task_id:=(result->'tasks'->0->>'id')::uuid;
  if tg_company_voice_error(member_id,task_id) is null then raise exception 'Voice allowed before quiz completion'; end if;
  perform app_start_ready_program(member_id,task_id);
  for i in 1..8 loop perform app_advance_ready_program(member_id,task_id,i); end loop;
  for i in 0..16 loop perform app_answer_ready_program(member_id,task_id,answers[i+1],i); end loop;
  result:=app_complete_ready_program(member_id,task_id); reward_id:=(result->'submission'->>'id')::uuid;
  if tg_company_voice_error(member_id,task_id) is not null then raise exception 'Completed voice inaccessible'; end if;
  insert into telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at,purpose) values
    ('voice-fixture-'||member_id,member_id,task_id,'810000000000001',now()+interval '15 minutes','company-voice');
  result:=tg_begin_submission('voice-fixture-'||member_id,'810000000000002',100);
  if not (result ? 'validationError') then raise exception 'Foreign Telegram selected voice'; end if;
  result:=tg_begin_submission('voice-fixture-'||member_id,'810000000000001',100);
  if result->>'purpose' is distinct from 'company-voice' or result->>'ready' is distinct from 'true' then raise exception 'Voice not selected'; end if;
  result:=tg_submit_answer('810000000000001','810000000000001',101,8100000001,'text','Not a voice',null);
  if not (result ? 'validationError') or (select consumed_at is not null from telegram_submission_sessions where token_hash='voice-fixture-'||member_id) then raise exception 'Text consumed voice session'; end if;
  result:=tg_submit_answer('810000000000001','810000000000001',99,8100000002,'voice','','voice-fixture');
  if not (result ? 'validationError') then raise exception 'Voice older than selection accepted'; end if;
  result:=tg_submit_answer('810000000000001','810000000000001',102,8100000003,'voice','','voice-fixture');
  if result->>'purpose' is distinct from 'company-voice' or (result->'data'->>'id')::uuid is distinct from reward_id then raise exception 'Voice not attached to existing result: %',result; end if;
  result:=tg_submit_answer('810000000000001','810000000000001',102,8100000003,'voice','','voice-fixture');
  if result->>'duplicate' is distinct from 'true' then raise exception 'Voice webhook not idempotent'; end if;
  if (select count(*) from telegram_notification_jobs where submission_id=reward_id and kind='company-voice')<>2 then raise exception 'Not queued for both ancestor mentors'; end if;
  if exists(select 1 from telegram_notification_jobs where submission_id=reward_id and recipient_id=sibling) then raise exception 'Voice leaked to sibling branch'; end if;
  if not tg_can_receive_company_voice(mentor,reward_id) or not tg_can_receive_company_voice(publisher,reward_id) or tg_can_receive_company_voice(sibling,reward_id) then raise exception 'Delivery authorization incorrect'; end if;
  update users set can_review=false where id=publisher;
  if tg_can_receive_company_voice(publisher,reward_id) then raise exception 'Revoked reviewer still receives voice'; end if;
  if (select count(*) from submissions where user_id=member_id)<>1 or (select points from submissions where id=reward_id)<>10 or (select status from submissions where id=reward_id)<>'accepted' then raise exception 'Voice changed reward/status'; end if;
  if tg_company_voice_error(member_id,task_id) is null then raise exception 'Second voice session allowed'; end if;
  if (app_complete_ready_program(member_id,task_id)->'submission'->>'id')::uuid is distinct from reward_id then raise exception 'Voice changed completion identity'; end if;
  -- Ordinary answer mode still rejects voices and preserves the session for a valid answer.
  insert into tasks(id,team_id,title,description,publication_type) values(ordinary_task,team,'Ordinary task','Answer','evergreen');
  insert into telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values('answer-fixture-'||member_id,member_id,ordinary_task,'810000000000001',now()+interval '15 minutes');
  perform tg_begin_submission('answer-fixture-'||member_id,'810000000000001',200);
  result:=tg_submit_answer('810000000000001','810000000000001',201,8100000004,'voice','','other-voice');
  if not (result ? 'validationError') then raise exception 'Ordinary task accepted unsupported voice'; end if;
  result:=tg_submit_answer('810000000000001','810000000000001',202,8100000005,'text','Normal answer',null);
  if result->'data'->>'status' is distinct from 'pending' then raise exception 'Ordinary answer regression'; end if;
  if has_function_privilege('anon','tg_company_voice_error(uuid,uuid)','execute') or has_function_privilege('authenticated','tg_can_receive_company_voice(uuid,uuid)','execute') then raise exception 'Public voice RPC access'; end if;
end $$;
rollback;

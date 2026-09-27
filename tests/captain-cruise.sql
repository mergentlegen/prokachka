\set ON_ERROR_STOP on
\ir ../supabase/20261007-captain-cruise.sql
\ir ../supabase/20261007-captain-cruise.sql
begin;
do $$
declare team uuid:=gen_random_uuid(); root_id uuid:=gen_random_uuid(); branch_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); sibling_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  task_id uuid; branch_task uuid; reward_id uuid; result jsonb; payload jsonb; details jsonb; idx int;
  keys int[]:=array[0,2,1,1,2,-1,-1,1,1,1,2,1,1,1,0];
begin
  insert into teams(id,name) values(team,'captain-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_review,can_publish_tasks,telegram_id) values
    (root_id,'Root','Root','Test',root_id||'@test.invalid',root_id::text,'test','admin',team,null,false,false,null),
    (branch_id,'Branch','Branch','Test',branch_id||'@test.invalid',branch_id::text,'test','member',team,root_id,true,true,null),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,branch_id,false,false,'820000000000001'),
    (sibling_id,'Sibling','Sibling','Test',sibling_id||'@test.invalid',sibling_id::text,'test','member',team,root_id,true,true,'820000000000002'),
    (other_id,'Other','Other','Test',other_id||'@test.invalid',other_id::text,'test','member',team,sibling_id,false,false,null);
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',root_id,'title','Captain cruise','templateKey','captain-cruise','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Captain cruise','description','Search trainer','maxPoints',20,'publicationType','evergreen','interactiveKind','captain-cruise'))));
  task_id:=(result->'tasks'->0->>'id')::uuid;
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',branch_id,'audienceRootId',branch_id,'title','Branch captain','templateKey','captain-cruise','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Branch captain','description','Search trainer','maxPoints',20,'publicationType','evergreen','interactiveKind','captain-cruise'))));
  branch_task:=(result->'tasks'->0->>'id')::uuid;
  if app_ready_task_error(member_id,branch_task) is not null or app_ready_task_error(other_id,branch_task) is null then raise exception 'Captain branch audience broken'; end if;
  if (select deadline_at is not null from tasks where id=task_id) then raise exception 'Captain has deadline'; end if;
  if tg_captain_screenshot_error(member_id,task_id) is null then raise exception 'Screenshot before training allowed'; end if;
  perform app_captain_cruise(member_id,task_id,'start',null,'{}');
  if not (app_captain_cruise(member_id,task_id,'finish',null,'{}') ? 'validationError') then raise exception 'Training skipped'; end if;
  perform app_advance_ready_program(member_id,task_id,1);
  if not (app_complete_ready_program(member_id,task_id) ? 'validationError') then raise exception 'Ordinary game RPC bypassed training'; end if;
  result:=app_captain_cruise(member_id,task_id,'checkpoint',0,'{"answer":1}');
  if result->>'failed' is distinct from 'true' or result->>'index'<>'0' then raise exception 'Wrong answer not retained'; end if;
  result:=app_captain_cruise(member_id,task_id,'checkpoint',0,'{"answer":0}');
  if result->>'index'<>'0' then raise exception 'Wrong answer reset automatically'; end if;
  perform app_captain_cruise(member_id,task_id,'retry',0,'{}');
  for idx in 0..14 loop
    payload:=jsonb_build_object('answer',keys[idx+1]);
    if idx=5 then payload:='{"direction":"Средиземное море"}'; end if;
    if idx=6 then
      if not (app_captain_cruise(member_id,task_id,'checkpoint',idx,'{"readKeys":["line"]}') ? 'validationError') then raise exception 'Unread card accepted'; end if;
      payload:='{"readKeys":["line","ship","port","nights","dates","price"]}';
    end if;
    if idx=9 then payload:=payload||'{"readCabins":[0,1,2,3]}'; end if;
    if idx=11 then
      if not (app_captain_cruise(member_id,task_id,'checkpoint',idx,payload||'{"guests":[2,null,0]}') ? 'validationError') then raise exception 'Invalid passenger accepted'; end if;
      payload:=payload||'{"guests":[2,2,0]}';
    end if;
    result:=app_captain_cruise(member_id,task_id,'checkpoint',idx,payload);
    if result->>'index' is distinct from (idx+1)::text then raise exception 'Checkpoint % failed: %',idx,result; end if;
    if app_captain_cruise(member_id,task_id,'checkpoint',idx,payload) is distinct from result then raise exception 'Checkpoint replay changed progress'; end if;
  end loop;
  if result->>'trainingPoints'<>'19' or result->>'earnedPoints'<>'0' or exists(select 1 from submissions where user_id=member_id) then raise exception 'Training awarded early/wrong amount'; end if;
  result:=app_captain_cruise(member_id,task_id,'finish',null,'{}'); reward_id:=(result->'submission'->>'id')::uuid;
  if result->>'earnedPoints'<>'19' or result->>'trainingDone'<>'true' or (select interactive_completed from submissions where id=reward_id) then raise exception '19-mile training result invalid'; end if;
  if app_captain_cruise(member_id,task_id,'finish',null,'{}') is distinct from result then raise exception 'Finish duplicated reward'; end if;
  if not (app_captain_cruise(member_id,task_id,'save-details',null,'{"details":{"direction":"Europe"}}') ? 'validationError') then raise exception 'Incomplete details accepted'; end if;
  details:='{"direction":"Средиземное море","line":"MSC Cruises","who":"2 взрослых и 2 детей","price":"$5,564.48"}';
  perform app_captain_cruise(member_id,task_id,'save-details',null,jsonb_build_object('details',details));
  if tg_captain_screenshot_error(member_id,task_id) is not null then raise exception 'Valid screenshot inaccessible'; end if;
  insert into telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at,purpose) values('captain-'||member_id,member_id,task_id,'820000000000001',now()+interval '15 minutes','captain-screenshot');
  if not (tg_begin_submission('captain-'||member_id,'820000000000002',100) ? 'validationError') then raise exception 'Foreign Telegram selected screenshot'; end if;
  result:=tg_begin_submission('captain-'||member_id,'820000000000001',100);
  if result->>'summary' is distinct from app_captain_message(details)||E'\n\nУчастник: Member' then raise exception 'Automatic message differs from fields'; end if;
  -- Editing the website cannot silently change the message already displayed in the bot.
  perform app_captain_cruise(member_id,task_id,'save-details',null,jsonb_build_object('details',details||'{"price":"$6,000"}'));
  if not (tg_submit_answer('820000000000001','820000000000001',101,8200000001,'text','Text instead of photo',null) ? 'validationError') then raise exception 'Text counted as screenshot'; end if;
  if not (tg_submit_answer('820000000000001','820000000000001',99,8200000002,'photo','','file') ? 'validationError') then raise exception 'Old photo attached'; end if;
  result:=tg_submit_answer('820000000000001','820000000000001',102,8200000003,'photo','','captain-photo');
  if result->>'purpose' is distinct from 'captain-screenshot' or (result->'data'->>'id')::uuid is distinct from reward_id then raise exception 'Photo not attached: %',result; end if;
  result:=tg_submit_answer('820000000000001','820000000000001',102,8200000003,'photo','','captain-photo');
  if result->>'duplicate' is distinct from 'true' then raise exception 'Screenshot webhook replay not idempotent'; end if;
  if (select points from submissions where id=reward_id)<>20 or (select count(*) from submissions where user_id=member_id)<>1 or not (select interactive_completed from submissions where id=reward_id) then raise exception 'Extra screenshot mile wrong or duplicated'; end if;
  if (select summary from ready_program_attachments where submission_id=reward_id) is distinct from app_captain_message(details)||E'\n\nУчастник: Member' then raise exception 'Message snapshot changed'; end if;
  if (select count(*) from telegram_notification_jobs where submission_id=reward_id and kind='captain-screenshot')<>2 or exists(select 1 from telegram_notification_jobs where submission_id=reward_id and recipient_id=sibling_id) then raise exception 'Wrong mentor recipients'; end if;
  if not tg_can_receive_captain_screenshot(root_id,reward_id) or not tg_can_receive_captain_screenshot(branch_id,reward_id) or tg_can_receive_captain_screenshot(sibling_id,reward_id) then raise exception 'Screenshot recipient scope wrong'; end if;
  update users set can_review=false where id=branch_id;
  if tg_can_receive_captain_screenshot(branch_id,reward_id) then raise exception 'Revoked reviewer allowed'; end if;
  if tg_captain_screenshot_error(member_id,task_id) is null then raise exception 'Second screenshot allowed'; end if;
  if (app_captain_cruise(member_id,task_id,'start',null,'{}')->>'earnedPoints')<>'20' then raise exception 'Screenshot result not restored'; end if;
  if has_function_privilege('anon','app_captain_cruise(uuid,uuid,text,integer,jsonb)','execute') or has_function_privilege('authenticated','tg_can_receive_captain_screenshot(uuid,uuid)','execute') or has_table_privilege('authenticated','ready_program_attachments','select') then raise exception 'Private captain data exposed'; end if;
end $$;
rollback;

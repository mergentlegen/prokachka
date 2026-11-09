\set ON_ERROR_STOP on
-- Results saved by the old 20-mile game, before the new version is applied.
create temporary table captain_v2_fixture(name text primary key, id uuid);
do $$
declare team uuid:=gen_random_uuid(); root_id uuid:=gen_random_uuid(); result jsonb; v_task uuid; member uuid; n int;
begin
  insert into teams(id,name) values(team,'captain-v2-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values(root_id,'Root','Root','Test',root_id||'@test.invalid',root_id::text,'test','admin',team);
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',root_id,'title','Captain cruise','templateKey','captain-cruise','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Captain cruise','description','Search trainer','maxPoints',10,'publicationType','evergreen','interactiveKind','captain-cruise'))));
  v_task:=(result->'tasks'->0->>'id')::uuid;
  -- The game as it was published before: 20 miles and the old catalog text.
  update tasks set max_points=20, description='Пройди тренировку и получи 19 миль. Найди круиз в своём кабинете inCruises и отправь скриншот наставникам через Telegram — ещё 1 миля автоматически.' where id=v_task;
  insert into captain_v2_fixture values('team',team),('task',v_task);
  for n in 1..4 loop
    member:=gen_random_uuid();
    insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id) values(member,'Member '||n,'Member','Test',member||'@test.invalid',member::text,'test','member',team,root_id);
    insert into captain_v2_fixture values('member'||n,member);
  end loop;
  -- 1: training and screenshot (20), 2: training only (19), 3: stopped at the card (old step 7, 9 miles), 4: wrong crown answer.
  insert into ready_program_attempts(user_id,task_id,status,earned_points,completed_at,state) values
    ((select id from captain_v2_fixture where name='member1'),v_task,'completed',20,now(),'{"captainIndex":15,"trainingPoints":19,"trainingDone":true,"screenshotSent":true}'),
    ((select id from captain_v2_fixture where name='member2'),v_task,'completed',19,now(),'{"captainIndex":15,"trainingPoints":19,"trainingDone":true}'),
    ((select id from captain_v2_fixture where name='member3'),v_task,'active',0,null,'{"captainIndex":7,"trainingPoints":9,"direction":"Европа","lastPayload":{"readKeys":[]}}'),
    ((select id from captain_v2_fixture where name='member4'),v_task,'active',0,null,'{"captainIndex":3,"trainingPoints":5,"failed":true,"lastAnswer":0}');
  insert into submissions(user_id,task_id,status,media_type,answer_text,points,comment,reviewed_at,submission_source,interactive_completed) values
    ((select id from captain_v2_fixture where name='member1'),v_task,'accepted','text','Тренировка «Капитан ищет свой круиз» завершена.',20,'19 миль за тренировку. Ещё 1 — после отправки скриншота.',now(),'interactive',true),
    ((select id from captain_v2_fixture where name='member2'),v_task,'accepted','text','Тренировка «Капитан ищет свой круиз» завершена.',19,'19 миль за тренировку. Ещё 1 — после отправки скриншота.',now(),'interactive',false);
end $$;

\ir ../supabase/20261112-captain-cruise-v2.sql
-- Applying it twice must not take the miles back twice.
\ir ../supabase/20261112-captain-cruise-v2.sql

do $$
declare v_task uuid:=(select id from captain_v2_fixture where name='task'); m1 uuid:=(select id from captain_v2_fixture where name='member1');
  m2 uuid:=(select id from captain_v2_fixture where name='member2'); m3 uuid:=(select id from captain_v2_fixture where name='member3'); m4 uuid:=(select id from captain_v2_fixture where name='member4'); a jsonb;
begin
  if (select points from submissions where user_id=m1 and task_id=v_task)<>10 or (select earned_points from ready_program_attempts where user_id=m1 and task_id=v_task)<>10 then raise exception 'Screenshot result not lowered to 10'; end if;
  if (select points from submissions where user_id=m2 and task_id=v_task)<>9 or (select earned_points from ready_program_attempts where user_id=m2 and task_id=v_task)<>9 then raise exception 'Training result not lowered to 9'; end if;
  if (select comment from submissions where user_id=m2 and task_id=v_task) is distinct from '9 миль за тренировку. Ещё 1 — после отправки скриншота.' then raise exception 'Old comment kept'; end if;
  a:=(select state from ready_program_attempts where user_id=m3 and task_id=v_task);
  if a->>'captainIndex'<>'8' or a->>'trainingPoints'<>'4' or a ? 'lastPayload' or a->>'direction'<>'Европа' then raise exception 'Card step not moved: %', a::text; end if;
  a:=(select state from ready_program_attempts where user_id=m4 and task_id=v_task);
  if a->>'captainIndex'<>'3' or a->>'trainingPoints'<>'1' or a ? 'failed' then raise exception 'Crown step not kept: %', a::text; end if;
  if (select max_points from tasks where id=v_task)<>10 or (select description from tasks where id=v_task) not like 'Пройди тренировку и получи 9 миль.%' then raise exception 'Task not updated'; end if;
  -- The member who stopped at the card goes on with the new steps and finishes with 9.
  perform app_captain_cruise(m3,v_task,'checkpoint',8,'{"answer":1}');
  perform app_captain_cruise(m3,v_task,'checkpoint',9,'{"answer":1}');
  perform app_captain_cruise(m3,v_task,'checkpoint',10,'{"answer":1,"readCabins":[0,1,2,3]}');
  perform app_captain_cruise(m3,v_task,'checkpoint',11,'{"answer":2}');
  perform app_captain_cruise(m3,v_task,'checkpoint',12,'{"answer":1,"guests":[2,2,0]}');
  perform app_captain_cruise(m3,v_task,'checkpoint',13,'{"answer":1}');
  perform app_captain_cruise(m3,v_task,'checkpoint',14,'{"answer":1}');
  perform app_captain_cruise(m3,v_task,'checkpoint',15,'{"answer":0}');
  a:=app_captain_cruise(m3,v_task,'finish',null,'{}');
  if a->>'earnedPoints'<>'9' or (a->'submission'->>'points')<>'9' then raise exception 'Moved attempt did not finish with 9: %', a::text; end if;
end $$;

delete from submissions where task_id=(select id from captain_v2_fixture where name='task');
delete from ready_program_attempts where task_id=(select id from captain_v2_fixture where name='task');
delete from tasks where id=(select id from captain_v2_fixture where name='task');
delete from task_programs where team_id=(select id from captain_v2_fixture where name='team');
delete from users where team_id=(select id from captain_v2_fixture where name='team') and role='member';
delete from users where team_id=(select id from captain_v2_fixture where name='team');
delete from teams where id=(select id from captain_v2_fixture where name='team');

-- The whole new game: sixteen checkpoints, 9 miles for the training and 1 for the screenshot.
begin;
do $$
declare team uuid:=gen_random_uuid(); root_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid();
  v_task uuid; reward_id uuid; result jsonb; payload jsonb; details jsonb; idx int;
  keys int[]:=array[0,2,1,1,1,2,-1,-1,1,1,1,2,1,1,1,0]; miles int[]:=array[1,0,0,0,0,2,1,0,0,1,0,1,0,1,1,1]; total int:=0;
begin
  insert into teams(id,name) values(team,'captain-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_review,can_publish_tasks,telegram_id) values
    (root_id,'Root','Root','Test',root_id||'@test.invalid',root_id::text,'test','admin',team,null,false,false,null),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,root_id,false,false,'820000000000011');
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',root_id,'title','Captain cruise','templateKey','captain-cruise','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Captain cruise','description','Search trainer','maxPoints',10,'publicationType','evergreen','interactiveKind','captain-cruise'))));
  v_task:=(result->'tasks'->0->>'id')::uuid;
  if (app_ready_program_spec('captain-cruise')->>'reward')<>'10' then raise exception 'Catalog reward is not 10'; end if;
  result:=app_captain_cruise(member_id,v_task,'start',null,'{}');
  if (select state->>'captainVersion' from ready_program_attempts where user_id=member_id and task_id=v_task)<>'2' then raise exception 'New attempt not marked'; end if;
  -- The new river question: Carnival is wrong, AmaWaterways is right.
  for idx in 0..15 loop
    payload:=jsonb_build_object('answer',keys[idx+1]);
    if idx=4 then
      result:=app_captain_cruise(member_id,v_task,'checkpoint',4,'{"answer":0}');
      if result->>'failed' is distinct from 'true' then raise exception 'Wrong river answer accepted'; end if;
      perform app_captain_cruise(member_id,v_task,'retry',4,'{}');
    end if;
    if idx=6 then payload:='{"direction":"Средиземное море"}'; end if;
    if idx=7 then
      if not (app_captain_cruise(member_id,v_task,'checkpoint',idx,'{"readKeys":["line"]}') ? 'validationError') then raise exception 'Unread card accepted'; end if;
      payload:='{"readKeys":["line","ship","port","nights","dates","price"]}';
    end if;
    if idx=10 then payload:=payload||'{"readCabins":[0,1,2,3]}'; end if;
    if idx=12 then payload:=payload||'{"guests":[2,2,0]}'; end if;
    result:=app_captain_cruise(member_id,v_task,'checkpoint',idx,payload);
    total:=total+miles[idx+1];
    if result->>'index' is distinct from (idx+1)::text or (result->>'trainingPoints')::int<>total then raise exception 'Checkpoint % failed: %',idx,result::text; end if;
  end loop;
  result:=app_captain_cruise(member_id,v_task,'finish',null,'{}'); reward_id:=(result->'submission'->>'id')::uuid;
  if result->>'earnedPoints'<>'9' or (select points from submissions where id=reward_id)<>9 then raise exception '9-mile training result invalid'; end if;
  details:='{"direction":"Средиземное море","line":"MSC Cruises","who":"2 взрослых и 2 детей","price":"$5,564.48"}';
  perform app_captain_cruise(member_id,v_task,'save-details',null,jsonb_build_object('details',details));
  insert into telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at,purpose) values('captain-v2-'||member_id,member_id,v_task,'820000000000011',now()+interval '15 minutes','captain-screenshot');
  perform tg_begin_submission('captain-v2-'||member_id,'820000000000011',100);
  result:=tg_submit_answer('820000000000011','820000000000011',101,8200000011,'photo','','captain-photo');
  if (result->'data'->>'id')::uuid is distinct from reward_id then raise exception 'Photo not attached: %',result::text; end if;
  if (select points from submissions where id=reward_id)<>10 or (app_captain_cruise(member_id,v_task,'start',null,'{}')->>'earnedPoints')<>'10' then raise exception 'Screenshot mile wrong'; end if;
  if tg_captain_screenshot_error(member_id,v_task) not like '%Все 10 миль начислены.' then raise exception 'Second screenshot message wrong'; end if;
  begin
    update submissions set points=11 where id=reward_id;
    raise exception 'Finished game changed';
  exception when raise_exception then
    if sqlerrm<>'Interactive submissions are immutable' then raise; end if;
  end;
end $$;
rollback;

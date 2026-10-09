-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
declare team uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid(); publisher uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid();
  veteran uuid:=gen_random_uuid(); game uuid; result jsonb; voice_id uuid; i int; version int;
  answers int[]:=array[1,1,1,1,0,0,1,1,1,1,2,1,1,2,0,1,1,1];
begin
  insert into teams(id,name) values(team,'voyage2-'||team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id,can_review,can_publish_tasks,telegram_id) values
    (mentor,'Root','Root','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null,false,false,null),
    (publisher,'Branch','Branch','Test',publisher||'@test.invalid',publisher::text,'test','member',team,mentor,true,true,null),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,publisher,false,false,'820000000000001'),
    (sibling,'Sibling','Sibling','Test',sibling||'@test.invalid',sibling::text,'test','member',team,mentor,true,true,'820000000000002'),
    (veteran,'Veteran','Old','Test',veteran||'@test.invalid',veteran::text,'test','member',team,publisher,false,false,'820000000000003');
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Корабль','templateKey','company-voyage','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Корабль, на который ты поднялся','description','Курс','maxPoints',2,'publicationType','evergreen','interactiveKind','company-voyage'))));
  game:=(result->'tasks'->0->>'id')::uuid;
  assert tg_company_voice_error(member_id,game) is not null, 'voice allowed before the quiz';

  -- Nine cards, then eighteen questions. A wrong answer stays on the question and is counted.
  perform app_start_ready_program(member_id,game);
  for i in 1..9 loop perform app_advance_ready_program(member_id,game,i); end loop;
  result:=app_answer_ready_program(member_id,game,0,0);
  assert (result->>'wrong')::boolean and (result->>'questionIndex')::int = 0 and (result->>'mistakes')::int = 1 and not (result->>'failed')::boolean, 'wrong answer handled wrong: '|| result::text;
  result:=app_answer_ready_program(member_id,game,2,0);
  assert (result->>'mistakes')::int = 2 and (result->>'questionIndex')::int = 0, 'second wrong answer not counted';
  result:=app_answer_ready_program(member_id,game,answers[1],0);
  assert not (result->>'wrong')::boolean and (result->>'questionIndex')::int = 1 and (result->>'firstTry')::int = 0, 'retried answer counted as first try: '|| result::text;
  assert app_complete_ready_program(member_id,game) ? 'validationError', 'completed with questions left';
  for i in 1..17 loop result:=app_answer_ready_program(member_id,game,answers[i+1],i); end loop;
  assert (result->>'ready')::boolean and (result->>'firstTry')::int = 17 and (result->>'mistakes')::int = 2, 'quiz result wrong: '|| result::text;

  -- Finishing the game gives no miles: they come from the mentor.
  result:=app_complete_ready_program(member_id,game);
  assert (result->>'completed')::boolean and (result->>'earnedPoints')::int = 0 and not (result ? 'submission'), 'game paid by itself: '|| result::text;
  assert not exists(select 1 from submissions where user_id=member_id and task_id=game), 'a record was created without the voice';
  assert tg_company_voice_error(member_id,game) is null, 'voice not allowed after the game';

  -- The voice becomes a work for review, sent to the mentors of the branch only.
  insert into telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at,purpose) values
    ('v2-'||member_id,member_id,game,'820000000000001',now()+interval '15 minutes','company-voice');
  result:=tg_begin_submission('v2-'||member_id,'820000000000001',100);
  assert (result->>'review')::boolean, 'voice not marked for review: '|| result::text;
  assert tg_submit_answer('820000000000001','820000000000001',101,8200000001,'text','Текст',null) ? 'validationError', 'text replaced the voice';
  result:=tg_submit_answer('820000000000001','820000000000001',102,8200000002,'voice','','voice-file-1');
  assert (result->>'review')::boolean and result->>'purpose' = 'company-voice', 'voice not saved for review: '|| result::text;
  voice_id:=(result->'data'->>'id')::uuid;
  assert (select status='pending' and media_type='voice' and telegram_file_id='voice-file-1' and points=0 and submission_source='telegram' from submissions where id=voice_id), 'voice stored wrong';
  assert (tg_submit_answer('820000000000001','820000000000001',102,8200000002,'voice','','voice-file-1')->>'duplicate')::boolean, 'webhook repeat not recognised';
  assert (select count(*) from telegram_notification_jobs where submission_id=voice_id and kind='submission')=2, 'not sent to both mentors of the branch';
  assert not exists(select 1 from telegram_notification_jobs where submission_id=voice_id and recipient_id=sibling), 'voice leaked to another branch';
  assert tg_company_voice_error(member_id,game) like '%уже у наставника%', 'second voice allowed while waiting';
  assert app_ready_attempt_json((select a from ready_program_attempts a where user_id=member_id and task_id=game))->'voice'->>'status' = 'pending', 'game does not see the voice';

  -- «На доработку» lets the participant record again; acceptance gives at most 2 miles.
  select review_version into version from submissions where id=voice_id;
  result:=tg_review_submission(voice_id,publisher,false,'revision',0,'Расскажи подробнее про клуб',version);
  assert result ? 'data', 'revision failed: '|| result::text;
  assert tg_company_voice_error(member_id,game) is null, 'cannot record again after revision';
  insert into telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at,purpose) values
    ('v2b-'||member_id,member_id,game,'820000000000001',now()+interval '15 minutes','company-voice');
  perform tg_begin_submission('v2b-'||member_id,'820000000000001',200);
  voice_id:=(tg_submit_answer('820000000000001','820000000000001',201,8200000003,'voice','','voice-file-2')->'data'->>'id')::uuid;
  select review_version into version from submissions where id=voice_id;
  result:=tg_review_submission(voice_id,publisher,false,'accepted',10,'Отлично',version);
  assert (select status='accepted' and points=2 from submissions where id=voice_id), 'miles not capped at 2';
  assert tg_company_voice_error(member_id,game) like '%уже принял%', 'voice allowed after acceptance';

  -- Someone who finished the old version keeps it: the voice is only practice, attached to the old result.
  insert into submissions(user_id,task_id,status,media_type,answer_text,points,reviewed_at,submission_source)
    values(veteran,game,'accepted','text','Старая версия',2,now(),'interactive');
  insert into ready_program_attempts(user_id,task_id,current_step,status,earned_points,completed_at) values(veteran,game,8,'completed',2,now());
  assert (app_ready_attempt_json((select a from ready_program_attempts a where user_id=veteran and task_id=game))->>'legacy')::boolean, 'old result not recognised';
  insert into telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at,purpose) values
    ('v2c-'||veteran,veteran,game,'820000000000003',now()+interval '15 minutes','company-voice');
  assert not (tg_begin_submission('v2c-'||veteran,'820000000000003',300)->>'review')::boolean, 'old result treated as new';
  result:=tg_submit_answer('820000000000003','820000000000003',301,8200000004,'voice','','voice-file-3');
  assert (select company_voice_file_id='voice-file-3' from submissions where user_id=veteran and submission_source='interactive'), 'practice voice not attached';
  assert (select count(*) from submissions where user_id=veteran)=1, 'old result got a second record';

  -- Other games keep their rule: a wrong answer means starting over.
  assert (app_ready_program_spec('company-voyage')->>'steps')::int = 9 and jsonb_array_length(app_ready_program_spec('company-voyage')->'answers') = 18, 'spec not updated';
  assert not has_function_privilege('authenticated','tg_voice_for_review(uuid,uuid)','execute'), 'browser reaches voice rules';
end $$;
rollback;

-- Run on a disposable database after bootstrap. Every fixture is rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  team uuid := gen_random_uuid(); mentor uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  voice_task uuid := gen_random_uuid(); plain_task uuid := gen_random_uuid(); result jsonb;
begin
  insert into public.teams(id,name) values(team, 'voice-' || team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review,telegram_id) values
    (mentor,'Наставник','Наставник','Ветки',mentor || '@test.invalid',mentor::text,'test','admin',team,false,null),
    (member,'Алия Бекова','Алия','Бекова',member || '@test.invalid',member::text,'test','member',team,false,'830000000000001');
  update public.users set parent_user_id = mentor where id = member;
  insert into public.tasks(id,title,description,team_id,max_points,voice_answer) values
    (voice_task,'Расскажи о себе','Голосовое на минуту',team,10,true),(plain_task,'Гайд','Прочитай',team,10,false);

  -- A voice task: the bot is told to wait for a voice message and refuses anything else.
  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values('voice-' || member,member,voice_task,'830000000000001',now() + interval '15 minutes');
  result := public.tg_begin_submission('voice-' || member, '830000000000001', 100);
  assert (result->>'ready')::boolean and (result->>'voice')::boolean, 'the bot does not know the task wants a voice message';
  assert public.tg_submit_answer('830000000000001','830000000000001',101,8300000001,'text','Текст вместо голосового',null) ? 'validationError', 'text accepted for a voice task';
  assert public.tg_submit_answer('830000000000001','830000000000001',102,8300000002,'document','','file') ? 'validationError', 'a file accepted for a voice task';
  result := public.tg_submit_answer('830000000000001','830000000000001',103,8300000003,'voice','','voice-file');
  assert result ? 'data', 'voice answer refused';
  assert (select media_type = 'voice' and status = 'pending' and telegram_file_id = 'voice-file' from public.submissions where user_id = member and task_id = voice_task), 'voice answer not waiting for review';

  -- Other tasks keep their rules: no voice, text is fine.
  insert into public.telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values('plain-' || member,member,plain_task,'830000000000001',now() + interval '15 minutes');
  result := public.tg_begin_submission('plain-' || member, '830000000000001', 200);
  assert not (result->>'voice')::boolean, 'an ordinary task asks for a voice message';
  assert public.tg_submit_answer('830000000000001','830000000000001',201,8300000004,'voice','','voice-2') ? 'validationError', 'voice accepted for an ordinary task';
  assert public.tg_submit_answer('830000000000001','830000000000001',202,8300000005,'text','Прочитала гайд',null) ? 'data', 'text refused for an ordinary task';
end;
$$;
rollback;

\set ON_ERROR_STOP on
-- The migration is replayable after older integration migrations.
\ir ../supabase/20261012-count-your-dream.sql
\ir ../supabase/20261012-count-your-dream.sql
begin;
do $$
declare team uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  dream_task uuid; result jsonb; answers jsonb; reward_id uuid; i integer;
begin
  insert into teams(id,name) values(team,'dream-'||team),(other_team,'other-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,mentor),
    (outsider,'Outsider','Outside','Test',outsider||'@test.invalid',outsider::text,'test','member',other_team,null);
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Посчитай свою мечту','templateKey','count-your-dream','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Посчитай свою мечту','description','Расчёт мечты','maxPoints',10,'publicationType','evergreen','interactiveKind','count-your-dream'))));
  dream_task:=(result->'tasks'->0->>'id')::uuid;
  if dream_task is null then raise exception 'Cannot publish: %',result; end if;
  if app_ready_task_error(outsider,dream_task) is null then raise exception 'Other team can play'; end if;
  if not (app_count_your_dream(outsider,dream_task,'start',0,'{}') ? 'validationError') then raise exception 'Other team started'; end if;
  if not (app_count_your_dream(member_id,dream_task,'complete',0,'{}') ? 'validationError') then raise exception 'Premature reward'; end if;
  answers:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('n','Дом для семьи','p',1200000)),
    'currency','₸','howlong','1–3 года','plan','Да','confidence',7,'save',30000,'caseChoice','',
    'extraN','','extraP',null,'why','Хочу дом для своей семьи','value','Семья','time','5–10 часов','feel','Вдохновение','pledged',true);
  result:=app_count_your_dream(member_id,dream_task,'start',0,'{}');
  if (result->>'step')::int<>0 then raise exception 'Wrong initial state'; end if;
  if not (app_count_your_dream(member_id,dream_task,'save',12,answers) ? 'validationError') then raise exception 'Skipped steps'; end if;
  for i in 1..12 loop result:=app_count_your_dream(member_id,dream_task,'save',i,answers); end loop;
  if (result->>'step')::int<>12 then raise exception 'Progress not saved'; end if;
  if (app_count_your_dream(member_id,dream_task,'start',0,'{}')->'answers'->>'why') is distinct from 'Хочу дом для своей семьи' then raise exception 'Answers lost on reopen'; end if;
  if not (app_count_your_dream(member_id,dream_task,'save',13,answers) ? 'validationError') then raise exception 'Invalid screen accepted'; end if;
  if not (app_count_your_dream(member_id,dream_task,'complete',0,'{}') ? 'validationError') then raise exception 'Invalid branch got reward'; end if;
  answers:=jsonb_set(answers,'{caseChoice}','"big"'::jsonb)||jsonb_build_object('extraN','Путешествие');
  perform app_count_your_dream(member_id,dream_task,'save',12,answers);
  if not (app_count_your_dream(member_id,dream_task,'complete',0,'{}') ? 'validationError') then raise exception 'Invalid second dream got reward'; end if;
  answers:=jsonb_set(answers,'{extraP}','400000'::jsonb);
  if app_count_dream_valid(answers) is distinct from true
    or app_count_dream_valid(answers||jsonb_build_object('save',0,'caseChoice','')) is distinct from true
    or app_count_dream_valid(answers||jsonb_build_object('save',10000,'caseChoice','')) is distinct from true
    or app_count_dream_valid(answers||jsonb_build_object('caseChoice','fast')) is distinct from true
    or app_count_dream_valid(answers||jsonb_build_object('save',1000000,'caseChoice','fast')) is distinct from false
    or app_count_dream_valid(answers||jsonb_build_object('why','')) is distinct from false then raise exception 'Calculator branch validation failed'; end if;
  perform app_count_your_dream(member_id,dream_task,'save',12,answers);
  result:=app_count_your_dream(member_id,dream_task,'complete',0,'{}'); reward_id:=(result->'submission'->>'id')::uuid;
  if reward_id is null or (result->'submission'->>'points')::int<>10 or result->>'completed'<>'true' then raise exception 'Reward failed: %',result; end if;
  result:=app_count_your_dream(member_id,dream_task,'complete',0,'{}');
  if (result->'submission'->>'id')::uuid is distinct from reward_id or (select count(*) from submissions where user_id=member_id and task_id=dream_task)<>1 then raise exception 'Duplicate reward'; end if;
  if tg_company_voice_error(member_id,dream_task) is not null then raise exception 'Voice eligibility broken: %',tg_company_voice_error(member_id,dream_task); end if;
  update submissions set company_voice_file_id='voice-id' where id=reward_id;
  if tg_can_receive_company_voice(mentor,reward_id) is distinct from true or tg_can_receive_company_voice(outsider,reward_id) is distinct from false then raise exception 'Voice branch delivery access broken'; end if;
  if has_function_privilege('authenticated','app_count_your_dream(uuid,uuid,text,integer,jsonb)','execute') then raise exception 'Public award RPC'; end if;
end $$;
rollback;

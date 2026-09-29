\set ON_ERROR_STOP on
-- The migration must be replayable on an existing installation.
\ir ../supabase/20261017-dream-route.sql
\ir ../supabase/20261017-dream-route.sql
begin;
do $$
declare team uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid(); mentor uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  route_task uuid; result jsonb; answers jsonb; reward_id uuid; i integer;
begin
  insert into teams(id,name) values(team,'route-'||team),(other_team,'other-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id,parent_user_id) values
    (mentor,'Mentor','Mentor','Test',mentor||'@test.invalid',mentor::text,'test','admin',team,null),
    (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team,mentor),
    (outsider,'Outsider','Outside','Test',outsider||'@test.invalid',outsider::text,'test','member',other_team,null);
  result:=app_create_program(jsonb_build_object('teamId',team,'publisherId',mentor,'title','Мечта → маршрут','templateKey','dream-route','deadlineHours',720,
    'tasks',jsonb_build_array(jsonb_build_object('title','Мечта → маршрут','description','Учебный маршрут','maxPoints',10,'publicationType','evergreen','interactiveKind','dream-route'))));
  route_task:=(result->'tasks'->0->>'id')::uuid;
  if route_task is null then raise exception 'Cannot publish route: %',result; end if;
  if app_ready_task_error(outsider,route_task) is null then raise exception 'Other team can play'; end if;
  if not (app_dream_route(outsider,route_task,'start',0,'{}') ? 'validationError') then raise exception 'Other team started'; end if;
  if not (app_dream_route(member_id,route_task,'complete',0,'{}') ? 'validationError') then raise exception 'Premature reward'; end if;
  answers:=jsonb_build_object('study',jsonb_build_array(true,true),'studyTime','по утрам','dream','Дом для семьи','sum',1200000,'currency','₸',
    'hook','💰 Найду деньги на старт','gameAnswers',jsonb_build_array(1,0,0,1,0,1,0),'flipOpen',true,
    'quizAnswers',jsonb_build_array(1,0,1,1,2),'station','💵 Первый доход — за 14 дней','names',jsonb_build_array('Алия','Бек','Саша'));
  if not app_dream_route_valid(answers) or app_dream_route_valid(answers-'names')
    or app_dream_route_valid(jsonb_set(answers,'{gameAnswers}','[0,0]'::jsonb))
    or app_dream_route_valid(jsonb_set(answers,'{gameAnswers}','{}'::jsonb))
    or app_dream_route_valid(jsonb_set(answers,'{names}','42'::jsonb))
    or app_dream_route_valid(jsonb_set(answers,'{sum}','-1'::jsonb)) then raise exception 'Route validation failed'; end if;
  result:=app_dream_route(member_id,route_task,'start',0,'{}');
  if (result->>'step')::int<>0 then raise exception 'Wrong initial step'; end if;
  if not (app_dream_route(member_id,route_task,'save',11,answers) ? 'validationError') then raise exception 'Skipped screens'; end if;
  for i in 1..11 loop result:=app_dream_route(member_id,route_task,'save',i,answers); end loop;
  if (result->>'step')::int<>11 or (app_dream_route(member_id,route_task,'start',0,'{}')->'answers'->>'dream') is distinct from 'Дом для семьи' then raise exception 'Progress lost'; end if;
  if not (app_dream_route(member_id,route_task,'save',12,answers) ? 'validationError') then raise exception 'Invalid step accepted'; end if;
  result:=app_dream_route(member_id,route_task,'complete',0,'{}'); reward_id:=(result->'submission'->>'id')::uuid;
  if reward_id is null or (result->'submission'->>'points')::int<>10 then raise exception 'Reward failed: %',result; end if;
  result:=app_dream_route(member_id,route_task,'complete',0,'{}');
  if (result->'submission'->>'id')::uuid is distinct from reward_id
    or (select count(*) from submissions where user_id=member_id and task_id=route_task)<>1 then raise exception 'Duplicate reward'; end if;
  if tg_company_voice_error(member_id,route_task) is not null then raise exception 'Voice eligibility broken'; end if;
  update submissions set company_voice_file_id='voice-id' where id=reward_id;
  if tg_can_receive_company_voice(mentor,reward_id) is distinct from true
    or tg_can_receive_company_voice(outsider,reward_id) is distinct from false then raise exception 'Voice delivery scope broken'; end if;
  if has_function_privilege('authenticated','app_dream_route(uuid,uuid,text,integer,jsonb)','execute') then raise exception 'Public reward RPC'; end if;
end $$;
rollback;

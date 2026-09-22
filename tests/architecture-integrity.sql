\set ON_ERROR_STOP on
begin;
do $$
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  mentor uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  child uuid := gen_random_uuid(); candidate uuid := gen_random_uuid(); req uuid := gen_random_uuid();
  task uuid := gen_random_uuid(); program uuid; outcome jsonb; before_count bigint; total bigint;
begin
  insert into teams(id,name) values(team,'audit-'||team),(other_team,'audit-'||other_team);
  insert into users(id,name,first_name,last_name,email,login,password_hash,role,team_id) values
    (mentor,'Root Mentor','Root','Mentor',mentor||'@test.invalid',mentor::text,'test','admin',team),
    (outsider,'No Team','No','Team',outsider||'@test.invalid',outsider::text,'test','admin',null),
    (member,'Member One','Member','One',member||'@test.invalid',member::text,'test','member',team),
    (child,'Child One','Child','One',child||'@test.invalid',child::text,'test','member',team),
    (candidate,'New Member','New','Member',candidate||'@test.invalid',candidate::text,'test','member',null);
  update users set parent_user_id = member where id = child;
  begin
    update users set team_id = other_team, parent_user_id = null where id = member;
    raise exception 'FAIL: parent moved with children';
  exception when check_violation then null; end;
  if (select team_id from users where id = member) <> team then raise exception 'FAIL: failed move was not rolled back'; end if;

  insert into team_join_requests(id,user_id,team_id) values(req,candidate,team);
  outcome := app_review_join_request(req,'rejected',outsider,false);
  if outcome->>'forbidden' <> 'true' then raise exception 'FAIL: teamless mentor processed a request'; end if;
  update users set team_id = other_team where id = outsider;
  outcome := app_review_join_request(req,'approved',outsider,false);
  if outcome->>'forbidden' <> 'true' then raise exception 'FAIL: foreign mentor processed a request'; end if;
  update users set team_id = team where id = candidate;
  if (select status from team_join_requests where id = req) <> 'approved' then raise exception 'FAIL: assignment did not close request'; end if;
  outcome := app_review_join_request(req,'rejected',mentor,false);
  if not outcome ? 'validationError' then raise exception 'FAIL: processed request was overwritten'; end if;

  insert into tasks(id,team_id,title,description,publication_type,audience_root_id,publisher_id)
    values(task,team,'Audit task','Audit answer','evergreen',member,member);
  begin
    delete from users where id = member;
    raise exception 'FAIL: deleting audience root widened publication scope';
  exception when foreign_key_violation then null; end;
  if (select audience_root_id from tasks where id = task) is distinct from member then raise exception 'FAIL: audience was changed'; end if;
  insert into submissions(user_id,task_id,status,points,media_type,answer_text)
    select member,task,'accepted',2,'text','Historical answer '||n from generate_series(1,1105) n;
  select points into total from app_ranking(team,'points') where id = member;
  if total <> 2210 then raise exception 'FAIL: points beyond 1000 rows were lost: %',total; end if;
  insert into star_awards(user_id,mentor_id,team_id,stars,award_kind)
    values(member,mentor,team,1,'starter'),(member,mentor,team,3,'premium'),(member,mentor,team,5,null);
  select points into total from app_ranking(team,'stars') where id = member;
  if total <> 9 then raise exception 'FAIL: named and historical awards must add up'; end if;
  if exists(select 1 from app_ranking(other_team,'points') where id = member) then raise exception 'FAIL: ranking crossed teams'; end if;
  select points into total from app_ranking(team,'points') where id = child;
  if total <> 0 then raise exception 'FAIL: zero-score member missing'; end if;

  outcome := app_update_network_user(mentor,member,jsonb_build_object('parent_user_id',mentor,'can_review',true));
  if not outcome ? 'data' or not exists(select 1 from team_assignment_history
    where user_id = member and new_parent_user_id = mentor and changed_by = mentor) then
    raise exception 'FAIL: network change did not record its author';
  end if;
  begin
    perform app_update_network_user(mentor,member,jsonb_build_object('parent_user_id',child,'can_review',false));
    raise exception 'FAIL: network cycle accepted';
  exception when raise_exception then
    if sqlerrm <> 'A user hierarchy cycle is not allowed' then raise; end if;
  end;
  if not (select can_review from users where id = member) then raise exception 'FAIL: permission change escaped rollback'; end if;
  if (select count(*) from team_assignment_history where user_id = member) <> 1 then raise exception 'FAIL: failed move left audit record'; end if;
  insert into submissions(user_id,task_id,status,media_type,answer_text) values(child,task,'pending','text','Child answer');
  outcome := app_mentor_counts(member);
  if (outcome->>'pending')::int <> 1 or (outcome->>'accepted')::int <> 0 then raise exception 'FAIL: branch counts include self or lose children'; end if;
  outcome := app_mentor_counts(mentor);
  if (outcome->>'pending')::int <> 1 or (outcome->>'accepted')::int <> 1105 then raise exception 'FAIL: admin counts are truncated'; end if;
  if (app_mentor_counts(outsider)->>'pending')::int <> 0 then raise exception 'FAIL: counters crossed teams'; end if;

  select count(*) into before_count from task_programs;
  begin
    perform app_create_program(jsonb_build_object('teamId',team,'title','Rollback program','deadlineHours',24,
      'tasks',jsonb_build_array(jsonb_build_object('title','Valid step','description','Answer me','maxPoints',10),
        jsonb_build_object('title','x','description','Invalid step','maxPoints',10))));
    raise exception 'FAIL: invalid step accepted';
  exception when check_violation then null; end;
  if (select count(*) from task_programs) <> before_count then raise exception 'FAIL: empty program left after rollback'; end if;
  outcome := app_create_program(jsonb_build_object('teamId',team,'title','Atomic program','deadlineHours',24,
    'tasks',jsonb_build_array(jsonb_build_object('title','Step one','description','Answer one','maxPoints',10),
      jsonb_build_object('title','Step two','description','Answer two','maxPoints',10))));
  program := (outcome->'program'->>'id')::uuid;
  update users set can_publish_tasks = true where id = member;
  outcome := app_update_program(program,'{"title":"Unauthorized change"}',member,false);
  if outcome->>'forbidden' <> 'true' then raise exception 'FAIL: publisher edited CEO program'; end if;
  outcome := app_update_program(program,'{"deadlineHours":48}',mentor,false);
  if not outcome ? 'data' or exists(select 1 from tasks where program_id = program and deadline_hours <> 48) then
    raise exception 'FAIL: program deadlines not changed atomically'; end if;
  begin
    perform app_update_program(program,'{"deadlineHours":9999}',mentor,false);
    raise exception 'FAIL: invalid deadline accepted';
  exception when check_violation then null; end;
  if (select deadline_hours from task_programs where id = program) <> 48 then raise exception 'FAIL: update did not roll back'; end if;
  if has_function_privilege('anon','app_ranking(uuid,text)','execute')
    or has_function_privilege('authenticated','app_review_join_request(uuid,text,uuid,boolean)','execute') then
    raise exception 'FAIL: public role can invoke privileged functions'; end if;
  -- Team deletion must still detach an entire branch without a partial state.
  delete from teams where id = team;
  if exists(select 1 from users where id in (member,child) and (team_id is not null or parent_user_id is not null)) then
    raise exception 'FAIL: deleted team left hierarchy edges';
  end if;
end $$;
rollback;

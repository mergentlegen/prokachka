\set ON_ERROR_STOP on
begin;
do $$
declare
  team_id uuid := gen_random_uuid(); mentor_id uuid := gen_random_uuid(); member_id uuid := gen_random_uuid();
  task_key uuid; thread_id uuid; result jsonb;
begin
  insert into public.teams(id,name) values(team_id,'miles-test-'||team_id);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id)
    values (mentor_id,'Mentor','Mentor','Test',mentor_id||'@test.invalid',mentor_id::text,'test','admin',team_id),
      (member_id,'Member','Member','Test',member_id||'@test.invalid',member_id::text,'test','member',team_id);

  insert into public.tasks(team_id,title,description,max_points,publication_type)
    values(team_id,'Large reward','Test task',25000,'evergreen') returning id into task_key;
  insert into public.submissions(user_id,task_id,status,media_type,answer_text,points)
    values(member_id,task_key,'accepted','text','Completed',25000);
  select id into thread_id from public.feedback_threads
    where member_user_id=member_id and task_id=task_key;
  insert into public.feedback_events(thread_id,kind,author_user_id,author_name,review_status,points,review_version)
    values(thread_id,'review',mentor_id,'Mentor','accepted',25000,1);

  result := public.app_create_program(jsonb_build_object('teamId',team_id,'publisherId',mentor_id,
    'title','Large reward program','deadlineHours',24,
    'tasks',jsonb_build_array(jsonb_build_object('title','Large step','description','Test step','maxPoints',25000))));
  if (result->'tasks'->0->>'max_points')::int is distinct from 25000 then
    raise exception 'Program reward was capped';
  end if;
  if (select points from public.submissions where task_id=task_key limit 1) is distinct from 25000 then
    raise exception 'Submission reward was capped';
  end if;
end $$;
rollback;

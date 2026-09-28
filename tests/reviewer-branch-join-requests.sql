-- Disposable database only: all fixtures are rolled back.
begin;
do $$
declare
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid(); reviewer uuid := gen_random_uuid(); child uuid := gen_random_uuid();
  sibling uuid := gen_random_uuid(); foreign_reviewer uuid := gen_random_uuid();
  applicant_a uuid := gen_random_uuid(); applicant_b uuid := gen_random_uuid(); applicant_c uuid := gen_random_uuid(); applicant_d uuid := gen_random_uuid();
  invite_child uuid := gen_random_uuid(); invite_sibling uuid := gen_random_uuid(); invite_foreign uuid := gen_random_uuid();
  request_a uuid := gen_random_uuid(); request_b uuid := gen_random_uuid(); request_c uuid := gen_random_uuid(); request_d uuid := gen_random_uuid();
  outcome jsonb;
begin
  insert into public.teams(id,name) values(team,'reviewer-test-'||team),(other_team,'reviewer-test-'||other_team);
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,role,team_id,can_review) values
    (admin_id,'Admin','Admin','Root',admin_id||'@test.invalid',admin_id::text,'test','admin',team,false),
    (reviewer,'Reviewer','Branch','Reviewer',reviewer||'@test.invalid',reviewer::text,'test','member',team,true),
    (child,'Child','Child','Member',child||'@test.invalid',child::text,'test','member',team,false),
    (sibling,'Sibling','Sibling','Member',sibling||'@test.invalid',sibling::text,'test','member',team,true),
    (foreign_reviewer,'Foreign','Foreign','Reviewer',foreign_reviewer||'@test.invalid',foreign_reviewer::text,'test','member',other_team,true),
    (applicant_a,'Applicant A','Applicant','Alpha',applicant_a||'@test.invalid',applicant_a::text,'test','member',null,false),
    (applicant_b,'Applicant B','Applicant','Beta',applicant_b||'@test.invalid',applicant_b::text,'test','member',null,false),
    (applicant_c,'Applicant C','Applicant','Gamma',applicant_c||'@test.invalid',applicant_c::text,'test','member',null,false),
    (applicant_d,'Applicant D','Applicant','Delta',applicant_d||'@test.invalid',applicant_d::text,'test','member',null,false);
  update public.users set parent_user_id = admin_id where id in (reviewer,sibling);
  update public.users set parent_user_id = reviewer where id = child;
  insert into public.team_invitation_links(id,team_id,inviter_user_id,token_hash) values
    (invite_child,team,child,invite_child::text),(invite_sibling,team,sibling,invite_sibling::text),
    (invite_foreign,other_team,foreign_reviewer,invite_foreign::text);
  insert into public.team_join_requests(id,user_id,team_id,invited_by_user_id,invitation_id) values
    (request_a,applicant_a,team,child,invite_child),(request_b,applicant_b,team,sibling,invite_sibling),
    (request_c,applicant_c,team,null,null),(request_d,applicant_d,other_team,foreign_reviewer,invite_foreign);

  if jsonb_array_length(public.app_reviewable_join_requests(reviewer)) <> 1
    or public.app_reviewable_join_requests(reviewer)->0->>'id' <> request_a::text then
    raise exception 'Reviewer did not see only descendant invitation'; end if;
  if (public.app_mentor_counts(reviewer)->>'requests')::int <> 1
    or (public.app_mentor_counts(admin_id)->>'requests')::int <> 3 then
    raise exception 'Incorrect scoped request counters'; end if;
  if jsonb_array_length(public.app_reviewable_join_requests(applicant_a)) <> 0 then
    raise exception 'Non-reviewer read branch applications'; end if;
  if public.app_review_join_request(request_b,'approved',reviewer,false)->>'forbidden' <> 'true'
    or public.app_review_join_request(request_c,'rejected',reviewer,false)->>'forbidden' <> 'true'
    or public.app_review_join_request(request_d,'approved',reviewer,false)->>'forbidden' <> 'true' then
    raise exception 'Reviewer escaped own branch'; end if;
  if public.app_review_join_request(request_a,'rejected',sibling,false)->>'forbidden' <> 'true' then
    raise exception 'Sibling reviewer processed another branch'; end if;

  update public.users set parent_user_id = sibling where id = child;
  if jsonb_array_length(public.app_reviewable_join_requests(reviewer)) <> 0
    or public.app_review_join_request(request_a,'approved',reviewer,false)->>'forbidden' <> 'true'
    or not exists(select 1 from jsonb_array_elements(public.app_reviewable_join_requests(sibling)) item
      where item->>'id' = request_a::text) then
    raise exception 'Branch move did not immediately change review access'; end if;
  update public.users set parent_user_id = reviewer where id = child;

  update public.users set can_review = false where id = reviewer;
  if jsonb_array_length(public.app_reviewable_join_requests(reviewer)) <> 0
    or public.app_review_join_request(request_a,'approved',reviewer,false)->>'forbidden' <> 'true' then
    raise exception 'Revoked reviewer still has access'; end if;
  update public.users set can_review = true where id = reviewer;

  outcome := public.app_review_join_request(request_a,'approved',reviewer,false);
  if outcome->>'processed' <> 'true' or not exists(select 1 from public.users where id = applicant_a and team_id = team and parent_user_id = child)
    or not exists(select 1 from public.team_join_requests where id = request_a and reviewed_by = reviewer and status = 'approved') then
    raise exception 'Reviewer approval did not join the invited branch'; end if;
  if jsonb_array_length(public.app_reviewable_join_requests(reviewer)) <> 0 then
    raise exception 'Processed application remains visible'; end if;
  if public.app_review_join_request(request_c,'rejected',admin_id,false)->>'processed' <> 'true' then
    raise exception 'Admin lost team-wide review'; end if;
  if public.app_review_join_request(request_b,'rejected',sibling,false)->>'processed' <> 'true' then
    raise exception 'Sibling could not process own invitation'; end if;
  if public.app_review_join_request(request_d,'approved',foreign_reviewer,false)->>'processed' <> 'true' then
    raise exception 'Other-team reviewer could not process own branch'; end if;
  if has_function_privilege('authenticated','public.app_reviewable_join_requests(uuid,integer,integer)','execute')
    or has_function_privilege('anon','public.app_reviewable_join_requests(uuid,integer,integer)','execute') then
    raise exception 'Branch listing function exposed to browser roles'; end if;
end;
$$;
rollback;

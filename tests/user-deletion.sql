-- Run only against an isolated disposable test database; all fixture rows roll back.
\set ON_ERROR_STOP on
begin;
do $$
#variable_conflict use_variable
declare
  team_id uuid := gen_random_uuid(); mentor_id uuid := gen_random_uuid(); branch_id uuid := gen_random_uuid();
  child_id uuid := gen_random_uuid(); sibling_id uuid := gen_random_uuid(); auth_id uuid := gen_random_uuid();
  program_id uuid := gen_random_uuid(); task_id uuid := gen_random_uuid(); global_task uuid := gen_random_uuid();
  attachment_path text; result jsonb; auth_job public.user_auth_cleanup_queue%rowtype;
  pdf_job public.task_attachment_cleanup_queue%rowtype;
begin
  insert into public.teams(id,name) values(team_id,'delete-' || team_id);
  insert into auth.users(id,email,email_confirmed_at) values(auth_id,auth_id || '@test.invalid',now());
  insert into public.users(id,name,first_name,last_name,email,login,password_hash,team_id,role,auth_user_id,can_publish_tasks)
    values(mentor_id,'Root Mentor','Root','Mentor',mentor_id || '@test.invalid',mentor_id::text,'test',team_id,'admin',null,true),
      (branch_id,'Branch Mentor','Branch','Mentor',branch_id || '@test.invalid',branch_id::text,'!supabase-auth',team_id,'member',auth_id,true),
      (child_id,'Child Member','Child','Member',child_id || '@test.invalid',child_id::text,'test',team_id,'member',null,false),
      (sibling_id,'Sibling Member','Sibling','Member',sibling_id || '@test.invalid',sibling_id::text,'test',team_id,'member',null,false);
  update public.users set parent_user_id=mentor_id where id in (branch_id,sibling_id);
  update public.users set parent_user_id=branch_id where id=child_id;
  insert into public.task_programs(id,team_id,title,template_key,publisher_id,audience_root_id)
    values(program_id,team_id,'Branch program','dream-plan',branch_id,branch_id);
  insert into public.tasks(id,team_id,title,description,program_id,interactive_kind,publication_type,publisher_id,audience_root_id)
    values(task_id,team_id,'Branch task','For branch',program_id,'dream-plan','evergreen',branch_id,branch_id);
  insert into public.tasks(id,team_id,title,description,publication_type,publisher_id)
    values(global_task,team_id,'Global task','For team','evergreen',mentor_id);
  insert into public.announcements(team_id,author_id,audience_root_id,title,content)
    values(team_id,branch_id,branch_id,'Branch news','Branch text');
  insert into public.submissions(user_id,task_id,answer_text,media_type)
    values(child_id,task_id,'Child answer','text');
  attachment_path := task_id::text || '/' || gen_random_uuid()::text || '.pdf';
  insert into public.task_attachments(task_id,storage_path,file_name,size_bytes)
    values(task_id,attachment_path,'test.pdf',100);

  result := public.app_delete_user(branch_id,true);
  if (result->'impact'->>'children')::int <> 1 or (result->'impact'->>'tasks')::int <> 1
    or (result->'impact'->>'programs')::int <> 1 or (result->'impact'->>'announcements')::int <> 1
    or (result->'impact'->>'otherSubmissions')::int <> 1 then raise exception 'FAIL: incorrect deletion preview: %',result; end if;
  if not exists(select 1 from public.users where id=branch_id) then raise exception 'FAIL: preview deleted user'; end if;
  result := public.app_delete_user(branch_id,false);
  if result->>'deleted' <> 'true' or exists(select 1 from public.users where id=branch_id) then raise exception 'FAIL: branch was not deleted'; end if;
  if (select parent_user_id from public.users where id=child_id) is distinct from mentor_id
    or (select parent_user_id from public.users where id=sibling_id) is distinct from mentor_id then
    raise exception 'FAIL: survivors were moved to wrong branch'; end if;
  if exists(select 1 from public.tasks t where t.id=task_id) or exists(select 1 from public.task_programs p where p.id=program_id)
    or exists(select 1 from public.announcements a where a.audience_root_id=branch_id)
    or exists(select 1 from public.submissions s where s.task_id=task_id) then raise exception 'FAIL: scoped content survived'; end if;
  if not exists(select 1 from public.tasks where id=global_task) then raise exception 'FAIL: global content was deleted'; end if;
  if not exists(select 1 from public.user_auth_cleanup_queue where auth_user_id=auth_id)
    or not exists(select 1 from public.task_attachment_cleanup_queue where storage_path=attachment_path) then
    raise exception 'FAIL: external cleanup was not queued'; end if;
  if public.app_delete_user(branch_id,false)->>'notFound' <> 'true' then raise exception 'FAIL: duplicate delete reported success'; end if;
  if not (public.app_delete_user(mentor_id,true) ? 'impact') then raise exception 'FAIL: next user cannot be previewed'; end if;
  create table public.user_delete_blocker(user_id uuid references public.users(id) on delete restrict);
  insert into user_delete_blocker values(mentor_id);
  begin
    perform public.app_delete_user(mentor_id,false);
    raise exception 'FAIL: unexpected foreign key was ignored';
  exception when foreign_key_violation then null; end;
  if not exists(select 1 from public.users u where u.id=mentor_id)
    or (select u.parent_user_id from public.users u where u.id=child_id) is distinct from mentor_id then
    raise exception 'FAIL: failed deletion partially changed hierarchy'; end if;
  drop table public.user_delete_blocker;
  result := public.app_delete_user(mentor_id,false);
  if result->>'deleted' <> 'true' then raise exception 'FAIL: root deletion result %',result; end if;
  if (select u.parent_user_id from public.users u where u.id=child_id) is not null then raise exception 'FAIL: child not detached'; end if;
  if (select u.parent_user_id from public.users u where u.id=sibling_id) is not null then raise exception 'FAIL: sibling not detached'; end if;
  if not exists(select 1 from public.tasks t where t.id=global_task) then raise exception 'FAIL: global task removed'; end if;
  if public.app_delete_user(child_id,false)->>'deleted' <> 'true'
    or public.app_delete_user(sibling_id,false)->>'deleted' <> 'true' then
    raise exception 'FAIL: consecutive account deletion failed'; end if;
  select * into auth_job from public.app_claim_user_cleanup(1);
  if auth_job.auth_user_id is distinct from auth_id then raise exception 'FAIL: Auth cleanup not claimable'; end if;
  perform public.app_ack_user_cleanup(auth_id,auth_job.lease_token,false);
  if not exists(select 1 from public.user_auth_cleanup_queue q where q.auth_user_id=auth_id) then
    raise exception 'FAIL: failed Auth cleanup was lost'; end if;
  update public.user_auth_cleanup_queue set next_attempt_at=now() where auth_user_id=auth_id;
  select * into auth_job from public.app_claim_user_cleanup(1);
  perform public.app_ack_user_cleanup(auth_id,auth_job.lease_token,true);
  if exists(select 1 from public.user_auth_cleanup_queue q where q.auth_user_id=auth_id) then
    raise exception 'FAIL: successful Auth cleanup was retained'; end if;
  select * into pdf_job from public.app_claim_task_attachment_cleanup(1);
  if pdf_job.storage_path is distinct from attachment_path then raise exception 'FAIL: PDF cleanup not claimable'; end if;
  perform public.app_ack_task_attachment_cleanup(attachment_path,pdf_job.lease_token,true);
  if exists(select 1 from public.task_attachment_cleanup_queue q where q.storage_path=attachment_path) then
    raise exception 'FAIL: successful PDF cleanup was retained'; end if;
  if has_function_privilege('authenticated','public.app_delete_user(uuid,boolean)','execute')
    or has_table_privilege('authenticated','public.user_auth_cleanup_queue','select') then
    raise exception 'FAIL: deletion internals exposed to clients'; end if;
end $$;
rollback;

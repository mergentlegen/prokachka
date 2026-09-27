\set ON_ERROR_STOP on
\ir ../supabase/20261004-task-feed-order.sql
\ir ../supabase/20261004-task-feed-order.sql
begin;
create function pg_temp.require(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception 'FAIL: %',message; end if; end $$;
do $$
declare
  team uuid:=gen_random_uuid(); other_team uuid:=gen_random_uuid(); root_user uuid:=gen_random_uuid(); branch uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid(); child uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); branch_task uuid:=gen_random_uuid(); sibling_task uuid:=gen_random_uuid(); new_task uuid:=gen_random_uuid();
  game uuid:=gen_random_uuid(); branch_game uuid:=gen_random_uuid(); step_program uuid:=gen_random_uuid(); step_task uuid:=gen_random_uuid();
  before_rows jsonb; snapshot jsonb; changed jsonb; old_revision text;
begin
  insert into teams(id,name) values(team,'Order fixture'),(other_team,'Other order fixture');
  insert into users(id,name,first_name,last_name,login,email,password_hash,team_id,role,can_publish_tasks) values
    (root_user,'Root Mentor','Root','Mentor',root_user::text,root_user||'@test.invalid','test',team,'admin',true),
    (branch,'Branch Mentor','Branch','Mentor',branch::text,branch||'@test.invalid','test',team,'member',true),
    (sibling,'Sibling Mentor','Sibling','Mentor',sibling::text,sibling||'@test.invalid','test',team,'member',true),
    (child,'Child Member','Child','Member',child::text,child||'@test.invalid','test',team,'member',false);
  update users set parent_user_id=root_user where id in (branch,sibling);
  update users set parent_user_id=branch where id=child;
  insert into tasks(id,team_id,title,description,publication_type,publisher_id,audience_root_id,created_at) values
    (a,team,'Task A','Description','evergreen',root_user,null,'2026-01-01'),
    (b,team,'Task B','Description','evergreen',root_user,null,'2026-01-02'),
    (branch_task,team,'Branch task','Description','evergreen',branch,branch,'2026-01-04'),
    (sibling_task,team,'Sibling task','Description','evergreen',sibling,sibling,'2026-01-05');
  insert into task_programs(id,team_id,title,template_key,publisher_id,audience_root_id,created_at) values
    (game,team,'Root game','dream-plan',root_user,null,'2026-01-03'),
    (branch_game,team,'Branch game','dream-plan',branch,branch,'2026-01-03'),
    (step_program,team,'Sequential program',null,root_user,null,'2026-01-03');
  insert into tasks(team_id,title,description,program_id,interactive_kind,publication_type,publisher_id,audience_root_id,created_at) values
    (team,'Root game','Description',game,'dream-plan','evergreen',root_user,null,'2026-01-03'),
    (team,'Branch game','Description',branch_game,'dream-plan','evergreen',branch,branch,'2026-01-03');
  insert into tasks(id,team_id,title,description,program_id,publication_type,position,deadline_hours,publisher_id)
    values(step_task,team,'Sequential step','Description',step_program,'sequential',1,72,root_user);
  select jsonb_agg(to_jsonb(t) order by id) into before_rows from tasks t where team_id=team;

  snapshot:=app_task_order_snapshot(root_user,true);
  perform pg_temp.require(jsonb_path_query_array(snapshot,'$.items[*].key')=jsonb_build_array(a::text,b::text,'game:dream-plan'),'default order and root scope');
  perform pg_temp.require(app_task_order_snapshot(child,true) ? 'forbidden','ordinary member cannot edit');
  changed:=app_save_task_order(root_user,snapshot->>'revision',array[]::text[],array['game:dream-plan',b::text,a::text]);
  perform pg_temp.require(changed->>'customized'='true','team order created');
  perform pg_temp.require(jsonb_path_query_array(changed,'$.items[*].key')=jsonb_build_array('game:dream-plan',b::text,a::text),'saved order is applied');
  perform pg_temp.require(app_save_task_order(root_user,snapshot->>'revision',array[]::text[],array[a::text,b::text,'game:dream-plan']) ? 'conflict','stale revision rejected');
  snapshot:=changed;
  perform pg_temp.require(app_save_task_order(root_user,snapshot->>'revision',array[]::text[],array[a::text,a::text,'game:dream-plan']) ? 'invalid','duplicates rejected');
  perform pg_temp.require(app_save_task_order(root_user,snapshot->>'revision',array[]::text[],array[a::text,b::text,sibling_task::text]) ? 'invalid','foreign branch or omitted game rejected');
  perform pg_temp.require(app_save_task_order(root_user,snapshot->>'revision',array[a::text],array[b::text,'game:dream-plan']) ? 'invalid','drag cannot change pin state');

  snapshot:=app_task_order_snapshot(branch,true);
  perform pg_temp.require(jsonb_path_query_array(snapshot,'$.items[*].key')=jsonb_build_array('game:dream-plan',b::text,a::text,branch_task::text),'branch inherits shared order and appends own task');
  perform pg_temp.require((snapshot->'items'->0->>'taskId')<>(select id::text from tasks where program_id=game),'nearest game represents one logical slot');
  changed:=app_save_task_order(branch,snapshot->>'revision',array[]::text[],array[branch_task::text,a::text,'game:dream-plan',b::text]);
  perform pg_temp.require(jsonb_path_query_array(app_task_order_snapshot(child,false),'$.items[*].key')=jsonb_path_query_array(changed,'$.items[*].key'),'child inherits closest custom order');
  perform pg_temp.require(jsonb_path_query_array(app_task_order_snapshot(sibling,false),'$.items[*].key')=jsonb_build_array('game:dream-plan',b::text,a::text,sibling_task::text),'sibling remains isolated');
  perform pg_temp.require((select jsonb_agg(to_jsonb(t) order by id) from tasks t where team_id=team)=before_rows,'reorder never modifies task content, dates or steps');
  update users set can_publish_tasks=false where id=branch;
  perform pg_temp.require(app_save_task_order(branch,changed->>'revision',array[]::text[],array[]::text[]) ? 'forbidden','revoked publisher cannot save');
  perform pg_temp.require(app_task_order_snapshot(child,false)->'items'->0->>'key'='game:dream-plan','revoked publisher order is ignored');
  update users set can_publish_tasks=true where id=branch;
  snapshot:=app_task_order_snapshot(branch,true);
  changed:=app_save_task_order(branch,snapshot->>'revision',array[]::text[],array[]::text[],true);
  perform pg_temp.require(changed->>'customized'='false' and changed->'items'->0->>'key'='game:dream-plan','branch reset restores inheritance');
  -- Older game rows can carry audience only on the owning program.
  update tasks set audience_root_id=null where program_id=branch_game;
  snapshot:=app_task_order_snapshot(branch,true);
  perform pg_temp.require(snapshot->'items'->0->>'taskId'=(select id::text from tasks where program_id=branch_game),'nearest game uses its program audience');

  snapshot:=app_task_order_snapshot(root_user,true); old_revision:=snapshot->>'revision';
  insert into tasks(id,team_id,title,description,publication_type,publisher_id,created_at) values(new_task,team,'New task','Description','evergreen',root_user,now());
  changed:=app_task_order_snapshot(root_user,true);
  perform pg_temp.require(changed->'items'->3->>'key'=new_task::text,'new task appends after manual order');
  perform pg_temp.require(app_save_task_order(root_user,old_revision,array[]::text[],array['game:dream-plan',b::text,a::text]) ? 'conflict','publication during editing detected');
  update tasks set is_pinned=true where id=b;
  update tasks set is_pinned=true where id=a;
  snapshot:=app_task_order_snapshot(root_user,true);
  perform pg_temp.require(jsonb_path_query_array(snapshot,'$.items[*].key')=jsonb_build_array(b::text,a::text,'game:dream-plan',new_task::text),'pin queue uses pin time');
  changed:=app_save_task_order(root_user,snapshot->>'revision',array[a::text,b::text],array[new_task::text,'game:dream-plan']);
  perform pg_temp.require(changed->'items'->0->>'key'=a::text,'explicit pinned order is respected');
  update tasks set is_pinned=true where id=new_task;
  snapshot:=app_task_order_snapshot(root_user,true);
  perform pg_temp.require(snapshot->'items'->2->>'key'=new_task::text,'new pin appends after manual pin order');
  update tasks set is_pinned=false where id=a;
  update tasks set is_pinned=true where id=a;
  snapshot:=app_task_order_snapshot(root_user,true);
  perform pg_temp.require(snapshot->'items'->0->>'key'=b::text and snapshot->'items'->2->>'key'=a::text,'repin cannot reuse obsolete saved pin position');
  old_revision:=snapshot->>'revision';
  update task_programs set is_active=false where id=game;
  snapshot:=app_task_order_snapshot(root_user,true);
  perform pg_temp.require(jsonb_array_length(snapshot->'items')=3,'hidden program removed from order');
  perform pg_temp.require(app_save_task_order(root_user,old_revision,array[a::text,b::text,new_task::text],array['game:dream-plan']) ? 'conflict','hidden game invalidates snapshot');
  update tasks set deadline_at=now()-interval '1 second' where id=new_task;
  perform pg_temp.require(jsonb_array_length(app_task_order_snapshot(root_user,true)->'items')=2,'expired tasks excluded');
  perform pg_temp.require(not has_table_privilege('authenticated','public.task_feed_orders','update') and not has_function_privilege('anon','public.app_save_task_order(uuid,text,text[],text[],boolean)','execute'),'browser cannot bypass authorization');
end;
$$;
rollback;

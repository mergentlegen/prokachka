const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const harnessFactory = require('./helpers/hook-harness.cjs');

function fixture() {
  const tables = { task_programs: [], tasks: [], users: [], member_program_progress: [], ready_program_attempts: [] };
  const calls = [];
  let conflict = false;
  const db = { from(table) {
    const q = { table, filters: [], select() { return this; }, eq(k, v) { this.filters.push(r => r[k] === v); return this; },
      is(k, v) { this.filters.push(r => (r[k] ?? null) === v); return this; }, not(k) { this.filters.push(r => r[k] != null); return this; },
      order() { return this; }, async range(a,b) { return { data: tables[table].filter(r => this.filters.every(f => f(r))).slice(a,b+1), error: null }; },
      async maybeSingle() { const r = await this.range(0, 1000); assert.ok(r.data.length < 2, 'scoped lookup must be unique'); return { data: r.data[0] || null, error: null }; },
      then(resolve,reject) { return this.range(0,1000).then(resolve,reject); } };
    return q;
  }, async rpc(name, args) {
    calls.push([name,args]);
    if (name === 'app_update_program') {
      const program = tables.task_programs.find(p => p.id === args.p_id);
      program.is_active = args.p_patch.isActive;
      tables.tasks.filter(t => t.program_id === program.id).forEach(t => t.is_active = true);
      return { data: { data: { ...program } }, error: null };
    }
    assert.equal(name,'app_create_program');
    const p = args.p_input;
    const program = { id: 'publication-' + calls.length, team_id: p.teamId, template_key: p.templateKey, publisher_id: p.publisherId, audience_root_id: p.audienceRootId || null, is_active: true, created_at: '2026-09-28' };
    const task = { id: 'task-' + program.id, team_id: p.teamId, program_id: program.id, audience_root_id: program.audience_root_id, is_active: true, publication_type: 'evergreen', interactive_kind: p.templateKey };
    tables.task_programs.push(program); tables.tasks.push(task);
    return conflict ? { error: { code: '23505' } } : { data: { program, tasks: [task] }, error: null };
  } };
  const overrides = { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => db } };
  return { tables, calls, db, overrides, race() { conflict = true; } };
}

test('root and sibling branches publish the same template independently, including simultaneous retries', async () => {
  const f = fixture(), svc = load('backend/services/programs.service.ts', f.overrides);
  const input = { teamId: 'team', key: 'starter-rules' };
  const a = await svc.publishReadyProgram({ ...input, publisherId: 'a', audienceRootId: 'a' });
  const b = await svc.publishReadyProgram({ ...input, publisherId: 'b', audienceRootId: 'b' });
  const root = await svc.publishReadyProgram({ ...input, publisherId: 'root', audienceRootId: null });
  assert.equal(new Set([a.data.program.id,b.data.program.id,root.data.program.id]).size,3);
  assert.equal((await svc.findReadyProgramPublications('team','a')).data[0].id,a.data.program.id);
  assert.equal((await svc.findReadyProgramPublications('team','b')).data[0].id,b.data.program.id);
  assert.equal((await svc.findReadyProgramPublications('team')).data[0].id,root.data.program.id);
  f.race();
  const raced = await svc.publishReadyProgram({ ...input, key: 'heart-survey', publisherId: 'b', audienceRootId: 'b' });
  assert.equal(raced.alreadyPublished,true);
  assert.equal(raced.data.program.audience_root_id,'b');
});

test('re-add reactivates the existing scoped program and its legacy hidden step, without new task IDs', async () => {
  const f = fixture(), svc = load('backend/services/programs.service.ts', f.overrides);
  const input = { teamId: 'team', key: 'dream-plan', publisherId: 'a', audienceRootId: 'a' };
  const first = await svc.publishReadyProgram(input);
  f.tables.task_programs[0].is_active = false; f.tables.tasks[0].is_active = false;
  const again = await svc.publishReadyProgram(input);
  assert.equal(again.data.program.id, first.data.program.id);
  assert.equal(again.data.program.is_active,true);
  assert.equal(again.data.tasks[0].is_active,true);
  assert.equal(f.tables.tasks.length,1);
  assert.equal(f.calls.at(-1)[1].p_actor,'a');
});

test('member feed reaches deep descendants and detached team members, excludes siblings, and retains progress without duplicate cards', async () => {
  const f = fixture();
  const svc = load('backend/services/programs.service.ts',f.overrides);
  const root = await svc.publishReadyProgram({ teamId:'team',key:'dream-plan',publisherId:'root' });
  const branch = await svc.publishReadyProgram({ teamId:'team',key:'dream-plan',publisherId:'a',audienceRootId:'a' });
  const sibling = await svc.publishReadyProgram({ teamId:'team',key:'starter-rules',publisherId:'b',audienceRootId:'b' });
  f.tables.users.push(...[['root',null],['a','root'],['b','root'],['child','a'],['deep','child'],['detached',null]].map(([id,parent]) => ({id,team_id:'team',parent_user_id:parent,role:'member'})));
  f.tables.tasks.push({ id:'ordinary',team_id:'team',is_active:true,publication_type:'evergreen',audience_root_id:null });
  const { getMemberTaskFeed } = load('backend/services/member-progress.service.ts',f.overrides);
  let rows = (await getMemberTaskFeed('deep','team','2026-09-01')).data;
  assert.deepEqual(rows.map(t=>t.id),[branch.data.tasks[0].id,'ordinary']);
  assert.deepEqual((await getMemberTaskFeed('deep','team','2026-10-01')).data.map(t=>t.id),[branch.data.tasks[0].id,'ordinary'], 'new members also receive already published evergreen games');
  assert.deepEqual((await getMemberTaskFeed('detached','team')).data.map(t=>t.id),[root.data.tasks[0].id,'ordinary']);
  assert.deepEqual((await getMemberTaskFeed('b','team')).data.map(t=>t.id),[root.data.tasks[0].id,sibling.data.tasks[0].id,'ordinary']);
  f.tables.ready_program_attempts.push({ id:'attempt',user_id:'deep',task_id:root.data.tasks[0].id,status:'active' });
  assert.deepEqual((await getMemberTaskFeed('deep','team')).data.map(t=>t.id),[root.data.tasks[0].id,'ordinary']);
  f.tables.task_programs.find(p=>p.id===branch.data.program.id).is_active=false;
  assert.deepEqual((await getMemberTaskFeed('deep','team')).data.map(t=>t.id),[root.data.tasks[0].id,'ordinary']);
  assert.equal(f.tables.ready_program_attempts.length,1);
});

test('existing large teams are paginated completely before audience filtering', async () => {
  const f = fixture();
  f.tables.users.push(...Array.from({length:1201},(_,i)=>({id:String(i).padStart(4,'0'),team_id:'team',parent_user_id:i ? String(i-1).padStart(4,'0'):null,role:'member'})));
  f.tables.task_programs.push({id:'ready',team_id:'team',is_active:true,audience_root_id:'0000',created_at:'2026-09-28'});
  f.tables.tasks.push({id:'game',team_id:'team',is_active:true,program_id:'ready',publication_type:'evergreen',audience_root_id:'0000',interactive_kind:'heart-survey'});
  const {getMemberTaskFeed}=load('backend/services/member-progress.service.ts',f.overrides);
  assert.equal((await getMemberTaskFeed('1200','team')).data[0].id,'game');
});

test('ordinary and sequential publications retain branch, deadline and step restrictions', async () => {
  const f=fixture();
  f.tables.users.push({id:'root',team_id:'team'},{id:'mentor',team_id:'team',parent_user_id:'root'},{id:'member',team_id:'team',parent_user_id:'mentor'},{id:'sibling',team_id:'team',parent_user_id:'root'});
  f.tables.task_programs.push({id:'steps',team_id:'team',is_active:true,audience_root_id:'mentor',created_at:'2026-09-01'}, {id:'hidden',team_id:'team',is_active:false,audience_root_id:null});
  const row={team_id:'team',is_active:true,publication_type:'evergreen',audience_root_id:null};
  f.tables.tasks.push({...row,id:'global'}, {...row,id:'branch',audience_root_id:'mentor'}, {...row,id:'other-branch',audience_root_id:'sibling'}, {...row,id:'other-team',team_id:'foreign'},
    {...row,id:'old-fixed',publication_type:'fixed',deadline_at:'2026-09-01'}, {...row,id:'new-fixed',publication_type:'fixed',deadline_at:'2026-10-01'},
    {...row,id:'step-1',program_id:'steps',publication_type:'sequential',audience_root_id:'mentor',position:1},
    {...row,id:'step-2',program_id:'steps',publication_type:'sequential',audience_root_id:'mentor',position:2}, {...row,id:'hidden-step',program_id:'hidden'});
  f.tables.member_program_progress.push({id:'progress',user_id:'member',program_id:'steps',current_task_id:'step-1',status:'active',due_at:'2026-10-01'});
  const {getMemberTaskFeed}=load('backend/services/member-progress.service.ts',f.overrides);
  assert.deepEqual((await getMemberTaskFeed('member','team','2026-09-15')).data.map(t=>t.id),['global','branch','new-fixed','step-1']);
  f.tables.member_program_progress[0].current_task_id='step-2';
  assert.deepEqual((await getMemberTaskFeed('member','team','2026-09-15')).data.map(t=>t.id),['global','branch','new-fixed','step-2']);
});

test('ordinary task API cannot mutate, remove or append steps to built-in games', async () => {
  const writes = [];
  const db={from(table){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:table==='tasks'?{id:'game',team_id:'team',publisher_id:'mentor',interactive_kind:'dream-plan'}:{team_id:'team',publisher_id:'mentor',audience_root_id:'mentor',template_key:'dream-plan'},error:null};},update(p){writes.push(p);return this;},delete(){writes.push('delete');return this;},insert(p){writes.push(p);return this;}};}};
  const svc=load('backend/services/tasks.service.ts',{'@/backend/infrastructure/supabase/admin-client':{getSupabaseAdmin:()=>db}});
  const actor={id:'mentor',role:'member',teamId:'team',canPublishTasks:true};
  assert.ok((await svc.patchTask('game',{isActive:false},actor)).validationError);
  assert.ok((await svc.deleteTask('game',actor)).validationError);
  assert.ok((await svc.insertTask({title:'New step',description:'Not allowed',teamId:'team',publisherId:'mentor',audienceRootId:'mentor',programId:'ready'})).validationError);
  assert.deepEqual(writes,[]);
  const programs=load('backend/services/programs.service.ts',{'@/backend/infrastructure/supabase/admin-client':{getSupabaseAdmin:()=>db}});
  assert.ok((await programs.deleteProgram('ready',actor)).validationError);
  assert.deepEqual(writes,[]);
});

function nodes(tree,predicate){if(Array.isArray(tree))return tree.flatMap(t=>nodes(t,predicate));if(!tree||typeof tree!=='object')return[];return[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
test('root catalog does not mistake another branch publication for its team-wide publication', async () => {
  const harness=harnessFactory(), calls=[];
  const {READY_PROGRAMS}=load('shared/domain/ready-programs.ts');
  const {ReadyProgramsPanel}=load('frontend/features/admin/ReadyProgramsPanel.tsx',{react:harness.react,'@/frontend/shared/api/admin-client':{
    loadReadyPrograms:async()=>READY_PROGRAMS.map(({tasks,...p})=>({...p,published:false})),
    publishReadyProgram:async(key)=>{calls.push(key);return{program:{id:'team-ready',templateKey:key,publisherId:'root',isActive:true},tasks:[]};}
  }});
  const props={actorId:'root',canManageAll:true,programs:[{id:'branch-ready',templateKey:'dream-plan',publisherId:'branch',audienceRootId:'branch',isActive:true}],tasks:[],onChange(){},onError(){}};
  harness.mount(ReadyProgramsPanel,props);
  try{const tree=await harness.settle();const button=nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='Добавить в задания: Мечта с планом')[0];assert.ok(button);assert.equal(button.props.disabled,false);button.props.onClick();await harness.settle();assert.deepEqual(calls,['dream-plan']);}finally{harness.unmount();}
});

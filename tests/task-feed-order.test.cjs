const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const { compareTaskFeed, moveTaskOrder } = load('shared/domain/task-feed-order.ts');
const dbKey = '@/backend/infrastructure/supabase/admin-client';
const user = { id: '00000000-0000-4000-8000-000000000001', teamId: 'team', role: 'member', canPublishTasks: true };
const item = (key, pinned = false) => ({ key, taskId: key, isPinned: pinned, pinnedAt: null, title: key });

test('manual order wins over dates within pin groups; dragging never changes pin membership', () => {
  const tasks = [
    { id:'old',createdAt:'2020-01-01',feedOrder:3 },{ id:'new',createdAt:'2026-01-01',feedOrder:2 },
    { id:'pin',createdAt:'2026-01-01',feedOrder:8,isPinned:true },
  ];
  assert.deepEqual(tasks.sort(compareTaskFeed).map(t=>t.id),['pin','new','old']);
  const rows=[item('p',true),item('a'),item('b')];
  assert.equal(moveTaskOrder(rows,'a','p'),rows);
  assert.equal(moveTaskOrder(rows,'missing','b'),rows);
  assert.deepEqual(moveTaskOrder(rows,'b','a').map(t=>t.key),['p','b','a']);
  assert.deepEqual(rows.map(t=>t.key),['p','a','b']);
});
test('feed order preserves allowed rows and sequential state, and maps an existing game attempt to its logical slot', async () => {
  const { applyTaskFeedOrder } = load('backend/services/task-feed-order.service.ts', { [dbKey]: { getSupabaseAdmin: () => ({ rpc: async (name,args) => {
    assert.equal(name,'app_task_order_snapshot'); assert.equal(args.p_viewer,user.id); assert.equal(args.p_edit,false);
    return { data:{ items:[item('game:dream-plan',true),item('b'),item('forbidden-sibling')] } };
  } }) } });
  const input=[{ id:'existing-attempt',interactive_kind:'dream-plan',publication_type:'evergreen',is_pinned:false },{id:'b',publication_type:'evergreen'}, {id:'step',publication_type:'sequential',position:2,due_at:'2026-10-05'}];
  const result=await applyTaskFeedOrder(input,user,false);
  assert.deepEqual(result.data.map(t=>t.id),input.map(t=>t.id));
  assert.equal(result.data[0].feed_order,0); assert.equal(result.data[0].is_pinned,true);
  assert.equal(result.data[2].feed_order,undefined); assert.equal(result.data[2].position,2); assert.equal(result.data[2].due_at,'2026-10-05');
  assert.equal(input[0].is_pinned,false);
});
test('order errors do not silently produce a different order; only a missing migration permits the legacy feed', async () => {
  for (const code of ['PGRST202','XX000']) {
    const { applyTaskFeedOrder } = load('backend/services/task-feed-order.service.ts', { [dbKey]: { getSupabaseAdmin:()=>({rpc:async()=>({error:{code}})}) } });
    const result=await applyTaskFeedOrder([{id:'a',publication_type:'evergreen'}],user,false);
    assert.equal(Boolean(result.data),code==='PGRST202');
  }
});
test('order API derives actor from fresh session, validates payloads, and reports stale writes as conflict', async () => {
  const calls=[];
  const { taskOrder }=load('backend/controllers/task-feed-order.controller.ts', {
    '@/backend/http/current-user':{getCurrentUser:async()=>user},
    '@/backend/services/task-feed-order.service':{saveTaskOrder:async(...args)=>{calls.push(args);return {data:{conflict:true}};}},
  });
  const req=body=>new Request('http://localhost/api/tasks/order',{method:'PUT',body:JSON.stringify(body)});
  const body={revision:'a'.repeat(32),pinned:[],regular:[user.id],actorId:'attacker',teamId:'other-team'};
  assert.equal((await taskOrder(req({...body,regular:[user.id,user.id]}))).status,400);
  assert.equal((await taskOrder(req(body))).status,409);
  assert.deepEqual(calls[0],[user.id,body.revision,[],[user.id],false]);
  const anonymous=load('backend/controllers/task-feed-order.controller.ts',{'@/backend/http/current-user':{getCurrentUser:async()=>null}});
  assert.equal((await anonymous.taskOrder(req(body))).status,401);
});

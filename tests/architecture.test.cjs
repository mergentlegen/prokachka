const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(relative, overrides = {}) {
  const file = path.resolve(__dirname, '..', relative);
  const m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  const original = m.require.bind(m);
  m.require = (name) => name in overrides ? overrides[name] : name.startsWith('@/') ? load(name.slice(2) + '.ts', overrides) : original(name);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports;
}
const guardKey = '@/backend/http/auth-guard', authKey = '@/backend/services/auth.service';
const currentKey = '@/backend/http/current-user', dbKey = '@/backend/infrastructure/supabase/admin-client';
const req = () => new Request('http://localhost/api/ranking');

test('current permissions are read once per request but not shared between requests', async () => {
  let reads = 0;
  const current = { id: 'member', role: 'member', teamId: 'new-team' };
  const { getCurrentUser } = load('backend/http/current-user.ts', {
    [guardKey]: { getRequestUser: () => ({ ...current, role: 'admin', teamId: 'old-team' }) },
    [authKey]: { findAccountById: async () => { reads++; return current; } },
  });
  const request = req();
  assert.deepEqual(await getCurrentUser(request), current);
  await getCurrentUser(request); assert.equal(reads, 1);
  await getCurrentUser(req()); assert.equal(reads, 2);
});
test('missing production account cannot reuse an old signed session', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const { getCurrentUser } = load('backend/http/current-user.ts', {
      [guardKey]: { getRequestUser: () => ({ id: 'removed', role: 'admin' }) }, [authKey]: { findAccountById: async () => null },
    });
    assert.equal(await getCurrentUser(req()), null);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test('teamless account cannot trigger globally scoped rating queries', async () => {
  const controller = load('backend/controllers/ranking.controller.ts', {
    [currentKey]: { getCurrentUser: async () => ({ id: 'member', role: 'member' }) },
    '@/backend/services/ranking.service': { findRanking: () => assert.fail('global read'), findStarRanking: () => assert.fail('global read') },
  });
  const response = await controller.listRanking(req());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).ranking, []);
});
test('ranking passes explicit fresh team scope and does not silently hide star query errors', async () => {
  const calls = [];
  const controller = load('backend/controllers/ranking.controller.ts', {
    [currentKey]: { getCurrentUser: async () => ({ id: 'member', role: 'member', teamId: 'fresh' }) },
    '@/backend/services/ranking.service': {
      findRanking: async (scope) => { calls.push(scope); return { data: [] }; },
      findStarRanking: async (scope) => { calls.push(scope); return { error: new Error('DB unavailable') }; },
    },
  });
  assert.equal((await controller.listRanking(req())).status, 500);
  assert.deepEqual(calls, [{ kind: 'team', teamId: 'fresh' }, { kind: 'team', teamId: 'fresh' }]);
});
test('teamless mentor is rejected by both request controller and service before any DB operation', async () => {
  const actor = { id: 'mentor', role: 'admin' };
  const service = load('backend/services/team-requests.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => assert.fail('unexpected DB operation') }, '@/backend/services/network.service': {},
  });
  assert.equal((await service.reviewJoinRequest('request', 'rejected', actor)).forbidden, true);
  const controller = load('backend/controllers/team-requests.controller.ts', {
    [currentKey]: { getCurrentUser: async () => actor },
    [guardKey]: { hasRole: (u, roles) => roles.includes(u.role) }, '@/backend/services/team-requests.service': service,
  });
  assert.equal((await controller.reviewTeamRequest(req(), 'request')).status, 403);
});
test('program creation is one RPC, never a partially saved program plus compensation delete', async () => {
  const input = { teamId: 'team', title: 'Program', deadlineHours: 24, tasks: [{ title: 'Step', description: 'Answer', maxPoints: 10 }] };
  const calls = [];
  const service = load('backend/services/programs.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => ({ rpc: async (...args) => { calls.push(args); return { error: new Error('rollback') }; } }) },
    '@/backend/services/network.service': {},
  });
  assert.ok((await service.createProgram(input)).error);
  assert.deepEqual(calls, [['app_create_program', { p_input: input }]]);
});
test('network section does not load other datasets; history alone requires history data', () => {
  const { sectionDatasets } = load('frontend/features/admin/admin-sections.ts');
  assert.deepEqual(sectionDatasets.network, []);
  assert.deepEqual(sectionDatasets.stars, ['users', 'starAwards']);
  assert.ok(!sectionDatasets.dashboard.includes('programs'));
});
test('admin dataset loader requests only selected datasets and deduplicates them', async () => {
  const calls = [];
  const client = load('frontend/shared/api/admin-client.ts', {
    '@/frontend/shared/api/client': {
      request: async (url) => { calls.push(url); return { tasks: [] }; }, mapTask: (row) => row,
    },
  });
  assert.deepEqual(await client.loadAdminData(['tasks','tasks']), { tasks: [] });
  assert.deepEqual(calls, ['/api/tasks']);
});

test('program history uses the actual audience and shows the author to the root mentor', async () => {
  const members = [
    { id: 'branch', name: 'Publisher', role: 'member', team_id: 'team' },
    { id: 'child', name: 'Child', role: 'member', team_id: 'team', parent_user_id: 'branch' },
    { id: 'sibling', name: 'Other branch', role: 'member', team_id: 'team' },
  ];
  const tables = {
    users: members,
    task_programs: [{ id: 'program', team_id: 'team', publisher_id: 'branch', audience_root_id: 'branch', title: 'Program', created_at: '2026-09-01T00:00:00Z', deadline_hours: 24 }],
    tasks: [{ id: 'step', program_id: 'program', position: 1, title: 'Step' }],
    member_program_progress: [], submissions: [],
  };
  const db = { from(table) {
    const query = new Proxy({}, { get: (_, key) => key === 'range'
      ? async () => ({ data: tables[table], error: null }) : () => query });
    return query;
  } };
  const network = load('backend/services/network.service.ts', { [dbKey]: { getSupabaseAdmin: () => db } });
  const history = load('backend/services/program-history.service.ts', {
    [dbKey]: { getSupabaseAdmin: () => db },
    '@/backend/services/network.service': { ...network, findTeamNetwork: async () => ({ data: members }) },
  });
  const result = await history.findProgramHistory('team', { id: 'root', role: 'admin' });
  assert.equal(result.data[0].publisherName, 'Publisher');
  assert.deepEqual(result.data[0].members.map((member) => member.userId), ['branch','child']);
  assert.deepEqual(result.data[0].steps[0].members.map((member) => member.userId), ['branch','child']);
});

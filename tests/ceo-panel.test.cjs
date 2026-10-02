const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

const HOUR = 3_600_000, DAY = 24 * HOUR;
const now = Date.parse('2026-10-02T09:00:00Z');
const at = (offset) => new Date(now + offset).toISOString();

const { buildCeoStats } = loadTs('backend/services/ceo-stats.service.ts', { '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => null } });
const user = (id, team, extra = {}) => ({ id, team_id: team, role: 'member', created_at: at(-60 * DAY), team_joined_at: at(-60 * DAY), ...extra });
const work = (id, userId, extra = {}) => ({ id, user_id: userId, status: 'accepted', submitted_at: at(-DAY), reviewed_at: at(-DAY + 5 * HOUR), ...extra });

test('CEO stats compare teams: activity, new members, review speed and the waiting queue', () => {
  const users = [user('lead', 'a', { role: 'admin' }), user('a1', 'a'), user('a2', 'a'), user('a3', 'a', { team_joined_at: at(-5 * DAY), created_at: at(-5 * DAY) }), user('b1', 'b'), user('ceo', null, { role: 'ceo' })];
  const recent = [work('w1', 'a1'), work('w2', 'a2', { submitted_at: at(-10 * DAY), reviewed_at: at(-10 * DAY + 3 * HOUR) }), work('w3', 'a1', { status: 'pending', reviewed_at: null, submitted_at: at(-3 * DAY) }), work('w4', 'b1', { submitted_at: at(-41 * DAY), reviewed_at: at(-40 * DAY) })];
  const stats = buildCeoStats({ users, recent, pending: [recent[2]], points: [{ id: 'a1', points: 40 }], stars: [{ id: 'a1', points: 2 }], telegram: [{ id: 'a1' }], tasks: [{ id: 't1', team_id: 'a', title: 'Старое', created_at: at(-9 * DAY) }, { id: 't2', team_id: 'a', title: 'Новое', created_at: at(-DAY) }] }, now);
  const a = stats.teams.find((team) => team.teamId === 'a');
  assert.equal(a.members, 3);
  assert.equal(a.mentors, 1);
  assert.equal(a.active14, 2, 'a1 and a2 sent work within 14 days');
  assert.equal(a.submissions7, 2, 'w1 and the pending w3');
  assert.equal(a.newMembers30, 1);
  assert.equal(a.pending, 1);
  assert.equal(a.oldestPendingAt, recent[2].submitted_at);
  assert.equal(a.avgReviewHours, 4, 'average of 5 h and 3 h');
  assert.deepEqual(a.recentTasks.map((task) => task.title), ['Новое', 'Старое']);
  const b = stats.teams.find((team) => team.teamId === 'b');
  assert.equal(b.submissions7, 0);
  assert.equal(b.avgReviewHours, null, 'reviews older than 30 days do not count');
  assert.equal(stats.daily.length, 30);
  assert.equal(stats.daily.reduce((sum, day) => sum + day.newUsers, 0), 1, 'only a3 registered in the last 30 days; the CEO is not counted');
  assert.deepEqual(stats.users.a1, { miles: 40, stars: 2, works90: 2, lastSubmittedAt: recent[0].submitted_at, hasTelegram: true });
  assert.equal(stats.users.b1.hasTelegram, false);
  assert.equal(stats.platform.pending, 1);
});

test('only the CEO can read platform statistics', async () => {
  const controller = (current) => loadTs('backend/controllers/ceo-stats.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => current },
    '@/backend/services/ceo-stats.service': { findCeoStats: async () => ({ data: { generatedAt: 'x' } }) },
  });
  assert.equal((await controller(null).getCeoStats(new Request('https://x.test'))).status, 401);
  assert.equal((await controller({ id: 'm', role: 'admin' }).getCeoStats(new Request('https://x.test'))).status, 403);
  const ok = await controller({ id: 'c', role: 'ceo' }).getCeoStats(new Request('https://x.test'));
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).stats, { generatedAt: 'x' });
});

test('attention: teams without a mentor, quiet teams, slow reviews, old requests and people without a team', () => {
  const { attentionItems, teamHealth, formatHours } = loadTs('frontend/features/ceo/ceo-insights.ts');
  const teams = [{ id: 'a', name: 'А', isActive: true }, { id: 'b', name: 'Б', isActive: true }, { id: 'c', name: 'Off', isActive: false }];
  const users = [{ id: 'm', role: 'admin', teamId: 'a' }, { id: 'x', role: 'member', teamId: 'b' }, { id: 'lost', role: 'member' }, { id: 'boss', role: 'ceo' }];
  const stats = { teams: [{ teamId: 'a', members: 4, active14: 3, submissions7: 5, oldestPendingAt: at(-3 * DAY) }, { teamId: 'b', members: 2, active14: 0, submissions7: 0, oldestPendingAt: null }] };
  const requests = [{ status: 'pending', createdAt: at(-2 * DAY) }, { status: 'pending', createdAt: at(-HOUR) }, { status: 'approved', createdAt: at(-5 * DAY) }];
  const items = attentionItems({ teams, users, requests, stats, now });
  assert.deepEqual(items.noMentor.map((team) => team.id), ['b']);
  assert.deepEqual(items.quiet.map((team) => team.id), ['b']);
  assert.deepEqual(items.slowReview.map((team) => team.id), ['a']);
  assert.equal(items.oldRequests.length, 1);
  assert.deepEqual(items.withoutTeam.map((person) => person.id), ['lost']);
  assert.equal(teamHealth(stats.teams[0]), 'growing');
  assert.equal(teamHealth(stats.teams[1]), 'quiet');
  assert.equal(teamHealth(undefined), 'empty');
  assert.equal(formatHours(0.5), 'меньше часа');
  assert.equal(formatHours(30), '30 ч');
  assert.equal(formatHours(72), '3 дн.');
  assert.equal(formatHours(null), '—');
});

test('CEO user search and filters', () => {
  const { filterCeoUsers } = loadTs('frontend/features/ceo/CeoUsers.tsx');
  const users = [{ id: '1', name: 'Анна Ким', login: 'anna', role: 'admin', teamId: 'a' }, { id: '2', name: 'Иван', login: 'ivan', role: 'member', teamId: 'b' }, { id: '3', name: 'Лера', role: 'member' }, { id: '4', name: 'CEO', role: 'ceo' }];
  const stats = { users: { 1: { hasTelegram: true }, 2: { hasTelegram: false }, 3: { hasTelegram: true } } };
  const ids = (options) => filterCeoUsers(users, stats, { query: '', filter: 'all', teamId: '', ...options }).map((item) => item.id);
  assert.deepEqual(ids({ query: 'ANNA' }), ['1']);
  assert.deepEqual(ids({ filter: 'mentors' }), ['1']);
  assert.deepEqual(ids({ filter: 'noTeam' }), ['3'], 'the CEO is never "without a team"');
  assert.deepEqual(ids({ filter: 'noTelegram' }), ['2']);
  assert.deepEqual(ids({ teamId: 'b' }), ['2']);
});

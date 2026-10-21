const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

test('a phone typed any usual way is kept in one form', () => {
  const { normalizePhone, formatPhone, whatsappLink } = loadTs('shared/domain/phone.ts');
  for (const typed of ['+7 701 234 56 78', '8 (701) 234-56-78', '87012345678', '77012345678', '7012345678', ' +7-701-234-56-78 ']) {
    assert.deepEqual(normalizePhone(typed), { phone: '+77012345678' }, typed);
  }
  assert.deepEqual(normalizePhone('+998 90 123 45 67'), { phone: '+998901234567' }, 'other countries with a plus');
  assert.deepEqual(normalizePhone(''), { phone: null }, 'empty removes the phone');
  assert.deepEqual(normalizePhone(null), { phone: null });
  for (const wrong of ['12345', 'телефон', '+7 701 abc', '7+7012345678', '8701234567890123']) assert.ok('error' in normalizePhone(wrong), wrong);
  assert.equal(formatPhone('+77012345678'), '+7 701 234 56 78');
  assert.equal(whatsappLink('+77012345678'), 'https://wa.me/77012345678');
});

test('phones go only to mentors; participants get an empty list without a database call', async () => {
  let calls = 0;
  const load = (user) => loadTs('backend/controllers/profile.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/account-security.service': { visiblePhones: async () => { calls++; return { data: { a: '+77012345678' } }; } },
  });
  const request = new Request('http://localhost/api/contacts');
  const member = await (await load({ id: '5a7d51f3-9d2e-4f0c-a9a1-8c5d7f0e1b11', role: 'member' }).listVisiblePhones(request)).json();
  assert.deepEqual(member.phones, {}); assert.equal(calls, 0);
  const mentor = await (await load({ id: '5a7d51f3-9d2e-4f0c-a9a1-8c5d7f0e1b11', role: 'member', canReview: true }).listVisiblePhones(request)).json();
  assert.deepEqual(mentor.phones, { a: '+77012345678' }); assert.equal(calls, 1);
});

test('a password change checks the current password and saves a new hash', async () => {
  const auth = loadTs('backend/services/auth.service.ts');
  const stored = await auth.hashPassword('Старый1пароль');
  const rpc = [];
  const supabase = {
    from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'u', email: 'a@b.kz', password_hash: stored, auth_user_id: null } }) }),
    rpc: async (name, args) => { rpc.push([name, args]); return { data: 2, error: null }; },
  };
  const service = loadTs('backend/services/account-security.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => supabase },
    '@/backend/services/auth.service': auth,
  });
  assert.equal((await service.changeOwnPassword('u', '', 'Новый1пароль')).status, 400, 'no current password');
  assert.match((await service.changeOwnPassword('u', 'Старый1пароль', 'слабый')).error, /8 символов/);
  assert.match((await service.changeOwnPassword('u', 'Старый1пароль', 'Старый1пароль')).error, /совпадает/);
  assert.match((await service.changeOwnPassword('u', 'Неверный1', 'Новый1пароль')).error, /неверно/);
  assert.equal(rpc.length, 0, 'nothing saved without the right current password');
  assert.deepEqual(await service.changeOwnPassword('u', 'Старый1пароль', 'Новый1пароль'), { changed: true });
  assert.equal(rpc[0][0], 'app_change_password');
  assert.ok(await auth.verifyPassword('Новый1пароль', rpc[0][1].p_password_hash), 'the new password works');
});

test('the profile shows four stat tiles and no programs, miles statement or task history', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const pass = ({ children }) => React.createElement(React.Fragment, null, children);
  const { MemberProfile } = loadTs('frontend/features/member/MemberProfile.tsx', {
    './MemberProfile.module.css': new Proxy({}, { get: (_target, key) => key }),
    '@/frontend/shared/ModalSheet': { ModalSheet: pass },
    '@/frontend/shared/SectionBoundary': { SectionBoundary: pass },
    '@/frontend/features/telegram/TelegramConnect': { TelegramConnect: () => null },
    '@/frontend/shared/api/profile-client': { loadProfileExtras: async () => ({}) },
  });
  const store = {
    tasks: [], programs: [], programProgress: [], users: [], announcements: [],
    submissions: [{ id: 's1', userId: 'me', taskId: 't1', status: 'accepted', points: 10, comment: '', submittedAt: '2026-10-05T10:00:00Z' },
      { id: 's2', userId: 'me', taskId: 't2', status: 'pending', points: 0, comment: '', submittedAt: '2026-10-06T10:00:00Z' }],
    starAwards: [{ id: 'a1', userId: 'me', stars: 2, comment: '', createdAt: '2026-10-07T10:00:00Z' }],
  };
  const markup = renderToStaticMarkup(React.createElement(MemberProfile, {
    user: { id: 'me', name: 'Алия Бекова', role: 'member', createdAt: '2026-01-01' }, store, rank: 78, points: 15, stars: 2,
    telegramBusy: false, onLinkTelegram() {}, onRefreshTelegram() {}, inviteUrl: '', inviteBusy: false, onCreateInvite() {}, onCopyInvite() {},
    onProfileSaved() {}, onNotice() {}, onOpenDone() {}, onOpenRanking() {}, onUnlinkTelegram() {}, onClose() {}, onLogout() {},
  }));
  assert.match(markup, /<strong>15<\/strong><span>миль<\/span>/);
  assert.match(markup, /<strong>78<\/strong><span>место<\/span>/);
  assert.match(markup, /<strong>1<\/strong><span>выполнено<\/span>/, 'only accepted work counts');
  assert.match(markup, /<strong>2<\/strong><span>звезды<\/span>/);
  assert.doesNotMatch(markup, /Мои программы|Откуда мои мили|История заданий/);
});

test('unlinking Telegram works only for the signed-in account', async () => {
  const calls = [];
  const load = (user) => loadTs('backend/controllers/profile.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/account-security.service': { unlinkOwnTelegram: async (id) => { calls.push(id); return { data: true }; } },
  });
  const request = () => new Request('http://localhost/api/telegram/unlink', { method: 'POST', body: '{}' });
  assert.equal((await load(null).unlinkTelegram(request())).status, 401);
  const id = '6b7d51f3-9d2e-4f0c-a9a1-8c5d7f0e1b22';
  assert.equal((await load({ id, role: 'member' }).unlinkTelegram(request())).status, 200);
  assert.deepEqual(calls, [id]);
});

test('the invite QR code is drawn from the link itself', () => {
  const harness = require('./helpers/hook-harness.cjs')();
  const { QrCode } = loadTs('frontend/shared/QrCode.tsx', { react: { ...harness.react, useMemo: (make) => make() }, 'qrcode-generator': { __esModule: true, default: require('qrcode-generator') } });
  const svg = QrCode({ value: 'https://prokachka.kz/?invite=abc', size: 120, label: 'QR' });
  const path = svg.props.children[1].props.d;
  assert.ok(path.length > 500, 'the code has its squares');
  assert.notEqual(path, QrCode({ value: 'https://prokachka.kz/?invite=xyz', size: 120, label: 'QR' }).props.children[1].props.d, 'another link, another code');
});

test('the mentor list is kept until the team changes, read once for parallel requests', async () => {
  let listener;
  const cache = loadTs('backend/services/mentor-list-cache.service.ts', {
    '@/backend/services/live-events.service': { trackLiveStream: () => () => {}, liveEvents: { subscribe: (value) => { listener = value; value.status(true); return () => {}; } } },
  });
  let reads = 0;
  const read = async () => { reads++; await new Promise((resolve) => setTimeout(resolve, 5)); return { data: [{ id: 'w' + reads }] }; };
  delete globalThis.prokachkaMentorLists;
  const [first, second] = await Promise.all([cache.cachedMentorList('m1', 'team', read), cache.cachedMentorList('m1', 'team', read)]);
  assert.equal(reads, 1, 'parallel requests share one read');
  assert.deepEqual(first, second);
  assert.deepEqual((await cache.cachedMentorList('m1', 'team', read)).data, [{ id: 'w1' }], 'nothing changed: from memory');
  listener.change({ topics: ['feedback'], teamIds: ['team'], userIds: [] });
  await cache.cachedMentorList('m1', 'team', read);
  assert.equal(reads, 1, 'a chat message does not touch the list');
  listener.change({ topics: ['submissions'], teamIds: ['other'], userIds: [] });
  await cache.cachedMentorList('m1', 'team', read);
  assert.equal(reads, 1, 'another team does not touch the list');
  listener.change({ topics: ['submissions', 'tasks'], teamIds: ['team'], userIds: [] });
  assert.deepEqual((await cache.cachedMentorList('m1', 'team', read)).data, [{ id: 'w2' }], 'a new work in the team: read again');
  cache.forgetTeamLists('team');
  await cache.cachedMentorList('m1', 'team', read);
  assert.equal(reads, 3, 'the mentor\'s own review forgets the list at once');
  listener.status(false);
  await cache.cachedMentorList('m1', 'team', read);
  assert.equal(reads, 4, 'without the change feed nothing old is trusted');
});

const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const view = loadTs('frontend/features/announcements/announcement-view.ts');
const DAY = 24 * 60 * 60 * 1000;
const now = new Date(2026, 9, 14, 15, 0).getTime();
const at = (offset) => new Date(now + offset).toISOString();
const item = (id, offset, extra = {}) => ({ id, teamId: 'team', title: 'Объявление ' + id, content: 'Текст ' + id, isActive: true, createdAt: at(offset), updatedAt: at(offset), photos: [], ...extra });

test('pinned announcements stay on top in pin order, the rest go newest first; home keeps pinned plus the latest three', () => {
  const list = [item('old', -9 * DAY), item('pin2', -20 * DAY, { isPinned: true, pinnedAt: at(-DAY) }), item('new', -1000), item('mid', -2 * DAY),
    item('pin1', -30 * DAY, { isPinned: true, pinnedAt: at(-5 * DAY) }), item('older', -12 * DAY)];
  const sorted = view.sortAnnouncements(list);
  assert.deepEqual(sorted.map((a) => a.id), ['pin1', 'pin2', 'new', 'mid', 'old', 'older']);
  assert.deepEqual(view.homeAnnouncements(sorted).map((a) => a.id), ['pin1', 'pin2', 'new', 'mid', 'old']);
  assert.deepEqual(view.searchAnnouncements(sorted, 'текст MID').map((a) => a.id), ['mid'], 'every word must be found, in any case');
  assert.equal(view.searchAnnouncements(sorted, '  ').length, 6);
});

test('dates read like people say them', () => {
  assert.match(view.friendlyTime(new Date(2026, 9, 14, 9, 30).toISOString(), now), /^сегодня в 09:30$/);
  assert.match(view.friendlyTime(new Date(2026, 9, 13, 21, 0).toISOString(), now), /^вчера в 21:00$/);
  assert.match(view.friendlyTime(new Date(2026, 9, 2, 8, 5).toISOString(), now), /^2 окт\.?, 08:05$/);
  assert.match(view.friendlyTime(new Date(2025, 11, 30, 8, 5).toISOString(), now), /2025/);
});

test('addresses open and phone numbers call; punctuation after a link stays text', () => {
  const parts = view.textParts('Запись: https://prokachka.kz/meet, звоните 8 (701) 123-45-67 или +7 702 555 11 22. Сайт www.incruises.com!');
  const links = parts.filter((part) => part.kind !== 'text');
  assert.deepEqual(links.map((part) => [part.kind, part.text, part.href]), [
    ['url', 'https://prokachka.kz/meet', 'https://prokachka.kz/meet'],
    ['phone', '8 (701) 123-45-67', 'tel:+77011234567'],
    ['phone', '+7 702 555 11 22', 'tel:+77025551122'],
    ['url', 'www.incruises.com', 'https://www.incruises.com'],
  ]);
  assert.equal(parts.map((part) => part.text).join(''), 'Запись: https://prokachka.kz/meet, звоните 8 (701) 123-45-67 или +7 702 555 11 22. Сайт www.incruises.com!');
  assert.deepEqual(view.textParts('Встреча 8 октября в 2026 году, 100 человек'), [{ kind: 'text', text: 'Встреча 8 октября в 2026 году, 100 человек' }]);
});

test('what was read is kept on the device; only the last two weeks can be new', () => {
  const store = new Map();
  const previous = global.window;
  global.window = { localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } };
  try {
    assert.equal(view.readSeen('me').size, 0);
    view.markSeen('me', ['a', 'b']); view.markSeen('me', ['b', 'c']);
    assert.deepEqual([...view.readSeen('me')].sort(), ['a', 'b', 'c']);
    assert.equal(view.readSeen('other').size, 0, 'another account on the same phone has its own marks');
    store.set('prokachka-announcements-seen:me', 'broken');
    assert.equal(view.readSeen('me').size, 0);
  } finally { global.window = previous; }
  assert.equal(view.isFresh(item('x', -13 * DAY), now), true);
  assert.equal(view.isFresh(item('x', -15 * DAY), now), false);
});

test('the block shows the author, a "new" mark, the new count and a button to all announcements', () => {
  const { AnnouncementsBlock } = loadTs('frontend/features/announcements/AnnouncementsBlock.tsx', {
    '@/frontend/shared/ModalSheet': { ModalSheet: () => null },
    './AnnouncementGallery': { AnnouncementGallery: () => null },
  });
  const list = [item('a', -1000, { authorName: 'Асель Нурланова', content: 'Пишите на +77011234567' }), item('b', -DAY), item('c', -2 * DAY), item('d', -3 * DAY), item('e', -30 * DAY)];
  const markup = renderToStaticMarkup(React.createElement(AnnouncementsBlock, { announcements: list, userId: 'me', at: now }));
  assert.match(markup, /Асель Нурланова/);
  assert.match(markup, /Наставник/, 'an author outside the team still has a name');
  assert.match(markup, />4 новых</, 'the old announcement is not counted as new');
  assert.equal((markup.match(/>Новое</g) || []).length, 3, 'only the three cards on the home screen show their mark');
  assert.match(markup, /Все объявления <b>5<\/b>/);
  assert.equal((markup.match(/data-announcement=/g) || []).length, 3);
  assert.match(markup, /href="tel:\+77011234567"/);
  assert.doesNotMatch(markup, /Для команды/);
  const short = renderToStaticMarkup(React.createElement(AnnouncementsBlock, { announcements: list.slice(4), userId: 'me' }));
  assert.doesNotMatch(short, /Все объявления/);
  assert.match(short, /announcement-count">1</);
});

test('the participant list carries the author name and photo from their own team', async () => {
  const rows = [
    { id: 'a1', team_id: 'team', author_id: 'lead', audience_root_id: null, title: 'T', content: 'C', photos: [], created_at: '2026-10-14T10:00:00Z' },
    { id: 'a2', team_id: 'team', author_id: 'ceo-outside', audience_root_id: null, title: 'T', content: 'C', photos: [], created_at: '2026-10-13T10:00:00Z' },
  ];
  const signed = [];
  const query = { select() { return this; }, order() { return this; }, eq() { return this; } };
  const service = loadTs('backend/services/announcements.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ from: () => query }) },
    '@/backend/infrastructure/supabase/read-pages': { readPages: async () => ({ data: rows }) },
    '@/backend/services/network.service': {
      findTeamNetwork: async () => ({ data: [{ id: 'lead', name: 'Асель Нурланова', avatar_path: 'avatars/lead.webp', role: 'admin' }, { id: 'me', name: 'Я', role: 'member', parent_user_id: 'lead' }] }),
      descendants: () => new Set(), isAudienceVisible: () => true,
    },
    '@/backend/services/avatar-urls.service': { withAvatarUrls: async (items) => items.map((row) => { signed.push(row.avatar_path); return { ...row, avatar_url: row.avatar_path ? 'https://signed/' + row.avatar_path : undefined }; }) },
    '@/backend/services/announcement-photos.service': { withAnnouncementPhotoUrls: async (items) => items },
  });
  const result = await service.findAnnouncements({ teamId: 'team', viewer: { id: 'me', role: 'member', teamId: 'team' } });
  assert.deepEqual(result.data.map((row) => [row.author_name, row.author_avatar_url]), [['Асель Нурланова', 'https://signed/avatars/lead.webp'], [null, null]]);
  assert.ok(result.data.every((row) => !('avatar_path' in row)), 'the storage path of a photo is not sent');
  assert.deepEqual(signed, ['avatars/lead.webp', null]);
});

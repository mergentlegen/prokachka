const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const reviewId = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const keptId = '11111111-2222-4333-8444-555555555555';
const member = { id: '0b8f1c9e-3a2d-4e5f-9a6b-7c8d9e0f1a2b', role: 'member', teamId: 'f3e2d1c0-b9a8-4776-8554-433221100fed', name: 'Алия' };

function controllerWith({ user = member, service = {}, audits = [] } = {}) {
  return loadTs('backend/controllers/reviews.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/reviews.service': { findReviews: async () => ({ data: { summary: {}, reviews: [] } }), saveReview: async () => ({ data: {}, created: true }), deleteReview: async () => ({ data: { deleted: true, own: true } }), ...service },
    '@/backend/services/telegram-notifications.service': { scheduleTelegramDelivery() {} },
    '@/backend/services/audit-log.service': { recordAudit: async (actor, entry) => { audits.push(entry); } },
  });
}
const form = (fields) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return new Request('http://localhost/api/reviews', { method: 'POST', body: data });
};

test('writing a review checks the stars, the text length and that the writer is in a team', async () => {
  const saved = [];
  const controller = controllerWith({ service: { saveReview: async (viewer, input) => { saved.push(input); return { data: { id: reviewId }, created: true }; } } });
  assert.equal((await controller.writeReview(form({ rating: '6', body: 'Отличный клуб, всем советую' }))).status, 400);
  assert.equal((await controller.writeReview(form({ rating: '5', body: 'Коротко' }))).status, 400);
  assert.equal((await controller.writeReview(form({ rating: '5', body: 'Отличный клуб', keepPhotoIds: '["../x"]' }))).status, 400, 'photo ids must be ids');
  const created = await controller.writeReview(form({ rating: '5', body: '  Отличный клуб, всем советую  ' }));
  assert.equal(created.status, 201);
  assert.deepEqual(saved.map((input) => [input.rating, input.body, input.photoFiles.length]), [[5, 'Отличный клуб, всем советую', 0]]);
  for (const user of [{ ...member, teamId: undefined }, { id: 'ceo', role: 'ceo', name: 'CEO' }]) {
    assert.equal((await controllerWith({ user }).writeReview(form({ rating: '5', body: 'Отличный клуб, всем советую' }))).status, 403);
  }
});

test('a mentor deleting someone else’s review goes to the journal; the author deleting their own does not', async () => {
  const audits = [];
  const mentorDeletes = controllerWith({ audits, service: { deleteReview: async () => ({ data: { deleted: true, own: false, authorName: 'Алия', teamId: member.teamId, rating: 2 } }) } });
  assert.equal((await mentorDeletes.removeReview(new Request('http://localhost'), reviewId)).status, 200);
  assert.deepEqual(audits.map((entry) => [entry.action, entry.targetLabel, entry.details.rating]), [['review.delete', 'Алия', 2]]);
  const ownDelete = controllerWith({ audits });
  await ownDelete.removeReview(new Request('http://localhost'), reviewId);
  assert.equal(audits.length, 1);
  const refused = controllerWith({ service: { deleteReview: async () => ({ data: { forbidden: true } }) } });
  assert.equal((await refused.removeReview(new Request('http://localhost'), reviewId)).status, 403);
  assert.equal((await refused.removeReview(new Request('http://localhost'), 'not-an-id')).status, 404);
});

test('editing keeps the review id and only the chosen photos; new files are released from cleanup after saving', async () => {
  const calls = [];
  const existing = [{ id: keptId, fullPath: `${reviewId}/${keptId}-full.webp`, thumbPath: `${reviewId}/${keptId}-thumb.webp`, width: 10, height: 10 },
    { id: '99999999-2222-4333-8444-555555555555', fullPath: 'x', thumbPath: 'y', width: 10, height: 10 }];
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: reviewId, photos: existing } }; } };
  const service = loadTs('backend/services/reviews.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ from: () => query, rpc: async (name, args) => { calls.push([name, args]); return { data: { data: { id: reviewId }, created: false } }; } }) },
    '@/backend/services/avatar-urls.service': { withAvatarUrls: async (rows) => rows },
    '@/backend/services/announcement-photos.service': {
      validatePhotoFiles: () => null, withAnnouncementPhotoUrls: async (rows) => rows,
      uploadAnnouncementPhotos: async (id, files) => { calls.push(['upload', id, files.length]); return { data: [{ id: 'new' }], paths: ['p1', 'p2'] }; },
      releaseAnnouncementPhotoIntent: async (paths) => { calls.push(['release', paths]); },
    },
  });
  const refused = await service.saveReview(member, { rating: 4, body: 'Исправленный отзыв', keepPhotoIds: ['00000000-0000-4000-8000-000000000000'], photoFiles: [] });
  assert.ok(refused.validationError, 'a photo that is not in the review cannot be kept');
  const result = await service.saveReview(member, { rating: 4, body: 'Исправленный отзыв', keepPhotoIds: [keptId], photoFiles: [new File(['x'], 'a.webp')] });
  assert.equal(result.created, false);
  assert.deepEqual(calls.map((call) => call[0]), ['upload', 'app_review_save', 'release']);
  assert.equal(calls[0][1], reviewId, 'new photos go into the same review folder');
  assert.deepEqual(calls[1][1].p_photos.map((photo) => photo.id), [keptId, 'new']);
  assert.equal(calls[1][1].p_id, reviewId);
});

test('the list signs avatars and photos, never sends storage paths, and lets the CEO delete anything', async () => {
  const service = loadTs('backend/services/reviews.service.ts', {
    '@/backend/infrastructure/supabase/admin-client': { getSupabaseAdmin: () => ({ rpc: async () => ({ data: { summary: { count: 1 }, reviews: [{ id: reviewId, user_id: member.id, avatar_path: 'avatars/a.webp', photos: [], can_delete: false }] } }) }) },
    '@/backend/services/avatar-urls.service': { withAvatarUrls: async (rows) => rows.map((row) => ({ ...row, avatar_url: 'https://signed/' + row.avatar_path })) },
    '@/backend/services/announcement-photos.service': { withAnnouncementPhotoUrls: async (rows) => rows },
  });
  const forMember = await service.findReviews(member);
  assert.equal(forMember.data.reviews[0].author_avatar_url, 'https://signed/avatars/a.webp');
  assert.ok(!('avatar_path' in forMember.data.reviews[0]));
  assert.equal(forMember.data.reviews[0].is_mine, true);
  assert.equal(forMember.data.reviews[0].can_delete, false);
  assert.equal((await service.findReviews({ id: 'ceo', role: 'ceo' })).data.reviews[0].can_delete, true);
});

test('the mentor gets the author, the stars and the start of the text in Telegram', () => {
  const { reviewNoticeText } = loadTs('backend/services/telegram-notifications.service.ts', { 'next/server': { after() {} } });
  const text = reviewNoticeText('Алия Бекова', 4, 'Съездила в круиз! '.repeat(30), 'https://prokachka.test/admin?section=reviews');
  assert.match(text, /^⭐ Новый отзыв от Алия Бекова: ★★★★$/m);
  assert.match(text, /…»$/m, 'a long text is cut');
  assert.match(text, /Открыть отзывы: https:\/\/prokachka\.test\/admin\?section=reviews/);
});

test('the summary and a review card show stars, the author, «изменён» and the actions the viewer has', () => {
  const panel = loadTs('frontend/features/reviews/ReviewsPanel.tsx', { '@/frontend/features/announcements/AnnouncementGallery': { AnnouncementGallery: () => null } });
  const summary = renderToStaticMarkup(React.createElement(panel.SummaryCard, { summary: { count: 3, average: 4.7, stars: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 } } }));
  assert.match(summary, /<strong>4,7<\/strong>/);
  assert.match(summary, /3 отзыва/);
  const review = { id: reviewId, userId: member.id, authorName: 'Алия Бекова', teamName: 'Команда Асель', rating: 4, body: 'Текст отзыва. '.repeat(40), photos: [], createdAt: new Date().toISOString(), editedAt: new Date().toISOString(), canDelete: true, isMine: true };
  const mine = renderToStaticMarkup(React.createElement(panel.ReviewCard, { review, now: Date.now(), onEdit() {}, onDelete() {} }));
  assert.match(mine, /Алия Бекова<em>это вы<\/em>/);
  assert.match(mine, /«Команда Асель» · сегодня в \d\d:\d\d · изменён/);
  assert.match(mine, /aria-label="4 из 5"/);
  assert.match(mine, />Читать полностью</);
  assert.match(mine, />Изменить</);
  const other = renderToStaticMarkup(React.createElement(panel.ReviewCard, { review: { ...review, isMine: false, canDelete: false }, now: Date.now(), onEdit() {}, onDelete() {} }));
  assert.doesNotMatch(other, />Изменить<|>Удалить</);
});

test('writing or deleting a review makes the open page read the rating again (the review mile)', () => {
  const { mutationTopics, resourceTopics } = loadTs('shared/domain/live-updates.ts');
  for (const method of ['POST', 'DELETE']) {
    const topics = mutationTopics('/api/reviews' + (method === 'DELETE' ? '/' + reviewId : ''), method);
    assert.ok(topics.some((topic) => resourceTopics('/api/ranking').includes(topic)), method + ' does not refresh the rating');
  }
});

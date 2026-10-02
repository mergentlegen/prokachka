const assert = require('node:assert/strict');
const test = require('node:test');
const loadTs = require('./helpers/load-ts.cjs');

test('typo hints fix popular mailboxes and leave real addresses alone', () => {
  const { suggestEmail } = loadTs('frontend/shared/lib/email-typos.ts');
  assert.equal(suggestEmail('anna@gmail.con'), 'anna@gmail.com');
  assert.equal(suggestEmail('Anna@Gmial.com '), 'anna@gmail.com');
  assert.equal(suggestEmail('ivan@mail.ry'), 'ivan@mail.ru');
  assert.equal(suggestEmail('ivan@yandx.ru'), 'ivan@yandex.ru');
  for (const fine of ['anna@gmail.com', 'ivan@mail.kz', 'boss@prokachka.kz', 'x@yandex.kz', 'not-an-email', 'a@']) assert.equal(suggestEmail(fine), null, fine);
});

test('the sign-up checklist follows the same rules as the server', () => {
  const { PASSWORD_RULES, validateNewPassword } = loadTs('shared/domain/password-policy.ts');
  for (const password of ['short1A', 'longenough1', 'LONGENOUGHA', 'Prokachka1', 'Пароль2026']) {
    const allMet = PASSWORD_RULES.every((rule) => rule.test(password));
    assert.equal(allMet, validateNewPassword(password) === null, password);
  }
});

test('an invitation link shows only who invites and to which team', async () => {
  let answer;
  const { previewInvitation } = loadTs('backend/controllers/invitation-preview.controller.ts', {
    '@/backend/services/network.service': { findInvitationByToken: async () => answer },
  });
  const good = 'a'.repeat(24);
  assert.equal((await previewInvitation('bad token')).status, 404, 'malformed token never reaches the database');
  answer = { data: { id: 'i', team_id: 't', inviter_user_id: 'u', max_uses: 0 }, preview: { inviterName: 'Асель Нурланова', teamName: 'Команда Асель' } };
  const ok = await previewInvitation(good);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).invitation, { inviterName: 'Асель Нурланова', teamName: 'Команда Асель' });
  answer = { validationError: 'Ссылка приглашения недействительна или уже исчерпала лимит.' };
  const dead = await previewInvitation(good);
  assert.equal(dead.status, 404);
  assert.match((await dead.json()).message, /недействительна/);
  answer = { unavailable: true };
  assert.equal((await previewInvitation(good)).status, 503);
});

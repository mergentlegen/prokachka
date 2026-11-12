const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const Link = ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children);
const font = () => ({ variable: 'font' });
// next/image as a plain picture: the props the page passes are what the test reads.
const Image = ({ src, alt, width, height, loading, className }) => React.createElement('img', { src, alt, width, height, loading, className });
const overrides = { 'next/link': { default: Link }, 'next/image': { default: Image }, 'next/font/google': { Onest: font } };

test('the landing sends leaders to WhatsApp and participants into the sign-up and sign-in screen', () => {
  const { Landing, REGISTER_HREF, LOGIN_HREF, LEADER_HREF, LEADER_PHONE, LEADER_MESSAGE } = loadTs('frontend/features/landing/Landing.tsx', overrides);
  assert.equal(REGISTER_HREF, '/?auth=register');
  assert.equal(LOGIN_HREF, '/?auth=login');
  assert.equal(LEADER_PHONE, '+7 707 689 73 25');
  assert.equal(LEADER_HREF, `https://wa.me/77076897325?text=${encodeURIComponent(LEADER_MESSAGE)}`, 'the chat opens with the message already typed');
  const html = renderToStaticMarkup(React.createElement(Landing));
  assert.match(html, /<h1[^>]*>Новичок знает, что делать завтра\./);
  assert.equal((html.match(/Подключить команду/g) || []).length, 3, 'the leader offer is in the header, hero and closing block');
  const whatsapp = html.match(/<a[^>]*href="https:\/\/wa\.me\/77076897325[^"]*"[^>]*>/g) || [];
  assert.equal(whatsapp.length, 4, 'header, hero, closing button and the phone number open WhatsApp');
  for (const link of whatsapp) assert.match(link, /target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/);
  assert.match(html, /\+7 707 689 73 25/, 'the number is shown as text too');
  const buttons = (html.match(/<a(?:\s[^>]*)?>.*?<\/a>/g) || []).map((tag) => tag.replace(/<[^>]+>/g, '').trim())
    .filter((label) => label === 'Войти в кабинет' || label === 'Подключить команду').map((label) => label === 'Войти в кабинет' ? 'login' : 'leader');
  assert.deepEqual(buttons, ['leader', 'login', 'leader', 'leader', 'login'], 'header link; sign-in first in the hero; the closing block speaks to leaders, then to participants');
  assert.match(html, /<a[^>]*href="\/\?auth=login"[^>]*>Войти<\/a>/, 'the header button is sign-in');
  assert.ok((html.match(/href="\/\?auth=register"/g) || []).length >= 3, 'registration is offered in the hero, the closing block and the footer');
  assert.ok((html.match(/href="\/\?auth=login"/g) || []).length >= 4, 'sign-in is in the header, hero, closing block and footer');
  assert.match(html, /href="\/admin"/, 'team leaders reach the mentor panel');
  for (const id of ['week', 'leader', 'questions', 'connect']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const id of ['week', 'leader', 'questions']) assert.match(html, new RegExp(`href="#${id}"`), `menu link to ${id}`);
});

test('the landing shows the product itself: real screens with descriptions, one chosen step, dated team numbers', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { Landing, TEAM_FACTS, TEAM_PERIOD } = loadTs('frontend/features/landing/Landing.tsx', overrides);
  const html = renderToStaticMarkup(React.createElement(Landing));
  const pictures = [...html.matchAll(/<img[^>]*>/g)].map(([tag]) => ({ src: tag.match(/src="([^"]+)"/)[1], alt: tag.match(/alt="([^"]*)"/)[1],
    width: Number(tag.match(/width="(\d+)"/)[1]), height: Number(tag.match(/height="(\d+)"/)[1]), eager: /loading="eager"/.test(tag) }));
  assert.equal(pictures.length, 8, 'the hero screen, five steps of the week, the mentor panel wide and on a phone');
  for (const picture of pictures) {
    assert.match(picture.src, /^\/landing\/[a-z-]+\.webp$/);
    assert.ok(fs.existsSync(path.join(__dirname, '../public', picture.src)), picture.src + ' is missing: run scripts/capture-landing-shots.cjs');
    assert.ok(picture.alt.length > 20, picture.src + ' needs a description for screen readers');
    assert.ok(picture.width > 0 && picture.height > 0, 'sizes keep the page from jumping while pictures load');
  }
  assert.deepEqual(pictures.filter((picture) => picture.eager).map((picture) => picture.src), ['/landing/program.webp'], 'only the first screen loads at once');
  const steps = html.match(/<input[^>]*name="week-step"[^>]*>/g) || [];
  assert.equal(steps.length, 5, 'five steps of the week');
  assert.equal(steps.filter((tag) => /checked=""/.test(tag)).length, 1, 'one step is chosen from the start, so a screen shows without scripts');
  assert.match(steps[0], /checked=""/);
  for (const [index, tag] of steps.entries()) assert.match(html, new RegExp(`<label[^>]*for="${tag.match(/id="([^"]+)"/)[1]}"`), `step ${index + 1} has its text`);
  assert.equal((html.match(/Вы видите:/g) || []).length, 5, 'every step says what the leader sees');
  for (const [value, label] of TEAM_FACTS) { assert.ok(html.includes(value), value); assert.ok(html.includes(label), label); }
  assert.ok(html.includes(TEAM_PERIOD), 'the numbers carry their dates');
  assert.match(html, /Участники и команда на них вымышленные/, 'the page says the people on the screens are invented');
  assert.doesNotMatch(html, /data-reveal|<details/, 'nothing waits for a scroll or a click to be read');
});

test('the landing names no company brand and promises no money', () => {
  const { Landing } = loadTs('frontend/features/landing/Landing.tsx', overrides);
  const text = renderToStaticMarkup(React.createElement(Landing)).replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /inCruises|ин ?круиз/i);
  assert.doesNotMatch(text, /\$|доход|заработ|бонус/i);
});

test('a guest on the bare address sees the landing; a session or any link parameter opens the app', async () => {
  const MemberApp = () => null, Landing = () => null;
  let session = null, cookie;
  const { default: Home } = loadTs('app/page.tsx', {
    'next/headers': { cookies: async () => ({ get: (name) => { cookie = name; return session ? { value: 'token' } : undefined; } }) },
    '@/backend/services/auth.service': { readSession: (token) => token && session },
    '@/frontend/features/member/MemberApp': { MemberApp },
    '@/frontend/features/landing/Landing': { Landing },
  });
  const page = (params) => Home({ searchParams: Promise.resolve(params) });
  assert.equal((await page({})).type, Landing);
  assert.equal(cookie, 'incruises_session');
  assert.equal((await page({ auth: 'register' })).type, MemberApp, 'the landing buttons open the sign-up screen');
  assert.equal((await page({ invite: 'abc' })).type, MemberApp, 'an invitation skips the landing');
  assert.equal((await page({ feedback: 'thread' })).type, MemberApp, 'Telegram deep links open the app');
  session = { id: 'm', role: 'member' };
  assert.equal((await page({})).type, MemberApp, 'a signed-in participant goes straight to the app');
});

test('the sign-in screen opened from the landing has a way back to it', () => {
  const Image = (props) => React.createElement('img', { src: props.src, alt: props.alt });
  const { AuthLayout } = loadTs('frontend/features/auth/AuthLayout.tsx', { 'next/link': { default: Link }, 'next/image': { default: Image } });
  const back = renderToStaticMarkup(React.createElement(AuthLayout, { homeHref: '/' }, 'form'));
  assert.match(back, /<a[^>]*href="\/"[^>]*>.*На главную<\/a>/);
  const plain = renderToStaticMarkup(React.createElement(AuthLayout, null, 'form'));
  assert.doesNotMatch(plain, /На главную/, 'the admin and CEO sign-in screens stay as they are');
  const member = require('node:fs').readFileSync(require('node:path').join(__dirname, '../frontend/features/member/MemberApp.tsx'), 'utf8');
  assert.match(member, /<AuthScreen onAuthenticated=\{handleAuthenticated\} homeHref="\/" \/>/);
});

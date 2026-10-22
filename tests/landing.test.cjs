const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const Link = ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children);
const font = () => ({ variable: 'font' });
const overrides = { 'next/link': { default: Link }, 'next/font/google': { Geologica: font, Onest: font } };

test('the landing sends leaders to WhatsApp and participants into the sign-up and sign-in screen', () => {
  const { Landing, REGISTER_HREF, LOGIN_HREF, LEADER_HREF, LEADER_PHONE, LEADER_MESSAGE } = loadTs('frontend/features/landing/Landing.tsx', overrides);
  assert.equal(REGISTER_HREF, '/?auth=register');
  assert.equal(LOGIN_HREF, '/?auth=login');
  assert.equal(LEADER_PHONE, '+7 707 689 73 25');
  assert.equal(LEADER_HREF, `https://wa.me/77076897325?text=${encodeURIComponent(LEADER_MESSAGE)}`, 'the chat opens with the message already typed');
  const html = renderToStaticMarkup(React.createElement(Landing));
  assert.match(html, /<h1[^>]*>Команда растёт по/);
  assert.equal((html.match(/Подключить команду/g) || []).length, 3, 'the leader offer is in the header, hero and connect block');
  const whatsapp = html.match(/<a[^>]*href="https:\/\/wa\.me\/77076897325[^"]*"[^>]*>/g) || [];
  assert.equal(whatsapp.length, 5, 'header, hero, connect button, phone number and chat window open WhatsApp');
  for (const link of whatsapp) assert.match(link, /target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/);
  assert.match(html, /\+7 707 689 73 25/, 'the number is shown as text too');
  const buttons = (html.match(/<a(?:\s[^>]*)?>.*?<\/a>/g) || []).map((tag) => tag.replace(/<[^>]+>/g, '').trim())
    .filter((label) => label === 'Войти в кабинет' || label === 'Подключить команду').map((label) => label === 'Войти в кабинет' ? 'login' : 'leader');
  assert.deepEqual(buttons, ['leader', 'login', 'leader', 'login', 'login', 'leader'], 'header link, then sign-in first in the hero, members and connect blocks');
  assert.match(html, /<a[^>]*href="\/\?auth=login"[^>]*>Войти<\/a>/, 'the gold header button is sign-in');
  assert.ok((html.match(/href="\/\?auth=register"/g) || []).length >= 2, 'registration is offered in the members block and footer');
  assert.ok((html.match(/href="\/\?auth=login"/g) || []).length >= 4, 'sign-in is in the header, hero, members block, final block and footer');
  assert.match(html, /href="\/admin"/, 'team leaders reach the mentor panel');
  for (const id of ['problem', 'launch', 'features', 'members', 'faq', 'connect']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const id of ['launch', 'features', 'members', 'faq']) assert.match(html, new RegExp(`href="#${id}"`), `menu link to ${id}`);
  assert.match(html, /<details>/, 'questions open without scripts');
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

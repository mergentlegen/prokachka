const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const course = loadTs('shared/domain/star-course.ts');
const row = (id, name, points) => ({ id, name, points });

test('Звёздный курс = miles (up to 100) + stars (up to 10) × 20, at most 300', () => {
  assert.equal(course.starCourse(100, 3), 160);
  assert.equal(course.starCourse(40, 0), 40);
  assert.equal(course.starCourse(450, 3), 160, 'miles above 100 do not add to the course');
  assert.equal(course.starCourse(80, 14), 280, 'stars above 10 do not add to the course');
  assert.equal(course.starCourse(500, 20), 300);
  assert.equal(course.COURSE_MAX, 300);
});

test('one rating by course; on a tie more stars (also above 10) go higher, then the name', () => {
  const miles = [row('a', 'Вера', 100), row('b', 'Анна', 60), row('c', 'Борис', 100), row('d', 'Гоша', 500), row('e', 'Даша', 100)];
  const stars = [row('a', 'Вера', 1), row('b', 'Анна', 3), row('c', 'Борис', 1), row('d', 'Гоша', 10), row('e', 'Даша', 13)];
  const ranking = course.courseRanking(miles, stars);
  assert.deepEqual(ranking.map((entry) => [entry.name, entry.points]), [['Даша', 300], ['Гоша', 300], ['Анна', 120], ['Борис', 120], ['Вера', 120]]);
  assert.deepEqual(ranking[0], { id: 'e', name: 'Даша', avatarUrl: undefined, points: 300, miles: 100, stars: 13 }, 'personal totals stay as they are');
  assert.deepEqual(course.courseRanking([row('x', 'Без звёзд', 30)], []).map((entry) => [entry.points, entry.stars]), [[30, 0]]);
});

test('the next place: course points, and whether miles or a star get there', () => {
  const { overtakeText } = loadTs('frontend/features/member/RankingBoard.tsx');
  const me = (miles, stars) => ({ id: 'me', name: 'Я', miles, stars, points: course.starCourse(miles, stars) });
  const ahead = (points, stars = 0) => ({ id: 'x', name: 'Он', points, stars, miles: 100 });
  assert.equal(overtakeText(me(85, 3), ahead(159)), '15 курса: 15 миль или 1 звезда');
  assert.equal(overtakeText(me(100, 3), ahead(174)), '15 курса: 1 звезда', 'miles are full, only a star helps');
  assert.equal(overtakeText(me(90, 10), ahead(295)), '6 курса: 6 миль', 'stars are full, only miles help');
  assert.equal(overtakeText(me(100, 2), ahead(200)), '61 курса: 4 звезды');
  assert.equal(overtakeText(me(100, 10), ahead(300, 12)), 'ещё 3 звезды', 'at 300 only more stars overtake');
  assert.equal(overtakeText(me(100, 10), ahead(300, 10)), 'ещё 1 звезда');
});

test('the participant card shows the course out of 300, both fuels and the hint', () => {
  const { StarCourseCard } = loadTs('frontend/features/member/StarCourseCard.tsx');
  const card = (miles, stars) => renderToStaticMarkup(React.createElement(StarCourseCard, { miles, stars, rank: 2, onOpenRanking() {} }));
  const html = card(140, 3);
  assert.match(html, /Звёздный курс/);
  assert.match(html, /из 300/);
  assert.match(html, /aria-valuenow="160"/);
  assert.match(html, /3\/10 звёзд<\/span><b>→ 60 курса/);
  assert.match(html, /100\/100 миль<\/span><b>→ 100 курса/);
  assert.match(html, /Следующая звезда = \+20 к курсу\. Один PREMIUM = \+100\./);
  assert.match(html, /2 место в рейтинге/);
  assert.match(card(40, 12), /Добирай мили/);
  const done = card(100, 10);
  assert.match(done, /Звёздный курс пройден ✓/);
  assert.match(done, /больше звёзд/);
});

test('the rating API returns one course rating and no separate miles or stars ratings', async () => {
  const controller = loadTs('backend/controllers/ranking.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => ({ id: 'me', role: 'member', teamId: 'team' }) },
    '@/backend/services/ranking.service': {
      findRanking: async () => ({ data: [row('a', 'Анна', 100), row('b', 'Борис', 30)] }),
      findStarRanking: async () => ({ data: [row('a', 'Анна', 0), row('b', 'Борис', 5)] }),
    },
  });
  const body = await (await controller.listRanking(new Request('https://example.test/api/ranking'))).json();
  assert.deepEqual(body.ranking.map((entry) => [entry.name, entry.points, entry.miles, entry.stars]), [['Борис', 130, 30, 5], ['Анна', 100, 100, 0]]);
  assert.equal(body.starRanking, undefined);
});

const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const course = loadTs('shared/domain/star-course.ts');
const row = (id, name, points) => ({ id, name, points });

test('XP (Опыт) = miles (up to 100) + stars (up to 10) × 20, at most 300', () => {
  assert.equal(course.starCourse(100, 3), 160);
  assert.equal(course.starCourse(40, 0), 40);
  assert.equal(course.starCourse(450, 3), 160, 'miles above 100 do not add to the course');
  assert.equal(course.starCourse(80, 14), 280, 'stars above 10 do not add to the course');
  assert.equal(course.starCourse(500, 20), 300);
  assert.equal(course.COURSE_MAX, 300);
});

test('one rating by course; on a tie more stars (also above 10) go higher, then the name', () => {
  const person = (id, name, miles, stars) => ({ id, name, miles, stars });
  const ranking = course.courseRanking([person('a', 'Вера', 100, 1), person('b', 'Анна', 60, 3), person('c', 'Борис', 100, 1), person('d', 'Гоша', 500, 10), person('e', 'Даша', 100, 13)]);
  assert.deepEqual(ranking.map((entry) => [entry.name, entry.points]), [['Даша', 300], ['Гоша', 300], ['Анна', 120], ['Борис', 120], ['Вера', 120]]);
  assert.deepEqual(ranking[0], { id: 'e', name: 'Даша', avatarUrl: undefined, points: 300, miles: 100, stars: 13 }, 'personal totals stay as they are');
  assert.deepEqual(course.courseRanking([person('x', 'Без звёзд', 30, 0)]).map((entry) => [entry.points, entry.stars]), [[30, 0]]);
});

test('the next place: course points, and whether miles or a star get there', () => {
  const { overtakeText } = loadTs('frontend/features/member/RankingBoard.tsx');
  const me = (miles, stars) => ({ id: 'me', name: 'Я', miles, stars, points: course.starCourse(miles, stars) });
  const ahead = (points, stars = 0) => ({ id: 'x', name: 'Он', points, stars, miles: 100 });
  assert.equal(overtakeText(me(85, 3), ahead(159)), '15 XP: 15 миль или 1 звезда');
  assert.equal(overtakeText(me(100, 3), ahead(174)), '15 XP: 1 звезда', 'miles are full, only a star helps');
  assert.equal(overtakeText(me(90, 10), ahead(295)), '6 XP: 6 миль', 'stars are full, only miles help');
  assert.equal(overtakeText(me(100, 2), ahead(200)), '61 XP: 4 звезды');
  assert.equal(overtakeText(me(100, 10), ahead(300, 12)), 'ещё 3 звезды', 'at 300 only more stars overtake');
  assert.equal(overtakeText(me(100, 10), ahead(300, 10)), 'ещё 1 звезда');
});

test('the participant card shows the course out of 300, both fuels and the hint', () => {
  const { StarCourseCard } = loadTs('frontend/features/member/StarCourseCard.tsx');
  const card = (miles, stars) => renderToStaticMarkup(React.createElement(StarCourseCard, { miles, stars, rank: 2, onOpenRanking() {} }));
  const html = card(140, 3);
  assert.match(html, /Опыт/);
  assert.match(html, /из 300 XP/);
  assert.match(html, /из 300/);
  assert.match(html, /aria-valuenow="160"/);
  assert.match(html, /3\/10 звёзд<\/span><b>→ 60 XP/);
  assert.match(html, /100\/100 миль<\/span><b>→ 100 XP/);
  assert.match(html, /Следующая звезда = \+20 XP\. Один PREMIUM = \+100 XP\./);
  assert.match(html, /2 место в рейтинге/);
  assert.match(card(40, 12), /Добирай мили/);
  const done = card(100, 10);
  assert.match(done, /Опыт набран ✓/);
  assert.match(done, /больше звёзд/);
});

test('the rating API returns the course rating of the viewer’s level only, and a pending congratulation', async () => {
  const standings = [
    { id: 'a', name: 'Анна', level: 1, miles: 100, stars: 0 }, { id: 'b', name: 'Борис', level: 1, miles: 30, stars: 5 },
    { id: 'me', name: 'Я', level: 2, miles: 10, stars: 1 }, { id: 'c', name: 'Вера', level: 2, miles: 40, stars: 0 },
  ];
  const api = (user, levelUp = null) => loadTs('backend/controllers/ranking.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/ranking.service': { findCourseStandings: async () => ({ data: standings }), findPendingLevelUp: async () => levelUp, markMemberLevelSeen: async () => ({ data: true }) },
  });
  const rating = async (user, levelUp) => (await (await api(user, levelUp).listRanking(new Request('https://example.test/api/ranking'))).json());
  const first = await rating({ id: 'a', role: 'member', teamId: 'team' });
  assert.deepEqual(first.ranking.map((entry) => [entry.name, entry.points, entry.miles, entry.stars]), [['Борис', 130, 30, 5], ['Анна', 100, 100, 0]]);
  assert.equal(first.level, 1);
  assert.equal(first.starRanking, undefined);
  const second = await rating({ id: 'me', role: 'member', teamId: 'team' }, 2);
  assert.deepEqual(second.ranking.map((entry) => entry.name), ['Вера', 'Я'], 'only level 2, with level 2 miles and stars');
  assert.equal(second.level, 2);
  assert.equal(second.levelUp, 2, 'the congratulation that was not shown yet');
});

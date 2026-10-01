const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const HOUR = 3_600_000, DAY = 24 * HOUR;
const now = Date.parse('2026-10-02T12:00:00Z');
const at = (offset) => new Date(now + offset).toISOString();
const progress = loadTs('frontend/features/member/member-progress.ts');
const task = (id, extra = {}) => ({ id, title: id, description: '', maxPoints: 10, isActive: true, publicationType: 'fixed', createdAt: '2026-09-01', updatedAt: '2026-09-01', ...extra });
const submission = (taskId, extra = {}) => ({ id: `s-${taskId}`, userId: 'me', taskId, status: 'pending', points: 0, comment: '', submittedAt: at(-DAY), interactiveCompleted: true, ...extra });

test('countdown wording and urgency follow the time that is left', () => {
  assert.deepEqual(progress.deadlineInfo(at(5 * DAY), now), { text: 'осталось 5 дней', tone: 'calm' });
  assert.deepEqual(progress.deadlineInfo(at(DAY + 3 * HOUR), now), { text: 'остался 1 день 3 ч', tone: 'soon' });
  assert.deepEqual(progress.deadlineInfo(at(5 * HOUR + 20 * 60_000), now), { text: 'осталось 5 ч 20 мин', tone: 'urgent' });
  assert.deepEqual(progress.deadlineInfo(at(10 * 60_000), now), { text: 'осталось 10 мин', tone: 'urgent' });
  assert.deepEqual(progress.deadlineInfo(at(-1), now), { text: 'срок истёк', tone: 'expired' });
  assert.equal(progress.deadlineInfo(undefined, now), null);
  assert.equal(progress.deadlineInfo(at(22 * DAY), now).text, 'осталось 22 дня');
});

test('task state matches what the participant can still do', () => {
  assert.equal(progress.taskState(task('a'), undefined, now), 'todo');
  assert.equal(progress.taskState(task('a'), submission('a', { status: 'revision' }), now), 'todo');
  assert.equal(progress.taskState(task('a'), submission('a'), now), 'review');
  assert.equal(progress.taskState(task('a'), submission('a', { status: 'accepted' }), now), 'done');
  assert.equal(progress.taskState(task('a'), submission('a', { status: 'accepted', interactiveCompleted: false }), now), 'todo', 'an unfinished survey is still to do');
  assert.equal(progress.taskState(task('a', { deadlineAt: at(-HOUR) }), undefined, now), 'closed');
  assert.equal(progress.taskState(task('a', { publicationType: 'sequential', dueAt: at(-HOUR) }), undefined, now), 'todo', 'program steps accept late answers');
});

test('"Сейчас важно" picks overdue program steps, then the nearest deadline, and skips finished work', () => {
  const tasks = [
    task('later', { deadlineAt: at(3 * DAY) }), task('no-deadline'), task('soon', { deadlineAt: at(2 * HOUR) }),
    task('late-step', { publicationType: 'sequential', dueAt: at(-HOUR) }), task('done', { deadlineAt: at(HOUR) }), task('waiting', { deadlineAt: at(HOUR) }),
  ];
  const latest = progress.latestSubmissions([submission('done', { status: 'accepted' }), submission('waiting'), submission('other', { userId: 'someone' })], 'me');
  assert.deepEqual(progress.focusTasks(tasks, latest, now).map((item) => item.id), ['late-step', 'soon', 'later', 'no-deadline']);
});

test('weekly miles and the gap to the next place', () => {
  const items = [
    submission('a', { status: 'accepted', points: 30, reviewedAt: at(-2 * DAY) }),
    submission('b', { status: 'accepted', points: 50, reviewedAt: at(-9 * DAY) }),
    submission('c', { status: 'pending', points: 99, reviewedAt: at(-DAY) }),
    submission('d', { status: 'accepted', points: 7, reviewedAt: at(-DAY), userId: 'someone' }),
  ];
  assert.equal(progress.milesSince(items, 'me', now - 7 * DAY), 30);
  const ranking = [{ id: 'lead', name: 'A', points: 120 }, { id: 'me', name: 'B', points: 80 }, { id: 'c', name: 'C', points: 10 }];
  assert.deepEqual(progress.rankGap(ranking, 'me'), { place: 2, points: 80, ahead: ranking[0], gap: 41 });
  assert.equal(progress.rankGap(ranking, 'lead').gap, 0);
  assert.equal(progress.rankGap([{ id: 'x', points: 5 }, { id: 'me', points: 5 }], 'me').gap, 1, 'a tie still needs one more mile');
  assert.equal(progress.rankGap(ranking, 'missing'), null);
});

test('celebration: the first visit remembers history; later visits celebrate only new acceptances and rank-ups', () => {
  const { newMoment } = loadTs('frontend/features/member/Celebration.tsx');
  const old = submission('old', { status: 'accepted', points: 20, reviewedAt: at(-3 * DAY), taskTitle: 'Старое' });
  const first = newMoment([old], 'me', 5, null, at(0));
  assert.equal(first.moment, null);
  assert.deepEqual(first.seen, { reviewedAt: old.reviewedAt, rank: 5 });

  const fresh = submission('new', { status: 'accepted', points: 30, reviewedAt: at(-HOUR), taskTitle: 'Новое' });
  const second = newMoment([old, fresh], 'me', 3, first.seen);
  assert.deepEqual(second.moment, { miles: 30, titles: ['Новое'], rank: 3 });
  assert.deepEqual(second.seen, { reviewedAt: fresh.reviewedAt, rank: 3 });
  assert.equal(newMoment([old, fresh], 'me', 3, second.seen).moment, null, 'the same moment is shown only once');

  assert.equal(newMoment([old], 'me', 0, { reviewedAt: old.reviewedAt, rank: 4 }).moment, null, 'an unloaded rating is not a rank change');
  assert.equal(newMoment([old], 'me', 0, { reviewedAt: old.reviewedAt, rank: 4 }).seen.rank, 4);
  assert.deepEqual(newMoment([old], 'me', 2, { reviewedAt: old.reviewedAt, rank: 4 }).moment, { miles: 0, titles: [], rank: 2 });
  assert.equal(newMoment([old], 'me', 6, { reviewedAt: old.reviewedAt, rank: 4 }).moment, null, 'dropping places is never celebrated');
  const someoneElse = submission('x', { userId: 'other', status: 'accepted', points: 9, reviewedAt: at(0) });
  assert.equal(newMoment([someoneElse], 'me', 4, { reviewedAt: old.reviewedAt, rank: 4 }).moment, null);
});

test('home overview tiles show tasks waiting, unread replies, place and weekly miles', () => {
  const { HomeOverview } = loadTs('frontend/features/member/HomeOverview.tsx');
  const opened = [];
  const element = React.createElement(HomeOverview, {
    userId: 'me', now, feedbackUnread: 2, onOpen: (tab) => opened.push(tab),
    tasks: [task('Шаг', { publicationType: 'sequential', position: 3, dueAt: at(4 * HOUR) }), task('Обычное'), task('Готово')],
    submissions: [submission('Готово', { status: 'accepted', points: 30, reviewedAt: at(-DAY) })],
    ranking: [{ id: 'lead', name: 'A', points: 100 }, { id: 'me', name: 'B', points: 30 }],
  });
  const markup = renderToStaticMarkup(element);
  assert.equal((markup.match(/<button/g) || []).length, 4);
  assert.match(markup, /<strong>2<\/strong><span[^>]*>задания ждут/);
  assert.match(markup, /осталось 4 ч/, 'the nearest deadline is visible on the tile');
  assert.match(markup, /новых ответа/);
  assert.match(markup, /<strong>71<\/strong><span[^>]*>миля до 1-го места/);
  assert.match(markup, /сейчас 2-е место/);
  assert.match(markup, /\+30/);
  const calm = renderToStaticMarkup(React.createElement(HomeOverview, { userId: 'me', now, feedbackUnread: 0, tasks: [], submissions: [], ranking: [{ id: 'me', name: 'B', points: 5 }], onOpen() {} }));
  assert.match(calm, /Всё выполнено/);
  assert.match(calm, /новых ответов нет/);
  assert.match(calm, /ты лидер!/);
});

test('ranking shows a podium for the top three and pins the participant’s own place', () => {
  const { RankingBoard } = loadTs('frontend/features/member/RankingBoard.tsx');
  const ranking = ['Анна', 'Борис', 'Вера', 'Гоша', 'Даша'].map((name, index) => ({ id: `u${index}`, name, points: 100 - index * 10 }));
  const markup = renderToStaticMarkup(React.createElement(RankingBoard, { ranking, metric: 'points', onMetric() {}, userId: 'u4' }));
  const podium = markup.slice(markup.indexOf('Первая тройка'), markup.indexOf('</ol>'));
  assert.ok(podium.indexOf('Борис') < podium.indexOf('Анна') && podium.indexOf('Анна') < podium.indexOf('Вера'), 'second, first, third like a real podium');
  assert.equal((markup.match(/class="rank-row/g) || []).length, 2);
  assert.match(markup, /До 4-го места: 11 миль/);
  const leader = renderToStaticMarkup(React.createElement(RankingBoard, { ranking, metric: 'stars', onMetric() {}, userId: 'u0' }));
  assert.match(leader, /на первом месте/);
  assert.match(leader, /100 звёзд/);
  const small = renderToStaticMarkup(React.createElement(RankingBoard, { ranking: ranking.slice(0, 2), metric: 'points', onMetric() {}, userId: 'u1' }));
  assert.ok(!small.includes('Первая тройка'), 'no podium for fewer than three people');
});

test('the bottom menu has five tabs with an unread badge on feedback', () => {
  const { MemberBottomNav } = loadTs('frontend/features/member/MemberNav.tsx');
  const markup = renderToStaticMarkup(React.createElement(MemberBottomNav, { tab: 'tasks', onChange() {}, feedbackUnread: 12 }));
  assert.equal((markup.match(/<button/g) || []).length, 5);
  assert.ok(!markup.includes('Профиль'));
  assert.match(markup, /aria-current="page"[^>]*>.*?Задания/);
  assert.match(markup, />9\+</);
});

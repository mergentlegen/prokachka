const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('«Правила игры» asks the five XP questions and the server key points at the right options', () => {
  const { STARTER_RULES_QUESTIONS } = loadTs('frontend/features/member/StarterRulesGame.tsx');
  const migration = read('supabase/20261110-starter-rules-xp.sql');
  const key = JSON.parse(migration.match(/'starter-rules' then '(\{[^']+\})'/)[1]).answers;
  assert.deepEqual(key, [0, 1, 0, 0, 0]);
  const right = ['За обучение и задания', 'За реальный результат', 'Твой настоящий прогресс', 'Набрать 300 XP', 'Постоянно быть активным на платформе и учиться'];
  assert.equal(STARTER_RULES_QUESTIONS.length, 5);
  STARTER_RULES_QUESTIONS.forEach((question, index) => {
    assert.equal(question.options.length, 3, question.title);
    assert.equal(question.options[key[index]], right[index], question.title);
  });
  const source = read('frontend/features/member/StarterRulesGame.tsx');
  for (const text of ['Мили — за обучение', 'Звёзды — за результат', 'XP — твой настоящий прогресс', 'Цель — набрать 300 XP', 'Радуйся: ты счастливчик!']) assert.ok(source.includes(text), text);
  assert.doesNotMatch(source, /Главный приз|бонус/i, 'the old rules text is gone');
});

test('every ready game offers its material again after it is passed, with the same large button', () => {
  const games = ['DreamPlanGame', 'HeartSurvey', 'CompanyVoyageGame', 'CaptainCruiseGame', 'CountYourDreamGame', 'DreamRouteGame', 'FirstYearGame', 'SafetyWatchGame', 'ReadyProgramQuiz'];
  for (const game of games) assert.match(read(`frontend/features/member/${game}.tsx`), /<MaterialButton /, game);
  assert.match(read('frontend/features/member/StarterRulesGame.tsx'), /onMaterial=\{\(\) => setQuizOpen\(false\)\}/, '«Правила игры» goes back to its rules');
  for (const game of ['CountYourDreamGame', 'DreamRouteGame']) assert.match(read(`frontend/features/member/${game}.tsx`), /if \(completed\) \{ setForm\(nextForm\); setStep\(next\);/, `${game}: reading again saves nothing`);
  const { MaterialButton } = loadTs('frontend/features/member/GameMaterial.tsx');
  const html = renderToStaticMarkup(React.createElement(MaterialButton, { onClick() {} }));
  assert.match(html, /Посмотреть материал игры/);
  assert.match(html, /Награда уже получена/);
});

test('simulator games open a reading page built from their own data', () => {
  const material = loadTs('frontend/features/member/GameMaterial.tsx');
  const render = (name) => renderToStaticMarkup(React.createElement(material[name], { onBack() {} })).replace(/<[^>]+>/g, ' ');
  const captain = render('CaptainCruiseMaterial');
  assert.match(captain, /Disney Cruise Line/);
  assert.match(captain, /Сколько круизных линий в клубе\?/);
  assert.match(captain, /Верно — 14 круизных линий/);
  const safety = render('SafetyWatchMaterial');
  assert.match(safety, /Пускаем на борт\?/);
  assert.match(safety, /Правильно: ✅ Пустить/);
  const year = render('FirstYearMaterial');
  assert.match(year, /Месяц 12/);
  assert.match(year, /Автоплатёж/);
  assert.doesNotMatch(year, /<b>|&lt;b&gt;/, 'bold marks are rendered, not shown as text');
  for (const page of [captain, safety, year]) assert.match(page, /К результату/);
});

test('a passed task or program step shows a clear «Материал задания» button on its card', () => {
  const { TaskCard } = loadTs('frontend/features/member/TaskCard.tsx');
  const task = { id: 't', title: 'Видео', description: 'Запиши', maxPoints: 10, isActive: true, publicationType: 'sequential', createdAt: '2026-09-01', updatedAt: '2026-09-01' };
  const accepted = { id: 's', userId: 'm', taskId: 't', status: 'accepted', points: 10, comment: '', submittedAt: '2026-09-02', reviewVersion: 1 };
  const card = (props) => renderToStaticMarkup(React.createElement(TaskCard, { onSubmit: async () => undefined, ...props }));
  assert.match(card({ task, submission: accepted }), /📖<\/span>Материал задания/);
  assert.match(card({ task: { ...task, interactiveKind: 'safety-watch' }, submission: accepted }), /📖<\/span>Материал игры/);
  assert.doesNotMatch(card({ task }), /Материал задания/, 'a task not yet done keeps «Подробнее»');
  assert.doesNotMatch(card({ task: { ...task, interactiveKind: 'safety-watch' }, submission: accepted, readOnly: true }), /Материал игры/, 'archive games do not start, so no such button');
  assert.match(read('frontend/features/member/TaskCard.module.css'), /\.read\.readMaterial \{[^}]*border:1\.5px solid var\(--blue\)/);
});

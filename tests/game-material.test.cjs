const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./helpers/load-ts.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('every ready game offers its material again after it is passed, with the same large button', () => {
  const games = ['DreamPlanGame', 'HeartSurvey', 'CompanyVoyageGame', 'CaptainCruiseGame', 'CountYourDreamGame', 'DreamRouteGame', 'FirstYearGame', 'SafetyWatchGame', 'CabinetTrainer', 'ReadyProgramQuiz', 'StarterRulesGame'];
  for (const game of games) assert.match(read(`frontend/features/member/${game}.tsx`), /<MaterialButton /, game);
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
  assert.match(captain, /Верно — 15 круизных линий/); assert.match(captain, /AmaWaterways 🌊 речные/);
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
  assert.match(card({ task: { ...task, interactiveKind: 'safety-watch' }, submission: accepted, readOnly: true }), /📖<\/span>Материал игры/, 'a game passed on an earlier level keeps its material');
  assert.doesNotMatch(card({ task: { ...task, interactiveKind: 'safety-watch' }, readOnly: true }), /Материал игры/, 'an archive game never played does not start');
  assert.match(read('frontend/features/member/TaskCard.module.css'), /\.read\.readMaterial \{[^}]*border:1\.5px solid var\(--blue\)/);
});

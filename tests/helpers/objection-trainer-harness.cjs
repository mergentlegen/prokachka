// The objection trainer screen (ObjectionTrainer) with a fake site that follows the SQL rules of app_<kind>.
const assert = require('node:assert/strict');
const React = require('react');
const load = require('./load-ts.cjs');
const hookHarness = require('./hook-harness.cjs');

const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap((item) => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const label = (tree) => Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const taskId = '88888888-8888-4888-8888-888888888888';

function setupTrainer(trainer, keys, start = {}) {
  const harness = hookHarness();
  const queue = [];
  const previous = globalThis.window;
  const total = trainer.rounds.length;
  const phrases = trainer.rounds[trainer.sortStep].phrases.length;
  globalThis.window = { setTimeout: (run) => { queue.push(run); return queue.length; }, clearTimeout() {}, location: { assign: (url) => server.opened.push(url) } };
  const server = { step: start.step || 0, mistakes: start.mistakes || 0, marks: { ...(start.marks || {}) }, completed: Boolean(start.completed), calls: [], opened: [], voiceLinks: 0 };
  const state = (extra = {}) => ({ step: server.step, mistakes: server.mistakes, completed: server.completed, earnedPoints: server.completed ? 1 : 0,
    marks: Object.fromEntries(Object.entries(server.marks).map(([item, good]) => [Number(item), { good, right: good === keys.sort[item] }])),
    keys: server.completed ? keys : undefined, submission: server.submission, ...extra });
  const api = { trainerAction: async (kind, id, operation, step, payload) => {
    assert.equal(kind, trainer.kind); assert.equal(id, taskId);
    server.calls.push([operation, step, payload]);
    if (operation === 'answer') {
      assert.equal(step, server.step, 'the answer is for the current round');
      const right = payload.answer === keys.answers[step];
      if (right) server.step += 1; else server.mistakes += 1;
      return state({ right });
    }
    if (operation === 'mark') {
      assert.equal(step, trainer.sortStep); assert.equal(server.step, trainer.sortStep, 'marks only in the sorting round');
      assert.equal(payload.item in server.marks, false, 'a phrase is sent once');
      const right = payload.good === keys.sort[payload.item];
      server.marks[payload.item] = payload.good;
      if (!right) server.mistakes += 1;
      if (Object.keys(server.marks).length === phrases) server.step = total;
      return state({ right });
    }
    if (operation === 'complete') { assert.equal(server.step, total); server.completed = true; server.submission = { id: 'result', points: 1 }; }
    return state();
  } };
  const css = { __esModule: true, default: new Proxy({}, { get: (_t, key) => key }) };
  const { ObjectionTrainer } = load('frontend/features/member/ObjectionTrainer.tsx', {
    react: { ...React, ...harness.react }, '@/frontend/shared/api/objection-trainer-client': api, './ObjectionTrainer.module.css': css,
    '@/frontend/shared/api/ready-program-client': { createCompanyVoiceLink: async (id) => { assert.equal(id, taskId); server.voiceLinks += 1; return { url: 'https://t.me/bot?start=company_voice_x' }; } },
  });
  const received = [];
  harness.mount(ObjectionTrainer, { trainer, taskId, onCompleted: (submission) => received.push(submission) });
  const game = { server, received, tree: null,
    async settle() { game.tree = await harness.settle(); return game.tree; },
    text() { return label(game.tree); },
    buttons(predicate) { return nodes(game.tree, (n) => n.type === 'button' && predicate(n)); },
    async press(name) {
      const button = game.buttons((n) => typeof name === 'string' ? label(n).trim() === name : name(n))[0];
      assert.ok(button, `button «${name}»`); assert.equal(Boolean(button.props.disabled), false, `«${name}» is disabled`);
      await button.props.onClick(); while (queue.length) queue.shift()(); return game.settle();
    },
    option(index) { return game.buttons((n) => /\bopt\b/.test(n.props.className || ''))[index]; },
    async pick(index) { return game.press((n) => n === game.option(index)); },
    async mark(index, good) { return game.press((n) => n === game.buttons((b) => label(b) === (good ? '👍 Помогает' : '👎 Вредит'))[index]); },
    done() { harness.unmount(); globalThis.window = previous; },
  };
  return game;
}

module.exports = { setupTrainer, nodes, label, taskId };

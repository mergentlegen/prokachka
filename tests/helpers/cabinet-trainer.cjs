// A cabinet trainer (frontend/features/member/CabinetTrainer.tsx) mounted with a fake site that follows the SQL
// app_<trainer> rules, and timers run by hand. `game` is the trainer's file, `screens` the name of its exported cabinet.
const assert = require('node:assert/strict');
const React = require('react');
const load = require('./load-ts.cjs');
const hookHarness = require('./hook-harness.cjs');

const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap((item) => nodes(item, predicate)) : !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const label = (tree) => Array.isArray(tree) ? tree.map(label).join('') : tree && typeof tree === 'object' ? label(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const task = '44444444-4444-4444-8444-444444444444';

function setupTrainer({ data, trainer, game: file, screens }, start = {}) {
  const harness = hookHarness();
  const queue = [];
  const previous = globalThis.window;
  globalThis.window = { setTimeout: (run) => { queue.push(run); return queue.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {} };
  const spec = load(data)[trainer];
  const count = spec.missions.length;
  const server = { missions: start.missions || 0, completed: Boolean(start.completed), stats: start.stats || { errors: 0, hints: 0, log: {} }, calls: [] };
  const api = { cabinetTrainerAction: async (kind, _id, operation, step, payload) => {
    assert.equal(kind, spec.kind, 'the trainer talks to its own rules');
    server.calls.push([operation, step, payload]);
    if (server.completed) return { missions: count, stats: server.stats, completed: true, earnedPoints: spec.reward };
    if (operation === 'save') {
      const mission = spec.missions[step - 1];
      if (step > server.missions + 1 || (mission.ask && payload.answer !== mission.ask.right)) throw new Error('Пройди миссию, чтобы перейти к следующей.');
      server.missions = Math.max(server.missions, step); server.stats = { errors: payload.errors, hints: payload.hints, log: payload.log };
    }
    if (operation === 'complete') {
      assert.equal(server.missions, count);
      assert.deepEqual(payload.answers, spec.quiz.map((question) => question.right));
      server.completed = true; server.stats = { errors: payload.errors, hints: payload.hints, log: payload.log };
      return { missions: count, stats: server.stats, completed: true, earnedPoints: spec.reward, submission: { id: 'done', points: spec.reward } };
    }
    return { missions: server.missions, stats: server.stats, completed: false, earnedPoints: 0 };
  } };
  // Class names stay readable in the tree: styles.cab is 'cab'.
  const css = { __esModule: true, default: new Proxy({}, { get: (_t, key) => key }) };
  const mocks = { react: { ...React, ...harness.react }, '@/frontend/shared/api/cabinet-trainer-client': api, './CabinetTrainer.module.css': css };
  const { CabinetTrainer } = load('frontend/features/member/CabinetTrainer.tsx', mocks);
  const render = load(file, mocks)[screens];
  const received = [];
  harness.mount(CabinetTrainer, { taskId: task, trainer: spec, render, onCompleted: (submission) => received.push(submission) });
  const game = { harness, server, received, tree: null, missions: spec.missions, quiz: spec.quiz,
    async settle() { game.tree = await harness.settle(); return game.tree; },
    async flush() { while (queue.length) queue.shift()(); return game.settle(); },
    text() { return label(game.tree); },
    find(predicate) { return nodes(game.tree, predicate); },
    spot(name) { return nodes(game.tree, (n) => n.props?.['data-hot'] === name); },
    async press(name) {
      const button = nodes(game.tree, (n) => n.type === 'button' && (typeof name === 'string' ? label(n) === name : name(n)))[0];
      assert.ok(button, `button «${name}»`); assert.equal(Boolean(button.props.disabled), false, `«${name}» is disabled`);
      await button.props.onClick(); return game.settle();
    },
    // A tap in the cabinet copy on the place marked `spot`, or on an empty spot (of the open menu with `menu`).
    async tap(spot, { menu = false } = {}) {
      const cabinet = nodes(game.tree, (n) => n.props?.className === 'cab')[0];
      assert.ok(cabinet, 'the cabinet is on screen');
      if (spot) assert.ok(game.spot(spot).length, `the place «${spot}» is on screen`);
      const element = { getAttribute: () => spot, classList: { add() {}, remove() {} } };
      const closest = (selector) => selector === `[data-hot="${spot}"]` || (spot && selector === '[data-hot]') ? element : selector === '[data-no-miss]' && menu ? {} : null;
      cabinet.props.onClick({ target: { closest, classList: { add() {}, remove() {} } } });
      return game.flush();
    },
    done() { harness.unmount(); globalThis.window = previous; },
  };
  return game;
}

module.exports = { setupTrainer, nodes, label, task };

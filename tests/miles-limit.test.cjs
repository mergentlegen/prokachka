const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

test('miles have no 100-point product ceiling but respect PostgreSQL integer bounds', () => {
  const { validMiles, MAX_MILES } = load('shared/domain/miles.ts');
  assert.equal(validMiles(25000), true);
  assert.equal(validMiles(MAX_MILES), true);
  for (const invalid of [-1, 1.5, MAX_MILES + 1, NaN, Infinity]) assert.equal(validMiles(invalid), false);
});

test('ordinary task creation accepts more than 100 miles and rejects overflow', async () => {
  const inputs = [];
  const user = { id: 'mentor', role: 'admin', teamId: 'a98a099e-8d8c-4cfb-882b-dcc6b56f845f' };
  const controller = load('backend/controllers/tasks.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => user },
    '@/backend/services/tasks.service': { insertTask: async input => { inputs.push(input); return { data: { id: 'task', ...input } }; } },
  });
  const request = maxPoints => new Request('http://localhost/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Large reward', description: 'Task description', maxPoints }) });
  assert.equal((await controller.createTask(request(25000))).status, 201);
  assert.equal(inputs[0].maxPoints, 25000);
  assert.equal((await controller.createTask(request(2147483648))).status, 400);
  assert.equal((await controller.createTask(request(1.5))).status, 400);
  assert.equal(inputs.length, 1);
});

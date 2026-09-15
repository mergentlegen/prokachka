// Opt-in: PROKACHKA_TEST_PG_PORT must point to a disposable localhost PostgreSQL.
// This suite creates isolated fixture users; it never loads the application's .env.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const port = process.env.PROKACHKA_TEST_PG_PORT;
const psql = process.env.PROKACHKA_TEST_PSQL || 'psql';
const args = ['-X', '-h', '127.0.0.1', '-p', port || '55439', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
const query = (sql) => execFileSync(psql, [...args, '-c', sql], { encoding: 'utf8' }).trim();
const parallel = async (sql) => (await promisify(execFile)(psql, [...args, '-c', sql], { encoding: 'utf8' })).stdout.trim();
function fixture() {
  const team = randomUUID(), root = randomUUID(), alice = randomUUID(), bob = randomUUID(), task = randomUUID();
  query(`insert into teams(id,name) values('${team}','concurrency-${team}');
    insert into users(id,name,first_name,last_name,email,login,password_hash,team_id,role) values
    ('${root}','Root Mentor','Root','Mentor','${root}@fixture.test','${root}','test-only','${team}','admin'),
    ('${alice}','Alice Member','Alice','Member','${alice}@fixture.test','${alice}','test-only','${team}','member'),
    ('${bob}','Bob Member','Bob','Member','${bob}@fixture.test','${bob}','test-only','${team}','member');
    insert into tasks(id,title,description,team_id,publication_type) values('${task}','Concurrent task','Answer','${team}','evergreen');
    insert into telegram_link_tokens(token,user_id,expires_at) values('${alice}','${alice}',now()+interval '1 hour'),('${bob}','${bob}',now()+interval '1 hour');`);
  return { team, root, alice, bob, task };
}

test('concurrent attempts cannot bind one Telegram to two website accounts', { skip: !port }, async () => {
  const { alice, bob } = fixture();
  const tg = String(Date.now());
  const results = await Promise.all([alice, bob].map((token) => parallel(`select tg_link_account('${token}','${tg}');`)));
  assert.equal(results.filter((result) => JSON.parse(result).userId).length, 1);
  assert.equal(query(`select count(*) from users where telegram_id = '${tg}'`), '1');
});

test('concurrent different Telegram identities cannot overwrite one account', { skip: !port }, async () => {
  const { alice } = fixture();
  const token = randomUUID(), tg = String(Date.now());
  query(`insert into telegram_link_tokens(token,user_id,expires_at) values('${token}','${alice}',now()+interval '1 hour');`);
  const results = await Promise.all([parallel(`select tg_link_account('${alice}','${tg}');`), parallel(`select tg_link_account('${token}','${BigInt(tg) + 1n}');`)]);
  assert.equal(results.filter((result) => JSON.parse(result).userId).length, 1);
});

test('parallel webhook retries and competing reviews save one answer and one decision', { skip: !port }, async () => {
  const { root, alice, task } = fixture();
  const tg = String(Date.now()), token = randomUUID(), update = Date.now();
  query(`select tg_link_account('${alice}','${tg}');
    insert into telegram_submission_sessions(token_hash,user_id,task_id,telegram_id,expires_at) values('${token}','${alice}','${task}','${tg}',now()+interval '1 hour');
    select tg_begin_submission('${token}','${tg}',1);`);
  const answers = await Promise.all(Array.from({ length: 5 }, () => parallel(`select tg_submit_answer('${tg}','${tg}',2,${update},'text','Exactly one answer',null);`)));
  const parsed = answers.map((value) => JSON.parse(value));
  assert.equal(parsed.filter((value) => value.duplicate === false).length, 1);
  assert.equal(parsed.filter((value) => value.duplicate === true).length, 4);
  assert.equal(query(`select count(*) from submissions where user_id = '${alice}' and task_id = '${task}'`), '1');
  const id = parsed[0].data.id;
  const reviews = await Promise.all(['accepted', 'revision'].map((status) => parallel(`select tg_review_submission('${id}','${root}',false,'${status}',10,'Concurrent review');`)));
  assert.equal(reviews.filter((value) => JSON.parse(value).data).length, 1);
  assert.equal(reviews.filter((value) => JSON.parse(value).validationError).length, 1);
});

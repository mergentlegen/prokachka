// Opt-in: PROKACHKA_TEST_PG_PORT must point to a disposable localhost PostgreSQL.
// This suite creates isolated fixture users; it never loads the application's .env.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const port = process.env.PROKACHKA_TEST_PG_PORT;
const psql = process.env.PROKACHKA_TEST_PSQL || 'psql';
const args = ['-X', '-h', '127.0.0.1', '-p', port || '55439', '-U', 'postgres', '-d', process.env.PROKACHKA_TEST_PG_DATABASE || 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
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

test('parallel ready publication retries are unique per audience, not across the whole team', { skip: !port }, async () => {
  const { team, root, alice, bob } = fixture();
  query(`update users set can_publish_tasks=true,parent_user_id='${root}' where id in ('${alice}','${bob}');`);
  const publish = (publisher, audience) => `select app_create_program('${JSON.stringify({
    teamId:team,publisherId:publisher,audienceRootId:audience,title:'Concurrent ready game',deadlineHours:720,templateKey:'starter-rules',
    tasks:[{title:'Rules game',description:'Read and answer the questions.',maxPoints:5,publicationType:'evergreen',interactiveKind:'starter-rules'}]
  })}'::jsonb);`;
  const same = await Promise.allSettled(Array.from({length:4},()=>parallel(publish(alice,alice))));
  assert.equal(same.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(query(`select count(*) from task_programs where team_id='${team}' and template_key='starter-rules' and audience_root_id='${alice}'`),'1');
  const others = await Promise.all([parallel(publish(bob,bob)),parallel(publish(root,null))]);
  assert.equal(others.length,2);
  assert.equal(query(`select count(*) from task_programs where team_id='${team}' and template_key='starter-rules'`),'3');
  assert.equal(query(`select count(*) from tasks where team_id='${team}' and interactive_kind='starter-rules'`),'3');
});

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

test('concurrent hierarchy moves cannot create a two-user cycle', { skip: !port }, async () => {
  const { root, alice, bob } = fixture();
  const results = await Promise.allSettled([
    parallel(`select app_update_network_user('${root}','${alice}','{"parent_user_id":"${bob}"}');`),
    parallel(`select app_update_network_user('${root}','${bob}','{"parent_user_id":"${alice}"}');`),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(query(`select count(*) from team_assignment_history where user_id in ('${alice}','${bob}')`), '1');
  assert.equal(query(`select count(*) from users a join users b on a.parent_user_id=b.id and b.parent_user_id=a.id where a.id='${alice}'`), '0');
});

test('competing approval and rejection process a request once', { skip: !port }, async () => {
  const { team, root, alice } = fixture();
  const request = randomUUID();
  query(`update users set team_id=null where id='${alice}';
    insert into team_join_requests(id,user_id,team_id) values('${request}','${alice}','${team}');`);
  const results = await Promise.all(['approved','rejected'].map((status) =>
    parallel(`select app_review_join_request('${request}','${status}','${root}',false);`)));
  assert.equal(results.filter((value) => JSON.parse(value).processed).length, 1);
  assert.equal(results.filter((value) => JSON.parse(value).validationError).length, 1);
  const state = JSON.parse(query(`select jsonb_build_object('status',r.status,'team',u.team_id) from team_join_requests r join users u on u.id=r.user_id where r.id='${request}'`));
  assert.equal(state.team, state.status === 'approved' ? team : null);
});

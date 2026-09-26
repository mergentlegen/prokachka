// Local-only UI fixture. All /api/* requests are intercepted: NEVER forwards to a database.
// Start the built Next app on 3105, then node tests/helpers/ui-fixture-server.cjs.
const http = require('node:http');
const fs = require('node:fs');
const welcomeFile = process.env.PROKACHKA_TEST_WELCOME_FILE;
let welcomeCompleted = false;
const avatarFiles = new Map();
const { READY_PROGRAMS } = require('./load-ts.cjs')('shared/domain/ready-programs.ts');
const requests = {};
const streams = new Set();
let delay = 500, points = 10;
const people = [
  { id: 'mentor', name: 'Тестовый наставник', first_name: 'Тестовый', last_name: 'наставник', profile_updated_at: '2026-09-26T10:00:00.000Z', login: 'mentor@fixture.test', role: 'admin', team_id: 'team', created_at: '2026-09-19' },
  { id: 'member', name: 'Тестовый участник', first_name: 'Тестовый', last_name: 'участник', profile_updated_at: '2026-09-26T10:00:00.000Z', login: 'member@fixture.test', role: 'member', team_id: 'team', parent_user_id: 'mentor', created_at: '2026-09-19' },
];
const task = { id: 'task', title: 'Тестовое задание', description: 'Описание для проверки обновлений интерфейса.', max_points: 10, team_id: 'team', publisher_id: 'mentor', is_active: true, is_pinned: false, publication_type: 'evergreen', created_at: '2026-09-19' };
const readyProgram = { id: 'ready', title: 'Мечта с планом', team_id: 'team', publisher_id: 'mentor', template_key: 'dream-plan', is_active: true, created_at: '2026-09-25' };
const game = { ...task, id: 'game', title: readyProgram.title, description: READY_PROGRAMS[0].tasks[0].description, max_points: 5, program_id: readyProgram.id, publisher_id: 'mentor', interactive_kind: 'dream-plan', created_at: readyProgram.created_at };
const rulesDefinition = READY_PROGRAMS.find(item => item.key === 'starter-rules');
const rulesProgram = { ...readyProgram, id: 'ready-rules', title: rulesDefinition.title, template_key: 'starter-rules' };
const rulesGame = { ...game, id: 'rules-game', title: rulesProgram.title, description: rulesDefinition.tasks[0].description, program_id: rulesProgram.id, interactive_kind: 'starter-rules' };
let rulesPublished = false;
let rulesAttempt;
const results = [];
const heartDefinition = require('./load-ts.cjs')('shared/domain/heart-survey.ts').HEART_SURVEY;
const heartProgram = { ...readyProgram, id: 'ready-heart', title: heartDefinition.title, template_key: 'heart-survey' };
const heartGame = { ...game, id: 'heart-game', title: heartDefinition.title, description: READY_PROGRAMS.find(item => item.key === 'heart-survey').tasks[0].description, program_id: heartProgram.id, interactive_kind: 'heart-survey' };
let heartPublished = false;
let heartState = { definition: heartDefinition, questionIndex: 0, answers: [], earnedPoints: 0, completed: false, delivery: { total: 2, sent: 0, waiting: 1 } };
let readyPublished = false;
const programs = [{ id: 'program', title: 'Первый шаг в команде', team_id: 'team', publisher_id: 'mentor', deadline_hours: 72, is_active: true, is_pinned: false, created_at: '2026-09-20' }];
const tasks = [task, { ...task, id: 'later-task', title: 'Следующее задание', created_at: '2026-09-22' },
  { ...task, id: 'step', title: 'Познакомиться с командой', program_id: 'program', publication_type: 'sequential', position: 1, deadline_hours: 72 }];
const announcements = [
  { id: 'news', title: 'Добро пожаловать в команду', content: 'Начните знакомство с заданиями.', author_id: 'mentor', team_id: 'team', is_active: true, is_pinned: false, created_at: '2026-09-19' },
  { id: 'later-news', title: 'Встреча с наставником', content: 'Приготовьте свои вопросы.', author_id: 'mentor', team_id: 'team', is_active: true, is_pinned: false, created_at: '2026-09-22' },
];
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3106');
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/__test/welcome.mp4' && welcomeFile) {
    const size = fs.statSync(welcomeFile).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    fs.createReadStream(welcomeFile, { start, end }).pipe(res); return;
  }
  if (url.pathname.startsWith('/__test/avatar/')) {
    const bytes = avatarFiles.get(url.pathname.split('/').at(-1));
    if (!bytes) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' }); return res.end(bytes);
  }
  if (url.pathname === '/api/profile' && req.method === 'PATCH') {
    const parts = [];
    req.on('data', chunk => parts.push(chunk));
    req.on('end', async () => {
      try {
        const person = people[new URL(req.headers.referer || 'http://localhost').pathname.startsWith('/admin') ? 0 : 1];
        const form = await new Response(Buffer.concat(parts), { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
        if (form.get('expectedVersion') !== person.profile_updated_at) return json({ message: 'Профиль уже изменён в другом окне.' }, 409);
        person.first_name = form.get('firstName'); person.last_name = form.get('lastName');
        person.name = person.first_name + ' ' + person.last_name;
        person.profile_updated_at = new Date().toISOString();
        if (form.get('avatarAction') === 'replace') {
          const file = form.get('avatar');
          avatarFiles.set(person.id, Buffer.from(await file.arrayBuffer()));
          person.avatar_url = '/__test/avatar/' + person.id + '?v=' + Date.now();
        }
        if (form.get('avatarAction') === 'remove') { avatarFiles.delete(person.id); person.avatar_url = undefined; }
        return json({ ok: true, user: { id: person.id, name: person.name, firstName: person.first_name, lastName: person.last_name, avatarUrl: person.avatar_url, profileVersion: person.profile_updated_at, login: person.login, role: person.role, teamId: 'team' } });
      } catch { json({ message: 'Invalid profile fixture' }, 400); }
    });
    return;
  }
  if (url.pathname === '/__test/stats') return json(requests);
  if (url.pathname === '/__test/change' && req.method === 'POST') {
    points += 5;
    for (const stream of streams) stream.write('event: change\ndata: ["submissions"]\n\n');
    return json({ points });
  }
  if (url.pathname === '/__test/delay' && req.method === 'POST') { delay = Number(url.searchParams.get('ms')) || 0; return json({ delay }); }
  if (url.pathname.startsWith('/api/')) {
    requests[req.url] = (requests[req.url] || 0) + 1;
    if (url.pathname === '/api/welcome-video/complete' && req.method === 'POST') { welcomeCompleted = true; return json({ ok: true, completed: true }); }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write('event: ready\ndata: {}\n\n'); streams.add(res);
      const timer = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
      req.on('close', () => { streams.delete(res); clearInterval(timer); });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ready-programs') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const { key } = JSON.parse(body);
        if (key === 'heart-survey') { const alreadyPublished = heartPublished; heartPublished = true; heartProgram.is_active = true; return json({ ok: true, program: heartProgram, tasks: [heartGame], alreadyPublished }); }
        const rules = key === 'starter-rules';
        const alreadyPublished = rules ? rulesPublished : readyPublished;
        const program = rules ? rulesProgram : readyProgram;
        if (rules) rulesPublished = true; else readyPublished = true;
        program.is_active = true;
        json({ ok: true, program, tasks: [rules ? rulesGame : game], alreadyPublished }, alreadyPublished ? 200 : 201);
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ready-programs/rules-game/attempt') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (!rulesPublished || !rulesProgram.is_active) return json({ message: 'Game unavailable' }, 409);
        const input = JSON.parse(body);
        if (!rulesAttempt) rulesAttempt = { attemptId: 'rules-attempt', step: 0, status: 'active', attemptNumber: 1, earnedPoints: 0, maxPoints: 5, questionIndex: 0, completed: false };
        if (input.action === 'advance') rulesAttempt.step = 1;
        if (input.action === 'answer') {
          if (rulesAttempt.failed || rulesAttempt.step !== 1 || input.questionIndex !== rulesAttempt.questionIndex) return json({ message: 'Invalid question state' }, 409);
          rulesAttempt.lastAnswer = input.answer;
          rulesAttempt.failed = [1,1,0,1,2][rulesAttempt.questionIndex] !== input.answer;
          if (!rulesAttempt.failed) { rulesAttempt.questionIndex += 1; rulesAttempt.earnedPoints += 1; rulesAttempt.ready = rulesAttempt.questionIndex === 5; }
        }
        if (input.action === 'restart-quiz') Object.assign(rulesAttempt, { questionIndex: 0, earnedPoints: 0, lastAnswer: null, failed: false, ready: false, attemptNumber: rulesAttempt.attemptNumber + 1 });
        if (input.action === 'complete') {
          if (!rulesAttempt.ready) return json({ message: 'Quiz incomplete' }, 409);
          if (!rulesAttempt.completed) {
            rulesAttempt.completed = true; rulesAttempt.status = 'completed'; points += 5;
            rulesAttempt.submission = { id: 'rules-result', user_id: 'member', task_id: rulesGame.id, status: 'accepted', points: 5, submission_source: 'interactive', created_at: new Date().toISOString() };
            results.push(rulesAttempt.submission);
          }
        }
        json({ ok: true, attempt: rulesAttempt });
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ready-programs/heart-game/survey') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const input = JSON.parse(body);
        if (input.action === 'answer') {
          if (input.questionIndex !== heartState.questionIndex || heartState.completed) return json({ message: 'Stale question' }, 409);
          points += 1;
          heartState = { ...heartState, questionIndex: heartState.questionIndex + 1, earnedPoints: heartState.earnedPoints + 1, answers: [...heartState.answers, input.answer], completed: heartState.questionIndex === 4 };
          heartState.submission = { id: 'heart-result', user_id: 'member', task_id: heartGame.id, status: 'accepted', points: heartState.earnedPoints, submission_source: 'interactive', interactive_completed: heartState.completed, submitted_at: new Date().toISOString() };
          const previous = results.findIndex(item => item.id === 'heart-result');
          if (previous < 0) results.push(heartState.submission); else results[previous] = heartState.submission;
        }
        json({ ok: true, survey: heartState });
      });
      return;
    }
    if (req.method === 'PATCH' && /^\/api\/(programs|tasks|announcements)\/[^/]+$/.test(url.pathname)) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const [, , kind, id] = url.pathname.split('/');
          const records = kind === 'programs' ? [readyProgram, rulesProgram, heartProgram, ...programs] : kind === 'tasks' ? tasks : announcements;
          const record = records.find((item) => item.id === id);
          if (!record) return json({ message: 'Fixture not found' }, 404);
          const patch = JSON.parse(body);
          if ('isActive' in patch) record.is_active = patch.isActive;
          if ('isPinned' in patch) {
            if (patch.isPinned && !record.is_pinned) record.pinned_at = new Date().toISOString();
            if (!patch.isPinned) record.pinned_at = null;
            record.is_pinned = patch.isPinned;
          }
          json({ ok: true, [kind === 'announcements' ? 'announcement' : kind === 'programs' ? 'program' : 'task']: record });
        }
        catch { json({ message: 'Invalid fixture request' }, 400); }
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/programs') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const input = JSON.parse(body);
          const program = { ...programs[0], id: 'program-' + programs.length, title: input.title, deadline_hours: input.deadlineHours, is_pinned: false, created_at: new Date().toISOString() };
          const steps = input.tasks.map((step, index) => ({ ...task, id: program.id + '-step-' + index, title: step.title, description: step.description, max_points: step.maxPoints, resource_url: step.resourceUrl, program_id: program.id, publication_type: 'sequential', position: index + 1, deadline_hours: input.deadlineHours }));
          programs.push(program); tasks.push(...steps);
          json({ ok: true, program, tasks: steps }, 201);
        } catch { json({ message: 'Invalid fixture request' }, 400); }
      });
      return;
    }
    if (req.method !== 'GET') return json({ message: 'Unmocked mutation; not forwarded' }, 405);
    if (url.pathname === '/api/auth/session') {
      const admin = new URL(req.headers.referer || 'http://localhost').pathname.startsWith('/admin');
      const person = people[admin ? 0 : 1];
      return json({ ok: true, user: { id: person.id, name: person.name, firstName: person.first_name, lastName: person.last_name, profileVersion: person.profile_updated_at, avatarUrl: person.avatar_url, login: person.login, role: person.role, teamId: 'team' } });
    }
    const fixtures = {
      '/api/users': { users: people }, '/api/network': { users: people }, '/api/tasks': { tasks: [...tasks, ...(readyPublished && (!url.searchParams.has('view') || readyProgram.is_active) ? [game] : []), ...(rulesPublished && (!url.searchParams.has('view') || rulesProgram.is_active) ? [rulesGame] : []), ...(heartPublished && (!url.searchParams.has('view') || heartProgram.is_active) ? [heartGame] : [])].map((item) => {
        if (!url.searchParams.has('view') || !item.program_id) return item;
        const program = [readyProgram, rulesProgram, heartProgram, ...programs].find((entry) => entry.id === item.program_id);
        return { ...item, is_pinned: Boolean(program?.is_pinned), pinned_at: program?.pinned_at || null, program_title: program?.title };
      }) },
      '/api/submissions': url.searchParams.has('summary') ? { counts: { pending: 0, accepted: 1, requests: 0 } } : { submissions: results },
      '/api/ranking': { ranking: [{ id: 'member', name: people[1].name, avatarUrl: people[1].avatar_url, points }], starRanking: [{ id: 'member', name: people[1].name, avatarUrl: people[1].avatar_url, points: 3 }] },
      '/api/programs': { programs: [...programs, ...(readyPublished ? [readyProgram] : []), ...(rulesPublished ? [rulesProgram] : []), ...(heartPublished ? [heartProgram] : [])] }, '/api/programs/history': { programs: [] }, '/api/publication-history': { history: [] },
      '/api/ready-programs': { readyPrograms: READY_PROGRAMS.map(({ tasks: _tasks, ...item }) => {
        if (item.key === 'heart-survey') return { ...item, published: heartPublished, publishedProgramId: heartPublished ? heartProgram.id : undefined, publishedActive: heartPublished && heartProgram.is_active, publishedPinned: heartProgram.is_pinned, publishedPinnedAt: heartProgram.pinned_at, publishedCreatedAt: heartProgram.created_at, canManage: heartPublished };
        const rules = item.key === 'starter-rules';
        const published = rules ? rulesPublished : readyPublished;
        const program = rules ? rulesProgram : readyProgram;
        return { ...item, published, publishedProgramId: published ? program.id : undefined, publishedActive: published && program.is_active, publishedPinned: program.is_pinned, publishedPinnedAt: program.pinned_at, publishedCreatedAt: program.created_at, canManage: published };
      }) },
      '/api/stars': { awards: [] }, '/api/team-requests': { requests: [] }, '/api/announcements': { announcements },
      '/api/welcome-video': welcomeFile && !welcomeCompleted ? { required: true, video: { id: 'fixture-asset', fileName: 'fixture.mp4', sizeBytes: fs.statSync(welcomeFile).size, durationSeconds: 5, width: 960, height: 540, url: '/__test/welcome.mp4' } } : { required: false }, '/api/telegram/link/status': { linked: false },
    };
    const fixture = fixtures[url.pathname];
    if (!fixture) return json({ message: 'Unmocked API; not forwarded' }, 404);
    setTimeout(() => json({ ok: true, ...fixture }), delay);
    return;
  }
  // Only static/page requests go to the local app. Host matches its production guard.
  const upstream = http.request({ hostname: '127.0.0.1', port: 3105, path: req.url, method: 'GET', headers: { host: 'prokachka.kz' } }, (response) => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => json({ error: 'Start Next on 127.0.0.1:3105 first' }, 502));
  upstream.end();
}).listen(3106, '127.0.0.1', () => console.log('Isolated UI fixtures: http://127.0.0.1:3106/admin'));

// Local-only UI fixture. All /api/* requests are intercepted: NEVER forwards to a database.
// Start the built Next app on 3105, then node tests/helpers/ui-fixture-server.cjs.
const http = require('node:http');
const { READY_PROGRAMS } = require('./load-ts.cjs')('shared/domain/ready-programs.ts');
const requests = {};
const streams = new Set();
let delay = 500, points = 10;
const people = [
  { id: 'mentor', name: 'Тестовый наставник', role: 'admin', team_id: 'team', created_at: '2026-09-19' },
  { id: 'member', name: 'Тестовый участник', role: 'member', team_id: 'team', parent_user_id: 'mentor', created_at: '2026-09-19' },
];
const task = { id: 'task', title: 'Тестовое задание', description: 'Описание для проверки обновлений интерфейса.', max_points: 10, team_id: 'team', is_active: true, publication_type: 'evergreen', created_at: '2026-09-19' };
const readyProgram = { id: 'ready', title: 'Мечта с планом', team_id: 'team', publisher_id: 'mentor', template_key: 'dream-plan', is_active: true, created_at: '2026-09-25' };
const game = { ...task, id: 'game', title: readyProgram.title, description: READY_PROGRAMS[0].tasks[0].description, max_points: 5, program_id: readyProgram.id, publisher_id: 'mentor', interactive_kind: 'dream-plan' };
let readyPublished = false;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3106');
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/__test/stats') return json(requests);
  if (url.pathname === '/__test/change' && req.method === 'POST') {
    points += 5;
    for (const stream of streams) stream.write('event: change\ndata: ["submissions"]\n\n');
    return json({ points });
  }
  if (url.pathname === '/__test/delay' && req.method === 'POST') { delay = Number(url.searchParams.get('ms')) || 0; return json({ delay }); }
  if (url.pathname.startsWith('/api/')) {
    requests[req.url] = (requests[req.url] || 0) + 1;
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write('event: ready\ndata: {}\n\n'); streams.add(res);
      const timer = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
      req.on('close', () => { streams.delete(res); clearInterval(timer); });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ready-programs') {
      const alreadyPublished = readyPublished; readyPublished = true; readyProgram.is_active = true;
      return json({ ok: true, program: readyProgram, tasks: [game], alreadyPublished }, alreadyPublished ? 200 : 201);
    }
    if (req.method === 'PATCH' && url.pathname === '/api/programs/ready') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try { readyProgram.is_active = Boolean(JSON.parse(body).isActive); json({ ok: true, program: readyProgram }); }
        catch { json({ message: 'Invalid fixture request' }, 400); }
      });
      return;
    }
    if (req.method !== 'GET') return json({ message: 'Unmocked mutation; not forwarded' }, 405);
    if (url.pathname === '/api/auth/session') {
      const admin = new URL(req.headers.referer || 'http://localhost').pathname.startsWith('/admin');
      return json({ ok: true, user: { id: admin ? 'mentor' : 'member', name: admin ? 'Тестовый наставник' : 'Тестовый участник', role: admin ? 'admin' : 'member', teamId: 'team' } });
    }
    const fixtures = {
      '/api/users': { users: people }, '/api/network': { users: people }, '/api/tasks': { tasks: [task, ...(readyPublished && (!url.searchParams.has('view') || readyProgram.is_active) ? [game] : [])] },
      '/api/submissions': url.searchParams.has('summary') ? { counts: { pending: 0, accepted: 1, requests: 0 } } : { submissions: [] },
      '/api/ranking': { ranking: [{ id: 'member', name: people[1].name, points }], starRanking: [{ id: 'member', name: people[1].name, points: 3 }] },
      '/api/programs': { programs: readyPublished ? [readyProgram] : [] }, '/api/programs/history': { programs: [] }, '/api/publication-history': { history: [] },
      '/api/ready-programs': { readyPrograms: READY_PROGRAMS.map(({ tasks: _tasks, ...item }) => ({ ...item, published: readyPublished, publishedProgramId: readyPublished ? readyProgram.id : undefined, publishedActive: readyPublished && readyProgram.is_active, canManage: readyPublished })) },
      '/api/stars': { awards: [] }, '/api/team-requests': { requests: [] }, '/api/announcements': { announcements: [] },
      '/api/welcome-video': { required: false }, '/api/telegram/link/status': { linked: false },
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

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./helpers/load-ts.cjs');
const { processOne, ffmpegArgs } = require('../scripts/process-task-videos.cjs');
const { cleanupTaskVideos } = require('../scripts/cleanup-task-videos.cjs');

const team = '11111111-1111-4111-8111-111111111111';
const task = '22222222-2222-4222-8222-222222222222';
const source = `${team}/${task}/33333333-3333-4333-8333-333333333333.mov`;
const env = { SUPABASE_SERVICE_ROLE_KEY: 'service-key', NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' };

// A fake Supabase: records every call and answers RPCs from a table.
function supabase(answers) {
  const calls = [];
  const request = async (url, init = {}) => {
    const target = new URL(url);
    calls.push({ path: target.pathname, method: init.method || 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    if (target.pathname.startsWith('/rest/v1/rpc/')) {
      const name = target.pathname.split('/').pop();
      return new Response(JSON.stringify(answers[name] ?? null), { status: 200 });
    }
    if (init.method === 'POST') { for await (const _ of init.body) { /* drain the upload stream */ } return new Response('{}', { status: 200 }); }
    if (target.pathname.startsWith('/storage/')) return new Response('video-bytes', { status: 200 });
    return new Response('', { status: 404 });
  };
  return { calls, request };
}

const tools = (originalDuration = 240) => ({
  probe: async (file) => file.endsWith('video.mp4') ? { video: { width: 1280, height: 720 }, duration: 239.5 } : { video: { width: 1920, height: 1080 }, duration: originalDuration },
  transcode: async (_input, output) => fs.writeFileSync(output, 'compressed'),
});

test('compression keeps landscape and portrait shapes, one thread, fast start', () => {
  const args = ffmpegArgs('in.mov', 'out.mp4');
  assert.deepEqual(args.slice(args.indexOf('-threads'), args.indexOf('-threads') + 2), ['-threads', '1']);
  assert.ok(args.includes('+faststart'), 'video starts playing before it fully downloads');
  assert.match(args[args.indexOf('-vf') + 1], /if\(gt\(iw,ih\),min\(1280,iw\),-2\)/);
  assert.equal(args.at(-1), 'out.mp4');
});

test('a claimed video is downloaded, compressed, uploaded next to the original and finished', async () => {
  const fake = supabase({ app_task_video_claim: [{ task_id: task, team_id: team, source_path: source, lease_token: 'lease', attempts: 1 }], app_task_video_finish: true });
  const result = await processOne({ env, request: fake.request, workRoot: os.tmpdir(), tools: tools() });
  assert.equal(result.processed, 1);
  assert.ok(fake.calls.some((call) => call.method === 'GET' && call.path === `/storage/v1/object/task-videos/${source}`));
  const upload = fake.calls.find((call) => call.method === 'POST' && call.path.startsWith('/storage/v1/object/task-videos/'));
  assert.match(upload.path, new RegExp(`^/storage/v1/object/task-videos/${team}/${task}/[0-9a-f-]{36}\\.mp4$`));
  const finish = fake.calls.find((call) => call.path.endsWith('/app_task_video_finish'));
  assert.equal(finish.body.p_source, source);
  assert.equal(finish.body.p_lease, 'lease');
  assert.deepEqual([finish.body.p_width, finish.body.p_height, finish.body.p_duration], [1280, 720, 239.5]);
  assert.ok(!fs.readdirSync(os.tmpdir()).some((name) => name.startsWith('prokachka-video-') && fs.existsSync(path.join(os.tmpdir(), name, 'source.mov'))), 'temporary files left behind');
});

test('a file that is not a video, or is too long, fails at once with a clear reason', async () => {
  for (const [probe, reason] of [[async () => ({ video: null, duration: 0 }), /не похож на видео/], [tools(30 * 60).probe, /длиннее 20 минут/]]) {
    const fake = supabase({ app_task_video_claim: [{ task_id: task, team_id: team, source_path: source, lease_token: 'lease', attempts: 1 }] });
    const result = await processOne({ env, request: fake.request, tools: { ...tools(), probe } });
    assert.equal(result.rejected, 1);
    const fail = fake.calls.find((call) => call.path.endsWith('/app_task_video_fail'));
    assert.equal(fail.body.p_final, true);
    assert.match(fail.body.p_error, reason);
  }
});

test('a temporary problem is reported for a retry and does not lose the original', async () => {
  const fake = supabase({ app_task_video_claim: [{ task_id: task, team_id: team, source_path: source, lease_token: 'lease', attempts: 1 }] });
  await assert.rejects(processOne({ env, request: fake.request, tools: { ...tools(), transcode: async () => { throw new Error('ffmpeg crashed'); } } }), /ffmpeg crashed/);
  const fail = fake.calls.find((call) => call.path.endsWith('/app_task_video_fail'));
  assert.equal(fail.body.p_final, false);
  assert.ok(!fake.calls.some((call) => call.method === 'DELETE'), 'nothing deleted');
});

test('an empty queue does nothing, and paths outside the bucket layout are refused', async () => {
  assert.deepEqual(await processOne({ env, request: supabase({ app_task_video_claim: [] }).request, tools: tools() }), { processed: 0 });
  const evil = supabase({ app_task_video_claim: [{ task_id: task, team_id: team, source_path: '../other-bucket/x.mp4', lease_token: 'l', attempts: 1 }] });
  await assert.rejects(processOne({ env, request: evil.request, tools: tools() }), /Invalid task video path/);
  const cleanup = supabase({ app_claim_task_video_cleanup: [{ storage_path: '../welcome-videos/a.mp4', lease_token: 'l' }] });
  await assert.rejects(cleanupTaskVideos({ env, request: cleanup.request }), /Invalid task video cleanup path/);
});

test('video endpoints: participants read and report progress, only managers upload', async () => {
  let actor = null;
  const calls = [];
  const service = {
    getTaskVideo: async () => ({ data: { status: 'ready', playable: true, url: 'https://cdn/x', watchedSeconds: 0, completed: false } }),
    recordTaskVideoProgress: async (_user, _task, position) => { calls.push(['progress', position]); return { data: { watchedSeconds: position, completed: false } }; },
    beginTaskVideoUpload: async () => ({ forbidden: true }),
    finishTaskVideoUpload: async () => ({ data: true }), removeTaskVideo: async () => ({ forbidden: true }),
  };
  const controller = loadTs('backend/controllers/task-videos.controller.ts', {
    '@/backend/http/current-user': { getCurrentUser: async () => actor },
    '@/backend/services/task-videos.service': service,
    '@/backend/services/audit-log.service': { auditRecord: async () => null, recordAudit: async () => undefined },
  });
  const req = (method, body) => new Request('http://localhost/api/tasks/' + task + '/video', { method, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await controller.readTaskVideo(req('GET'), task)).status, 401);
  actor = { id: 'm', role: 'member', teamId: team };
  assert.equal((await controller.readTaskVideo(req('GET'), 'bad')).status, 400);
  assert.equal((await (await controller.readTaskVideo(req('GET'), task)).json()).video.url, 'https://cdn/x');
  assert.equal((await controller.saveTaskVideoProgress(req('POST', { position: -5 }), task)).status, 400);
  assert.equal((await controller.saveTaskVideoProgress(req('POST', { position: 42 }), task)).status, 200);
  assert.deepEqual(calls, [['progress', 42]]);
  assert.equal((await controller.startTaskVideoUpload(req('POST', { fileName: 'a.mp4', sizeBytes: 5000, contentType: 'video/mp4' }), task)).status, 403);
  assert.equal((await controller.deleteTaskVideo(req('DELETE'), task)).status, 403);
});

test('phone videos with an empty MIME type are recognised by their extension', () => {
  const { taskVideoContentType } = loadTs('shared/domain/task-video.ts');
  assert.equal(taskVideoContentType('IMG_0001.MOV', ''), 'video/quicktime');
  assert.equal(taskVideoContentType('clip.m4v', ''), 'video/mp4');
  assert.equal(taskVideoContentType('clip.webm', 'video/webm'), 'video/webm');
  assert.equal(taskVideoContentType('notes.pdf', 'application/pdf'), '');
});

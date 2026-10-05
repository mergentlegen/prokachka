// Compresses one uploaded task video per run. Node 22+, no npm dependencies; needs ffmpeg and ffprobe.
// Run every minute from cron under flock:
//   node --env-file=/etc/prokachka/prokachka.env scripts/process-task-videos.cjs
// Works at the lowest CPU priority on one thread so the site stays fast. Never logs URLs or keys.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const BUCKET = 'task-videos';
const MAX_SECONDS = 20 * 60;
const SOURCE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov|webm)$/i;

// Landscape becomes at most 1280 wide, portrait at most 1280 tall; small videos are never enlarged.
const SCALE = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'";
function ffmpegArgs(input, output) {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', SCALE, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-threads', '1', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', output];
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { if (stdout.length < 1_000_000) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 20_000) stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr.slice(-300)}`)); });
  });
}

async function probe(file) {
  const raw = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], 60_000);
  const info = JSON.parse(raw);
  const video = (info.streams || []).find((stream) => stream.codec_type === 'video');
  const duration = Number(info.format?.duration || video?.duration || 0);
  return { video, duration };
}

class FinalError extends Error {}

// `tools` lets tests replace ffprobe/ffmpeg; production uses the real binaries.
const realTools = {
  probe,
  transcode: (input, output, duration) => run('nice', ['-n', '19', 'ffmpeg', ...ffmpegArgs(input, output)], Math.max(10 * 60_000, duration * 6_000)),
};

async function processOne({ env = process.env, request = fetch, workRoot = os.tmpdir(), tools = realTools } = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const base = new URL(env.NEXT_PUBLIC_SUPABASE_URL || 'https://missing.invalid');
  if (!key || base.protocol !== 'https:' || base.hostname.endsWith('.invalid')) throw new Error('Configure HTTPS Supabase URL and service-role key');
  const auth = { ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), apikey: key };
  async function rpc(name, body) {
    const response = await request(new URL(`/rest/v1/rpc/${name}`, base), {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Video database operation ${name} failed: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  const [job] = await rpc('app_task_video_claim', {}) || [];
  if (!job) return { processed: 0 };
  if (!SOURCE_PATH.test(job.source_path)) throw new Error('Invalid task video path');
  const dir = fs.mkdtempSync(path.join(workRoot, 'prokachka-video-'));
  const source = path.join(dir, 'source' + path.extname(job.source_path));
  const output = path.join(dir, 'video.mp4');
  try {
    const download = await request(new URL(`/storage/v1/object/${BUCKET}/${job.source_path}`, base), { headers: auth, redirect: 'error', signal: AbortSignal.timeout(20 * 60_000) });
    if (!download.ok || !download.body) throw new Error(`Download failed: HTTP ${download.status}`);
    await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(source));

    const original = await tools.probe(source).catch(() => ({ video: null, duration: 0 }));
    if (!original.video || !(original.duration > 0)) throw new FinalError('Файл не похож на видео. Загрузите MP4, MOV или WebM.');
    if (original.duration > MAX_SECONDS + 5) throw new FinalError('Видео длиннее 20 минут. Сократите его и загрузите снова.');

    await tools.transcode(source, output, original.duration);
    const result = await tools.probe(output);
    if (!result.video || !(result.duration > 0)) throw new Error('Compressed file has no video');

    const target = `${job.team_id}/${job.task_id}/${crypto.randomUUID()}.mp4`;
    const size = fs.statSync(output).size;
    const upload = await request(new URL(`/storage/v1/object/${BUCKET}/${target}`, base), {
      method: 'POST', headers: { ...auth, 'Content-Type': 'video/mp4', 'Cache-Control': 'max-age=3600', 'x-upsert': 'false', 'Content-Length': String(size) },
      body: Readable.toWeb(fs.createReadStream(output)), duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(20 * 60_000),
    });
    if (!upload.ok) throw new Error(`Upload failed: HTTP ${upload.status}`);
    const applied = await rpc('app_task_video_finish', {
      p_task: job.task_id, p_lease: job.lease_token, p_source: job.source_path, p_video: target, p_size: size,
      p_duration: Math.round(result.duration * 100) / 100, p_width: Number(result.video.width), p_height: Number(result.video.height),
    });
    return { processed: 1, replaced: applied === false };
  } catch (error) {
    const final = error instanceof FinalError;
    await rpc('app_task_video_fail', { p_task: job.task_id, p_lease: job.lease_token, p_error: final ? error.message : 'Не удалось обработать видео, пробуем ещё раз.', p_final: final })
      .catch(() => undefined);
    if (!final) throw error;
    return { processed: 0, rejected: 1 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { processOne, ffmpegArgs, SCALE };
if (require.main === module) processOne().then((result) => {
  if (result.processed || result.rejected) console.log(`Task video: ${result.processed ? 'compressed' : 'rejected'}`);
}).catch((error) => { console.error(error.message); process.exitCode = 1; });

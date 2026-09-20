'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { createHash } = require('node:crypto');
const { inspectMedia, preparationArgs } = require('./core.cjs');

function runProcess(executable, args, { signal, onOutput } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Operation cancelled.'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let killTimer;
    const abort = () => {
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      if (onOutput) onOutput(chunk.toString());
      else stdout = (stdout + chunk).slice(-8 * 1024 * 1024);
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    const cleanup = () => { clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); reject(new Error(`${executable}: ${error.message}. Check the reference runner executable path.`)); });
    child.on('close', code => {
      cleanup();
      if (signal?.aborted) reject(new Error('Operation cancelled.'));
      else if (code !== 0) reject(new Error(`${executable} exited ${code}: ${stderr}`));
      else resolve(stdout);
    });
  });
}

const probeCache = new Map();
async function probeFile(input, settings, signal) {
  if (signal?.aborted) throw new Error('Operation cancelled.');
  const stat = await fs.stat(input);
  const key = JSON.stringify([input, stat.size, stat.mtimeMs, stat.ctimeMs, settings.ffprobePath]);
  if (signal?.aborted) throw new Error('Operation cancelled.');
  if (probeCache.has(key)) return probeCache.get(key);
  const probe = JSON.parse(await runProcess(settings.ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input], { signal }));
  const video = probe.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (video) {
    const decoded = JSON.parse(await runProcess(settings.ffprobePath, ['-v', 'error', '-select_streams', String(video.index),
      '-read_intervals', '%+#64', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', input], { signal }));
    const first = decoded.frames?.find(f => Number.isFinite(Number(f.best_effort_timestamp_time)));
    if (!first) throw new Error('Cannot locate the first decodable video frame.');
    video.decoded_start_time = first.best_effort_timestamp_time;
  }
  if (signal?.aborted) throw new Error('Operation cancelled.');
  probeCache.set(key, probe);
  if (probeCache.size > 32) probeCache.delete(probeCache.keys().next().value);
  return probe;
}

async function prepareMedia(input, cacheRoot, settings, order, audioIndex, signal, progress = () => {}, inspected) {
  if (signal?.aborted) throw new Error('Operation cancelled.');
  const probe = inspected || await probeFile(input, settings, signal);
  const info = inspectMedia(probe, audioIndex);
  const stat = await fs.stat(input);
  const key = createHash('sha256').update(JSON.stringify([8, input, stat.size, stat.mtimeMs, order, info.audioIndex])).digest('hex');
  const directory = path.join(cacheRoot, key);
  const pcm = path.join(directory, 'audio.f32');
  const foa = path.join(directory, 'foa.wav');
  const proxyName = info.hasVideo ? 'playback.mp4' : 'playback.mp3';
  const proxy = path.join(directory, proxyName);
  try {
    const meta = JSON.parse(await fs.readFile(path.join(directory, 'ready.json'), 'utf8'));
    const [p, v] = await Promise.all([fs.stat(pcm), fs.stat(proxy)]);
    const f = await fs.stat(foa);
    if (p.size === meta.pcmSize && v.size === meta.proxySize && f.size === meta.foaSize && p.size > 0 && v.size > 0) {
      progress('Using prepared media cache');
      return { ...info, pcm, proxy, foa, directory };
    }
  } catch { /* An incomplete cache entry is not reusable. */ }
  await fs.mkdir(cacheRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(cacheRoot, 'preparing-'));
  try {
    progress(info.hasVideo ? 'Preparing aspect-preserving video and stereo monitor' : 'Preparing FOA audio and stereo monitor');
    await runProcess(settings.ffmpegPath, preparationArgs(input, path.join(staging, 'audio.f32'), path.join(staging, proxyName), info, order), {
      signal, onOutput: chunk => {
        const match = chunk.match(/out_time_us=(\d+)/);
        if (match) progress(`Preparing media ${Math.min(100, Math.round(Number(match[1]) / 1e6 / info.duration * 100))}%`);
      },
    });
    const p = await fs.stat(path.join(staging, 'audio.f32'));
    const v = await fs.stat(path.join(staging, proxyName));
    if (p.size < 16 || p.size % 16 || !v.size) throw new Error('Decoded media is empty or not four-channel float PCM.');
    const f = await fs.stat(path.join(staging, 'foa.wav'));
    if (f.size <= p.size) throw new Error('FOA playback WAV is incomplete.');
    await fs.writeFile(path.join(staging, 'ready.json'), JSON.stringify({ pcmSize: p.size, proxySize: v.size, foaSize: f.size }));
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rename(staging, directory);
    return { ...info, pcm, proxy, foa, directory };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

class AnalyzerClient {
  constructor(python, script, media, order, log = () => {}) {
    this.child = spawn(python, ['-u', script, media.pcm, String(media.sampleRate), order], {
      windowsHide: true, env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.closed = false;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.ready.catch(() => {});
    this.readyTimer = setTimeout(() => this.fail(new Error('PowerMap Python startup timed out.')), 30000);
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.child.stderr.on('data', data => log(data.toString()));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('close', code => this.fail(new Error(`PowerMap process exited (${code}). Check Python dependencies.`)));
    this.lines.on('line', line => {
      try {
        const result = JSON.parse(line);
        if (result.type === 'ready') { clearTimeout(this.readyTimer); this.readyResolve(); return; }
        if (!this.pending || result.id !== this.pending.id) throw new Error('Invalid PowerMap response ID.');
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
        if (result.type === 'error') pending.reject(new Error(result.message));
        else if (result.type !== 'map' || typeof result.rgba !== 'string' || Buffer.from(result.rgba, 'base64').length !== 140 * 70 * 4) pending.reject(new Error('Invalid PowerMap frame.'));
        else pending.resolve(result);
      } catch (error) { this.fail(error); }
    });
  }
  async analyze(request) {
    await this.ready;
    if (this.closed) throw new Error('PowerMap process closed.');
    if (this.pending) throw new Error('Only one analysis may be in flight.');
    return new Promise((resolve, reject) => {
      this.pending = { id: request.id, resolve, reject, timer: setTimeout(() => this.fail(new Error('PowerMap analysis timed out.')), 5000) };
      this.child.stdin.write(JSON.stringify(request) + '\n');
    });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.readyTimer);
    this.readyReject(error);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    this.lines.close(); this.child.kill();
  }
  dispose() { this.fail(new Error('PowerMap session closed.')); }
}

module.exports = { runProcess, probeFile, prepareMedia, AnalyzerClient };

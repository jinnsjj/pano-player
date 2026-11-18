'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const maxChunk = 262144;
const checkSignal = signal => { if (signal?.aborted) throw new Error('Native video stream cancelled.'); };

function runVideoProcess(executable, args, { signal, timeoutMs = 5000 } = {}) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', killTimer, timedOut = false, settled = false, stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', stop, { once: true });
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', stop);
      if (error) reject(error); else resolve();
    };
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
    child.once('error', error => finish(new Error(`Cannot run FFmpeg: ${error.message}`)));
    child.once('close', code => finish(signal?.aborted ? new Error('Native video stream cancelled.') : timedOut ?
      new Error('FFmpeg discovery timed out.') : code ? new Error(`FFmpeg exited ${code}: ${stderr}`) : null));
    if (signal?.aborted) stop();
  });
}

async function findFfmpeg({ env, platform, run, signal }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const directories = (env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(entry => p.isAbsolute(entry));
  if (platform !== 'win32') directories.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
  const deadline = Date.now() + 15000;
  for (const executable of new Set(directories.map(directory => p.join(directory, 'ffmpeg')))) {
    checkSignal(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try { await run(executable, ['-version'], { signal, timeoutMs: Math.min(3000, remaining) }); return executable; }
    catch { checkSignal(signal); }
  }
  throw new Error('FFmpeg is unavailable. Install FFmpeg with VideoToolbox support for native HEVC playback.');
}

function videoStreamArgs(input, { time, width, height }) {
  const resize = width > 4096 || height > 4096 || width % 2 || height % 2;
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-copyts', '-noautorotate'];
  if (time > 0) args.push('-seek_timestamp', '1', '-ss', time.toFixed(6), '-noaccurate_seek');
  args.push('-hwaccel', 'videotoolbox');
  if (!resize) args.push('-hwaccel_output_format', 'videotoolbox_vld');
  args.push('-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1');
  const filters = [];
  // FFmpeg's automatic seek trimming adds input start_time even with seek_timestamp=1.
  if (time > 0) filters.push('trim=start=' + time.toFixed(6));
  if (resize) filters.push("scale=w='min(4096,iw)':h='min(4096,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2");
  if (filters.length) args.push('-vf', filters.join(','));
  if (resize) args.push('-pix_fmt', 'yuv420p');
  args.push('-c:v', 'h264_videotoolbox', '-profile:v', 'high', '-b:v', '32M', '-bf', '0', '-g', '30', '-realtime', '1',
    '-fps_mode', 'passthrough', '-avoid_negative_ts', 'disabled', '-use_editlist', '1',
    '-movflags', '+empty_moov+delay_moov+default_base_moof+frag_every_frame+skip_trailer', '-flush_packets', '1',
    '-video_track_timescale', '90000', '-f', 'mp4', 'pipe:1');
  return args;
}

async function openVideoStream(input, { time = 0, width, height, signal, env = process.env,
  platform = process.platform, spawn: launch = spawn, run = runVideoProcess } = {}) {
  checkSignal(signal);
  if (!path.isAbsolute(input)) throw new Error('Native video requires an absolute host path.');
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65536) ||
      !Number.isFinite(time) || time < 0 || time > 1e9) throw new Error('Invalid native video dimensions or seek time.');
  if (platform !== 'darwin') throw new Error('Native VideoToolbox playback is only available on macOS.');
  const source = await fs.realpath(input);
  if (!(await fs.stat(source)).isFile()) throw new Error('Native video requires a regular file.');
  const executable = await findFfmpeg({ env, platform, run, signal });
  checkSignal(signal);
  const child = launch(executable, videoStreamArgs(source, { time, width, height }), {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let disposed = false, finished = false, stopping = false, failure, stderr = '', pending, killTimer;
  const stop = () => {
    if (finished || stopping) return;
    stopping = true;
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
    killTimer.unref();
  };
  const settle = (error, value) => {
    const request = pending;
    if (!request) return;
    pending = undefined; clearTimeout(request.timer);
    if (error) request.reject(error); else request.resolve(value);
  };
  const pump = () => {
    if (!pending) return;
    if (disposed) { settle(new Error('Native video stream closed.')); return; }
    if (failure) { settle(failure); return; }
    const count = Math.min(maxChunk, child.stdout.readableLength);
    if (count) {
      const bytes = child.stdout.read(count);
      if (bytes?.length) {
        settle(null, { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), eof: false });
        return;
      }
    }
    if (finished) settle(null, { data: new ArrayBuffer(0), eof: true });
    else child.stdout.read(0);
  };
  const fail = error => {
    if (disposed) return;
    failure = error; pump(); stop();
  };
  child.stdout.on('readable', pump);
  child.stdout.on('end', pump);
  child.stdout.on('error', error => fail(new Error('Native video output failed: ' + error.message)));
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  child.once('error', error => fail(new Error('Cannot start native video decoder: ' + error.message)));
  child.once('close', code => {
    finished = true; clearTimeout(killTimer);
    if (!disposed && code !== 0) failure = new Error(`Native VideoToolbox stream exited ${code}: ${stderr}`);
    pump();
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true; signal?.removeEventListener('abort', dispose);
    settle(new Error('Native video stream closed.'));
    stop(); child.stdout.destroy(); child.stderr.destroy();
  };
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) { dispose(); checkSignal(signal); }
  return { backend: 'FFmpeg/VideoToolbox', read() {
    if (disposed) return Promise.reject(new Error('Native video stream closed.'));
    if (pending) return Promise.reject(new Error('Only one native video read may be in flight.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('Native video decoder produced no output for 15 seconds.')), 15000);
      timer.unref();
      pending = { resolve, reject, timer }; pump();
    });
  }, dispose };
}

module.exports = { openVideoStream, videoStreamArgs, runVideoProcess };

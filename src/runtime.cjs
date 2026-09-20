'use strict';
const path = require('node:path');
const os = require('node:os');
const { runProcess } = require('./media.cjs');

async function resolveRuntime(settings = {}, { env = process.env, home = os.homedir(), platform = process.platform,
  signal, run = runProcess, log = () => {} } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const directories = (env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(d => p.isAbsolute(d));
  if (platform !== 'win32') directories.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
  const executable = name => platform === 'win32' ? `${name}.exe` : name;
  const candidates = name => directories.map(dir => p.join(dir, executable(name)));
  const checkCancelled = () => { if (signal?.aborted) throw new Error('Operation cancelled.'); };
  async function choose(key, label, defaults, paths, args, help) {
    const value = settings[key]?.trim();
    const explicit = value && !defaults.includes(value);
    const failures = [];
    for (const candidate of new Set(explicit ? [value] : paths)) {
      checkCancelled();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 15000);
      try {
        await run(candidate, args, { signal: controller.signal });
        checkCancelled();
        log(`${label}: ${candidate}`);
        return candidate;
      } catch (error) {
        checkCancelled();
        failures.push(`${candidate}: ${controller.signal.aborted ? 'Check timed out' : error.message}`);
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
      }
    }
    failures.forEach(log);
    if (explicit) throw new Error(`Invalid ${key}: ${failures[0]}. ${help}`);
    throw new Error(`${label} not found or missing dependencies. ${help} Existing installations are detected automatically; pass a custom ${key} to the reference runner. See its log for attempted paths.`);
  }
  const ffmpegPath = await choose('ffmpegPath', 'FFmpeg', ['auto', 'ffmpeg'], candidates('ffmpeg'), ['-version'], 'Install FFmpeg with libx264 and libmp3lame support.');
  const ffprobePath = await choose('ffprobePath', 'FFprobe', ['auto', 'ffprobe'],
    [p.join(p.dirname(ffmpegPath), executable('ffprobe')), ...candidates('ffprobe')], ['-version'], 'Install FFprobe (included with FFmpeg).');
  const python = candidates('python3');
  for (const prefix of [env.CONDA_PREFIX, env.VIRTUAL_ENV,
    ...['miniconda3', 'miniforge3', 'anaconda3', 'mambaforge'].map(name => p.join(home, name)),
    ...(platform === 'darwin' ? ['/opt/anaconda3', '/opt/miniconda3', '/opt/homebrew/Caskroom/miniforge/base'] : [])]) {
    if (prefix && p.isAbsolute(prefix)) python.push(p.join(prefix, platform === 'win32' ? 'python.exe' : 'bin/python'));
  }
  python.push(...candidates('python'));
  const pythonPath = await choose('pythonPath', 'Python with NumPy, SciPy and OpenCV', ['auto', 'python3', 'python'], python,
    ['-c', 'import numpy, scipy, cv2'], 'Install these packages in your Python environment: python -m pip install numpy scipy opencv-python.');
  return { ffmpegPath, ffprobePath, pythonPath };
}
module.exports = { resolveRuntime };

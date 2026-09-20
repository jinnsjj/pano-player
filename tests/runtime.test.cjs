'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRuntime } = require('../src/runtime.cjs');

const options = { env: { PATH: '/usr/bin:/bin' }, home: '/home/test', platform: 'darwin' };
test('default settings discover Homebrew and a Python with all dependencies without PATH changes', async () => {
  const valid = ['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe', '/home/test/miniconda3/bin/python'];
  const config = await resolveRuntime({}, { ...options, run: async (exe, args) => {
    if (!valid.includes(exe)) throw new Error('not available');
    if (exe.endsWith('python')) assert.match(args[1], /numpy, scipy, cv2/);
  } });
  assert.deepEqual(Object.values(config), valid);
});
test('explicit overrides fail rather than silently using a different executable', async () => {
  const calls = [];
  await assert.rejects(resolveRuntime({ ffmpegPath: '/custom/ffmpeg' }, { ...options, run: async exe => {
    calls.push(exe); throw new Error('ENOENT');
  } }), /Invalid ffmpegPath.*ENOENT/);
  assert.deepEqual(calls, ['/custom/ffmpeg']);
});
test('finds ffprobe beside a custom ffmpeg', async () => {
  const valid = ['/custom/bin/ffmpeg', '/custom/bin/ffprobe', '/custom/python'];
  const result = await resolveRuntime({ ffmpegPath: valid[0], pythonPath: valid[2] }, { ...options,
    run: async exe => { if (!valid.includes(exe)) throw new Error('missing'); } });
  assert.equal(result.ffprobePath, valid[1]);
});
test('missing dependencies produce actionable diagnostics and ignore relative PATH entries', async () => {
  const calls = [];
  await assert.rejects(resolveRuntime({}, { ...options, env: { PATH: '.:relative:/usr/bin' }, run: async exe => {
    calls.push(exe); throw new Error('missing');
  } }), /FFmpeg.*not found/);
  assert.ok(calls.every(exe => exe.startsWith('/')));
});
test('cancellation stops discovery immediately', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolveRuntime({}, { ...options, signal: controller.signal, run: async () => {
    assert.fail('must not spawn');
  } }), /cancelled/);
});
test('legacy executable-name settings also enable discovery', async () => {
  const result = await resolveRuntime({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', pythonPath: 'python3' }, {
    ...options, run: async exe => {
      if (!exe.startsWith('/opt/homebrew/bin/')) throw new Error('missing');
    },
  });
  assert.equal(result.pythonPath, '/opt/homebrew/bin/python3');
});
test('Python without scientific dependencies is skipped and missing packages are explained', async () => {
  await assert.rejects(resolveRuntime({}, { ...options, run: async (exe, args) => {
    if (args[0] === '-c') throw new Error('No module named scipy');
  } }), /Python.*pip install numpy scipy opencv-python/);
});
test('cancellation propagates to an active process and does not try another candidate', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(resolveRuntime({}, { ...options, signal: controller.signal, run: async (exe, args, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      controller.abort();
    });
  } }), /cancelled/);
  assert.equal(calls, 1);
});

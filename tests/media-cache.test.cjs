const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');

test('cached preparation never repeats Python imports or media probes; changed files invalidate probes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-player-probe-test-'));
  const calls = [];
  const probe = { streams: [{ index: 0, codec_type: 'video', width: 100, height: 50 },
    { index: 1, codec_type: 'audio', channels: 4, sample_rate: '48000' }], format: { duration: '10' } };
  const module = { exports: {} };
  const spawn = (exe, args) => {
    calls.push({ exe, args });
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', JSON.stringify(args.includes('-show_frames')
        ? { frames: [{ best_effort_timestamp_time: '0' }] } : probe));
      child.emit('close', 0);
    });
    return child;
  };
  vm.runInNewContext(await fs.readFile(require.resolve('../src/media.cjs'), 'utf8'), {
    module, Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'node:child_process' ? { spawn }
      : name === './core.cjs' ? require('../src/core.cjs') : require(name),
  });
  const { probeFile, prepareMedia } = module.exports;
  const config = { ffprobePath: '/ffprobe', pythonPath: '/python' };
  try {
    const input = path.join(root, 'clip.webm'); await fs.writeFile(input, 'source');
    const inspected = await probeFile(input, config);
    const stat = await fs.stat(input);
    const key = createHash('sha256').update(JSON.stringify([8, input, stat.size, stat.mtimeMs, 'WYZX', 1])).digest('hex');
    const cache = path.join(root, 'cache'); const directory = path.join(cache, key);
    await fs.mkdir(directory, { recursive: true });
    for (const [name, size] of [['audio.f32', 16], ['foa.wav', 60], ['playback.mp4', 5]]) await fs.writeFile(path.join(directory, name), Buffer.alloc(size));
    await fs.writeFile(path.join(directory, 'ready.json'), JSON.stringify({ pcmSize: 16, foaSize: 60, proxySize: 5 }));
    await prepareMedia(input, cache, config, 'WYZX', undefined, undefined, undefined, inspected);
    assert.equal(calls.length, 2, 'one stream probe and one decoded-timestamp probe only');
    await probeFile(input, config);
    assert.equal(calls.length, 2, 'unchanged files reuse probe results');
    await fs.appendFile(input, 'changed');
    await probeFile(input, config);
    assert.equal(calls.length, 4, 'modified source requires a fresh probe');
    await probeFile(input, { ...config, ffprobePath: '/other/ffprobe' });
    assert.equal(calls.length, 6, 'changed probe executable requires reinspection');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(probeFile(input, config, controller.signal), /cancelled/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

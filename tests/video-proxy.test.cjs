const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { openVideoStream, videoStreamArgs, runVideoProcess } = require('../src/video-proxy.cjs');

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-native-video-'));
  const input = path.join(directory, 'original # ;.mp4');
  await fs.writeFile(input, 'original media bytes');
  try { await run({ directory, input }); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

function processFixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kills = [];
  child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('close', null)); return true; };
  const calls = [], checks = [];
  return { child, calls, checks, options: { width: 4096, height: 4096, platform: 'darwin', env: { PATH: '/tools' },
    run: async (executable, args, options) => { checks.push({ executable, args, options }); },
    spawn: (executable, args, options) => { calls.push({ executable, args, options }); return child; } } };
}

test('native stream writes only stdout, preserves source timestamps and uses per-frame fragments', () => {
  const args = videoStreamArgs('/source # ;.mp4', { time: 20, width: 4096, height: 4096 });
  assert.ok(args.includes('-copyts')); assert.ok(args.includes('-noautorotate'));
  assert.equal(args[args.indexOf('-ss') + 1], '20.000000');
  assert.equal(args[args.indexOf('-seek_timestamp') + 1], '1');
  assert.ok(args.indexOf('-seek_timestamp') < args.indexOf('-ss'));
  assert.ok(args.indexOf('-noaccurate_seek') < args.indexOf('-i'));
  assert.equal(args[args.indexOf('-vf') + 1], 'trim=start=20.000000');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
  assert.equal(args[args.indexOf('-i') + 1], '/source # ;.mp4');
  assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file,pipe');
  assert.ok(args.indexOf('-protocol_whitelist') < args.indexOf('-i'));
  assert.ok(args.includes('-an')); assert.ok(args.includes('-sn')); assert.ok(args.includes('-dn'));
  assert.equal(args[args.indexOf('-map') + 1], '0:v:0');
  assert.equal(args[args.indexOf('-hwaccel_output_format') + 1], 'videotoolbox_vld');
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_videotoolbox');
  assert.equal(args[args.indexOf('-bf') + 1], '0');
  assert.equal(args[args.indexOf('-realtime') + 1], '1');
  assert.equal(args[args.indexOf('-use_editlist') + 1], '1');
  assert.match(args[args.indexOf('-movflags') + 1], /delay_moov.*default_base_moof.*frag_every_frame/);
  assert.ok(!args.some(arg => /faststart|start_at_zero|libx264/.test(arg)));
  assert.equal(args.at(-1), 'pipe:1');
  const start = videoStreamArgs('/source', { time: 0, width: 4096, height: 4096 });
  assert.ok(!start.includes('-vf')); assert.ok(!start.includes('-noaccurate_seek'));
});

test('oversized or odd sources retain aspect while rendering within hardware limits', () => {
  for (const [width, height] of [[7200, 3600], [1919, 1080]]) {
    const args = videoStreamArgs('/in', { time: 0, width, height });
    assert.match(args[args.indexOf('-vf') + 1], /min\(4096,iw\).*force_original_aspect_ratio=decrease.*force_divisible_by=2/);
    assert.ok(!args.includes('-hwaccel_output_format'));
    assert.ok(!args.includes('-ss'));
  }
});

test('native playback opens an owned source without creating cache or output files', async () => {
  await fixture(async ({ input, directory }) => {
    const f = processFixture();
    const stream = await openVideoStream(input, f.options);
    assert.equal(stream.backend, 'FFmpeg/VideoToolbox');
    assert.equal(f.checks.length, 1); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.shell, undefined);
    assert.deepEqual(f.calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(f.calls[0].args.at(-1), 'pipe:1');
    assert.deepEqual(await fs.readdir(directory), [path.basename(input)]);
    assert.equal(await fs.readFile(input, 'utf8'), 'original media bytes');
    stream.dispose();
    assert.deepEqual(f.child.kills, ['SIGTERM']);
  });
});

test('read pulls at most 256 KiB and preserves every byte before a clean EOF', async () => {
  await fixture(async ({ input }) => {
    const f = processFixture(), stream = await openVideoStream(input, f.options);
    const bytes = Buffer.alloc(600000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    f.child.stdout.write(bytes);
    f.child.stdout.end(); f.child.emit('close', 0);
    const chunks = [];
    for (;;) {
      const result = await stream.read();
      assert.ok(result.data.byteLength <= 262144);
      if (result.eof) { assert.equal(result.data.byteLength, 0); break; }
      chunks.push(Buffer.from(result.data));
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal((await stream.read()).eof, true);
    stream.dispose(); assert.deepEqual(f.child.kills, []);
  });
});

test('read remains pull-driven, waits for live bytes and rejects overlapping reads', async () => {
  await fixture(async ({ input }) => {
    const f = processFixture(), stream = await openVideoStream(input, f.options);
    assert.equal(f.child.stdout.listenerCount('data'), 0);
    const pending = stream.read();
    await assert.rejects(stream.read(), /one native video read/);
    f.child.stdout.write(Buffer.from('first live fragment'));
    assert.equal(Buffer.from((await pending).data).toString(), 'first live fragment');
    assert.equal(f.child.stdout.readableLength, 0);
    stream.dispose();
  });
});

test('closing or aborting rejects pending reads and suppresses late output', async () => {
  await fixture(async ({ input }) => {
    for (const aborting of [false, true]) {
      const f = processFixture(), abort = new AbortController();
      const stream = await openVideoStream(input, { ...f.options, signal: abort.signal });
      const pending = stream.read();
      const rejected = assert.rejects(pending, /closed/);
      if (aborting) abort.abort(); else stream.dispose();
      await rejected;
      stream.dispose(); f.child.emit('close', 1);
      await assert.rejects(stream.read(), /closed/);
      assert.deepEqual(f.child.kills, ['SIGTERM']);
    }
  });
});

test('native decoder failures expose bounded stderr instead of claiming successful EOF', async () => {
  await fixture(async ({ input }) => {
    const f = processFixture(), stream = await openVideoStream(input, f.options);
    f.child.stderr.write('failure'.repeat(2000));
    f.child.emit('close', 1);
    await assert.rejects(stream.read(), error => /VideoToolbox stream exited 1/.test(error.message) && error.message.length < 4100);
    stream.dispose();
    const failed = processFixture(), other = await openVideoStream(input, failed.options);
    failed.child.emit('error', new Error('spawn rejected'));
    await assert.rejects(other.read(), /Cannot start native video decoder: spawn rejected/);
    other.dispose();
  });
});

test('seek creates a new independent process while disposing the old process', async () => {
  await fixture(async ({ input }) => {
    const first = processFixture(), second = processFixture();
    const a = await openVideoStream(input, first.options);
    a.dispose();
    const b = await openVideoStream(input, { ...second.options, time: 20 });
    assert.equal(second.calls[0].args[second.calls[0].args.indexOf('-ss') + 1], '20.000000');
    first.child.emit('close', 0); second.child.stdout.write(Buffer.of(9));
    assert.deepEqual([...new Uint8Array((await b.read()).data)], [9]);
    b.dispose();
  });
});

test('unsupported hosts, missing FFmpeg, invalid resources and already-aborted calls cannot spawn playback', async () => {
  await fixture(async ({ input, directory }) => {
    const f = processFixture();
    for (const options of [{ platform: 'linux' }, { width: 0 }, { time: -1 }, { time: Infinity }]) {
      await assert.rejects(openVideoStream(input, { ...f.options, ...options }), /macOS|Invalid/);
    }
    await assert.rejects(openVideoStream('relative.mp4', f.options), /absolute/);
    await assert.rejects(openVideoStream(directory, f.options), /regular file/);
    await assert.rejects(openVideoStream(input, { ...f.options, run() { throw new Error('missing'); } }), /FFmpeg is unavailable/);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(openVideoStream(input, { ...f.options, signal: abort.signal }), /cancelled/);
    assert.equal(f.calls.length, 0);
  });
});

test('runtime discovery cancels a real subprocess and bounds captured diagnostics', async () => {
  const abort = new AbortController();
  const task = runVideoProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: abort.signal });
  abort.abort();
  await assert.rejects(task, /cancelled/);
  await assert.rejects(runVideoProcess(process.execPath, ['-e', 'process.stderr.write("x".repeat(10000)); process.exit(2)']),
    error => error.message.length < 4100 && /exited 2/.test(error.message));
});

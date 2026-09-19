const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectMedia, preparationArgs, LatestQueue, validRequest } = require('../src/core.cjs');
const probe = { format: { duration: '10' }, streams: [
  { index: 0, codec_type: 'video', width: 960, height: 480, start_time: '2', duration: '8' },
  { index: 1, codec_type: 'audio', channels: 4, sample_rate: '48000', start_time: '2.2' },
] };
test('validates panorama and preserves selected audio stream offset', () => {
  const info = inspectMedia(probe, 1);
  assert.equal(info.sampleRate, 48000);
  assert.ok(Math.abs(info.audioOffset - .2) < 1e-8);
  assert.equal(info.duration, 8);
  assert.throws(() => inspectMedia({ streams: [] }), /four-channel/i);
  assert.throws(() => inspectMedia({ ...probe, streams: [probe.streams[0]] }), /four-channel/i);
  assert.throws(() => inspectMedia({ ...probe, streams: [{ ...probe.streams[0], width: 0 }, probe.streams[1]] }), /dimensions/);
});
test('four-channel WAV needs no video and uses its own duration and origin', () => {
  const wav = { format: { duration: '6' }, streams: [
    { index: 0, codec_type: 'audio', channels: 4, sample_rate: '44100', duration: '6' },
  ] };
  const info = inspectMedia(wav);
  assert.equal(info.hasVideo, false);
  assert.equal(info.videoIndex, undefined);
  assert.equal(info.duration, 6);
  assert.equal(info.videoStart, 0);
  assert.equal(info.audioOffset, 0);
  assert.equal(info.sampleRate, 44100);
  const args = preparationArgs('in.wav', 'pcm', 'playback.mp3', info, 'WYZX');
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.ok(!filter.includes('scale=') && !filter.endsWith(';'));
  assert.ok(!args.includes('[v]') && !args.includes('libx264') && !args.includes('-movflags'));
  assert.ok(args.includes('[stereo]') && args.includes('libmp3lame'));
  assert.match(filter, /c0=0.5\*c0\+0.25\*c3\+0.25\*c1/);
  const cover = { index: 1, codec_type: 'video', disposition: { attached_pic: 1 } };
  assert.equal(inspectMedia({ ...wav, streams: [...wav.streams, cover] }).hasVideo, false);
  assert.throws(() => inspectMedia({ ...wav, streams: [{ ...wav.streams[0], channels: 2 }] }), /four-channel/);
  const shifted = inspectMedia({ ...wav, streams: [{ ...wav.streams[0], start_time: '2' }] });
  assert.equal(shifted.videoStart, 2);
  assert.equal(shifted.duration, 6);
});
test('accepts non-2:1 video and preserves aspect ratio within preview bounds', () => {
  for (const [width, height] of [[1920, 1080], [1000, 1000], [1080, 1920]]) {
    const info = inspectMedia({ ...probe, streams: [{ ...probe.streams[0], width, height }, probe.streams[1]] });
    assert.equal(info.width, width);
    assert.equal(info.height, height);
    assert.match(preparationArgs('a', 'b', 'c', info, 'WYZX').join(' '), /scale=960:480:force_original_aspect_ratio=decrease:force_divisible_by=2/);
  }
});
test('ambiguous four-channel tracks require explicit selection', () => {
  const multiple = { ...probe, streams: [...probe.streams, { ...probe.streams[1], index: 2 }] };
  assert.throws(() => inspectMedia(multiple), /select/i);
  assert.equal(inspectMedia(multiple, 2).audioIndex, 2);
  assert.throws(() => inspectMedia(probe, 9), /four-channel/i);
});
test('actual decoded video start overrides inaccurate container start metadata', () => {
  const actual = inspectMedia({ ...probe, streams: [{ ...probe.streams[0], decoded_start_time: '5.305' }, probe.streams[1]] });
  assert.equal(actual.videoStart, 5.305);
  assert.ok(Math.abs(actual.duration - 4.695) < 1e-8);
  assert.ok(Math.abs(actual.audioOffset + 3.105) < 1e-8);
});
test('FFmpeg uses argument arrays, explicit maps, order-aware monitor and offset', () => {
  const args = preparationArgs("/tmp/a ';.mp4", '/tmp/pcm', '/tmp/proxy.webm', inspectMedia(probe), 'WYZX');
  assert.equal(args[args.indexOf('-i') + 1], "/tmp/a ';.mp4");
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /asetpts=PTS-2\/TB,aresample=48000:async=1:first_pts=0/);
  assert.ok(args.includes('-copyts'));
  assert.match(filter, /0.25\*c3/);
  assert.match(filter, /\[pcm\]/);
  assert.ok(!args.includes('-ac'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('libmp3lame'));
  assert.ok(args.includes('+faststart'));
  const early = inspectMedia({ ...probe, streams: [probe.streams[0], { ...probe.streams[1], start_time: '1.5' }] });
  assert.match(preparationArgs('a', 'b', 'c', early, 'WXYZ').join(' '), /asetpts=PTS-2\/TB/);
  assert.throws(() => preparationArgs('a', 'b', 'c', early, 'other'), /order/i);
});
test('bounded queue keeps in-flight plus latest only and clears pending', async () => {
  const sent = []; const releases = [];
  const queue = new LatestQueue(x => new Promise(resolve => { sent.push(x); releases.push(resolve); }));
  queue.push(1); queue.push(2); queue.push(3);
  assert.deepEqual(sent, [1]); releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [1, 3]);
  queue.push(4); queue.dispose(); releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [1, 3]);
});
test('validates untrusted request numbers and generation', () => {
  assert.ok(validRequest({ type: 'analyze', time: 1, generation: 0, id: 1 }, 10));
  for (const time of [NaN, Infinity, -1, 11, '1']) {
    assert.equal(validRequest({ type: 'analyze', time, generation: 0, id: 1 }, 10), false);
  }
  assert.equal(validRequest({ type: 'analyze', time: 1, generation: -1, id: 1 }, 10), false);
});

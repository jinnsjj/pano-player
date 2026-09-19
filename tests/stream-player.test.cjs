const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');

test('stream player closes stale frames, preserves seek epochs and bounds PCM prefetch', async () => {
  const bundle = buildSync({ entryPoints: [path.join(__dirname, '../src/stream-player.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const context = { module: { exports: {} }, exports: {}, window: {}, EventTarget, Event,
    AbortController, fetch, Number };
  vm.runInNewContext(bundle, context);
  const { StreamPlayer } = context.module.exports;
  StreamPlayer.prototype.load = () => {};
  let drawn = 0, closed = 0;
  const player = new StreamPlayer({ dataset: {}, getContext: () => ({ drawImage() { drawn++; } }) });
  const messages = [];
  player.worker = { postMessage: data => messages.push(data) };
  player.node = { port: { postMessage: data => messages.push(data) } };
  player.receive({ type: 'metadata', epoch: 0, sampleRate: 48000, width: 640, height: 640, duration: 20 });
  player.receive({ type: 'video', epoch: 0, time: 8, frame: { close() { closed++; } } });
  assert.equal(drawn, 1, 'Show the first source frame while waiting for its presentation timestamp');
  await player.seek(10);
  player.receive({ type: 'video', epoch: 0, time: 1, frame: { close() { closed++; } } });
  assert.equal(closed, 2); assert.equal(drawn, 1); assert.equal(player.currentTime, 10);
  assert.equal(player.epoch, 1);
  player.receive({ type: 'audio', epoch: 0, channels: [] });
  assert.equal(player.eof, false);
  player.audioPending = false; player.endFrame = 13 * 48000;
  const count = messages.length; player.refill();
  assert.equal(messages.length, count);
  player.endFrame = 11 * 48000; player.refill(); player.refill();
  assert.equal(messages.length, count + 1, 'Only one audio request may be in flight');
});

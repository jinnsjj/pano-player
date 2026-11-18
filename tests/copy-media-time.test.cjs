const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMediaTime } = require('../src/copy-media-time.cjs');

test('copy text preserves the opened path and formats seconds to millisecond precision', () => {
  assert.equal(formatMediaTime('/media/session # %.jsonpp', { time: 12.3456 }), '/media/session # %.jsonpp\ntime: 12.346 s');
  assert.equal(formatMediaTime('C:\\media\\video.MP4', { time: 0 }), 'C:\\media\\video.MP4\ntime: 0.000 s');
  assert.equal(formatMediaTime('/media/video.mp4', { time: 3661.2 }), '/media/video.mp4\ntime: 3661.200 s');
});

test('copy text uses the selected loop endpoints instead of the current position', () => {
  assert.equal(formatMediaTime('/media/video.mp4', { loop: { start: 1.25, end: 8.75 } }),
    '/media/video.mp4\nrange: 1.250 - 8.750 s');
});

test('invalid or ambiguous selections cannot reach the clipboard', () => {
  for (const playback of [undefined, null, [], {}, { time: '1' }, { time: -1 }, { time: NaN }, { time: Infinity },
    { time: 1, loop: { start: 0, end: 2 } }, { loop: null }, { loop: { start: 1, end: 1 } },
    { loop: { start: -1, end: 2 } }, { loop: { start: 2, end: 1 } }, { loop: { start: 0, end: Infinity } },
    { loop: { start: '0', end: 1 } }, { loop: { end: 2 } }]) assert.throws(() => formatMediaTime('/media/video.mp4', playback), /Invalid/);
});

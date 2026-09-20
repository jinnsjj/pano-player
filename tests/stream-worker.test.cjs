const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('video-only worker opens and serves frames without audio decoders', async () => {
  const sent = [], self = {};
  const track = { getDecoderConfig: async () => ({ codedWidth: 640, codedHeight: 320 }) };
  const source = fs.readFileSync(require.resolve('../src/stream-worker.js'), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, { self, postMessage: data => sent.push(data), resourceFetch() {},
    Input: class {
      getPrimaryAudioTrack = async () => null;
      getPrimaryVideoTrack = async () => track;
      getDurationFromMetadata = async () => 2;
      getFormat = async () => ({ name: 'WebM' });
    }, UrlSource: class {}, ALL_FORMATS: [], setWebmOpusTiming() {},
    VideoSampleSink: class { async *samples(time) { yield { timestamp: time, toVideoFrame: () => ({ duration: 40000 }), close() {} }; } },
    AudioSampleSink: class { constructor() { throw new Error('Audio decoder must not be initialized'); } },
  });
  self.onmessage({ data: { type: 'open', url: 'test.webm' } });
  await new Promise(setImmediate);
  assert.equal(sent[0]?.type, 'metadata', JSON.stringify(sent));
  assert.equal(sent[0].channels, 0); assert.equal(sent[0].width, 640);
  self.onmessage({ data: { type: 'video', epoch: 0 } });
  await new Promise(setImmediate);
  assert.equal(sent.at(-1).type, 'video');
  self.onmessage({ data: { type: 'seek', epoch: 1, time: 1 } });
  self.onmessage({ data: { type: 'video', epoch: 1 } });
  await new Promise(setImmediate);
  assert.equal(sent.at(-1).time, 1); assert.equal(sent.at(-1).epoch, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('worker enumerates audio tracks, selects by index and rejects unsupported selections', async () => {
  const tracks = [6, 2, 4].map((channels, index) => ({ codec: 'flac',
    getDecoderConfig: async () => ({ numberOfChannels: channels, sampleRate: index === 1 ? 44100 : 48000 }),
    getName: async () => ['Surround', 'Stereo', 'FOA'][index], getLanguageCode: async () => 'eng',
  }));
  for (const selected of [undefined, 2, 0, -1, 20, 1.5]) {
    const sent = [], self = {}, starts = [];
    let sinkTrack;
    const source = fs.readFileSync(require.resolve('../src/stream-worker.js'), 'utf8').replace(/^import .*;\n/gm, '');
    vm.runInNewContext(source, { self, postMessage: data => sent.push(data), resourceFetch() {},
      Input: class {
        getAudioTracks = async () => tracks;
        getPrimaryAudioTrack = async () => tracks[0];
        getPrimaryVideoTrack = async () => null;
        getDurationFromMetadata = async () => 20;
        getFormat = async () => ({ name: 'MP4' });
      }, UrlSource: class {}, ALL_FORMATS: [], setWebmOpusTiming() {},
      AudioSampleSink: class {
        constructor(track) { sinkTrack = track; }
        samples(time) { starts.push(time); return { return: async () => {} }; }
      },
    });
    self.onmessage({ data: { type: 'open', url: 'test.mp4', audioTrackIndex: selected, time: 7, epoch: 4 } });
    await new Promise(setImmediate);
    const result = sent[0];
    assert.equal(result.epoch, 4);
    if (selected === undefined || selected === 2) {
      const index = selected ?? 1;
      assert.equal(result.type, 'metadata'); assert.equal(result.audioTrackIndex, index);
      assert.equal(result.channels, index === 1 ? 2 : 4);
      assert.equal(result.sampleRate, index === 1 ? 44100 : 48000);
      assert.equal(result.audioTracks[0].supported, false);
      assert.equal(result.audioTracks[2].name, 'FOA');
      assert.equal(sinkTrack, tracks[index]); assert.equal(starts[0], 6.88);
    } else {
      assert.equal(result.type, 'error'); assert.equal(sinkTrack, undefined);
    }
  }
});

test('video-only worker opens and serves frames without audio decoders', async () => {
  const sent = [], self = {};
  const track = { getDecoderConfig: async () => ({ codedWidth: 640, codedHeight: 320 }) };
  const source = fs.readFileSync(require.resolve('../src/stream-worker.js'), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, { self, postMessage: data => sent.push(data), resourceFetch() {},
    Input: class {
      getAudioTracks = async () => [];
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

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const processorSource = () => buildSync({ entryPoints: [require.resolve('../src/powermap/wav-stream-processor.js')],
  bundle: true, write: false }).outputFiles[0].text;

test('PCM playback preserves arbitrary browser-supported channels, seek and EOF without FOA conversion', () => {
  let Processor;
  vm.runInNewContext(processorSource(), {
    sampleRate: 48000, Float32Array,
    AudioWorkletProcessor: class { port = { postMessage() {} }; },
    registerProcessor(name, type) { Processor = type; },
  });
  for (const channels of [1, 2, 3, 4, 6, 8, 16, 32]) {
    const processor = new Processor({ processorOptions: { channels, sourceSampleRate: 48000 } });
    const messages = []; processor.port.postMessage = message => messages.push(message);
    for (const epoch of [0, 1]) {
      processor.handleMessage({ type: 'seek', frame: epoch * 48000, epoch });
      const input = Array.from({ length: channels }, (_, channel) => Float32Array.of(.1 * (channel + 1), -.2, .3));
      processor.handleMessage({ type: 'chunk', channels: input, epoch });
      processor.handleMessage({ type: 'eof', epoch }); processor.handleMessage({ type: 'play', epoch });
      const output = input.map(() => new Float32Array(3));
      processor.process([], [output]);
      assert.deepEqual(output, input);
      assert.equal(messages.at(-1).type, 'ended');
      assert.equal(messages.at(-1).frame, epoch * 48000 + 3);
    }
    processor.handleMessage({ type: 'chunk', channels: [], epoch: 1 });
    assert.equal(messages.at(-1).type, 'error');
  }
  for (const channels of [0, -1, 1.5, 33, NaN]) {
    assert.throws(() => new Processor({ processorOptions: { channels } }), /channel count/);
  }
});

test('audio handoff trims prebuffered PCM without a seek, zero gap or stale-epoch change', () => {
  let Processor;
  vm.runInNewContext(processorSource(), {
    sampleRate: 48000, Float32Array,
    AudioWorkletProcessor: class { port = { postMessage() {} }; },
    registerProcessor(name, type) { Processor = type; },
  });
  const processor = new Processor({ processorOptions: { channels: 1, sourceSampleRate: 48000 } });
  processor.handleMessage({ type: 'seek', frame: 48000, epoch: 2 });
  processor.handleMessage({ type: 'chunk', channels: [Float32Array.of(.1, .2, .3, .4, .5)], epoch: 2 });
  processor.handleMessage({ type: 'align', frame: 48004, epoch: 1 });
  assert.equal(processor.availableFrames, 5);
  processor.handleMessage({ type: 'align', frame: 48002, epoch: 2 });
  assert.equal(processor.sourceFrame, 48002); assert.equal(processor.availableFrames, 3);
  processor.handleMessage({ type: 'play', epoch: 2 });
  const output = [new Float32Array(3)]; processor.process([], [output]);
  assert.deepEqual(output[0], Float32Array.of(.3, .4, .5));
});

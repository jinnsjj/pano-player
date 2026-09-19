const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('PCM playback preserves 1/2/4 channels, seek and EOF without FOA conversion', () => {
  let Processor;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/powermap/wav-stream-processor.js'), 'utf8'), {
    sampleRate: 48000, Float32Array,
    AudioWorkletProcessor: class { port = { postMessage() {} }; },
    registerProcessor(name, type) { Processor = type; },
  });
  for (const channels of [1, 2, 4]) {
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
});

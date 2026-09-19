const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('SN3D and N3D produce matching ACN audio and map frames in both channel orders', () => {
  let Processor;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/powermap/foa-capture-processor.js'), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage() {} }; },
    registerProcessor(name, type) { Processor = type; },
  });
  for (const channelMap of [[0, 1, 2, 3], [0, 2, 3, 1]]) {
    const processor = new Processor({ processorOptions: { frameSize: 4 } });
    const frames = [];
    processor.port.postMessage = frame => frames.push(frame);
    for (const normalization of ['SN3D', 'N3D', 'SN3D']) {
      processor.handleMessage({ type: 'reset', epoch: frames.length });
      processor.handleMessage({ type: 'configure', enabled: true, channelMap, normalization });
      const expected = [0.8, -0.2, 0.3, 0.4];
      const input = Array.from({ length: 4 }, () => new Float32Array(4));
      for (let channel = 0; channel < 4; channel++) {
        input[channelMap[channel]].fill(expected[channel] * (normalization === 'N3D' && channel ? Math.sqrt(3) : 1));
      }
      const output = input.map(() => new Float32Array(4));
      processor.process([input], [output]);
      for (let channel = 0; channel < 4; channel++) {
        for (const value of output[channel]) assert.ok(Math.abs(value - expected[channel]) < 1e-6);
        for (const value of frames.at(-1).channels[channel]) assert.ok(Math.abs(value - expected[channel]) < 1e-6);
      }
    }
  }
});

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
  for (const channelCount of [4, 6]) for (const channelMap of [[0, 1, 2, 3], [0, 2, 3, 1]]) {
    const processor = new Processor({ processorOptions: { frameSize: 4 } });
    const frames = [];
    processor.port.postMessage = frame => frames.push(frame);
    for (const normalization of ['SN3D', 'N3D', 'SN3D']) {
      processor.handleMessage({ type: 'reset', epoch: frames.length });
      processor.handleMessage({ type: 'configure', enabled: true, channelMap, normalization });
      const expected = [0.8, -0.2, 0.3, 0.4];
      const input = Array.from({ length: channelCount }, () => new Float32Array(4));
      if (channelCount === 6) { input[4].fill(.6); input[5].fill(-.7); }
      for (let channel = 0; channel < 4; channel++) {
        input[channelMap[channel]].fill(expected[channel] * (normalization === 'N3D' && channel ? Math.sqrt(3) : 1));
      }
      const output = Array.from({ length: 4 }, () => new Float32Array(4));
      const hl = Array.from({ length: 2 }, () => new Float32Array(4).fill(1));
      processor.process([input], [output, hl]);
      assert.equal(frames.at(-1).channelCount, channelCount);
      assert.equal(frames.at(-1).channels.length, 4);
      for (let side = 0; side < 2; side++) {
        assert.deepEqual(hl[side], channelCount === 6 ? input[side + 4] : new Float32Array(4));
      }
      for (let channel = 0; channel < 4; channel++) {
        for (const value of output[channel]) assert.ok(Math.abs(value - expected[channel]) < 1e-6);
        for (const value of frames.at(-1).channels[channel]) assert.ok(Math.abs(value - expected[channel]) < 1e-6);
      }
    }
  }
});

test('HL-only input stays out of FOA analysis and works with analysis disabled', () => {
  let Processor;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/powermap/foa-capture-processor.js'), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage() {} }; },
    registerProcessor(name, type) { Processor = type; },
  });
  const processor = new Processor({ processorOptions: { frameSize: 4 } }), frames = [];
  processor.port.postMessage = frame => frames.push(frame);
  for (const enabled of [true, false]) {
    processor.handleMessage({ type: 'configure', enabled, normalization: 'N3D', channelMap: [0, 2, 3, 1] });
    const input = Array.from({ length: 6 }, (_, i) => new Float32Array(4).fill(i < 4 ? 0 : i / 10));
    const foa = Array.from({ length: 4 }, () => new Float32Array(4));
    const hl = Array.from({ length: 2 }, () => new Float32Array(4));
    processor.process([input], [foa, hl]);
    assert.deepEqual(hl, input.slice(4));
    assert.ok(foa.every(channel => channel.every(value => value === 0)));
    assert.ok(frames[0].channels.every(channel => channel.every(value => value === 0)));
    processor.process([input.slice(0, 4)], [foa, hl]);
    assert.ok(hl.every(channel => channel.every(value => value === 0)));
  }
});

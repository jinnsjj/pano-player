const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const source = file => buildSync({ entryPoints: [require.resolve(file)], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
function load(file) {
  const module = { exports: {} };
  vm.runInNewContext(source(file), { module, exports: module.exports, Float32Array });
  return module.exports;
}
const { createRouting, validRouting, copyRouting, routingPreset, channelLabels } = load('../media/channel-routing.js');
const { ChannelMatrix } = load('../src/channel-matrix.js');
const plain = value => JSON.parse(JSON.stringify(value));

test('routing is bounded, copied, channel-count-specific and labels are channel numbers only', () => {
  for (const count of [0, 1, 2, 4, 6, 32]) {
    const routing = createRouting(count);
    assert.ok(validRouting(routing, count)); assert.equal(routingPreset(routing), 'identity');
    assert.equal(validRouting(routing, count + 1), false);
    const copy = copyRouting(routing);
    if (count) { copy.matrix[0][0] = 0; assert.equal(routing.matrix[0][0], 1); }
  }
  for (const bad of [null, {}, { ...createRouting(2), matrix: [[], []] },
    { ...createRouting(2), matrix: [[1, NaN], [0, 1]] }, { ...createRouting(2), matrix: [Array(2), Array(2)] },
    { ...createRouting(2), enabled: 'yes' }, { ...createRouting(2), channels: 33 }]) assert.equal(validRouting(bad), false);
  assert.deepEqual(plain(channelLabels(6)), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(plain(channelLabels(2)), ['1', '2']);
  assert.equal(channelLabels(32)[31], '32');
});

test('matrix supports permutation, duplication, unity summing, silent outputs and bypass', () => {
  const mapper = new ChannelMatrix(6, 48000), output = Array.from({ length: 6 }, () => new Float32Array(1));
  mapper.samples.set([1, 2, 3, 4, 5, 6]);
  const routing = createRouting(6, 'clear');
  routing.matrix[0][5] = 1; routing.matrix[1][5] = 1;
  routing.matrix[2][0] = routing.matrix[2][1] = 1;
  mapper.configure(routing, false); mapper.render(output, 0);
  assert.deepEqual(output.map(channel => channel[0]), [6, 6, 3, 0, 0, 0]);
  assert.equal(routingPreset(routing), 'custom');
  mapper.configure({ ...routing, enabled: false }, false); mapper.render(output, 0);
  assert.deepEqual(output.map(channel => channel[0]), [1, 2, 3, 4, 5, 6]);
  assert.equal(mapper.configure(createRouting(4), false), false);
  mapper.render(output, 0); assert.equal(output[5][0], 6);
});

test('live changes ramp for 5 ms, remain bounded across rapid edits, then reach exact silence', () => {
  const mapper = new ChannelMatrix(6, 48000);
  mapper.samples.fill(1);
  const output = Array.from({ length: 6 }, () => new Float32Array(600));
  mapper.configure(createRouting(6, 'foa'), true);
  for (let frame = 0; frame < 120; frame++) mapper.render(output, frame);
  assert.ok(Math.abs(output[4][119] - .5) < 1e-6);
  mapper.configure(createRouting(6, 'hl'), true);
  for (let frame = 120; frame < 600; frame++) mapper.render(output, frame);
  for (let channel = 0; channel < 6; channel++) {
    assert.equal(output[channel][599], channel < 4 ? 0 : 1);
    assert.ok(output[channel].every(value => value >= 0 && value <= 1));
  }
  assert.ok(Math.abs(output[4][120] - output[4][119]) < .005);
});

test('PCM mapping happens before FOA order/normalization, HL split and PowerMap capture, without changing clock', () => {
  let PCM, Capture;
  const sandbox = { sampleRate: 48000, Float32Array,
    AudioWorkletProcessor: class { port = { postMessage() {} }; },
    registerProcessor(name, type) { if (name === 'wav-stream-processor') PCM = type; else Capture = type; } };
  vm.runInNewContext(source('../src/powermap/wav-stream-processor.js'), sandbox);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/powermap/foa-capture-processor.js'), 'utf8'), sandbox);
  for (const preset of ['identity', 'foa', 'hl', 'clear']) {
    const pcm = new PCM({ processorOptions: { channels: 6, sourceSampleRate: 48000 } });
    const capture = new Capture({ processorOptions: { frameSize: 4 } });
    const frames = []; capture.port.postMessage = frame => frames.push(frame);
    const routing = createRouting(6, preset);
    pcm.handleMessage({ type: 'routing', routing });
    // A seek must not remove the mapping or alter channel semantics.
    pcm.handleMessage({ type: 'seek', frame: 96000, epoch: 2 });
    pcm.handleMessage({ type: 'chunk', channels: Array.from({ length: 6 }, (_, channel) => new Float32Array(4).fill(channel + 1)), epoch: 2 });
    pcm.handleMessage({ type: 'play', epoch: 2 });
    const mapped = Array.from({ length: 6 }, () => new Float32Array(4));
    pcm.process([], [mapped]);
    assert.equal(pcm.sourceFrame, 96004); assert.equal(pcm.channels, 6); assert.equal(pcm.playing, true);
    capture.handleMessage({ type: 'configure', enabled: true, normalization: 'N3D', channelMap: [0, 2, 3, 1] });
    const foa = Array.from({ length: 4 }, () => new Float32Array(4)), hl = Array.from({ length: 2 }, () => new Float32Array(4));
    capture.process([mapped], [foa, hl]);
    const expected = [1, 3 / Math.sqrt(3), 4 / Math.sqrt(3), 2 / Math.sqrt(3)];
    for (let channel = 0; channel < 4; channel++) {
      const value = ['identity', 'foa'].includes(preset) ? expected[channel] : 0;
      assert.ok(foa[channel].every(sample => Math.abs(sample - value) < 1e-6));
      assert.ok(frames[0].channels[channel].every(sample => Math.abs(sample - value) < 1e-6));
    }
    for (let side = 0; side < 2; side++) assert.ok(hl[side].every(sample => sample === (['identity', 'hl'].includes(preset) ? side + 5 : 0)));
    assert.equal(frames[0].channelCount, 6);
  }
});

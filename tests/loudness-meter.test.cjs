const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const moduleObject = { exports: {} };
vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../src/loudness-meter.js')], bundle: true,
  write: false, format: 'cjs' }).outputFiles[0].text, { module: moduleObject, exports: moduleObject.exports });
const { LoudnessMeter } = moduleObject.exports;
function feed(meter, seconds, signal = () => 0) {
  const frames = Math.round(seconds * meter.rate);
  for (let offset = 0; offset < frames; offset += 128) {
    const length = Math.min(128, frames - offset);
    meter.process([0, 1].map(ch => Float32Array.from({ length }, (_, i) => signal(offset + i, ch))), length);
  }
  return meter.snapshot();
}
const near = (actual, expected, tolerance = .02) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('peak attacks immediately, decays by 6.02 dB per 150 ms and retains the maximum until reset', () => {
  const meter = new LoudnessMeter(48000);
  meter.process([Float32Array.of(.5), Float32Array.of(.25)], 1);
  near(meter.snapshot().channels[0].peak, -6.0206);
  const decayed = feed(meter, .15);
  near(decayed.channels[0].peak, -12.0412);
  near(decayed.channels[0].heldPeak, -6.0206);
  near(decayed.channels[1].heldPeak, -12.0412);
  feed(meter, .85);
  near(meter.snapshot().channels[0].heldPeak, -6.0206);
  meter.reset();
  assert.equal(meter.snapshot().channels[0].heldPeak, -Infinity);
  assert.equal(meter.snapshot().rmsMomentary, null);
});
test('400 ms RMS and K-weighted loudness use stereo energy without phase cancellation', () => {
  for (const rate of [44100, 48000, 96000]) {
    const meter = new LoudnessMeter(rate);
    const signal = (i, ch) => .25 * Math.sin(2 * Math.PI * 1000 * i / rate) * (ch ? -1 : 1);
    assert.equal(feed(meter, .3, signal).rmsMomentary, null);
    const result = feed(meter, 4.7, signal);
    near(result.rmsMomentary, -12.0412);
    near(result.channels[0].rms, -15.0515);
    near(result.channels[0].rms, result.channels[1].rms);
    near(result.lufsMomentary, -12.04, .1);
    near(result.lufsIntegrated, result.lufsMomentary, .05);
    near(result.lufsShort, result.lufsMomentary, .05);
    assert.equal(result.lra, 0);
    const silent = feed(meter, 5);
    assert.equal(silent.rmsMomentary, -Infinity);
    near(silent.lufsIntegrated, result.lufsIntegrated, .2);
    assert.ok(silent.rmsIntegrated < result.rmsIntegrated - 2.5);
  }
});
test('true peak detects inter-sample overload while sample peaks stay below full scale', () => {
  const meter = new LoudnessMeter(48000);
  const result = feed(meter, .5, i => 1.2 * Math.sin(Math.PI * i / 2 + Math.PI / 4));
  for (const channel of result.channels) {
    assert.ok(channel.heldPeak < 0);
    assert.ok(channel.heldTruePeak > 0);
    assert.equal(channel.clips, 0);
    assert.ok(channel.trueClips > 0);
  }
  meter.reset();
  const silence = feed(meter, .4, () => NaN);
  assert.equal(silence.channels[0].heldPeak, -Infinity);
  assert.equal(silence.lufsIntegrated, -Infinity);
});
test('LRA waits for enough short-term observations and measures the 10 LU level spread', () => {
  const meter = new LoudnessMeter(48000);
  const tone = amplitude => i => amplitude * Math.sin(2 * Math.PI * 1000 * i / meter.rate);
  assert.equal(feed(meter, 3, tone(.1)).lra, null);
  feed(meter, 5, tone(.1));
  const result = feed(meter, 8, tone(Math.sqrt(.1)));
  near(result.lra, 10, .2);
  assert.ok(result.lraLow < result.lraHigh);
});
test('meter worklet is silent, dormant when closed and resets queued statistics by epoch', () => {
  let Processor;
  const messages = [];
  vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../src/level-meter-processor.js')], bundle: true,
    write: false, format: 'iife' }).outputFiles[0].text, {
    sampleRate: 48000, AudioWorkletProcessor: class { port = { postMessage: value => messages.push(value) }; },
    registerProcessor(name, type) { Processor = type; },
  });
  const processor = new Processor();
  const input = [new Float32Array(128).fill(1.1), new Float32Array(128).fill(.2)];
  const output = [new Float32Array(128).fill(1)];
  processor.process([input], [output]);
  assert.ok(output[0].every(value => value === 0));
  assert.equal(processor.meter.snapshot().duration, 0); assert.equal(messages.length, 0);
  processor.port.onmessage({ data: { type: 'configure', enabled: true, epoch: 4 } });
  for (let i = 0; i < 20; i++) processor.process([input], [output]);
  assert.equal(messages.at(-1).epoch, 4);
  assert.ok(messages.at(-1).data.channels[0].clips > 0);
  processor.port.onmessage({ data: { type: 'reset', epoch: 5 } });
  assert.equal(messages.at(-1).data.channels[0].clips, 0);
  assert.equal(messages.at(-1).data.channels[0].heldPeak, -Infinity);
  processor.port.onmessage({ data: { type: 'configure', enabled: false, epoch: 6 } });
  processor.process([input], [output]);
  assert.equal(processor.meter.snapshot().duration, 0);
});

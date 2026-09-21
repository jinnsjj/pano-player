const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
function load(file) {
  const module = { exports: {} };
  const built = buildSync({ entryPoints: [require.resolve('../src/powermap/' + file)], bundle: true, write: false, format: 'cjs', logLevel: 'silent' });
  vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, Float32Array, Float64Array, Int32Array, URL });
  return module.exports;
}
const math = load('powermap-math.js'), worker = load('powermap-worker.js');
const directions = new Float32Array([0, 0, 90, 0, 180, 0, -90, 0, 0, 90]);
const geometry = { steering: math.firstOrderSteering(directions),
  interpolationIndices: Int32Array.from({ length: 15 }, (_, i) => Math.floor(i / 3)),
  interpolationWeights: Float32Array.from({ length: 15 }, (_, i) => i % 3 === 0 ? 1 : 0) };
function frame(two = false) {
  const channels = Array.from({ length: 4 }, () => new Float32Array(1024));
  for (let i = 0; i < 1024; i++) {
    const front = Math.sin(2 * Math.PI * 16 * i / 1024), left = two ? .7 * Math.sin(2 * Math.PI * 37 * i / 1024) : 0;
    channels[0][i] = front + left; channels[1][i] = left; channels[3][i] = front;
  }
  return { channels, sampleRate: 48000, time: 0, geometry, mapAverage: 0 };
}
test('PWD matches time-domain beam energy and MUSIC resolves one or two independent directions', () => {
  const input = frame(true), pwd = math.analyzeFoaWindow({ ...input, algorithm: 'pwd' });
  for (let direction = 0; direction < 5; direction++) {
    let energy = 0, weight = 0;
    for (let i = 0; i < 1024; i++) {
      const window = Math.fround(.5 - .5 * Math.cos(2 * Math.PI * i / 1023));
      let beam = 0;
      for (let ch = 0; ch < 4; ch++) beam += input.channels[ch][i] * (ch ? Math.sqrt(3) : 1) * geometry.steering[direction * 4 + ch];
      energy += (window * beam) ** 2; weight += window ** 2;
    }
    assert.ok(Math.abs(pwd.spectrum[direction] - energy / weight) < 1e-10);
  }
  assert.deepEqual(pwd.map, math.analyzeFoaWindow({ ...input, algorithm: 'pwd', numSources: 2 }).map);
  const one = math.analyzeFoaWindow(frame()), two = math.analyzeFoaWindow({ ...input, numSources: 2 });
  assert.equal(one.map[0], 1); assert.ok(one.map[1] < .01);
  assert.ok(two.map[0] > .99 && two.map[1] > .99); assert.ok(two.map[2] < .01);
  assert.notDeepEqual(two.map, math.analyzeFoaWindow(input).map);
  for (const options of [{ algorithm: 'unknown' }, { numSources: 0 }, { numSources: 3 }, { numSources: '2' }]) {
    assert.throws(() => math.analyzeFoaWindow({ ...input, ...options }), /algorithm|sources/);
  }
  for (const algorithm of ['music', 'pwd']) {
    const silent = { ...input, channels: Array.from({ length: 4 }, () => new Float32Array(1024)), algorithm };
    assert.ok(math.analyzeFoaWindow(silent).map.every(value => value === 0));
  }
});
test('worker passes algorithm/source options and clears incompatible averaging history', () => {
  const state = worker.createWorkerState({ geometry }); worker.registerSession(state, { sessionId: 'test' });
  for (const [algorithm, numSources] of [['music', 1], ['music', 2], ['pwd', 2], ['music', 2]]) {
    const request = { ...frame(true), algorithm, numSources, mapAverage: .666, sessionId: 'test', requestId: numSources };
    worker.queueAnalysis(state, request); const result = worker.processPendingAnalysis(state, 'test');
    const fresh = math.analyzeFoaWindow(request);
    assert.deepEqual(result.map, fresh.map); assert.deepEqual(state.sessions.get('test').previousSpectrum, fresh.spectrum);
  }
  assert.throws(() => worker.queueAnalysis(state, { ...frame(), sessionId: 'test', algorithm: 'bad' }), /algorithm/);
});
test('service forwards settings and drops pending pre-reset work before forcing a clean next frame', async () => {
  const sent = [], listeners = {}, { PowermapService } = load('powermap-service.js');
  const service = new PowermapService({ workerUrl: 'unused', workerFactory: () => ({
    postMessage(message) { sent.push(message); }, addEventListener(type, fn) { listeners[type] = fn; }, terminate() {},
  }) });
  service.register({ sessionId: 'test' });
  const first = service.requestMap('test', 0, { ...frame(), algorithm: 'music' });
  const pending = service.requestMap('test', 1, { ...frame(), algorithm: 'music' });
  service.reset('test'); assert.equal(await pending, null);
  const next = service.requestMap('test', 2, { ...frame(), algorithm: 'pwd', numSources: 2 });
  const respond = () => { const message = sent.findLast(message => message.type === 'analyze');
    listeners.message({ data: { ...message, type: 'map', map: new Float32Array(5) } }); };
  respond(); await first;
  assert.equal(sent.at(-1).algorithm, 'pwd'); assert.equal(sent.at(-1).numSources, 2);
  assert.equal(sent.at(-1).reset, true); assert.equal(sent.at(-1).time, 2);
  assert.equal(sent.filter(message => message.type === 'analyze').length, 2);
  respond(); await next; service.dispose();
});

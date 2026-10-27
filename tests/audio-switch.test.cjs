const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

function setup() {
  const sessions = [], routes = [];
  let pendingPrepare = Promise.resolve();
  const main = { dataset: {}, currentTime: 3, paused: false, seeking: false, useAudioSession(session) { this.audio = session; } };
  const previous = { video: main, context: {}, orientation: {}, setMuted(value) { this.muted = value; },
    getChannelRouting: () => ({ channels: 4, enabled: true, matrix: [[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] }),
    dispose(options) { this.disposed = options; } };
  let active = previous;
  const settings = { volume: .4, muted: false, order: 'WXYZ', normalization: 'N3D', listening: 'binaural',
    mapAlgorithm: 'music', mapSources: 1, enabled: false };
  const module = { exports: {} };
  vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../media/audio-switch.js')], bundle: true,
    format: 'cjs', write: false }).outputFiles[0].text, {
    module, exports: module.exports, AbortController, DOMException, setTimeout, clearTimeout,
    document: { createElement: () => ({ dataset: {} }) }, window: {
      StreamPlayer: class {
        constructor(element, options) {
          this.options = options; this.time = options.time; this.duration = 20;
          this.sampleRate = 48000; this.endFrame = 7 * this.sampleRate; this.channels = 4;
          sessions.push(this);
        }
        alignAudio(time) { this.aligned = time; }
        async play() { this.played = true; }
      },
      FoaMonitor: class {
        constructor(video, error, map, options) { this.video = video; this.context = options.context; routes.push(this); }
        prepare() { return pendingPrepare; }
        setOrder(value) { this.order = value; } setNormalization(value) { this.normalization = value; }
        setMode() {} setPowermap() {} setEnabled() {} setMeterEnabled() {} setOrientation(value) { this.orientation = value; }
        setVolume(value) { this.volume = value; } setMuted(value) { this.muted = value; }
        setChannelRouting(value) { this.routing = value; }
        dispose(options) { this.disposed = options; }
      },
    },
  });
  const switcher = new module.exports.AudioSwitcher(main, {}, { monitor: () => active, settings: () => settings,
    commit(next) { active = next; }, onError() {}, onMap() {} });
  return { switcher, main, previous, sessions, routes, active: () => active,
    prepare: promise => { pendingPrepare = promise; } };
}

test('replacement prepares silently and commits at the live time without pausing or seeking video', async () => {
  const s = setup(); let finish;
  s.prepare(new Promise(resolve => { finish = resolve; }));
  const switching = s.switcher.select({ id: 'external', file: 'fixture' }, 1);
  assert.equal(s.main.audio, undefined); assert.equal(s.previous.muted, undefined);
  assert.equal(s.routes[0].muted, true); assert.equal(s.main.paused, false);
  s.main.currentTime = 4; finish(); await switching;
  assert.equal(s.sessions[0].aligned, 4); assert.equal(s.sessions[0].played, true);
  assert.equal(s.main.currentTime, 4); assert.equal(s.main.paused, false);
  assert.equal(s.active().order, 'WXYZ'); assert.equal(s.active().normalization, 'N3D');
  assert.equal(s.active().volume, .4); assert.equal(s.active().orientation, s.previous.orientation);
  assert.deepEqual(s.active().routing, s.previous.getChannelRouting());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(s.previous.disposed.preserveVideo, true); assert.equal(s.previous.disposed.preserveContext, true);
});

test('pause during preparation stays paused at handoff', async () => {
  const s = setup(); let finish;
  s.prepare(new Promise(resolve => { finish = resolve; }));
  const switching = s.switcher.select({ id: 'primary' }, 1);
  s.main.paused = true; finish(); await switching;
  assert.equal(s.sessions[0].played, undefined); assert.equal(s.sessions[0].paused, true);
});

test('failed replacement keeps the previous audio, clock and video intact', async () => {
  const s = setup(); s.prepare(Promise.reject(new Error('Unsupported codec')));
  await assert.rejects(s.switcher.select({ id: 'broken' }), /Unsupported/);
  assert.equal(s.active(), s.previous); assert.equal(s.main.currentTime, 3);
  assert.equal(s.previous.muted, undefined); assert.equal(s.previous.disposed, undefined);
  assert.equal(s.routes[0].disposed.preserveContext, true);
});

test('rapid selections cancel stale work; closing cancels the latest preparation', async () => {
  const s = setup(); s.prepare(new Promise(() => {}));
  const first = s.switcher.select({ id: 'first' });
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const second = s.switcher.select({ id: 'second' });
  const secondRejected = assert.rejects(second, { name: 'AbortError' });
  s.switcher.cancel(); await firstRejected; await secondRejected;
  assert.ok(s.routes.every(route => route.disposed));
  assert.equal(s.active(), s.previous); assert.equal(s.main.audio, undefined);
});

test('an audio source shorter than the current time cannot replace the active route', async () => {
  const s = setup(); let finish;
  s.prepare(new Promise(resolve => { finish = resolve; }));
  const pending = s.switcher.select({ id: 'short' });
  s.sessions[0].duration = 2; finish();
  await assert.rejects(pending, /ends before/);
  assert.equal(s.active(), s.previous);
});

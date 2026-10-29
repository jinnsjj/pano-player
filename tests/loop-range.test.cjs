const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const context = { module: { exports: {} }, exports: {}, AbortController };
vm.runInNewContext(buildSync({ entryPoints: [require.resolve('../media/loop-range.js')], bundle: true,
  format: 'cjs', write: false }).outputFiles[0].text, context);
const { LoopRange, attachLoopRange } = context.module.exports;
const flush = () => new Promise(resolve => setImmediate(resolve));
class Player extends EventTarget {
  constructor() { super(); this.duration = 10; this.currentTime = 0; this.paused = true; this.seeks = []; this.plays = 0; }
  emit(type) { this.dispatchEvent(new Event(type)); }
  async seek(time) { this.seeks.push(time); this.currentTime = time; this.seeking = true; this.emit('seeking'); }
  async play() { this.plays++; this.paused = false; this.emit('play'); }
  pause() { this.paused = true; this.emit('pause'); }
  seeked() { this.seeking = false; this.emit('seeked'); }
  end() { this.currentTime = this.duration; this.pause(); this.emit('ended'); }
}
test('selection sorts, clamps and validates boundaries without autoplay', async () => {
  const p = new Player(), loop = new LoopRange(p);
  assert.equal(loop.setRange(8, 2), true);
  assert.equal(JSON.stringify(loop.getState()), JSON.stringify({ range: { start: 2, end: 8 }, enabled: true }));
  await flush(); assert.deepEqual(p.seeks, [2]); assert.equal(p.paused, true); assert.equal(p.plays, 0);
  for (const pair of [[2, 2], [2, 2.01], [NaN, 2], [-2, -1], [11, 12]]) assert.equal(loop.setRange(...pair), false);
  loop.setRange(-1, 100); await flush(); assert.equal(loop.range.start, 0); assert.equal(loop.range.end, 10);
  p.duration = NaN; assert.equal(loop.setRange(1, 2), false);
  p.emit('durationchange'); assert.equal(loop.range, null); assert.equal(loop.enabled, false);
  loop.dispose();
});
test('active loops wrap once at the end, wait for seek completion and preserve pause', async () => {
  const p = new Player(), loop = new LoopRange(p);
  loop.setRange(2, 4); await flush(); p.seeked(); await p.play();
  p.currentTime = 3.99; p.emit('timeupdate'); assert.deepEqual(p.seeks, [2]);
  p.currentTime = 4.02; p.emit('timeupdate'); p.emit('timeupdate');
  assert.deepEqual(p.seeks, [2, 2]); await flush();
  p.currentTime = 4.1; p.emit('timeupdate'); assert.equal(p.seeks.length, 2);
  p.currentTime = 2; p.seeked(); p.pause(); p.currentTime = 5; p.emit('timeupdate');
  assert.equal(p.seeks.length, 2); await p.play(); assert.deepEqual(p.seeks, [2, 2]);
  loop.dispose();
});
test('seeking before a selected loop keeps it active and plays into it before wrapping', async () => {
  const p = new Player(), loop = new LoopRange(p);
  loop.setRange(2, 4); await flush(); p.seeked();
  loop.seek(.5); assert.equal(loop.enabled, true); assert.equal(p.currentTime, .5);
  await p.play(); assert.deepEqual(p.seeks, [2]);
  for (const time of [1, 1.9, 2.5, 3.99]) { p.currentTime = time; p.emit('timeupdate'); }
  assert.deepEqual(p.seeks, [2]);
  p.currentTime = 4.01; p.emit('timeupdate'); await flush();
  assert.deepEqual(p.seeks, [2, 2]); assert.equal(loop.enabled, true); assert.equal(p.paused, false);
  p.seeked(); loop.seek(0);
  p.currentTime = 4.2; p.emit('timeupdate'); await flush();
  assert.deepEqual(p.seeks, [2, 2, 2], 'a delayed clock update crossing the whole range still wraps');
  loop.dispose();
});
test('seeking beyond the range keeps looping enabled, plays to EOF, then returns to the selection', async () => {
  const p = new Player(), loop = new LoopRange(p);
  loop.setRange(2, 4); await flush(); p.seeked(); await p.play();
  loop.seek(6); p.emit('timeupdate'); await flush();
  assert.deepEqual(p.seeks, [2]); assert.equal(p.currentTime, 6); assert.equal(loop.enabled, true);
  p.currentTime = 9.9; p.emit('timeupdate'); assert.equal(p.seeks.length, 1);
  p.end(); await flush(); assert.deepEqual(p.seeks, [2, 2]); assert.equal(p.currentTime, 2); assert.equal(p.paused, false);
  p.seeked(); await p.seek(7); p.seeked(); await flush();
  assert.deepEqual(p.seeks, [2, 2, 7], 'direct player seeks do not count as crossing the loop boundary');
  assert.equal(loop.enabled, true); loop.dispose();
});
test('loops ending at EOF restart; pause, clear, toggle and disposal cancel pending restart', async () => {
  for (const action of [null, 'pause', 'clear', 'toggle', 'dispose']) {
    const p = new Player(), loop = new LoopRange(p);
    loop.setRange(8, 10); await flush(); p.seeked(); await p.play();
    let resolve;
    p.seek = time => { p.currentTime = time; return new Promise(done => { resolve = done; }); };
    p.end();
    if (action === 'pause') p.pause(); else if (action) loop[action]();
    resolve(); await flush();
    assert.equal(p.plays, action ? 1 : 2, action || 'restart');
    assert.equal(p.currentTime, 8); loop.dispose();
  }
});
test('repeat creates a full-media loop without seeking, then clears the range without changing playback', async () => {
  for (const paused of [true, false]) {
    const p = new Player(), loop = new LoopRange(p);
    p.currentTime = 7; p.paused = paused;
    loop.toggle(); await flush();
    assert.equal(loop.range.start, 0); assert.equal(loop.range.end, 10); assert.equal(loop.enabled, true);
    assert.equal(p.currentTime, 7); assert.equal(p.paused, paused); assert.deepEqual(p.seeks, []);
    loop.toggle(); assert.equal(loop.range, null); assert.equal(loop.enabled, false);
    assert.equal(p.currentTime, 7); assert.equal(p.paused, paused);
    p.currentTime = 10; loop.toggle(); await flush();
    assert.equal(loop.range.start, 0); assert.equal(loop.range.end, 10); assert.equal(p.currentTime, 0);
    loop.dispose();
  }
});
test('repeat clears manually selected ranges even after seeking outside; the next click loops the entire media', async () => {
  const p = new Player(), loop = new LoopRange(p);
  loop.setRange(2, 5); await flush();
  loop.toggle(); assert.equal(loop.range, null); assert.equal(loop.enabled, false);
  loop.setRange(2, 5); await flush(); p.seeked();
  loop.seek(3); assert.equal(loop.enabled, true);
  loop.seek(7); assert.equal(loop.enabled, true); assert.equal(loop.range.start, 2);
  loop.toggle(); assert.equal(loop.range, null); assert.equal(p.currentTime, 7);
  loop.toggle(); assert.equal(loop.range.start, 0); assert.equal(loop.range.end, 10);
  assert.equal(loop.enabled, true); assert.equal(p.currentTime, 7); loop.dispose();
});
test('track duration changes clamp or clear ranges and seeking failures stop the loop', async () => {
  const p = new Player(), errors = [], loop = new LoopRange(p, () => {}, error => errors.push(error));
  loop.setRange(3, 9); await flush(); p.seeked();
  p.duration = 5; p.emit('loadedmetadata'); assert.equal(loop.range.end, 5);
  p.duration = 3; p.emit('loadedmetadata'); assert.equal(loop.range, null);
  p.seek = async () => { throw new Error('seek failed'); };
  loop.setRange(1, 2); await flush(); assert.equal(loop.enabled, false); assert.equal(errors[0].message, 'seek failed');
  p.duration = .05; p.currentTime = 0; p.emit('durationchange'); loop.toggle(); assert.equal(loop.range.end, .05);
  loop.dispose();
});

class Element {
  constructor(label = '') { this.handlers = {}; this.attrs = { 'aria-label': label }; this.dataset = {}; this.style = { setProperty() {} }; }
  addEventListener(type, fn, { signal }) {
    (this.handlers[type] ||= []).push(fn);
    signal.addEventListener('abort', () => { this.handlers[type] = this.handlers[type].filter(f => f !== fn); }, { once: true });
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key]; }
  getBoundingClientRect() { return { left: 0, width: 1012 }; }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = undefined; }
  focus() { this.focused = true; }
  fire(type, extra = {}) {
    const event = { currentTarget: this, button: 0, isPrimary: true, pointerId: 1, clientX: 206,
      preventDefault() { this.prevented = true; }, ...extra };
    for (const fn of this.handlers[type] || []) fn(event);
    return event;
  }
}
function ui() {
  const p = new Player();
  const e = Object.fromEntries(['seek', 'track', 'selection', 'start', 'end', 'toggle', 'readout'].map(key => [key, new Element(key)]));
  const controls = attachLoopRange(p, e);
  return { p, e, controls, state: () => controls.getState() };
}
function drag(element, from, to, extra = {}) {
  element.fire('pointerdown', { clientX: from, ...extra });
  element.fire('pointermove', { clientX: to });
  element.fire('pointerup', { clientX: to });
}
test('timeline clicks seek, forward/reverse drags select, thumb drags scrub, Shift overrides thumb', async () => {
  const { p, e, controls, state } = ui();
  e.seek.fire('pointerdown'); e.seek.fire('pointerup'); assert.equal(p.currentTime, 2); assert.equal(state().range, null);
  drag(e.seek, 406, 706); await flush(); assert.equal(state().range.start, 4); assert.equal(state().range.end, 7);
  assert.equal(e.toggle.attrs['aria-pressed'], 'true'); assert.equal(e.readout.textContent, '0:04.00 - 0:07.00');
  drag(e.seek, 806, 306); await flush(); assert.equal(state().range.start, 3); assert.equal(state().range.end, 8);
  drag(e.seek, 306, 906); assert.equal(p.currentTime, 9); assert.equal(state().enabled, true);
  assert.equal(e.toggle.attrs['aria-pressed'], 'true');
  drag(e.seek, 906, 706, { shiftKey: true }); await flush(); assert.equal(state().range.start, 7); assert.equal(state().range.end, 9);
  assert.equal(p.paused, true); controls.dispose();
});
test('range handles resize with pointer and keyboard; repeat clears both state and selection UI', async () => {
  const { e, controls, state } = ui();
  drag(e.seek, 206, 606); await flush();
  drag(e.start, 206, -100); await flush(); assert.equal(state().range.start, 0);
  drag(e.end, 606, 306); await flush(); assert.equal(state().range.end, 3);
  e.start.fire('keydown', { key: 'ArrowRight', shiftKey: true }); await flush(); assert.equal(state().range.start, 1);
  e.end.fire('keydown', { key: 'ArrowLeft' }); await flush(); assert.equal(state().range.end, 2.9);
  e.start.fire('keydown', { key: 'End' }); await flush(); assert.ok(Math.abs(state().range.start - 2.8) < 1e-9);
  assert.equal(e.start.attrs['aria-valuetext'], '0:02.80');
  e.end.fire('keydown', { key: 'End' }); await flush(); assert.equal(state().range.end, 10);
  assert.equal(e.toggle.attrs['aria-label'], 'Clear loop range');
  e.toggle.fire('click'); assert.equal(state().range, null); assert.equal(state().enabled, false);
  assert.equal(e.readout.textContent, '');
  for (const element of [e.selection, e.start, e.end]) assert.equal(element.hidden, true);
  assert.equal(e.toggle.attrs['aria-pressed'], 'false'); assert.equal(e.toggle.attrs['aria-label'], 'Loop entire media');
  e.toggle.fire('click'); await flush(); assert.equal(state().range.start, 0); assert.equal(state().range.end, 10);
  e.seek.fire('keydown', { key: 'Delete' }); assert.equal(state().range, null); controls.dispose();
});
test('cancelled drags restore selection; non-primary pointers, tiny ranges and invalid duration do not select', async () => {
  const { p, e, controls, state } = ui();
  drag(e.seek, 206, 606); await flush();
  for (const type of ['pointercancel', 'lostpointercapture', 'keydown']) {
    e.seek.fire('pointerdown', { clientX: 806 }); e.seek.fire('pointermove', { clientX: 906 });
    e.seek.fire(type, { key: 'Escape' });
    assert.equal(state().range.start, 2); assert.equal(state().range.end, 6);
    assert.equal(e.readout.textContent, '0:02.00 - 0:06.00');
  }
  drag(e.seek, 806, 906, { isPrimary: false }); assert.equal(state().range.start, 2);
  drag(e.seek, 806, 811); assert.equal(state().range.start, 2);
  e.seek.fire('pointerdown', { clientX: 806 }); e.seek.fire('pointermove', { pointerId: 2, clientX: 906 });
  e.seek.fire('pointercancel'); assert.equal(state().range.start, 2);
  p.duration = Infinity; p.emit('durationchange'); assert.equal(e.toggle.disabled, true); assert.equal(state().range, null);
  drag(e.seek, 206, 606); assert.equal(state().range, null);
  controls.dispose(); assert.equal(e.seek.handlers.pointerdown.length, 0);
});

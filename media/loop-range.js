const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validDuration = player => Number.isFinite(player.duration) && player.duration > 0;
const minimumRange = player => Math.min(.1, player.duration);
const format = time => {
  const centiseconds = Math.round(time * 100);
  return Math.floor(centiseconds / 6000) + ':' + String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')
    + '.' + String(centiseconds % 100).padStart(2, '0');
};

export class LoopRange {
  constructor(player, changed = () => {}, onError = () => {}) {
    this.player = player; this.changed = changed; this.onError = onError;
    this.range = null; this.enabled = false; this.request = 0; this.pending = false;
    this.position = player.currentTime;
    this.events = new AbortController();
    const on = (type, fn) => player.addEventListener(type, fn, { signal: this.events.signal });
    for (const type of ['timeupdate', 'play', 'seeked']) on(type, () => this.check());
    for (const type of ['loadedmetadata', 'durationchange']) on(type, () => this.sync());
    on('seeking', () => { this.position = player.currentTime; });
    on('ended', () => { if (this.enabled) { this.sync(); if (this.enabled) void this.jump(true); } });
    on('pause', () => this.cancel());
    on('error', () => { this.enabled = false; this.cancel(); this.changed(); });
  }
  cancel() { this.request++; this.pending = false; }
  sync() {
    const duration = this.player.duration;
    if (this.range) {
      const end = Math.min(this.range.end, duration);
      if (!validDuration(this.player) || end - this.range.start < minimumRange(this.player) - 1e-9) this.clear();
      else if (end !== this.range.end) {
        this.range = { ...this.range, end }; this.cancel();
      }
    }
    this.changed(); this.check();
  }
  setRange(a, b, seekToStart = true) {
    if (!validDuration(this.player) || !Number.isFinite(a) || !Number.isFinite(b)) return false;
    const start = clamp(Math.min(a, b), 0, this.player.duration);
    const end = clamp(Math.max(a, b), 0, this.player.duration);
    if (end - start < minimumRange(this.player) - 1e-9) return false;
    this.cancel(); this.range = { start, end }; this.enabled = true; this.position = this.player.currentTime; this.changed();
    if (seekToStart || this.outside()) void this.jump();
    return true;
  }
  toggle() {
    if (this.range) { this.clear(); return; }
    if (!validDuration(this.player)) return;
    this.setRange(0, this.player.duration, false);
  }
  clear() { this.range = null; this.enabled = false; this.cancel(); this.changed(); }
  outside(time = this.player.currentTime) { return this.range && (time < this.range.start || time >= this.range.end); }
  seek(time) {
    if (!validDuration(this.player)) return;
    this.cancel();
    this.position = time;
    this.player.currentTime = time;
  }
  check() {
    const previous = this.position, time = this.player.currentTime;
    this.position = time;
    // Wrap only when playback crosses the end, not when the user seeks past it.
    if (this.enabled && !this.pending && !this.player.paused && !this.player.seeking
        && previous < this.range.end && time >= this.range.end) void this.jump();
  }
  async jump(resume = false) {
    if (!this.range || this.disposed) return;
    const request = ++this.request;
    this.pending = true;
    try {
      await this.player.seek(this.range.start);
      if (resume && request === this.request && this.enabled && !this.disposed) await this.player.play();
    } catch (error) {
      if (request === this.request && !this.disposed) {
        this.enabled = false; this.changed(); this.onError(error);
      }
    } finally { if (request === this.request) this.pending = false; }
  }
  getState() { return { range: this.range && { ...this.range }, enabled: this.enabled }; }
  dispose() { this.disposed = true; this.cancel(); this.events.abort(); }
}

export function attachLoopRange(player, elements, onError) {
  const { seek, track, selection, start, end, toggle, readout } = elements;
  const events = new AbortController();
  const on = (element, type, fn) => element.addEventListener(type, fn, { signal: events.signal });
  let pointer, preview;
  const loop = new LoopRange(player, render, onError);
  function render() {
    const range = preview || loop.range;
    const available = validDuration(player) && !player.error;
    toggle.disabled = !available;
    toggle.setAttribute('aria-pressed', String(loop.enabled));
    toggle.setAttribute('aria-label', loop.range ? 'Clear loop range' : 'Loop entire media');
    toggle.title = toggle.getAttribute('aria-label') + (loop.range ? ': ' + format(loop.range.start) + ' - ' + format(loop.range.end) : '');
    track.dataset.loopEnabled = String(loop.enabled || !!preview);
    selection.hidden = start.hidden = end.hidden = !range;
    readout.textContent = range ? format(range.start) + ' - ' + format(range.end) : '';
    readout.title = readout.textContent;
    if (!range) return;
    track.style.setProperty('--loop-start', String(range.start / player.duration));
    track.style.setProperty('--loop-end', String(range.end / player.duration));
    for (const [handle, value, min, max] of [[start, range.start, 0, range.end - minimumRange(player)],
      [end, range.end, range.start + minimumRange(player), player.duration]]) {
      handle.setAttribute('aria-valuemin', min); handle.setAttribute('aria-valuemax', max);
      handle.setAttribute('aria-valuenow', value); handle.setAttribute('aria-valuetext', format(value));
      handle.title = handle.getAttribute('aria-label') + ': ' + format(value);
    }
  }
  const position = event => {
    const rect = seek.getBoundingClientRect();
    return clamp((event.clientX - rect.left - 6) / Math.max(1, rect.width - 12), 0, 1) * player.duration;
  };
  function begin(event, handle) {
    if (event.button !== 0 || !event.isPrimary || pointer || !validDuration(player) || player.error) return;
    const target = event.currentTarget, time = position(event);
    const width = Math.max(1, seek.getBoundingClientRect().width - 12);
    const scrub = !event.shiftKey && Math.abs(time - player.currentTime) / player.duration * width <= 8;
    pointer = { id: event.pointerId, x: event.clientX, time, target, mode: handle || (scrub ? 'seek' : 'select'), moved: false };
    target.setPointerCapture(event.pointerId); target.focus(); event.preventDefault();
  }
  function move(event) {
    if (pointer?.id !== event.pointerId) return;
    if (!pointer.moved && Math.abs(event.clientX - pointer.x) < 4) return;
    pointer.moved = true;
    const time = position(event);
    if (pointer.mode === 'seek') { loop.seek(time); return; }
    if (pointer.mode === 'select') preview = { start: Math.min(pointer.time, time), end: Math.max(pointer.time, time) };
    else if (loop.range) {
      preview = pointer.mode === 'start'
        ? { start: clamp(time, 0, loop.range.end - minimumRange(player)), end: loop.range.end }
        : { start: loop.range.start, end: clamp(time, loop.range.start + minimumRange(player), player.duration) };
    }
    render();
  }
  function finish(event, commit) {
    if (pointer?.id !== event.pointerId) return;
    const drag = pointer, range = preview;
    pointer = preview = undefined;
    if (drag.target.hasPointerCapture(event.pointerId)) drag.target.releasePointerCapture(event.pointerId);
    if (commit) {
      if (drag.moved && range) loop.setRange(range.start, range.end);
      else if (drag.mode === 'select' || drag.mode === 'seek') loop.seek(position(event));
    }
    render();
  }
  for (const [element, handle] of [[seek, null], [start, 'start'], [end, 'end']]) {
    on(element, 'pointerdown', event => begin(event, handle));
    on(element, 'pointermove', move);
    on(element, 'pointerup', event => { move(event); finish(event, true); });
    for (const type of ['pointercancel', 'lostpointercapture']) on(element, type, event => finish(event, false));
    on(element, 'keydown', event => {
      if (event.key === 'Escape' && pointer) { finish({ pointerId: pointer.id }, false); event.preventDefault(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { loop.clear(); event.preventDefault(); return; }
      if (!handle || !loop.range) return;
      const range = loop.range, step = event.shiftKey ? 1 : .1;
      const min = handle === 'start' ? 0 : range.start + minimumRange(player);
      const max = handle === 'start' ? range.end - minimumRange(player) : player.duration;
      const next = { ArrowLeft: range[handle] - step, ArrowDown: range[handle] - step,
        ArrowRight: range[handle] + step, ArrowUp: range[handle] + step, Home: min, End: max }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      loop.setRange(handle === 'start' ? clamp(next, min, max) : range.start,
        handle === 'end' ? clamp(next, min, max) : range.end);
    });
  }
  on(seek, 'input', () => loop.seek(Number(seek.value)));
  on(toggle, 'click', () => loop.toggle());
  render();
  return { getState: () => loop.getState(), dispose() {
    if (pointer) finish({ pointerId: pointer.id }, false);
    events.abort(); loop.dispose();
  } };
}

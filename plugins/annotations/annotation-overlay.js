import { AnnotationTimeline, annotationColor, annotationLimits, validateAnnotations } from './annotation-data.js';
import { annotationFormatHelp } from './annotation-format.js';

function fitText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let low = 0, high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(text.slice(0, middle) + '...').width <= width) low = middle; else high = middle - 1;
  }
  return text.slice(0, low) + '...';
}

export function drawAnnotationShapes(canvas, items, color, { labels = true, displayWidth = 720 } = {}) {
  const ctx = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const unit = width / Math.max(120, displayWidth), fontSize = 12 * unit, padding = 4 * unit;
  ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const captions = [];
  for (const item of items) {
    const coordinates = item.bbox || item.point;
    if (!coordinates) continue;
    const x = coordinates[0] * width, y = coordinates[1] * height;
    const stroke = color(item.source);
    ctx.beginPath();
    if (item.bbox) ctx.rect(x, y, (coordinates[2] - coordinates[0]) * width, (coordinates[3] - coordinates[1]) * height);
    else ctx.arc(x, y, 4 * unit, 0, 2 * Math.PI);
    ctx.lineWidth = 4 * unit; ctx.strokeStyle = '#08090a'; ctx.stroke();
    ctx.lineWidth = 2 * unit; ctx.strokeStyle = stroke; ctx.stroke();
    if (item.point) { ctx.fillStyle = stroke; ctx.fill(); }
    const caption = [item.label, item.source ? `[${item.source}]` : ''].filter(Boolean).join(' ');
    if (!labels || !caption) continue;
    const text = fitText(ctx, caption, Math.max(1, width - 2 * padding));
    const w = Math.min(width, ctx.measureText(text).width + 2 * padding), h = fontSize + 2 * padding;
    const left = Math.max(0, Math.min(width - w, x + (item.point ? 8 * unit : 0)));
    let top = Math.max(0, Math.min(height - h, y - h));
    // Prefer a nearby free row instead of painting concurrent method labels on top of one another.
    for (let attempt = 0; attempt < 24; attempt++) {
      if (!captions.some(r => left < r.x + r.w && left + w > r.x && top < r.y + r.h && top + h > r.y)) break;
      top = (top + h + unit) % Math.max(h + unit, height - h);
    }
    captions.push({ x: left, y: top, w, h });
    ctx.fillStyle = '#08090aee'; ctx.fillRect(left, top, w, h);
    ctx.fillStyle = stroke; ctx.fillText(text, left + padding, top + h / 2);
  }
}

export class AnnotationOverlay {
  constructor(api) {
    this.api = api;
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.id = 'annotation-enabled';
    const panel = api.createPanel({ title: 'Annotation', placement: 'overlay', toggle: enabled });
    panel.innerHTML = `<div class="settings-row">
      <button id="annotation-open" title="Open annotation JSON" aria-label="Open annotation JSON"><i data-lucide="folder-open" aria-hidden="true"></i></button>
      <input id="annotation-file" type="file" accept=".json,application/json" hidden>
      <span id="annotation-name">No annotation file</span>
      <button id="annotation-clear" title="Remove annotations" aria-label="Remove annotations" disabled><i data-lucide="x" aria-hidden="true"></i></button>
      <label class="toggle"><input id="annotation-labels" type="checkbox" checked disabled><span>Labels</span></label>
      <output id="annotation-count" aria-live="off">0 active / 0</output>
    </div>
    <div id="annotation-sources" role="group" aria-label="Annotation sources"></div>
    ${annotationFormatHelp}
    <output id="annotation-status" role="status" hidden></output>`;
    const $ = id => panel.querySelector('#' + id);
    this.controls = { enabled, ...Object.fromEntries(['open', 'file', 'clear', 'labels', 'name', 'count', 'status', 'sources']
      .map(key => [key, $('annotation-' + key)])) };
    this.controls.options = panel;
    this.layer = api.createLayer(); this.raw = this.layer.canvas;
    this.timeline = new AnnotationTimeline([]); this.selected = new Set(); this.revision = 0; this.request = 0;
    this.events = new AbortController();
    const on = (element, type, fn) => element.addEventListener(type, fn, { signal: this.events.signal });
    on(this.controls.open, 'click', () => this.controls.file.click());
    on(this.controls.file, 'change', event => {
      const file = event.target.files[0]; event.target.value = '';
      if (file) void this.load(file);
    });
    on(this.controls.clear, 'click', () => { this.clear(); this.controls.open.focus(); });
    for (const control of [this.controls.enabled, this.controls.labels]) on(control, 'change', () => this.update(undefined, true));
    on(this.controls.sources, 'change', event => {
      const { source } = event.target.dataset;
      if (source === undefined) return;
      if (event.target.checked) this.selected.add(source); else this.selected.delete(source);
      this.revision++; this.update(undefined, true);
    });
    this.subscription = api.onFrame(state => this.update(state));
    this.clear(); api.refreshIcons();
  }
  async load(file) {
    const request = ++this.request;
    this.controls.options.setAttribute('aria-busy', 'true');
    this.message('Loading ' + file.name);
    try {
      if (!file.size) throw new Error('The file is empty.');
      if (file.size > annotationLimits.bytes) throw new Error('Annotation files must be 20 MB or smaller.');
      const data = validateAnnotations(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      if (this.disposed || request !== this.request) return;
      this.timeline = new AnnotationTimeline(data.annotations);
      this.name = file.name; this.controls.name.textContent = file.name; this.controls.name.title = file.name;
      this.selected = new Set(this.timeline.sources);
      this.colors = new Map(this.timeline.sources.map((source, index) => [source, annotationColor(index)]));
      this.controls.sources.replaceChildren(...this.timeline.sources.map(source => {
        const label = document.createElement('label'); label.className = 'toggle annotation-source';
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.dataset.source = source;
        const swatch = document.createElement('span'); swatch.className = 'annotation-swatch'; swatch.style.backgroundColor = this.colors.get(source); swatch.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span'); text.textContent = source;
        label.append(input, swatch, text); return label;
      }));
      this.controls.enabled.checked = true;
      this.controls.clear.disabled = this.controls.enabled.disabled = this.controls.labels.disabled = false;
      this.revision++; this.message(''); this.update(undefined, true);
    } catch (error) {
      if (!this.disposed && request === this.request) this.message('Annotations unchanged: ' + error.message);
    } finally {
      if (!this.disposed && request === this.request) this.controls.options.removeAttribute('aria-busy');
    }
  }
  clear() {
    this.request++; this.timeline = new AnnotationTimeline([]); this.selected.clear(); this.colors = new Map(); this.name = null;
    this.controls.name.textContent = 'No annotation file'; this.controls.name.removeAttribute('title');
    this.controls.sources.replaceChildren();
    this.controls.clear.disabled = this.controls.enabled.disabled = this.controls.labels.disabled = true;
    this.controls.enabled.checked = false;
    this.controls.options.removeAttribute('aria-busy'); this.message(''); this.update(undefined, true);
  }
  message(text) { this.controls.status.textContent = text; this.controls.status.hidden = !text; }
  update(state = this.api.getState(), force = false) {
    if (this.disposed) return;
    const active = this.timeline.at(state.time).filter(item => !item.source || this.selected.has(item.source));
    const enabled = this.controls.enabled.checked && state.hasVideo;
    this.active = enabled ? active.length : 0;
    this.controls.count.textContent = `${this.active.toLocaleString()} active / ${this.timeline.total.toLocaleString()}`;
    const { width, height, sourceDisplayWidth } = state;
    const key = [this.revision, enabled, this.controls.labels.checked, width, height, sourceDisplayWidth,
      active.map(item => item.index).join(',')].join('|');
    if (!force && this.key === key) return;
    this.key = key;
    if (!enabled || !active.length || !width || !height) { this.layer.update({ visible: false }); return; }
    const scale = Math.min(2, 2048 / Math.max(width, height));
    const rawWidth = Math.max(1, Math.round(width * scale)), rawHeight = Math.max(1, Math.round(height * scale));
    if (this.raw.width !== rawWidth || this.raw.height !== rawHeight) { this.raw.width = rawWidth; this.raw.height = rawHeight; }
    drawAnnotationShapes(this.raw, enabled ? active : [], source => this.colors.get(source) || annotationColor(this.colors.size), {
      labels: this.controls.labels.checked, displayWidth: sourceDisplayWidth,
    });
    this.layer.update({ visible: true });
  }
  getState() {
    return { name: this.name, total: this.timeline.total, active: this.active,
      enabled: this.controls.enabled.checked, labels: this.controls.labels.checked,
      sources: this.timeline.sources, selected: [...this.selected] };
  }
  dispose() {
    this.disposed = true; this.request++; this.events.abort(); this.subscription.dispose(); this.layer.dispose();
  }
}

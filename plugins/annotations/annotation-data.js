export const annotationLimits = Object.freeze({ bytes: 20 * 1024 * 1024, count: 200000 });

export function validateAnnotations(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.annotations)) {
    throw new Error('Expected annotation JSON with version: 1 and an annotations array.');
  }
  if (value.annotations.length > annotationLimits.count) throw new Error('Too many annotations (maximum 200,000).');
  const annotations = value.annotations.map((item, index) => {
    const fail = message => { throw new Error(`Annotation ${index + 1}: ${message}`); };
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('expected an object.');
    const { start, end } = item;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) fail('require 0 <= start < end, in seconds.');
    const metadata = {};
    for (const key of ['label', 'source']) {
      const text = item[key];
      if (text == null) continue;
      if (typeof text !== 'string' || text.length > 2000) fail(`${key} must be a string of at most 2,000 characters when provided.`);
      if (text.trim()) metadata[key] = text;
    }
    const box = item.bbox != null, point = item.point != null;
    if (box && point) fail('provide at most one of bbox or point.');
    if (!box && !point) return { start, end, ...metadata };
    const key = box ? 'bbox' : 'point', coordinates = item[key];
    if (!Array.isArray(coordinates) || coordinates.length !== (box ? 4 : 2)
        || !coordinates.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) fail(`${key} coordinates must be numbers in [0, 1].`);
    if (box && (coordinates[0] >= coordinates[2] || coordinates[1] >= coordinates[3])) fail('bbox must be [left, top, right, bottom] with positive area.');
    return { start, end, ...metadata, [key]: [...coordinates] };
  });
  return { version: 1, annotations };
}

export class AnnotationTimeline {
  constructor(annotations) {
    this.total = annotations.length;
    this.items = annotations.map((item, index) => ({ ...item, index })).filter(item => item.bbox || item.point)
      .sort((a, b) => a.start - b.start || a.index - b.index);
    let end = -Infinity;
    this.ends = this.items.map(item => (end = Math.max(end, item.end)));
    this.sources = [...new Set(this.items.map(item => item.source).filter(Boolean))].sort();
  }
  at(time) {
    if (!Number.isFinite(time)) return [];
    let low = 0, high = this.items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.items[middle].start <= time) low = middle + 1; else high = middle;
    }
    const active = [];
    for (let i = low - 1; i >= 0 && this.ends[i] > time; i--) {
      if (this.items[i].end > time) active.push(this.items[i]);
    }
    return active.reverse();
  }
}

const palette = ['#83dfc5', '#ffb86b', '#79cbff', '#f198c2', '#e5df75', '#c4b2ff', '#ff9292', '#c8e7ed'];
export function annotationColor(index) { return palette[index % palette.length]; }

// All audio inputs use X front, Y left, Z up; the output is source-image UV.
export function directionToPoint(xyz, horizontalFov = 360) {
  if (!Array.isArray(xyz) || xyz.length !== 3 || !xyz.every(Number.isFinite) || Math.hypot(...xyz) < 1e-10) {
    throw new Error('Expected a finite, nonzero XYZ direction.');
  }
  const [x, y, z] = xyz, azimuth = Math.atan2(y, x), elevation = Math.atan2(z, Math.hypot(x, y));
  if (horizontalFov !== 180 && horizontalFov !== 360) throw new Error('Only 180 or 360 degree ERP is supported.');
  if (horizontalFov === 180 && x < 0) return null;
  return [Math.max(0, Math.min(1, .5 - azimuth / (horizontalFov * Math.PI / 180))), .5 - elevation / Math.PI];
}

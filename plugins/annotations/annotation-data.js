export const annotationLimits = Object.freeze({ bytes: 20 * 1024 * 1024, count: 200000, issues: 10 });
const standardFields = new Set(['start', 'end', 'timestamp', 'frame', 'fps', 'label', 'source', 'bbox', 'point']);

class InvalidAnnotationError extends Error {}

function validateFps(fps, fail) {
  if (!Number.isFinite(fps) || fps <= 0) fail('fps must be a finite number greater than 0.');
  return fps;
}

function annotationInterval(item, defaultFps, fail) {
  const timestamp = Object.hasOwn(item, 'timestamp'), frame = Object.hasOwn(item, 'frame');
  const interval = Object.hasOwn(item, 'start') || Object.hasOwn(item, 'end');
  if (Number(timestamp) + Number(frame) + Number(interval) !== 1) {
    fail('provide exactly one timing form: start/end, timestamp, or frame.');
  }
  const fps = Object.hasOwn(item, 'fps') ? validateFps(item.fps, fail) : defaultFps;
  let start, end;
  if (frame) {
    if (!Number.isSafeInteger(item.frame) || item.frame < 0) fail('frame must be a nonnegative safe integer (zero-based).');
    if (fps === undefined) fail('frame requires an explicit fps on the annotation or root object.');
    start = item.frame / fps;
    end = (item.frame + 1) / fps;
  } else if (timestamp) {
    if (fps === undefined) fail('timestamp requires an explicit fps on the annotation or root object.');
    start = item.timestamp;
    end = start + 1 / fps;
  } else {
    start = item.start; end = item.end;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) {
    fail('timing must produce finite 0 <= start < end, in seconds.');
  }
  return { start, end };
}

function validateAnnotation(item, index, fps) {
  const fail = message => { throw new InvalidAnnotationError(`Annotation ${index + 1}: ${message}`); };
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('expected an object.');
  const { start, end } = annotationInterval(item, fps, fail);
  const metadata = {};
  for (const key of ['label', 'source']) {
    const text = item[key];
    if (text == null) continue;
    if (typeof text !== 'string' || text.length > 2000) fail(`${key} must be a string of at most 2,000 characters when provided.`);
    if (text.trim()) metadata[key] = text;
  }
  const customFields = Object.entries(item).filter(([key]) => !standardFields.has(key));
  if (customFields.length) metadata.customFields = Object.fromEntries(customFields);
  const box = item.bbox != null, point = item.point != null;
  if (box && point) fail('provide at most one of bbox or point.');
  if (!box && !point) return { start, end, ...metadata };
  const key = box ? 'bbox' : 'point', coordinates = item[key];
  if (!Array.isArray(coordinates) || coordinates.length !== (box ? 4 : 2)
      || !coordinates.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) fail(`${key} coordinates must be numbers in [0, 1].`);
  if (box && (coordinates[0] >= coordinates[2] || coordinates[1] >= coordinates[3])) fail('bbox must be [left, top, right, bottom] with positive area.');
  return { start, end, ...metadata, [key]: [...coordinates] };
}

export function validateAnnotations(value, { skipInvalid = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.hasOwn(value, 'version') && value.version !== 1) || !Array.isArray(value.annotations)) {
    throw new Error('Expected annotation JSON with an annotations array and optional version: 1.');
  }
  if (value.annotations.length > annotationLimits.count) throw new Error('Too many annotations (maximum 200,000).');
  const fps = Object.hasOwn(value, 'fps') ? validateFps(value.fps, message => { throw new Error(`Annotation JSON: ${message}`); }) : undefined;
  const annotations = [], issues = [];
  let skipped = 0;
  value.annotations.forEach((item, index) => {
    try {
      annotations.push(validateAnnotation(item, index, fps));
    } catch (error) {
      if (!skipInvalid || !(error instanceof InvalidAnnotationError)) throw error;
      skipped++;
      if (issues.length < annotationLimits.issues) issues.push(error.message);
    }
  });
  return { version: 1, annotations, ...(skipInvalid ? { skipped, issues } : {}) };
}

export class AnnotationTimeline {
  constructor(annotations) {
    this.total = annotations.length;
    this.items = annotations.map((item, index) => ({ ...item, index })).filter(item => item.bbox || item.point || item.label)
      .sort((a, b) => a.start - b.start || a.index - b.index);
    let end = -Infinity;
    this.ends = this.items.map(item => (end = Math.max(end, item.end)));
    this.sources = [...new Set(this.items.map(item => item.source).filter(Boolean))].sort();
    this.fields = [...new Set(this.items.flatMap(item => Object.keys(item.customFields || {})))].sort();
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

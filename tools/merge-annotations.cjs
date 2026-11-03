'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const aliases = Object.freeze({
  Speech: 'speech', 'Female speech, woman speaking': 'female_speech',
  'Male speech, man speaking': 'male_speech', 'Child speech, kid speaking': 'child_speech',
  'Walk, footsteps': 'footsteps', Breathing: 'breathing', Screaming: 'screaming',
  Boom: 'boom', Gong: 'gong', Thunder: 'thunder', Yell: 'yell', Fireworks: 'fireworks',
  Explosion: 'explosion', 'Zipper (clothing)': 'zipper',
  'Scratching (performance technique)': 'scratching_performance',
});
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const round = number => Math.round(number * 1e6) / 1e6;

async function mergeAnnotations(directory, output, videoPath) {
  const { validateAnnotations, directionToPoint } = await import('../plugins/annotations/annotation-data.js');
  const av = read(path.join(directory, 'av_annotation.json'));
  const record = JSON.parse(fs.readFileSync(path.join(directory, 'record.jsonl'), 'utf8').trim());
  const geometry = record.original_media?.geometry;
  const fov = geometry?.horizontal_fov_deg;
  if (![180, 360].includes(fov)) throw new Error('Source metadata must declare a 180 or 360 degree ERP horizontal FOV.');
  const report = { version: 1, input: path.resolve(directory), video: videoPath ? path.resolve(videoPath) : null,
    horizontal_fov_deg: fov, input_sha256: {}, raw_predictions_verified: 0, sources: {}, label_aliases: aliases,
    skipped: { rear_hemisphere: [], zero_duration_visual_samples: 0, null_emitter_boxes: 0 },
    notes: [
      'Method predictions are combined, not associated with a shared object or treated as ground truth.',
      'Visual samples hold for at most 1/location_fps seconds, clipped to the next sample and event end; no interpolation.',
      'Audio intervals and existing candidate thresholds are preserved. No threshold is applied across methods.',
      'SO-7B QA points are static predictions over each provided window, not trajectories.',
      'Labels are preserved except the explicit taxonomy aliases; physical methods have no semantic class.',
      'Rear-hemisphere audio points cannot be represented in an ERP180 video frame and are listed, not clamped into view.',
    ] };
  const annotations = [];
  function add(item) {
    annotations.push(item);
    const counts = report.sources[item.source] ||= { bbox: 0, point: 0 };
    counts[item.bbox ? 'bbox' : 'point']++;
  }
  report.input_sha256['av_annotation.json'] = hash(path.join(directory, 'av_annotation.json'));
  const samplePeriod = 1 / av.location_fps;
  if (!Number.isFinite(samplePeriod) || samplePeriod <= 0) throw new Error('Invalid location_fps.');
  const avSource = record.model_snapshot?.name || 'AV model';
  for (const event of av.events) {
    const locations = [...event.visual_locations].sort((a, b) => a.time - b.time);
    locations.forEach((location, index) => {
      const start = round(Math.max(location.time, event.start));
      const end = round(Math.min(location.time + samplePeriod, locations[index + 1]?.time ?? Infinity, event.end));
      if (end <= start) { report.skipped.zero_duration_visual_samples++; return; }
      if (location.bbox_format !== 'xyxy') throw new Error('Visual bbox_format must be xyxy.');
      if (location.bbox) add({ start, end, label: event.label, source: avSource, bbox: location.bbox });
      if (location.emitter_bbox) add({ start, end, label: `${event.label} / ${location.emitter_part || 'emitter'}`, source: avSource, bbox: location.emitter_bbox });
      else report.skipped.null_emitter_boxes++;
    });
  }
  const methods = { pseld: 'PSELD', so_encoder: 'SO-Encoder', so_qa: 'SO-7B QA' };
  for (const name of ['pseld', 'so_encoder', 'so_qa', 'physical']) {
    const relative = `audio/${name}.json`, file = path.join(directory, relative), data = read(file);
    report.input_sha256[relative] = hash(file);
    for (const window of data.windows || []) {
      const raw = path.join(directory, 'audio_raw', name, path.basename(window.raw));
      if (!fs.existsSync(raw)) continue;
      if (hash(raw) !== window.sha256) throw new Error(`Raw prediction checksum mismatch: ${raw}`);
      report.raw_predictions_verified++;
    }
    for (const row of data.records) {
      const start = round(row.start_s ?? row.time_s), end = round(row.end_s);
      const groups = name === 'physical' ? row.methods : { [name]: row.candidates };
      for (const [method, candidates] of Object.entries(groups)) {
        const source = methods[method] || ({ iv: 'IV', tf_hist: 'TF peaks', music1: 'MUSIC' })[method];
        if (!source) throw new Error(`Unknown audio method: ${method}`);
        for (const candidate of candidates) {
          const label = name === 'physical' ? 'sound direction' : aliases[candidate.label] || candidate.label;
          const point = directionToPoint(candidate.xyz, fov);
          if (!point) {
            report.skipped.rear_hemisphere.push({ start, end, label, source, xyz: candidate.xyz });
            continue;
          }
          add({ start, end, label, source, point: point.map(round) });
        }
      }
    }
  }
  if (videoPath) {
    report.video_sha256 = hash(videoPath);
    report.expected_video_sha256 = record.original_media.sha256;
    if (report.video_sha256 !== report.expected_video_sha256) throw new Error('Video checksum differs from the annotated source.');
  }
  annotations.sort((a, b) => a.start - b.start || a.end - b.end || a.source.localeCompare(b.source));
  const result = validateAnnotations({ version: 1, annotations });
  report.annotations = annotations.length;
  report.full_frame_boxes = annotations.filter(a => a.bbox?.every((n, i) => n === [0, 0, 1, 1][i])).length;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  const reportPath = output.replace(/\.json$/i, '') + '.report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  return { output: path.resolve(output), report: path.resolve(reportPath), annotations: annotations.length, sources: report.sources,
    rearHemisphereSkipped: report.skipped.rear_hemisphere.length, rawVerified: report.raw_predictions_verified };
}
module.exports = { mergeAnnotations, aliases };
if (require.main === module) {
  const [directory, output, video] = process.argv.slice(2);
  if (!directory || !output) { console.error('Usage: node tools/merge-annotations.cjs <export-directory> <output.json> [source-video]'); process.exitCode = 1; }
  else mergeAnnotations(directory, output, video).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

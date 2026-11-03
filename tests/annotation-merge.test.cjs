const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { mergeAnnotations } = require('../tools/merge-annotations.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-annotations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => {
    const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data));
  };
  const candidate = (label = 'speech', xyz = [1, 0, 0]) => ({ label, xyz });
  write('record.jsonl', { model_snapshot: { name: 'Visual Model' }, original_media: { geometry: { horizontal_fov_deg: 180 } } });
  write('av_annotation.json', { location_fps: 5, events: [{ start: 0, end: .5, label: 'Person speaking', visual_locations: [
    { time: 0, bbox: [.1, .2, .5, .8], bbox_format: 'xyxy', emitter_bbox: [.2, .3, .3, .4], emitter_part: 'head' },
    { time: .4, bbox: [.3, .2, .6, .8], bbox_format: 'xyxy', emitter_bbox: null },
  ] }] });
  write('audio/pseld.json', { records: [{ time_s: 0, end_s: .1, candidates: [candidate('Speech')] }] });
  write('audio/so_encoder.json', { records: [{ time_s: 0, end_s: .1, candidates: [candidate('speech', [0, 1, 0])] }] });
  write('audio/so_qa.json', { records: [{ start_s: 0, end_s: 10, candidates: [candidate('tool', [-1, 0, 0])] }] });
  write('audio/physical.json', { records: [{ time_s: 0, end_s: .2, methods: {
    iv: [candidate()], tf_hist: [candidate()], music1: [candidate('ignored', [-1, 0, 0])],
  } }] });
  return { root, write, output: path.join(root, 'out/annotations.json') };
}

test('merger combines independent method labels, clips sample holds and reports unrepresentable rear directions', async t => {
  const { root, output } = fixture(t);
  const result = await mergeAnnotations(root, output);
  const annotations = JSON.parse(fs.readFileSync(output)).annotations;
  assert.equal(result.annotations, 7); assert.equal(result.rearHemisphereSkipped, 2);
  const visual = annotations.filter(a => a.source === 'Visual Model');
  assert.deepEqual(visual.map(a => [a.start, a.end]), [[0, .2], [0, .2], [.4, .5]]);
  assert.equal(visual[1].label, 'Person speaking / head');
  assert.equal(annotations.find(a => a.source === 'PSELD').label, 'speech');
  assert.equal(annotations.find(a => a.source === 'SO-Encoder').point[0], 0);
  assert.equal(annotations.find(a => a.source === 'IV').label, 'sound direction');
  const report = JSON.parse(fs.readFileSync(result.report));
  assert.equal(report.skipped.null_emitter_boxes, 1); assert.equal(report.raw_predictions_verified, 0);
  assert.equal(Object.keys(report.input_sha256).length, 5);
});

test('merger preserves window-length QA and arbitrary existing audio intervals without interpolation', async t => {
  const { root, output, write } = fixture(t);
  write('audio/so_qa.json', { records: [{ start_s: 0, end_s: 10, candidates: [{ label: 'speech', xyz: [1, 0, 1] }] }] });
  await mergeAnnotations(root, output);
  const qa = JSON.parse(fs.readFileSync(output)).annotations.find(a => a.source === 'SO-7B QA');
  assert.deepEqual(qa, { start: 0, end: 10, label: 'speech', source: 'SO-7B QA', point: [.5, .25] });
});

test('merger verifies available raw prediction checksums and fails rather than silently reading changed files', async t => {
  const { root, output, write } = fixture(t);
  const file = path.join(root, 'audio_raw/pseld/fixture.npz'); fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = Buffer.from('raw prediction fixture'); fs.writeFileSync(file, raw);
  write('audio/pseld.json', { records: [], windows: [{ raw: '/remote/fixture.npz', sha256: crypto.createHash('sha256').update(raw).digest('hex') }] });
  assert.equal((await mergeAnnotations(root, output)).rawVerified, 1);
  fs.writeFileSync(file, 'changed');
  await assert.rejects(mergeAnnotations(root, output), /checksum mismatch/);
});

test('merger refuses missing geometry metadata and a mismatched source video', async t => {
  const { root, output, write } = fixture(t);
  const video = path.join(root, 'source.mp4'); fs.writeFileSync(video, 'video fixture');
  await assert.rejects(mergeAnnotations(root, output, video), /Video checksum differs/);
  write('record.jsonl', { original_media: {} });
  await assert.rejects(mergeAnnotations(root, output), /metadata must declare/);
});

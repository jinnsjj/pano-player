'use strict';
const defaults = Object.freeze({
  projection: 'auto', layout: 'mono', rotation: '0', view: 'flat', listening: 'binaural',
  order: 'WYZX', normalization: 'SN3D', enabled: false, opacity: .75,
  mapAlgorithm: 'music', mapSources: 1,
  volume: 1, muted: false, grid: false, gridOpacity: 1, meter: false, overview: true, yaw: 0, pitch: 0, fov: 72,
});
const choices = {
  projection: ['auto', '180', '360', 'eac'], layout: ['mono', 'sbs', 'tb'],
  rotation: ['0', '90', '180', '270'],
  view: ['flat', 'spatial'], listening: ['binaural', 'stereo'],
  order: ['WYZX', 'WXYZ'], normalization: ['SN3D', 'N3D'],
  mapAlgorithm: ['music', 'pwd'], mapSources: [1, 2],
};
const ranges = { opacity: [0, 1], gridOpacity: [0, 1], volume: [0, 1], yaw: [-Math.PI, Math.PI],
  pitch: [-Math.PI / 2 + .05, Math.PI / 2 - .05], fov: [35, 110] };
function normalize(value) {
  const result = { ...defaults };
  if (!value || typeof value !== 'object') return result;
  for (const [key, options] of Object.entries(choices)) if (options.includes(value[key])) result[key] = value[key];
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (Number.isFinite(value[key])) result[key] = Math.max(min, Math.min(max, value[key]));
  }
  for (const key of ['enabled', 'muted', 'grid', 'meter', 'overview']) if (typeof value[key] === 'boolean') result[key] = value[key];
  return result;
}
module.exports = { defaults, normalize };

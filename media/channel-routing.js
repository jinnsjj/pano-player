export function validRouting(value, channels = value?.channels) {
  return Number.isInteger(channels) && channels >= 0 && channels <= 32 && value?.channels === channels
    && typeof value.enabled === 'boolean' && Array.isArray(value.matrix) && value.matrix.length === channels
    && Array.from(value.matrix).every(row => Array.isArray(row) && row.length === channels
      && Array.from(row).every(gain => gain === 0 || gain === 1));
}

export function createRouting(channels, preset = 'identity') {
  if (!Number.isInteger(channels) || channels < 0 || channels > 32) channels = 0;
  return { channels, enabled: true, matrix: Array.from({ length: channels }, (_, output) =>
    Array.from({ length: channels }, (_, input) => Number(output === input && preset !== 'clear'
      && (preset !== 'foa' || output < 4) && (preset !== 'hl' || output >= 4)))) };
}

export function copyRouting(value) {
  return { channels: value.channels, enabled: value.enabled, matrix: value.matrix.map(row => row.slice()) };
}

export function routingPreset(value) {
  for (const preset of ['identity', ...(value.channels === 6 ? ['foa', 'hl'] : []), 'clear']) {
    const expected = createRouting(value.channels, preset).matrix;
    if (value.matrix.every((row, out) => row.every((gain, input) => gain === expected[out][input]))) return preset;
  }
  return 'custom';
}

export function channelLabels(channels) {
  return Array.from({ length: channels }, (_, index) => String(index + 1));
}

'use strict';

function formatMediaTime(filename, playback) {
  const valid = value => Number.isFinite(value) && value >= 0;
  if (!playback || typeof playback !== 'object') throw new Error('Invalid playback time.');
  const { time, loop } = playback;
  if (time !== undefined && loop === undefined && valid(time)) return filename + '\ntime: ' + time.toFixed(3) + ' s';
  if (time === undefined && loop && valid(loop.start) && valid(loop.end) && loop.end > loop.start) {
    return filename + '\nrange: ' + loop.start.toFixed(3) + ' - ' + loop.end.toFixed(3) + ' s';
  }
  throw new Error('Invalid playback time or loop range.');
}

module.exports = { formatMediaTime };

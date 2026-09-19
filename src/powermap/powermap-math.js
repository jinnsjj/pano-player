export const FRAME_SIZE = 1024;
export const MAP_INTERVAL_SECONDS = 0.14;
export const MAP_AVERAGE = 0.666;
export const GRID_WIDTH = 140;
export const GRID_HEIGHT = 70;
export const SCAN_FREQUENCY = 9;

const ROOT_THREE = Math.sqrt(3);
const MUSIC_EPSILON = 2.23e-10;
const HANN_WINDOW = Float32Array.from(
  { length: FRAME_SIZE },
  (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (FRAME_SIZE - 1)),
);
const WINDOW_ENERGY = HANN_WINDOW.reduce(
  (total, value) => total + value * value,
  0,
);

const ICOSAHEDRON_FACES = Object.freeze([
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
]);

function assertFourEqualChannels(channels) {
  if (!Array.isArray(channels) || channels.length !== 4) {
    throw new TypeError('Expected four FOA channels (W/Y/Z/X)');
  }
  const length = channels[0]?.length;
  if (!Number.isInteger(length) || channels.some((channel) => channel?.length !== length)) {
    throw new TypeError('FOA channels must have equal length');
  }
}

export function ambixSn3dToN3d(channels) {
  assertFourEqualChannels(channels);
  return channels.map((channel, channelIndex) => {
    const converted = Float32Array.from(channel);
    if (channelIndex > 0) {
      for (let sample = 0; sample < converted.length; sample += 1) {
        converted[sample] *= ROOT_THREE;
      }
    }
    return converted;
  });
}

function normalizedIcosahedronVertices() {
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, goldenRatio, 0], [1, goldenRatio, 0], [-1, -goldenRatio, 0],
    [1, -goldenRatio, 0], [0, -1, goldenRatio], [0, 1, goldenRatio],
    [0, -1, -goldenRatio], [0, 1, -goldenRatio], [goldenRatio, 0, -1],
    [goldenRatio, 0, 1], [-goldenRatio, 0, -1], [-goldenRatio, 0, 1],
  ];
  return raw.map(([x, y, z]) => {
    const norm = Math.hypot(x, y, z);
    return [x / norm, y / norm, z / norm];
  });
}

function roundedPointKey(point) {
  return point.map((value) => Math.round(value * 1e12) / 1e12).join(',');
}

export function icosphereDirections(frequency = SCAN_FREQUENCY) {
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new RangeError('Icosphere frequency must be a positive integer');
  }
  const vertices = normalizedIcosahedronVertices();
  const uniquePoints = new Map();

  for (const [aIndex, bIndex, cIndex] of ICOSAHEDRON_FACES) {
    const a = vertices[aIndex];
    const b = vertices[bIndex];
    const c = vertices[cIndex];
    for (let i = 0; i <= frequency; i += 1) {
      for (let j = 0; j <= frequency - i; j += 1) {
        const k = frequency - i - j;
        const point = [
          (i * a[0] + j * b[0] + k * c[0]) / frequency,
          (i * a[1] + j * b[1] + k * c[1]) / frequency,
          (i * a[2] + j * b[2] + k * c[2]) / frequency,
        ];
        const norm = Math.hypot(...point);
        const normalized = point.map((value) => value / norm);
        uniquePoints.set(roundedPointKey(normalized), normalized);
      }
    }
  }

  const directions = [...uniquePoints.values()].map(([x, y, z]) => {
    let azimuth = Math.atan2(y, x) * 180 / Math.PI;
    azimuth = ((azimuth + 180) % 360 + 360) % 360 - 180;
    const elevation = Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI;
    return [azimuth, elevation];
  });
  directions.sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  return Float32Array.from(directions.flat());
}

export function firstOrderSteering(directions) {
  if (!(directions instanceof Float32Array || directions instanceof Float64Array)
      || directions.length % 2 !== 0) {
    throw new TypeError('Directions must be a flat azimuth/elevation array');
  }
  const steering = new Float64Array((directions.length / 2) * 4);
  for (let index = 0; index < directions.length / 2; index += 1) {
    const azimuth = directions[index * 2] * Math.PI / 180;
    const elevation = directions[index * 2 + 1] * Math.PI / 180;
    const offset = index * 4;
    steering[offset] = 1;
    steering[offset + 1] = ROOT_THREE * Math.cos(elevation) * Math.sin(azimuth);
    steering[offset + 2] = ROOT_THREE * Math.sin(elevation);
    steering[offset + 3] = ROOT_THREE * Math.cos(elevation) * Math.cos(azimuth);
  }
  return steering;
}

function directionsToCartesian(directions) {
  const cartesian = new Float64Array((directions.length / 2) * 3);
  for (let index = 0; index < directions.length / 2; index += 1) {
    const azimuth = directions[index * 2] * Math.PI / 180;
    const elevation = directions[index * 2 + 1] * Math.PI / 180;
    const cosine = Math.cos(elevation);
    cartesian[index * 3] = cosine * Math.cos(azimuth);
    cartesian[index * 3 + 1] = cosine * Math.sin(azimuth);
    cartesian[index * 3 + 2] = Math.sin(elevation);
  }
  return cartesian;
}

function equirectangularGrid(width = GRID_WIDTH, height = GRID_HEIGHT) {
  const directions = new Float32Array(width * height * 2);
  let offset = 0;
  for (let row = 0; row < height; row += 1) {
    const elevation = -90 + row * (180 / height);
    for (let column = 0; column < width; column += 1) {
      directions[offset] = -180 + column * (360 / width);
      directions[offset + 1] = elevation;
      offset += 2;
    }
  }
  return directions;
}

function interpolationLookup(scanDirections, gridDirections) {
  const scan = directionsToCartesian(scanDirections);
  const grid = directionsToCartesian(gridDirections);
  const gridSize = gridDirections.length / 2;
  const scanSize = scanDirections.length / 2;
  const indices = new Int32Array(gridSize * 3);
  const weights = new Float32Array(gridSize * 3);

  for (let gridIndex = 0; gridIndex < gridSize; gridIndex += 1) {
    const gx = grid[gridIndex * 3];
    const gy = grid[gridIndex * 3 + 1];
    const gz = grid[gridIndex * 3 + 2];
    const bestCosines = [-Infinity, -Infinity, -Infinity];
    const bestIndices = [-1, -1, -1];

    for (let scanIndex = 0; scanIndex < scanSize; scanIndex += 1) {
      const cosine = gx * scan[scanIndex * 3]
        + gy * scan[scanIndex * 3 + 1]
        + gz * scan[scanIndex * 3 + 2];
      for (let rank = 0; rank < 3; rank += 1) {
        if (cosine > bestCosines[rank]) {
          for (let shift = 2; shift > rank; shift -= 1) {
            bestCosines[shift] = bestCosines[shift - 1];
            bestIndices[shift] = bestIndices[shift - 1];
          }
          bestCosines[rank] = cosine;
          bestIndices[rank] = scanIndex;
          break;
        }
      }
    }

    const distances = bestCosines.map((cosine) => (
      Math.acos(Math.max(-1, Math.min(1, cosine)))
    ));
    const exactRank = distances.findIndex((distance) => distance <= 1e-8);
    const rawWeights = exactRank >= 0
      ? distances.map((_, rank) => Number(rank === exactRank))
      : distances.map((distance) => 1 / Math.max(distance, 1e-9));
    const totalWeight = rawWeights[0] + rawWeights[1] + rawWeights[2];

    for (let rank = 0; rank < 3; rank += 1) {
      const lookupOffset = gridIndex * 3 + rank;
      indices[lookupOffset] = bestIndices[rank];
      weights[lookupOffset] = rawWeights[rank] / totalWeight;
    }
  }
  return { indices, weights };
}

export function createPowermapGeometry() {
  const scanDirections = icosphereDirections();
  const gridDirections = equirectangularGrid();
  const steering = firstOrderSteering(scanDirections);
  const { indices, weights } = interpolationLookup(scanDirections, gridDirections);
  return {
    scanDirections,
    gridDirections,
    steering,
    interpolationIndices: indices,
    interpolationWeights: weights,
  };
}

export function jacobiEigenSymmetric4(matrix) {
  if (!(matrix instanceof Float32Array || matrix instanceof Float64Array)
      || matrix.length !== 16) {
    throw new TypeError('Expected a flat symmetric 4x4 matrix');
  }
  const valuesMatrix = Float64Array.from(matrix);
  const vectors = new Float64Array(16);
  for (let index = 0; index < 4; index += 1) {
    vectors[index * 4 + index] = 1;
  }

  for (let iteration = 0; iteration < 64; iteration += 1) {
    let p = 0;
    let q = 1;
    let maximum = 0;
    for (let row = 0; row < 4; row += 1) {
      for (let column = row + 1; column < 4; column += 1) {
        const magnitude = Math.abs(valuesMatrix[row * 4 + column]);
        if (magnitude > maximum) {
          maximum = magnitude;
          p = row;
          q = column;
        }
      }
    }
    if (maximum <= 1e-14) {
      break;
    }

    const app = valuesMatrix[p * 4 + p];
    const aqq = valuesMatrix[q * 4 + q];
    const apq = valuesMatrix[p * 4 + q];
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let index = 0; index < 4; index += 1) {
      if (index === p || index === q) continue;
      const aip = valuesMatrix[index * 4 + p];
      const aiq = valuesMatrix[index * 4 + q];
      const nextP = cosine * aip - sine * aiq;
      const nextQ = sine * aip + cosine * aiq;
      valuesMatrix[index * 4 + p] = nextP;
      valuesMatrix[p * 4 + index] = nextP;
      valuesMatrix[index * 4 + q] = nextQ;
      valuesMatrix[q * 4 + index] = nextQ;
    }
    valuesMatrix[p * 4 + p] = cosine ** 2 * app
      - 2 * sine * cosine * apq
      + sine ** 2 * aqq;
    valuesMatrix[q * 4 + q] = sine ** 2 * app
      + 2 * sine * cosine * apq
      + cosine ** 2 * aqq;
    valuesMatrix[p * 4 + q] = 0;
    valuesMatrix[q * 4 + p] = 0;

    for (let row = 0; row < 4; row += 1) {
      const vip = vectors[row * 4 + p];
      const viq = vectors[row * 4 + q];
      vectors[row * 4 + p] = cosine * vip - sine * viq;
      vectors[row * 4 + q] = sine * vip + cosine * viq;
    }
  }

  const order = [0, 1, 2, 3].sort(
    (left, right) => valuesMatrix[left * 4 + left] - valuesMatrix[right * 4 + right],
  );
  const values = new Float64Array(4);
  const sortedVectors = new Float64Array(16);
  for (let column = 0; column < 4; column += 1) {
    const sourceColumn = order[column];
    values[column] = valuesMatrix[sourceColumn * 4 + sourceColumn];
    for (let row = 0; row < 4; row += 1) {
      sortedVectors[row * 4 + column] = vectors[row * 4 + sourceColumn];
    }
  }
  return { values, vectors: sortedVectors };
}

export function normalizeMap(values) {
  if (!(values instanceof Float32Array || values instanceof Float64Array)) {
    throw new TypeError('Power map must be a typed array');
  }
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new TypeError('Power map values must be finite');
    }
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const normalized = new Float32Array(values.length);
  const range = maximum - minimum;
  if (range <= 1e-12) {
    return normalized;
  }
  for (let index = 0; index < values.length; index += 1) {
    normalized[index] = (values[index] - minimum) / range;
  }
  return normalized;
}

export function validatePowermapOptions({
  mapAverage = MAP_AVERAGE,
  numSources = 1,
} = {}) {
  if (numSources !== 1 && numSources !== 2) {
    throw new RangeError('First-order MUSIC supports one or two sources');
  }
  if (!Number.isFinite(mapAverage) || mapAverage < 0 || mapAverage >= 1) {
    throw new RangeError('PowerMap average must be in [0, 1)');
  }
  return { mapAverage, numSources };
}

export function analyzeFoaWindow({
  channels,
  sampleRate,
  time,
  geometry,
  mapAverage = MAP_AVERAGE,
  numSources = 1,
  previousSpectrum = null,
}) {
  assertFourEqualChannels(channels);
  const options = validatePowermapOptions({ mapAverage, numSources });
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be positive');
  }
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError('time must be non-negative');
  }
  const {
    steering,
    interpolationIndices,
    interpolationWeights,
  } = geometry ?? {};
  if (!(steering instanceof Float64Array)
      || !(interpolationIndices instanceof Int32Array)
      || !(interpolationWeights instanceof Float32Array)) {
    throw new TypeError('A prepared PowerMap geometry is required');
  }
  const scanSize = steering.length / 4;
  if (previousSpectrum !== null && previousSpectrum.length !== scanSize) {
    throw new TypeError('Previous spectrum does not match the scan geometry');
  }

  const covariance = new Float64Array(16);
  const start = Math.round(time * sampleRate);
  for (let frameIndex = 0; frameIndex < FRAME_SIZE; frameIndex += 1) {
    const sourceIndex = start + frameIndex;
    const windowValue = HANN_WINDOW[frameIndex];
    const sample = [
      (channels[0][sourceIndex] ?? 0) * windowValue,
      (channels[1][sourceIndex] ?? 0) * ROOT_THREE * windowValue,
      (channels[2][sourceIndex] ?? 0) * ROOT_THREE * windowValue,
      (channels[3][sourceIndex] ?? 0) * ROOT_THREE * windowValue,
    ];
    for (let row = 0; row < 4; row += 1) {
      for (let column = row; column < 4; column += 1) {
        covariance[row * 4 + column] += sample[row] * sample[column];
      }
    }
  }
  for (let row = 0; row < 4; row += 1) {
    for (let column = row; column < 4; column += 1) {
      const normalized = covariance[row * 4 + column] / WINDOW_ENERGY;
      covariance[row * 4 + column] = normalized;
      covariance[column * 4 + row] = normalized;
    }
  }

  const rawSpectrum = new Float64Array(scanSize);
  const trace = covariance[0] + covariance[5] + covariance[10] + covariance[15];
  if (trace > 1e-12) {
    const { vectors } = jacobiEigenSymmetric4(covariance);
    for (let scanIndex = 0; scanIndex < scanSize; scanIndex += 1) {
      let denominator = 0;
      for (
        let noiseColumn = 0;
        noiseColumn < 4 - options.numSources;
        noiseColumn += 1
      ) {
        let projection = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          projection += vectors[channel * 4 + noiseColumn]
            * steering[scanIndex * 4 + channel];
        }
        denominator += projection * projection;
      }
      rawSpectrum[scanIndex] = 1 / (denominator + MUSIC_EPSILON);
    }
  }

  const spectrum = new Float64Array(scanSize);
  for (let index = 0; index < scanSize; index += 1) {
    spectrum[index] = (1 - options.mapAverage) * rawSpectrum[index]
      + options.mapAverage * (previousSpectrum?.[index] ?? 0);
  }
  const interpolated = new Float64Array(interpolationIndices.length / 3);
  for (let gridIndex = 0; gridIndex < interpolated.length; gridIndex += 1) {
    const offset = gridIndex * 3;
    interpolated[gridIndex] = spectrum[interpolationIndices[offset]]
      * interpolationWeights[offset]
      + spectrum[interpolationIndices[offset + 1]]
      * interpolationWeights[offset + 1]
      + spectrum[interpolationIndices[offset + 2]]
      * interpolationWeights[offset + 2];
  }
  return {
    map: normalizeMap(interpolated),
    spectrum,
  };
}

import {
  analyzeFoaWindow,
  createPowermapGeometry,
} from './powermap-math.js';

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new TypeError('A non-empty sessionId is required');
  }
}

function assertChannels(channels) {
  if (!Array.isArray(channels) || channels.length !== 4) {
    throw new TypeError('Expected four FOA channels (W/Y/Z/X)');
  }
  const length = channels[0]?.length;
  if (!Number.isInteger(length) || channels.some(
    (channel) => !(channel instanceof Float32Array) || channel.length !== length,
  )) {
    throw new TypeError('FOA channels must be equal-length Float32Array values');
  }
}

export function createWorkerState({ geometry = null } = {}) {
  return {
    geometry: geometry ?? createPowermapGeometry(),
    sessions: new Map(),
  };
}

export function registerSession(state, { sessionId }) {
  assertSessionId(sessionId);
  state.sessions.set(sessionId, {
    pending: null,
    previousSpectrum: null,
  });
}

export function queueAnalysis(state, message) {
  assertSessionId(message.sessionId);
  const session = state.sessions.get(message.sessionId);
  if (!session) {
    throw new Error(`Unknown PowerMap session: ${message.sessionId}`);
  }
  assertChannels(message.channels);
  if (!Number.isFinite(message.sampleRate) || message.sampleRate <= 0) {
    throw new RangeError('sampleRate must be positive');
  }
  const replacedRequestId = session.pending?.requestId ?? null;
  session.pending = {
    channels: message.channels,
    sampleRate: message.sampleRate,
    sessionId: message.sessionId,
    requestId: message.requestId,
    time: message.time,
    reset: Boolean(message.reset),
    numSources: message.numSources,
    mapAverage: message.mapAverage,
  };
  return replacedRequestId;
}

export function resetSession(state, sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return false;
  session.previousSpectrum = null;
  return true;
}

export function releaseSession(state, sessionId) {
  return state.sessions.delete(sessionId);
}

export function processPendingAnalysis(state, sessionId) {
  const session = state.sessions.get(sessionId);
  const request = session?.pending;
  if (!session || !request) return null;
  session.pending = null;
  if (request.reset) session.previousSpectrum = null;
  const result = analyzeFoaWindow({
    channels: request.channels,
    geometry: state.geometry,
    previousSpectrum: session.previousSpectrum,
    sampleRate: request.sampleRate,
    // AudioWorklet already supplies one complete analysis frame.
    time: 0,
    numSources: request.numSources,
    mapAverage: request.mapAverage,
  });
  session.previousSpectrum = result.spectrum;
  return {
    type: 'map',
    sessionId,
    requestId: request.requestId,
    time: request.time,
    map: result.map,
  };
}

const workerScope = typeof self !== 'undefined'
  && typeof WorkerGlobalScope !== 'undefined'
  && self instanceof WorkerGlobalScope
  ? self
  : null;

if (workerScope) {
  const state = createWorkerState();
  let drainScheduled = false;

  const postFailure = (message, error) => {
    workerScope.postMessage({
      type: 'error',
      sessionId: message.sessionId ?? null,
      requestId: message.requestId ?? null,
      message: error instanceof Error ? error.message : String(error),
    });
  };

  const drain = () => {
    drainScheduled = false;
    for (const sessionId of state.sessions.keys()) {
      const requestId = state.sessions.get(sessionId)?.pending?.requestId ?? null;
      try {
        const response = processPendingAnalysis(state, sessionId);
        if (response) {
          workerScope.postMessage(response, [response.map.buffer]);
        }
      } catch (error) {
        postFailure({ sessionId, requestId }, error);
      }
    }
    if ([...state.sessions.values()].some((session) => session.pending)) {
      drainScheduled = true;
      setTimeout(drain, 0);
    }
  };

  const scheduleDrain = () => {
    if (drainScheduled) return;
    drainScheduled = true;
    setTimeout(drain, 0);
  };

  workerScope.addEventListener('message', ({ data }) => {
    try {
      switch (data?.type) {
        case 'register':
          registerSession(state, data);
          break;
        case 'analyze':
          queueAnalysis(state, data);
          scheduleDrain();
          break;
        case 'reset':
          resetSession(state, data.sessionId);
          break;
        case 'release':
          releaseSession(state, data.sessionId);
          break;
        default:
          throw new Error(`Unknown PowerMap worker message: ${data?.type}`);
      }
    } catch (error) {
      postFailure(data ?? {}, error);
    }
  });
}

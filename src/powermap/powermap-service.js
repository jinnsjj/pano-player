function validateFrame(channels, sampleRate) {
  if (!Array.isArray(channels) || channels.length !== 4) {
    throw new TypeError('Expected four captured FOA channels');
  }
  const length = channels[0]?.length;
  if (!Number.isInteger(length) || channels.some(
    (channel) => !(channel instanceof Float32Array) || channel.length !== length,
  )) {
    throw new TypeError('Captured FOA channels must be equal-length Float32Array values');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('sampleRate must be positive');
  }
}

export class PowermapService {
  constructor({
    workerFactory = (url) => new Worker(url, { type: 'module' }),
    workerUrl = new URL('./powermap-worker.js', import.meta.url),
  } = {}) {
    this.worker = workerFactory(workerUrl);
    this.sessions = new Map();
    this.nextRequestId = 1;
    this.disposed = false;
    this.worker.addEventListener('message', (event) => this.handleMessage(event.data));
    this.worker.addEventListener('error', (event) => this.handleWorkerError(event));
  }

  register({ sessionId }) {
    this.assertActive();
    this.release(sessionId);
    this.sessions.set(sessionId, { inFlight: null, pending: null });
    this.worker.postMessage({
      type: 'register',
      sessionId,
    });
  }

  requestMap(sessionId, time, {
    channels,
    algorithm,
    mapAverage,
    numSources,
    reset = false,
    sampleRate,
  } = {}) {
    this.assertActive();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.reject(new Error(`PowerMap session is not registered: ${sessionId}`));
    }
    validateFrame(channels, sampleRate);
    return new Promise((resolve, reject) => {
      const request = {
        channels,
        algorithm,
        requestId: this.nextRequestId,
        mapAverage,
        numSources,
        reset,
        sampleRate,
        time,
        resolve,
        reject,
      };
      this.nextRequestId += 1;
      if (session.pending) session.pending.resolve(null);
      session.pending = request;
      this.dispatchPending(sessionId);
    });
  }

  reset(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || this.disposed) return;
    session.pending?.resolve(null);
    session.pending = null;
    session.needsReset = true;
    this.worker.postMessage({ type: 'reset', sessionId });
  }

  release(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pending?.resolve(null);
    session.inFlight?.resolve(null);
    this.sessions.delete(sessionId);
    if (!this.disposed) this.worker.postMessage({ type: 'release', sessionId });
  }

  dispose() {
    if (this.disposed) return;
    for (const sessionId of [...this.sessions.keys()]) this.release(sessionId);
    this.disposed = true;
    this.worker.terminate();
  }

  dispatchPending(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.inFlight || !session.pending) return;
    const request = session.pending;
    session.pending = null;
    session.inFlight = request;
    this.worker.postMessage({
      type: 'analyze',
      channels: request.channels,
      algorithm: request.algorithm,
      sessionId,
      requestId: request.requestId,
      sampleRate: request.sampleRate,
      time: request.time,
      mapAverage: request.mapAverage,
      numSources: request.numSources,
      reset: request.reset || Boolean(session.needsReset),
    }, request.channels.map((channel) => channel.buffer));
    session.needsReset = false;
  }

  handleMessage(message) {
    const session = this.sessions.get(message?.sessionId);
    if (!session) return;
    const request = session.inFlight;
    if (!request || request.requestId !== message.requestId) return;
    session.inFlight = null;
    if (message.type === 'map') {
      request.resolve({ map: message.map, time: message.time });
    } else {
      request.reject(new Error(message.message || 'PowerMap analysis failed'));
    }
    this.dispatchPending(message.sessionId);
  }

  handleWorkerError(event) {
    const error = new Error(event?.message || 'PowerMap worker failed');
    for (const session of this.sessions.values()) {
      session.pending?.reject(error);
      session.inFlight?.reject(error);
      session.pending = null;
      session.inFlight = null;
    }
  }

  assertActive() {
    if (this.disposed) throw new Error('PowerMap service has been disposed');
  }
}

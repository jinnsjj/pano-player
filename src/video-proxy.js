let sequence = 0;
const timeoutMs = 30000;
const streamIdPattern = /^[a-f0-9]{32}$/;

export async function fetchVideoStream(api, time, config, signal) {
  if (signal?.aborted) throw new DOMException('Video stream cancelled.', 'AbortError');
  const width = config?.codedWidth, height = config?.codedHeight;
  if (!Number.isFinite(time) || time < 0 ||
    ![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65536)) {
    throw new Error('Invalid video stream request.');
  }
  const session = crypto.randomUUID();
  let streamId, pending, controller, closed = false;
  const cleanup = error => {
    if (closed) return;
    closed = true;
    window.removeEventListener('message', receive);
    signal?.removeEventListener('abort', cancel);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error || new DOMException('Video stream closed.', 'AbortError'));
      pending = undefined;
    }
    if (error) controller?.error(error);
    try { api.postMessage({ type: 'close-video-stream', session, ...(streamId ? { streamId } : {}) }); }
    catch { /* The host can already be gone during webview disposal. */ }
  };
  const cancel = () => cleanup(new DOMException('Video stream cancelled.', 'AbortError'));
  const receive = ({ data }) => {
    if (!pending || data?.type !== 'video-stream' || data.session !== session || data.id !== pending.id) return;
    const request = pending; pending = undefined; clearTimeout(request.timer);
    if (data.error !== undefined) {
      request.reject(new Error(typeof data.error === 'string' && data.error.length > 0 && data.error.length <= 2000
        ? data.error : 'Invalid video stream response.'));
    } else request.resolve(data);
  };
  const request = data => new Promise((resolve, reject) => {
    if (closed) { reject(new DOMException('Video stream closed.', 'AbortError')); return; }
    if (pending || !Number.isSafeInteger(sequence + 1)) { reject(new Error('Invalid video stream request.')); return; }
    const id = ++sequence;
    pending = { id, resolve, reject,
      timer: setTimeout(() => cleanup(new Error('Video stream request timed out.')), timeoutMs) };
    try { api.postMessage({ ...data, session, id }); }
    catch (error) { cleanup(error); }
  });
  window.addEventListener('message', receive);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const opened = await request({ type: 'open-video-stream', time, width, height });
    if (closed) throw new DOMException('Video stream cancelled.', 'AbortError');
    if (typeof opened.streamId !== 'string' || !streamIdPattern.test(opened.streamId)) throw new Error('Invalid video stream response.');
    streamId = opened.streamId;
    if (typeof opened.backend !== 'string' || opened.backend.length < 1 || opened.backend.length > 80 ||
      /[\x00-\x1f\x7f]/.test(opened.backend) ||
      (opened.timeOrigin !== undefined && !Number.isFinite(opened.timeOrigin))) throw new Error('Invalid video stream response.');
    const headers = { 'Content-Type': 'video/mp4', 'X-Pano-Backend': opened.backend };
    if (opened.timeOrigin !== undefined) headers['X-Pano-Time-Origin'] = String(opened.timeOrigin);
    return new Response(new ReadableStream({
      start(value) { controller = value; },
      async pull(value) {
        if (closed) return;
        try {
          const chunk = await request({ type: 'read-video-stream', streamId });
          if (closed) return;
          if (chunk.streamId !== streamId || (chunk.eof !== undefined && typeof chunk.eof !== 'boolean') ||
            (chunk.data !== undefined && (!(chunk.data instanceof ArrayBuffer) || chunk.data.byteLength > 262144)) ||
            (!chunk.eof && !chunk.data?.byteLength)) throw new Error('Invalid video stream response.');
          if (chunk.data?.byteLength) value.enqueue(new Uint8Array(chunk.data));
          if (chunk.eof) { value.close(); cleanup(); }
        } catch (error) { cleanup(error); }
      },
      cancel() { cancel(); },
    }, { highWaterMark: 0 }), { status: 200, headers });
  } catch (error) { cleanup(error); throw error; }
}

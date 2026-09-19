export function createHostFetch(api, source, signal) {
  let id = 0;
  const pending = new Map();
  window.addEventListener('message', ({ data }) => {
    if (data?.type !== 'media-range') return;
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data);
  }, { signal });
  signal.addEventListener('abort', () => {
    for (const request of pending.values()) request.reject(new DOMException('Media closed.', 'AbortError'));
    pending.clear();
  }, { once: true });
  const read = offset => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Media closed.', 'AbortError')); return; }
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    api.postMessage({ type: 'read-media', id: requestId, offset, length: 262144 });
  });
  return async (url, init = {}) => {
    if (String(url) !== source) return fetch(url, init);
    const range = /^bytes=(\d+)-$/.exec(new Headers(init.headers).get('range') || 'bytes=0-');
    if (!range) throw new Error('Unsupported media range.');
    const start = Number(range[1]);
    let position = start, chunk = await read(start), stopped = false;
    const size = chunk.size;
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          if (stopped || init.signal?.aborted) { controller.close(); return; }
          chunk ??= await read(position);
          if (stopped) return;
          const bytes = new Uint8Array(chunk.data);
          if (!bytes.length && position < size) throw new Error('Media file was truncated during playback.');
          position += bytes.length; chunk = undefined; controller.enqueue(bytes);
          if (position >= size) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; },
    }, { highWaterMark: 0 }), { status: 206,
      headers: { 'Content-Range': `bytes ${start}-${size - 1}/${size}`, 'Content-Length': String(size - start) } });
  };
}

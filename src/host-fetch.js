let id = 0;
// Start small so header probes stay cheap, then ramp up for sequential playback.
const firstChunk = 262144, maxChunk = 1048576;
export function createHostFetch(api, source, signal) {
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
  const read = (offset, length, sourceId) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Media closed.', 'AbortError')); return; }
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    api.postMessage({ type: 'read-media', id: requestId, sourceId, offset, length });
  });
  return async (url, init = {}) => {
    const sourceId = api.mediaSourceId?.(String(url)) ?? (String(url) === source ? 'primary' : undefined);
    if (sourceId === undefined) return fetch(url, init);
    const range = /^bytes=(\d+)-$/.exec(new Headers(init.headers).get('range') || 'bytes=0-');
    if (!range) throw new Error('Unsupported media range.');
    const start = Number(range[1]);
    let next = start, length = firstChunk, size = Infinity, stopped = false;
    const request = () => {
      const block = { offset: next, length: Math.min(length, size - next) };
      next += block.length; length = Math.min(maxChunk, length * 2);
      block.reply = read(block.offset, block.length, sourceId);
      // A prefetched block may settle after cancellation; nobody awaits it then.
      block.reply.catch(() => {});
      return block;
    };
    const queue = [request()];
    const first = await queue[0].reply;
    size = first.size;
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          if (stopped || init.signal?.aborted) { controller.close(); return; }
          const block = queue.shift() ?? request();
          // Keep exactly one block in flight while the consumer processes this one.
          if (!queue.length && next < size) queue.push(request());
          const chunk = await block.reply;
          if (stopped) return;
          const bytes = new Uint8Array(chunk.data);
          if (bytes.length !== Math.min(block.length, size - block.offset)) throw new Error('Media file was truncated during playback.');
          controller.enqueue(bytes);
          if (block.offset + bytes.length >= size) controller.close();
        } catch (error) { if (!stopped) controller.error(error); }
      },
      cancel() { stopped = true; queue.length = 0; },
    }, { highWaterMark: 0 }), { status: 206,
      headers: { 'Content-Range': `bytes ${start}-${size - 1}/${size}`, 'Content-Length': String(size - start) } });
  };
}

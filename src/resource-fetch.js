// Fetch in the webview window: VS Code's resource service worker cannot serve worker clients.
export async function serveResource(port, url, init, signal, fetchResource = fetch) {
  let reader;
  const abort = new AbortController();
  const cancel = () => { abort.abort(); void reader?.cancel().catch(() => {}); port.close(); };
  signal?.addEventListener('abort', cancel, { once: true });
  const close = () => { signal?.removeEventListener('abort', cancel); port.close(); };
  port.onmessage = async ({ data }) => {
    if (data === 'cancel') { cancel(); close(); return; }
    try {
      const { done, value } = await reader.read();
      port.postMessage({ done, value }, value ? [value.buffer] : []);
      if (done) close();
    } catch (error) { port.postMessage({ error: error.message }); close(); }
  };
  try {
    const response = await fetchResource(url, { ...init, signal: abort.signal });
    reader = response.body?.getReader();
    port.postMessage({ status: response.status, statusText: response.statusText,
      headers: [...response.headers], body: !!reader });
    if (!reader) close();
  } catch (error) { port.postMessage({ error: error.message }); close(); }
}

export function resourceFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const { port1: port, port2 } = new MessageChannel();
    let controller;
    const close = () => { init.signal?.removeEventListener('abort', cancel); port.close(); };
    const cancel = () => {
      const error = new DOMException('Resource read aborted.', 'AbortError');
      port.postMessage('cancel'); controller?.error(error); reject(error); close();
    };
    if (init.signal?.aborted) { cancel(); return; }
    init.signal?.addEventListener('abort', cancel, { once: true });
    port.onmessage = ({ data }) => {
      if (data.error) { const error = new Error(data.error); controller?.error(error); reject(error); close(); }
      else if (data.status) {
        const body = data.body ? new ReadableStream({
          start(value) { controller = value; },
          pull() { port.postMessage('read'); },
          cancel() { port.postMessage('cancel'); close(); },
        }, { highWaterMark: 0 }) : null;
        resolve(new Response(body, data));
        if (!body) close();
      } else if (data.done) { controller.close(); close(); }
      else controller.enqueue(data.value);
    };
    postMessage({ type: 'fetch', url: String(url), init: { method: init.method,
      headers: [...new Headers(init.headers)] }, port: port2 }, [port2]);
  });
}

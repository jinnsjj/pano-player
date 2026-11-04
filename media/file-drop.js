import { parseDropResources } from './drop-resources.js';

function resourceName(resource) {
  if (resource.path) return resource.path.split(/[\\/]/).pop();
  return decodeURIComponent(new URL(resource.uri).pathname.split('/').pop());
}

export function attachFileDrop(target, { openFiles, postMessage, onError, timeoutMs = 30000 }) {
  const events = new AbortController(), pending = new Map();
  const session = crypto.randomUUID();
  let nextId = 0, disposed = false;
  const requestFile = (type, resource) => new Promise((resolve, reject) => {
    if (disposed) { reject(new Error('Media closed.')); return; }
    const id = ++nextId;
    const selecting = type === 'select-json-file';
    const timer = selecting ? undefined : setTimeout(() => {
      pending.delete(id); reject(new Error('Reading the dropped annotation timed out.'));
    }, timeoutMs);
    timer?.unref?.();
    pending.set(id, { resolve, reject, timer, responseType: selecting ? 'selected-json' : 'dropped-json' });
    try { postMessage({ type, session, id, ...(resource ? { resource } : {}) }); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
  target.addEventListener('message', ({ data }) => {
    if (data?.session !== session) return;
    const request = pending.get(data.id);
    if (!request || data.type !== request.responseType) return;
    pending.delete(data.id); clearTimeout(request.timer);
    if (data.error) { request.reject(new Error(data.error)); return; }
    if (data.type === 'selected-json' && data.file === null) { request.resolve(null); return; }
    try {
      if (typeof data.file?.name !== 'string' || typeof data.file.text !== 'string') throw new Error('Invalid dropped annotation response.');
      request.resolve(new File([data.file.text], data.file.name, { type: 'application/json' }));
    } catch (error) { request.reject(error); }
  }, { signal: events.signal });
  target.addEventListener('dragover', event => event.preventDefault(), { signal: events.signal });
  target.addEventListener('drop', event => {
    event.preventDefault();
    if (disposed || !event.dataTransfer) return;
    try {
      const files = Array.from(event.dataTransfer.files || []);
      const resources = parseDropResources(event.dataTransfer);
      // VS Code's standard URI list can omit all but the first selected resource.
      if (files.length && (!resources || resources.length <= files.length)) { openFiles(files); return; }
      if (!resources?.length) return;
      if (!postMessage) throw new Error('URI-only file drops require VS Code.');
      openFiles(resources.map(resource => ({ kind: 'file', name: resourceName(resource), getFile: () => requestFile('read-dropped-json', resource) })));
    } catch (error) { onError(error?.message || String(error)); }
  }, { signal: events.signal });
  return {
    selectJsonFile: postMessage ? () => requestFile('select-json-file') : undefined,
    dispose() {
      disposed = true; events.abort();
      for (const request of pending.values()) {
        clearTimeout(request.timer); request.reject(new Error('Media closed.'));
      }
      pending.clear();
    },
  };
}

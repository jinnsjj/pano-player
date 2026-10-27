const modules = new WeakMap();

export function loadWorklet(context, source) {
  let cache = modules.get(context);
  if (!cache) { cache = new Map(); modules.set(context, cache); }
  if (!cache.has(source)) {
    const pending = (async () => {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Cannot load audio worklet (${response.status}).`);
      const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    })().catch(error => { cache.delete(source); throw error; });
    cache.set(source, pending);
  }
  return cache.get(source);
}

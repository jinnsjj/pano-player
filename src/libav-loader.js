const variants = new Map();

export function loadLibav(url) {
  if (!variants.has(url)) {
    const loading = (async () => {
      // VS Code's resource service worker serves fetches from the window, not importScripts.
      for (const source of [url, url.replace(/\.js$/, '.wasm.js')]) {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Cannot load bundled FFmpeg decoder (${response.status}).`);
        const blob = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
        try { importScripts(blob); } finally { URL.revokeObjectURL(blob); }
      }
      const wrapper = globalThis.LibAV, factory = globalThis.LibAVFactory;
      const wasmurl = url.replace(/\.js$/, '.wasm.wasm');
      const response = await fetch(wasmurl);
      if (!response.ok) throw new Error(`Cannot load bundled FFmpeg decoder (${response.status}).`);
      const wasmBinary = new Uint8Array(await response.arrayBuffer());
      // The libav.js frontend forwards only known options; inject cached bytes at its factory boundary.
      return { wrapper, wasmurl, factory: settings => factory({ ...settings, wasmBinary }) };
    })().catch(error => { variants.delete(url); throw error; });
    variants.set(url, loading);
  }
  return variants.get(url);
}

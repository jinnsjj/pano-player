import { pluginApiVersion } from './plugin-package.js';
import { OverlayLayer } from './overlay-layer.js';
import { attachOverlayDisclosure } from './overlay-controls.js';

export class PlayerPlugins {
  constructor({ getState, getView, stage, panels, overlays, projectionUrl, icons, onError,
    load = url => import(url) }) {
    Object.assign(this, { getState, getView, stage, panels, overlays, projectionUrl, icons, onError, load });
    this.entries = new Map();
  }
  sync(descriptors = []) {
    if (this.disposed) return;
    const wanted = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]));
    for (const [id, entry] of this.entries) {
      if (JSON.stringify(wanted.get(id)) !== entry.key) { this.remove(id); }
    }
    for (const descriptor of wanted.values()) if (!this.entries.has(descriptor.id)) void this.start(descriptor);
  }
  async start(descriptor) {
    const entry = { descriptor, key: JSON.stringify(descriptor), state: 'loading', callbacks: new Set(), resources: [], layers: [] };
    this.entries.set(descriptor.id, entry);
    const alive = () => !entry.disposed && !this.disposed && entry.state !== 'error';
    const own = resource => { if (!alive()) { resource.dispose(); throw new Error('Plugin session closed.'); } entry.resources.push(resource); return resource; };
    const fail = error => {
      if (!alive()) return;
      entry.state = 'error'; entry.error = error.message || String(error);
      this.cleanup(entry); this.onError(`${descriptor.name || descriptor.id}: ${entry.error}`);
    };
    try {
      if (descriptor.apiVersion !== pluginApiVersion) throw new Error('Incompatible plugin API. Supported API: 1.');
      if (descriptor.css || descriptor.style) {
        const link = document.createElement('link'); link.rel = 'stylesheet';
        let styleUrl;
        if (descriptor.css) { styleUrl = URL.createObjectURL(new Blob([descriptor.css], { type: 'text/css' })); link.href = styleUrl; }
        else link.href = descriptor.style;
        document.head.append(link);
        own({ dispose() { link.remove(); if (styleUrl) URL.revokeObjectURL(styleUrl); } });
      }
      const api = Object.freeze({
        apiVersion: pluginApiVersion,
        getState: () => Object.freeze(this.getState()),
        refreshIcons: () => this.icons(),
        onFrame(callback) {
          if (typeof callback !== 'function') throw new Error('onFrame requires a function.');
          entry.callbacks.add(callback); return own({ dispose() { entry.callbacks.delete(callback); } });
        },
        createPanel: ({ title, icon = 'layers', placement = 'settings', toggle }) => {
          if (typeof title !== 'string' || !title.trim() || !/^[a-z0-9-]+$/.test(icon)) throw new Error('Invalid panel title or icon.');
          if (!['settings', 'overlay'].includes(placement)) throw new Error('Invalid panel placement.');
          if (toggle !== undefined && (placement !== 'overlay' || toggle?.type !== 'checkbox')) throw new Error('Overlay toggle must be a checkbox input.');
          if (placement === 'overlay') {
            if (!this.overlays) throw new Error('Overlay controls are unavailable.');
            const group = document.createElement('div'); group.className = 'overlay-control';
            group.setAttribute('role', 'group'); group.setAttribute('aria-label', title + ' overlay');
            if (toggle) {
              const label = document.createElement('label'); label.className = 'toggle';
              const text = document.createElement('span'); text.textContent = title;
              label.append(toggle, text); group.append(label);
            }
            const button = document.createElement('button'); button.className = 'overlay-module-toggle' + (toggle ? ' overlay-arrow' : '');
            button.id = `plugin-toggle-${descriptor.id}-${entry.resources.length}`;
            button.textContent = toggle ? '' : title; button.title = title + ' settings';
            if (toggle) button.setAttribute('aria-label', button.title);
            const glyph = document.createElement('i'); glyph.dataset.lucide = 'chevron-down'; glyph.setAttribute('aria-hidden', 'true'); button.append(glyph);
            const body = document.createElement('div'); body.className = 'overlay-module-body plugin-panel-content';
            body.id = button.id + '-body'; body.hidden = true; body.dataset.plugin = descriptor.id;
            body.setAttribute('role', 'group'); body.setAttribute('aria-labelledby', button.id);
            button.setAttribute('aria-controls', body.id);
            const dispose = attachOverlayDisclosure(button, body);
            group.append(button);
            (this.overlays.querySelector('[data-overlay-modules]') || this.overlays.querySelector('.settings-row')).append(group);
            this.overlays.append(body);
            own({ dispose() { dispose(); group.remove(); body.remove(); } });
            this.icons(); return body;
          }
          const section = document.createElement('section'); section.className = 'settings-section plugin-panel';
          section.dataset.plugin = descriptor.id;
          const heading = document.createElement('h2'), glyph = document.createElement('i');
          glyph.dataset.lucide = icon; glyph.setAttribute('aria-hidden', 'true'); heading.append(glyph, document.createTextNode(title));
          const body = document.createElement('div'); body.className = 'plugin-panel-content';
          section.append(heading, body); this.panels.append(section); this.icons();
          own({ dispose() { section.remove(); } }); return body;
        },
        createLayer: () => {
          if (entry.layers.length >= 8) throw new Error('A plugin can create at most eight layers.');
          const layer = own(new OverlayLayer({ id: `${descriptor.id}:${entry.layers.length}`, stage: this.stage,
            getView: this.getView, projectionUrl: this.projectionUrl, order: 2 + entry.layers.length, onError: fail }));
          entry.layers.push(layer);
          return Object.freeze({ canvas: layer.canvas, update: value => { if (alive()) layer.update(value); }, dispose: () => layer.dispose() });
        },
      });
      let moduleUrl;
      if (descriptor.code) moduleUrl = URL.createObjectURL(new Blob([descriptor.code], { type: 'text/javascript' }));
      let module;
      try { module = await this.load(moduleUrl || descriptor.script); }
      finally { if (moduleUrl) URL.revokeObjectURL(moduleUrl); }
      if (!alive()) return;
      if (typeof module.activate !== 'function') throw new Error('Plugin must export activate(api).');
      const instance = await module.activate(api);
      if (!alive()) { instance?.dispose?.(); return; }
      entry.instance = instance; entry.state = 'active';
      this.frame();
    } catch (error) { fail(error); }
  }
  frame() {
    if (this.disposed) return;
    const state = Object.freeze(this.getState());
    for (const entry of this.entries.values()) {
      if (entry.state !== 'active') continue;
      try {
        for (const callback of entry.callbacks) callback(state);
        for (const layer of entry.layers) layer.render(state);
      } catch (error) {
        entry.state = 'error'; entry.error = error.message || String(error);
        this.cleanup(entry); this.onError(`${entry.descriptor.name}: ${entry.error}`);
      }
    }
  }
  cleanup(entry) {
    entry.callbacks.clear();
    const instance = entry.instance; entry.instance = undefined;
    try { instance?.dispose?.(); } catch {}
    for (const resource of entry.resources.splice(0).reverse()) { try { resource.dispose(); } catch {} }
    entry.layers = [];
  }
  remove(id) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.disposed = true; this.cleanup(entry); this.entries.delete(id);
  }
  snapshot() {
    return [...this.entries.values()].map(entry => {
      let data;
      try { data = entry.instance?.getState?.(); } catch {}
      return { id: entry.descriptor.id, name: entry.descriptor.name, version: entry.descriptor.version, status: entry.state, error: entry.error, data };
    });
  }
  dispose() { this.disposed = true; for (const id of this.entries.keys()) this.remove(id); }
}

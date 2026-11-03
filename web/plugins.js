import { pluginPackageLimit, validatePluginPackage } from '../media/plugin-package.js';

export class PluginStore {
  constructor(indexedDB, bundled = []) {
    this.items = new Map(); this.listeners = new Set();
    this.bundled = new Map(bundled.map(entry => [entry.id, { ...entry, enabled: true, bundled: true }]));
    this.ready = this.open(indexedDB).catch(error => { this.error = error.message; this.emit(); });
  }
  async open(indexedDB) {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('panoplayer.plugins.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('plugins', { keyPath: 'id' });
      request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Close other PanoPlayer tabs to open plugin storage.'));
      request.onsuccess = () => resolve(request.result);
    });
    this.db.onversionchange = () => this.db.close();
    const records = await new Promise((resolve, reject) => {
      const request = this.db.transaction('plugins').objectStore('plugins').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    for (const record of records) {
      if (this.bundled.has(record.id)) {
        if (typeof record.enabled === 'boolean') this.bundled.get(record.id).enabled = record.enabled;
        continue;
      }
      try { this.items.set(record.id, { ...validatePluginPackage(record), enabled: record.enabled === true }); } catch {}
    }
    this.emit();
  }
  getEnabled() { return this.list().filter(item => item.enabled).map(({ enabled, bundled, ...entry }) => entry); }
  list() { return [...this.bundled.values(), ...this.items.values()].map(item => ({ ...item })); }
  subscribe(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  emit() { for (const callback of this.listeners) callback(); }
  async write(id, value) {
    await this.ready;
    if (this.error || !this.db) throw new Error(this.error || 'Plugin storage is unavailable.');
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('plugins', 'readwrite'), store = tx.objectStore('plugins');
      if (value) store.put(value); else store.delete(id);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Plugin storage write was cancelled.'));
    });
    if (this.bundled.has(id)) this.bundled.get(id).enabled = value.enabled;
    else if (value) this.items.set(id, value); else this.items.delete(id);
    this.emit();
  }
  install(value) {
    const entry = validatePluginPackage(value);
    if (this.bundled.has(entry.id)) throw new Error('This plugin is included with PanoPlayer and cannot be replaced by a package.');
    return this.write(entry.id, { ...entry, enabled: true });
  }
  async setEnabled(id, enabled) {
    await this.ready;
    const builtin = this.bundled.get(id), item = builtin || this.items.get(id);
    if (!item) return;
    if (builtin && this.error) { builtin.enabled = Boolean(enabled); this.emit(); return; }
    return this.write(id, builtin ? { id, bundled: true, enabled: Boolean(enabled) } : { ...item, enabled: Boolean(enabled) });
  }
  remove(id) {
    if (this.bundled.has(id)) throw new Error('Bundled plugins cannot be uninstalled. Disable the plugin instead.');
    return this.write(id, null);
  }
}

export function attachPluginManager(store, icons) {
  const $ = id => document.getElementById(id), dialog = $('plugins-dialog');
  let pending, busy = false, readRequest = 0;
  function message(text) { $('plugins-message').textContent = text || ''; $('plugins-message').hidden = !text; }
  function review(value) {
    pending = value; $('plugin-review').hidden = !value; $('plugins-library').hidden = !!value;
    $('plugin-trust').checked = false; $('plugin-confirm').disabled = true;
    if (value) { $('plugin-review-name').textContent = `${value.name} ${value.version}`; $('plugin-review-id').textContent = value.id; }
  }
  async function action(callback) {
    if (busy) return;
    busy = true; dialog.setAttribute('aria-busy', 'true');
    try { await callback(); message(''); } catch (error) { message(error.message); }
    finally { busy = false; dialog.removeAttribute('aria-busy'); render(); }
  }
  function render() {
    const entries = store.list();
    $('plugins-empty').hidden = entries.length > 0;
    $('plugins-list').replaceChildren(...entries.map(entry => {
      const row = document.createElement('div'); row.className = 'plugin-row';
      const label = document.createElement('label'); label.className = 'toggle';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = entry.enabled; input.disabled = busy; input.dataset.plugin = entry.id;
      input.addEventListener('change', () => { void action(() => store.setEnabled(entry.id, input.checked)); });
      const text = document.createElement('span'); text.textContent = entry.name;
      const version = document.createElement('span'); version.className = 'plugin-version'; version.textContent = entry.version + (entry.bundled ? ' (built-in)' : '');
      label.append(input, text); const remove = document.createElement('button'); remove.disabled = busy;
      remove.hidden = entry.bundled === true;
      remove.title = `Uninstall ${entry.name}`; remove.setAttribute('aria-label', remove.title);
      remove.dataset.removePlugin = entry.id; remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
      remove.addEventListener('click', () => { void action(() => store.remove(entry.id)); });
      row.append(label, version, remove); return row;
    }));
    if (store.error) message(store.error);
    $('plugin-install').disabled = Boolean(store.error) || busy;
    icons();
  }
  $('plugins-open').addEventListener('click', () => { readRequest++; review(null); render(); dialog.showModal(); });
  $('plugins-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { readRequest++; review(null); $('plugins-open').focus(); });
  $('plugin-install').addEventListener('click', () => $('plugin-file').click());
  $('plugin-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    const request = ++readRequest;
    try {
      if (!file.size || file.size > pluginPackageLimit) throw new Error('Select a plugin package between 1 byte and 5 MB.');
      const value = validatePluginPackage(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      if (!dialog.open || request !== readRequest) return;
      message(''); review(value); $('plugin-trust').focus();
    } catch (error) { if (dialog.open && request === readRequest) message(error.message); }
  });
  $('plugin-trust').addEventListener('change', () => { $('plugin-confirm').disabled = !$('plugin-trust').checked; });
  $('plugin-cancel').addEventListener('click', () => { readRequest++; review(null); });
  $('plugin-confirm').addEventListener('click', () => {
    if (!pending || !$('plugin-trust').checked) return;
    void action(async () => { await store.install(pending); review(null); });
  });
  store.subscribe(render); void store.ready.then(render); render();
}

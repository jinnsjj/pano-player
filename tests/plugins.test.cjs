const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const { createPluginRegistry } = require('../src/plugin-registry.cjs');

function moduleFor(file, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(buildSync({ entryPoints: [require.resolve(file)], bundle: true, format: 'cjs', write: false }).outputFiles[0].text,
    { module, exports: module.exports, URL, Blob, AbortController, ...globals });
  return module.exports;
}
const { validatePluginPackage } = moduleFor('../media/plugin-package.js');
const sample = patch => ({ format: 'panoplayer-plugin', apiVersion: 1, id: 'test.example', name: 'Example', version: '1.0.0', code: 'export function activate() {}', ...patch });

test('local plugin packages require compatible metadata and bounded, bundled code', () => {
  const valid = validatePluginPackage(sample()); assert.equal(valid.css, '');
  for (const patch of [{ apiVersion: 2 }, { format: 'zip' }, { id: '../file' }, { name: ' ' }, { version: 'latest' },
    { code: '' }, { code: 3 }, { code: 'x'.repeat(4 * 1024 * 1024 + 1) }, { css: 'x'.repeat(512 * 1024 + 1) }]) {
    assert.throws(() => validatePluginPackage(sample(patch)));
  }
  assert.equal(validatePluginPackage(sample({ script: 'https://example.com/remote.js' })).script, undefined, 'Web packages never select a remote module URL');
});

test('companion registry accepts only installed opt-in extensions and narrowly scoped resource paths', async () => {
  const uri = value => ({ path: value, toString: () => 'vscode-remote://host' + value });
  const logs = [], installed = { id: 'test.example', extensionUri: uri('/extensions/example'),
    packageJSON: { displayName: 'Example', version: '1.0.0', panoPlayerPlugin: { apiVersion: 1 } } };
  const registry = createPluginRegistry({ extensions: { all: [installed], getExtension: id => id === installed.id ? installed : undefined },
    Uri: { joinPath: (base, ...parts) => uri(base.path + '/' + parts.join('/')) } }, { appendLine: text => logs.push(text) });
  installed.activate = () => { registry.register(installed.id, { apiVersion: 1, script: 'media/plugin.js', style: 'media/plugin.css' }); };
  await registry.discover();
  assert.equal(registry.roots()[0].path, '/extensions/example/media');
  const descriptor = registry.descriptors({ asWebviewUri: value => value })[0];
  assert.equal(descriptor.script, 'vscode-remote://host/extensions/example/media/plugin.js');
  assert.equal(descriptor.apiVersion, 1);
  assert.throws(() => registry.register('missing', { apiVersion: 1, script: 'media/plugin.js' }), /installed/);
  registry.dispose();
  for (const script of ['/etc/passwd', 'media/../secret.js', 'media//bad.js', 'https://example.com/code.js', 'media/a.js?x=1', 'src/code.js']) {
    assert.throws(() => registry.register(installed.id, { apiVersion: 1, script }), /relative files/);
  }
  const registration = registry.register(installed.id, { apiVersion: 1, script: 'media/plugin.js' });
  assert.throws(() => registry.register(installed.id, { apiVersion: 1, script: 'media/plugin.js' }), /already/);
  registration.dispose(); assert.equal(registry.roots().length, 0); assert.deepEqual(logs, []);
});

test('bundled native plugins load from core assets without companions and take precedence over legacy installations', async () => {
  const catalog = require('../plugins/catalog.cjs');
  const uri = value => ({ path: value, toString: () => 'vscode-remote://host' + value });
  let activated = 0;
  const legacy = { id: catalog[0].id, extensionUri: uri('/extensions/legacy'),
    packageJSON: { panoPlayerPlugin: { apiVersion: 1 } }, activate() { activated++; } };
  const registry = createPluginRegistry({ extensions: { all: [legacy], getExtension: () => legacy },
    Uri: { joinPath: (base, ...parts) => uri(base.path + '/' + parts.join('/')) } }, { appendLine() {} },
    catalog.map(plugin => ({ ...plugin, extensionUri: uri('/extensions/core') })));
  const descriptors = () => registry.descriptors({ asWebviewUri: value => value });
  await registry.discover(); assert.equal(activated, 0);
  assert.equal(descriptors().length, 1);
  assert.equal(descriptors()[0].script, 'vscode-remote://host/extensions/core/media/plugins/annotations.js');
  assert.equal(descriptors()[0].style, 'vscode-remote://host/extensions/core/media/plugins/annotations.css');
  assert.deepEqual(registry.roots(), [], 'Bundled assets use the existing core media resource root');
  registry.register(legacy.id, { apiVersion: 1, script: 'media/plugin.js' }).dispose();
  assert.equal(descriptors().length, 1, 'A legacy registration cannot replace or dispose the bundled module');
  registry.dispose(); assert.equal(descriptors().length, 0);
});

function pluginDatabase(initial = []) {
  const records = new Map(initial.map(value => [value.id, value]));
  const db = { close() {}, transaction() {
    const tx = {};
    tx.objectStore = () => ({
      getAll() { const request = {}; queueMicrotask(() => { request.result = [...records.values()]; request.onsuccess(); }); return request; },
      put(value) { records.set(value.id, value); queueMicrotask(() => tx.oncomplete()); },
      delete(id) { records.delete(id); queueMicrotask(() => tx.oncomplete()); },
    });
    return tx;
  } };
  return { records, open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; } };
}

test('bundled web plugins are enabled on a fresh profile, persist opt-out and refresh code from the catalog', async () => {
  const { PluginStore } = moduleFor('../web/plugins.js');
  const builtin = { id: 'test.bundled', name: 'Bundled', apiVersion: 1, version: '1.0.0', script: '/media/bundled.js' };
  const database = pluginDatabase(), store = new PluginStore(database, [builtin]);
  assert.equal(store.getEnabled()[0].script, builtin.script, 'No install or storage round-trip is required');
  await store.ready;
  await store.setEnabled(builtin.id, false);
  assert.equal(store.getEnabled().length, 0);
  assert.deepEqual(Object.keys(database.records.get(builtin.id)).sort(), ['bundled', 'enabled', 'id'], 'Store only enablement, not a pinned runtime');
  const upgraded = new PluginStore(database, [{ ...builtin, version: '2.0.0', script: '/media/new.js' }]);
  await upgraded.ready;
  assert.equal(upgraded.list()[0].enabled, false);
  await upgraded.setEnabled(builtin.id, true);
  assert.equal(upgraded.getEnabled()[0].version, '2.0.0');
  assert.equal(upgraded.getEnabled()[0].script, '/media/new.js');
  assert.equal(upgraded.getEnabled()[0].bundled, undefined);
  assert.throws(() => upgraded.install(sample({ id: builtin.id })), /included/);
  assert.throws(() => upgraded.remove(builtin.id), /cannot be uninstalled/);
  await upgraded.install(sample()); assert.equal(upgraded.getEnabled().length, 2);
  await upgraded.remove('test.example'); assert.equal(upgraded.getEnabled().length, 1);
});

test('a previously installed web package cannot shadow a bundled plugin and storage failures do not disable defaults', async () => {
  const { PluginStore } = moduleFor('../web/plugins.js');
  const builtin = { id: 'test.bundled', name: 'Bundled', version: '2.0.0', apiVersion: 1, script: '/media/new.js' };
  const database = pluginDatabase([{ ...sample({ id: builtin.id, code: 'throw new Error("old package");' }), enabled: true }]);
  const store = new PluginStore(database, [builtin]); await store.ready;
  assert.equal(store.list().length, 1); assert.equal(store.getEnabled()[0].script, '/media/new.js');
  assert.equal(store.getEnabled()[0].code, undefined);
  const unavailable = new PluginStore(undefined, [builtin]); await unavailable.ready;
  assert.ok(unavailable.error); assert.equal(unavailable.getEnabled().length, 1);
  await unavailable.setEnabled(builtin.id, false); assert.equal(unavailable.getEnabled().length, 0);
  await unavailable.setEnabled(builtin.id, true); assert.equal(unavailable.getEnabled().length, 1);
});

function setup(load) {
  function element(tag = 'div') {
    const context = { draws: [], clearRect() { this.draws = []; }, drawImage(...args) { this.draws.push(args); } };
    const attributes = {}, listeners = {};
    return { tagName: tag.toUpperCase(), width: 300, height: 150, dataset: {}, style: {}, children: [],
      getContext: () => context, setAttribute(key, value) { attributes[key] = value; }, getAttribute: key => attributes[key], querySelector() { return null; },
      addEventListener(type, callback, options) {
        listeners[type] = callback;
        options?.signal.addEventListener('abort', () => { if (listeners[type] === callback) delete listeners[type]; });
      }, click() { listeners.click?.(); }, focus() {},
      append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
      insertBefore(item) { this.append(item); }, remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); } };
  }
  const stage = element(), panels = element(), overlays = element(), overlayToolbar = element(), head = element(), errors = [], layers = new Map();
  overlays.querySelector = () => overlayToolbar;
  const view = { setOverlayLayer(id, canvas, visible) { layers.set(id, { canvas, visible }); }, removeOverlayLayer: id => layers.delete(id) };
  let state = { time: 0, hasVideo: true, width: 720, height: 720, projection: '180', layout: 'mono', rotation: 0, viewMode: 'flat' };
  const projections = [];
  const globals = { document: { createElement: element, createTextNode: text => ({ text }), head },
    window: { PanoProjection: class {
      constructor(canvas, source) { this.canvas = canvas; this.source = source; projections.push(this); }
      configure(...args) { this.settings = args; } render() {} dispose() { this.disposed = true; }
    } } };
  const { PlayerPlugins } = moduleFor('../media/plugins.js', globals);
  const runtime = new PlayerPlugins({ getState: () => ({ ...state }), getView: () => view, stage, panels, overlays,
    projectionUrl: 'http://localhost/media/view.js', icons() {}, onError: text => errors.push(text), load });
  return { runtime, stage, panels, overlays, overlayToolbar, head, view, layers, errors, projections, state, element,
    frame(patch = {}) { state = { ...state, ...patch }; runtime.frame(); } };
}
const flush = () => new Promise(setImmediate);

test('overlay modules expand inline, remain separate from normal settings panels and clean up on unload', async () => {
  let body;
  const s = setup(async () => ({ activate(api) { body = api.createPanel({ title: 'Custom overlay', placement: 'overlay' }); } }));
  s.runtime.sync([sample()]); await flush();
  assert.equal(s.panels.children.length, 0); assert.equal(s.overlays.children[0], body);
  const button = s.overlayToolbar.children[0].children[0];
  assert.equal(body.hidden, true); assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-controls'), body.id);
  button.click(); assert.equal(body.hidden, false); assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.click(); assert.equal(body.hidden, true);
  s.runtime.sync([]); assert.equal(s.overlays.children.length, 0); assert.equal(s.overlayToolbar.children.length, 0);
});

test('an overlay plugin supplies its own visibility checkbox independently of the shared disclosure', async () => {
  let body, toggle;
  const s = setup(async () => ({ activate(api) {
    toggle = { type: 'checkbox', checked: false };
    body = api.createPanel({ title: 'Custom overlay', placement: 'overlay', toggle });
  } }));
  s.runtime.sync([sample()]); await flush();
  const group = s.overlayToolbar.children[0], button = group.children[1];
  assert.equal(group.children[0].children[0], toggle);
  assert.equal(button.getAttribute('aria-label'), 'Custom overlay settings');
  toggle.checked = true; assert.equal(body.hidden, true);
  button.click(); assert.equal(body.hidden, false); assert.equal(toggle.checked, true);
  button.click(); assert.equal(body.hidden, true); assert.equal(toggle.checked, true);
  s.runtime.sync([]); button.click();
  assert.equal(body.hidden, true); assert.equal(s.overlayToolbar.children.length, 0);
});

test('owned overlay toolbar actions remain outside the collapsed panel and independent of its toggle and disclosure', async () => {
  let body, toggle, action, clicks = 0;
  const s = setup(async () => ({ activate(api) {
    toggle = { type: 'checkbox', checked: false };
    action = s.element('button'); action.setAttribute('aria-label', 'Open data JSON');
    action.addEventListener('click', () => { clicks++; });
    body = api.createPanel({ title: 'Custom overlay', placement: 'overlay', toggle, actions: [action] });
  } }));
  s.runtime.sync([sample()]); await flush();
  const group = s.overlayToolbar.children[0], arrow = group.children[2];
  assert.equal(group.children[0].children[0], toggle);
  assert.equal(group.children[1], action); assert.equal(action.parent, group);
  assert.equal(body.children.includes(action), false); assert.equal(body.hidden, true);
  assert.equal(Boolean(group.hidden || action.hidden), false);
  action.click();
  assert.equal(clicks, 1); assert.equal(toggle.checked, false); assert.equal(body.hidden, true);
  assert.equal(arrow.getAttribute('aria-expanded'), 'false');
  arrow.click();
  assert.equal(body.hidden, false); assert.equal(arrow.getAttribute('aria-expanded'), 'true');
  toggle.checked = true; action.click();
  assert.equal(clicks, 2); assert.equal(toggle.checked, true); assert.equal(body.hidden, false);
  arrow.click();
  assert.equal(body.hidden, true); assert.equal(toggle.checked, true); assert.equal(group.children[1], action);
  s.runtime.sync([]);
  assert.equal(s.overlayToolbar.children.length, 0, 'Unloading removes the toolbar group and its action');
  assert.equal(s.overlays.children.length, 0);
  s.runtime.dispose();
});

test('toolbar actions must be button arrays and are rejected for settings panels', async () => {
  let api;
  const s = setup(async () => ({ activate(value) { api = value; } }));
  s.runtime.sync([sample()]); await flush();
  for (const actions of [null, {}, [null], [s.element('div')], [{ tagName: 'button' }]]) {
    assert.throws(() => api.createPanel({ title: 'Invalid actions', placement: 'overlay', actions }), /actions.*button/i);
  }
  assert.throws(() => api.createPanel({ title: 'Settings actions', actions: [s.element('button')] }), /actions.*button/i);
  assert.equal(s.panels.children.length, 0); assert.equal(s.overlays.children.length, 0);
  assert.equal(s.overlayToolbar.children.length, 0);
  assert.equal(s.runtime.snapshot()[0].status, 'active');
  s.runtime.dispose();
});

test('showPanel reveals an owned overlay disclosure idempotently without changing its visibility toggle', async () => {
  let api, body, toggle;
  const s = setup(async () => ({ activate(value) {
    api = value; toggle = { type: 'checkbox', checked: false };
    body = api.createPanel({ title: 'Example', placement: 'overlay', toggle });
  } }));
  s.runtime.sync([sample()]); await flush();
  const button = s.overlayToolbar.children[0].children[1];
  assert.equal(body.hidden, true); assert.equal(button.getAttribute('aria-expanded'), 'false');
  api.showPanel(body);
  assert.equal(body.hidden, false); assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.checked, false, 'Revealing settings does not enable the overlay');
  api.showPanel(body);
  assert.equal(body.hidden, false); assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.click(); toggle.checked = true;
  api.showPanel(body);
  assert.equal(body.hidden, false); assert.equal(toggle.checked, true);
  s.runtime.dispose();
});

test('showPanel rejects foreign and non-overlay panels and does nothing after the plugin unloads', async () => {
  const apis = {}, bodies = {};
  let settings;
  const s = setup(async url => ({ activate(api) {
    apis[url] = api; bodies[url] = api.createPanel({ title: url, placement: 'overlay' });
    if (url === 'first') settings = api.createPanel({ title: 'Settings' });
  } }));
  s.runtime.sync(['first', 'second'].map(id => ({ ...sample({ id: 'test.' + id }), code: undefined, script: id })));
  await flush();
  assert.throws(() => apis.first.showPanel(bodies.second), /owned|overlay/);
  assert.throws(() => apis.first.showPanel(settings), /owned|overlay/);
  assert.equal(bodies.first.hidden, true); assert.equal(bodies.second.hidden, true);
  s.runtime.sync([]);
  assert.doesNotThrow(() => apis.first.showPanel(bodies.first));
  assert.equal(bodies.first.hidden, true);
  s.runtime.dispose();
});

test('generic plugin interface owns panels, frames and source-aligned layers without exposing player internals', async () => {
  let api, frames = 0, disposed = 0, layer;
  const s = setup(async () => ({ activate(value) {
    api = value; api.createPanel({ title: '<Plain text>' });
    layer = api.createLayer(); layer.update({ visible: true }); api.onFrame(() => { frames++; });
    return { dispose() { disposed++; }, getState: () => ({ frames }) };
  } }));
  s.runtime.sync([sample()]); await flush();
  assert.equal(s.panels.children.length, 1); assert.equal(s.stage.children.length, 1);
  assert.equal(s.runtime.snapshot()[0].status, 'active'); assert.ok(frames > 0);
  assert.equal(api.video, undefined); assert.equal(api.view, undefined);
  assert.equal(api.selectJsonFile, undefined, 'Browser runtimes do not advertise a host picker');
  assert.equal(api.getState().time, 0);
  assert.equal(Object.isFrozen(api.getState()), true);
  const output = s.layers.get('test.example:0').canvas;
  assert.deepEqual(output.getContext('2d').draws[0].slice(1), [512, 0, 1024, 1024]);
  const before = frames; s.frame({ time: 5 }); assert.equal(frames, before + 1);
  s.frame({ projection: '360', layout: 'sbs', rotation: 90 }); await flush();
  assert.deepEqual(Array.from(s.projections[0].settings), ['360', 'sbs', 90]);
  assert.equal(s.projections[0].source, layer.canvas);
  s.frame({ viewMode: 'spatial' }); assert.equal(output.hidden, true);
  s.runtime.sync([]); assert.equal(s.panels.children.length, 0); assert.equal(s.stage.children.length, 0);
  assert.equal(s.layers.size, 0); assert.equal(disposed, 1); assert.equal(s.projections[0].disposed, true);
  s.runtime.dispose(); assert.equal(disposed, 1);
});

test('the optional host JSON picker is forwarded without exposing host APIs and rejects calls after unload', async () => {
  let api;
  const s = setup(async () => ({ activate(value) { api = value; } }));
  const file = { name: 'host.json' }; let calls = 0;
  s.runtime.selectJsonFile = async () => { calls++; return file; };
  s.runtime.sync([sample()]); await flush();
  assert.equal(await api.selectJsonFile(), file); assert.equal(calls, 1);
  assert.equal(api.postMessage, undefined); assert.equal(api.host, undefined);
  s.runtime.sync([]); await assert.rejects(api.selectJsonFile(), /session closed/);
  assert.equal(calls, 1); s.runtime.dispose();
});

test('file drops route arrays through active plugin handlers in order and stop at the first claim', async () => {
  const calls = [], file = { name: 'labels.json' };
  let received;
  const s = setup(async url => ({ activate(api) {
    api.onFileDrop(files => { received = files; calls.push(url + ':first'); return false; });
    api.onFileDrop(files => { calls.push(url + ':second'); return files[0]?.name.endsWith('.json'); });
    api.onFileDrop(() => { calls.push(url + ':third'); return true; });
  } }));
  s.runtime.sync(['first', 'second'].map(id => ({ ...sample({ id: 'test.' + id }), code: undefined, script: id })));
  await flush();
  assert.equal(s.runtime.dropFiles({ 0: file, length: 1 }), true);
  assert.equal(Array.isArray(received), true);
  assert.deepEqual(Array.from(received), [file]);
  assert.deepEqual(calls, ['first:first', 'first:second']);
  s.runtime.dispose();
});

test('only a synchronous true claims a drop and unmatched media remains available to the host', async () => {
  const calls = [];
  const s = setup(async () => ({ activate(api) {
    for (const [name, result] of [['undefined', undefined], ['truthy', 1], ['promise', Promise.resolve(true)], ['false', false]]) {
      api.onFileDrop(() => { calls.push(name); return result; });
    }
    api.onFileDrop(files => { calls.push('json'); return files.length === 1 && files[0].name.endsWith('.json'); });
  } }));
  s.runtime.sync([sample()]); await flush();
  assert.equal(s.runtime.dropFiles([{ name: 'movie.mp4' }]), false);
  assert.deepEqual(calls, ['undefined', 'truthy', 'promise', 'false', 'json']);
  calls.length = 0;
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), true);
  assert.deepEqual(calls, ['undefined', 'truthy', 'promise', 'false', 'json']);
  s.runtime.dispose();
});

test('file drop subscriptions validate callbacks and release on unsubscribe, unload and runtime disposal', async () => {
  let api, subscription, calls = 0;
  const s = setup(async () => ({ activate(value) {
    api = value; subscription = api.onFileDrop(() => { calls++; return true; });
  } }));
  s.runtime.sync([sample()]); await flush();
  for (const callback of [undefined, null, 1, {}]) assert.throws(() => api.onFileDrop(callback), /function/);
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), true); assert.equal(calls, 1);
  subscription.dispose(); subscription.dispose();
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), false); assert.equal(calls, 1);
  api.onFileDrop(() => { calls++; return true; });
  s.runtime.sync([]);
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), false); assert.equal(calls, 1);
  s.runtime.sync([sample()]); await flush();
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), true); assert.equal(calls, 2);
  s.runtime.dispose();
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), false); assert.equal(calls, 2);
});

test('file handlers registered during asynchronous activation cannot consume drops before activation', async () => {
  let resolve, calls = 0;
  const s = setup(async () => ({ activate(api) {
    api.onFileDrop(() => { calls++; return true; });
    return new Promise(r => { resolve = r; });
  } }));
  s.runtime.sync([sample()]); await flush();
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), false); assert.equal(calls, 0);
  resolve({}); await flush();
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), true); assert.equal(calls, 1);
  s.runtime.dispose();
});

test('a throwing file handler releases its plugin and continues routing to healthy handlers', async () => {
  let brokenCalls = 0, healthyCalls = 0, disposed = 0;
  const s = setup(async url => ({ activate(api) {
    api.createPanel({ title: url }); api.createLayer();
    api.onFileDrop(() => {
      if (url === 'broken') { brokenCalls++; throw new Error('drop failure'); }
      healthyCalls++; return true;
    });
    if (url === 'broken') api.onFileDrop(() => { brokenCalls++; return true; });
    return { dispose() { if (url === 'broken') disposed++; } };
  } }));
  s.runtime.sync(['broken', 'healthy'].map(id => ({ ...sample({ id: 'test.' + id }), code: undefined, script: id })));
  await flush();
  assert.equal(s.runtime.dropFiles([{ name: 'labels.json' }]), true);
  assert.equal(brokenCalls, 1); assert.equal(healthyCalls, 1); assert.equal(disposed, 1);
  assert.equal(s.runtime.snapshot().find(p => p.id === 'test.broken').status, 'error');
  assert.equal(s.runtime.snapshot().find(p => p.id === 'test.healthy').status, 'active');
  assert.equal(s.panels.children.length, 1); assert.equal(s.stage.children.length, 1);
  assert.equal(s.errors.length, 1); assert.match(s.errors[0], /drop failure/);
  assert.equal(s.runtime.dropFiles([{ name: 'next.json' }]), true);
  assert.equal(brokenCalls, 1); assert.equal(healthyCalls, 2);
  s.runtime.dispose(); assert.equal(disposed, 1);
});

test('failed plugins release their resources without stopping healthy plugins or the frame loop', async () => {
  let healthy = 0, disposed = 0;
  const s = setup(async url => ({ activate(api) {
    api.createPanel({ title: 'Example' }); api.createLayer().update({ visible: true });
    api.onFrame(() => { if (url.includes('broken')) throw new Error('frame failure'); healthy++; });
    return { dispose() { disposed++; } };
  } }));
  s.runtime.sync([{ ...sample(), code: undefined, script: 'broken' }, { ...sample({ id: 'test.healthy' }), code: undefined, script: 'healthy' }]);
  await flush(); s.frame();
  assert.equal(s.runtime.snapshot().find(p => p.id === 'test.example').status, 'error');
  assert.equal(s.runtime.snapshot().find(p => p.id === 'test.healthy').status, 'active');
  assert.equal(s.panels.children.length, 1); assert.equal(s.stage.children.length, 1);
  assert.ok(healthy > 0); assert.match(s.errors[0], /frame failure/); s.runtime.dispose();
  assert.equal(disposed, 2, 'Each instance is disposed once, including failed instances');
});

test('removal during asynchronous loading or activation cannot resurrect a plugin or leak resources', async () => {
  let resolve, activated = 0;
  const s = setup(() => new Promise(r => { resolve = r; }));
  s.runtime.sync([sample()]); s.runtime.sync([]);
  resolve({ activate() { activated++; } }); await flush(); assert.equal(activated, 0);
  const next = setup(async () => ({ activate(api) {
    api.createPanel({ title: 'Pending' }); api.createLayer();
    return new Promise(r => { resolve = r; });
  } }));
  next.runtime.sync([sample()]); await flush(); assert.equal(next.panels.children.length, 1);
  next.runtime.dispose(); let disposed = 0;
  resolve({ dispose() { disposed++; } }); await flush();
  assert.equal(disposed, 1); assert.equal(next.panels.children.length, 0); assert.equal(next.stage.children.length, 0);
  assert.equal(next.runtime.snapshot().length, 0);
});

test('incompatible plugin API does not execute code; stylesheet resources are cleaned on unload', async () => {
  let calls = 0;
  const s = setup(async () => { calls++; return { activate() {} }; });
  s.runtime.sync([sample({ apiVersion: 2 })]); await flush();
  assert.equal(calls, 0); assert.equal(s.runtime.snapshot()[0].status, 'error');
  s.runtime.sync([sample({ css: 'body { color: white; }' })]); await flush();
  assert.equal(calls, 1); assert.equal(s.head.children.length, 1);
  s.runtime.dispose(); assert.equal(s.head.children.length, 0);
});

test('plugin file review ignores stale reads and cancellation without installing code', async () => {
  const elements = new Map();
  function get(id) {
    if (!elements.has(id)) elements.set(id, Object.assign(new EventTarget(), {
      files: [], checked: false, hidden: false, textContent: '', replaceChildren() {}, focus() {},
      setAttribute() {}, removeAttribute() {},
      click() { this.dispatchEvent(new Event('click')); },
      showModal() { this.open = true; }, close() { this.open = false; this.dispatchEvent(new Event('close')); },
    }));
    return elements.get(id);
  }
  const { attachPluginManager, PluginStore } = moduleFor('../web/plugins.js', { document: { getElementById: get } });
  let installed = 0;
  attachPluginManager({ ready: Promise.resolve(), list: () => [], subscribe() {}, install() { installed++; } }, () => {});
  get('plugins-open').click();
  let resolve;
  get('plugin-file').files = [{ name: 'slow.panoplugin', size: 100, text: () => new Promise(r => { resolve = r; }) }];
  get('plugin-file').dispatchEvent(new Event('change'));
  get('plugin-file').files = [{ name: 'new.panoplugin', size: 100, text: async () => JSON.stringify(sample({ name: 'New package' })) }];
  get('plugin-file').dispatchEvent(new Event('change')); await flush();
  assert.equal(get('plugin-review-name').textContent, 'New package 1.0.0');
  resolve(JSON.stringify(sample({ name: 'Old package' }))); await flush();
  assert.equal(get('plugin-review-name').textContent, 'New package 1.0.0');
  get('plugins-close').click(); assert.equal(get('plugin-review').hidden, true);
  assert.equal(installed, 0);
  const unavailable = new PluginStore(undefined); await unavailable.ready;
  assert.ok(unavailable.error); assert.equal(unavailable.getEnabled().length, 0);
});

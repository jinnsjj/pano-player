// Run after npm test. Uses an isolated VS Code profile and existing synthetic fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/playwright/media-manifest');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), contexts = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.executionContextCreated') contexts.set(message.params.context.id, message.params.context);
    if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(message.params.executionContextId);
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
  };
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, contextId) => {
    const result = await call('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Runtime.enable', {});
  return { socket, call, evaluate, contexts };
}

async function runCase(name, config, fallback) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-json-native-'));
  await fs.mkdir(path.join(profile, 'user/User'), { recursive: true });
  await fs.writeFile(path.join(profile, 'user/User/settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'workbench.startupEditor': 'none',
  }));
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const ready = path.join(profile, 'ready.json'), done = path.join(profile, 'done.json');
  const env = { ...process.env, PANO_PLAYER_TEST_VIDEO: config, PANO_PLAYER_TEST_READY: ready, PANO_PLAYER_TEST_DONE: done };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.env.PANO_PLAYER_CODE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code', [
    '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    '--user-data-dir=' + path.join(profile, 'user'), '--extensions-dir=' + path.join(profile, 'extensions'),
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
    '--extensionDevelopmentPath=' + root, '--extensionTestsPath=' + path.join(__dirname, 'media-manifest-native-host.cjs'),
  ], { env });
  let log = '', exited = false, client, workbench;
  child.on('exit', () => { exited = true; });
  child.stdout.on('data', bytes => { log += bytes; }); child.stderr.on('data', bytes => { log += bytes; });
  try {
    const deadline = Date.now() + 60000;
    let target;
    while (Date.now() < deadline && !target) {
      try {
        await fs.access(ready);
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'iframe' && item.url.includes('shijunjie.pano-player'));
      } catch {}
      if (exited) throw new Error('Isolated VS Code exited before opening JSON.');
      if (!target) await sleep(100);
    }
    assert.ok(target, 'JSON must open a native player');
    client = await connect(target);
    let contextId;
    const findContext = async () => {
      for (const context of client.contexts.values()) {
        try { if (await client.evaluate('!!window.__PANO_PLAYER__', context.id)) return context.id; } catch {}
      }
    };
    while (Date.now() < deadline && contextId === undefined) { contextId = await findContext(); if (contextId === undefined) await sleep(100); }
    assert.notEqual(contextId, undefined, 'The inner player frame must start');
    const evaluate = expression => client.evaluate(expression, contextId);
    const wait = async expression => {
      const until = Date.now() + 45000;
      while (Date.now() < until) { if (await evaluate(expression)) return; await sleep(100); }
      throw new Error('Native JSON timed out: ' + expression + '\n' + JSON.stringify(await evaluate('({state:__PANO_PLAYER__.getState(), audio:document.querySelector("#audio-switch-status").textContent, plugin:document.querySelector("#plugin-status").textContent})')));
    };
    const readyExpression = `__PANO_PLAYER__.getState().ready && __PANO_PLAYER__.getState().videoQuality.total > 0 && !__PANO_PLAYER__.getState().switchingTrack &&
      document.querySelectorAll('#audio-track option').length >= ${fallback ? 5 : 6} &&
      ![...document.querySelectorAll('#audio-track option')].some(o => /Loading/.test(o.textContent)) &&
      __PANO_PLAYER__.getState().plugins[0]?.data?.total === 1`;
    await wait(readyExpression);
    const initial = await evaluate('({state:__PANO_PLAYER__.getState(), tracks:[...document.querySelectorAll("#audio-track option")].map(o=>({value:o.value,label:o.textContent,disabled:o.disabled}))})');
    if (fallback) {
      await wait('__PANO_PLAYER__.getState().audioSource !== "primary"');
      assert.match(await evaluate('document.querySelector("#audio-track").selectedOptions[0].textContent'), /foa\.wav/);
    } else assert.equal(initial.state.audioSource, 'primary');
    const pixels = await evaluate(`(() => { const c=document.querySelector('#video'), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      return d.some((v,i)=>i%4!==3 && v>30); })()`);
    assert.equal(pixels, true, 'Video pixels must be nonblank');
    assert.ok(initial.tracks.find(track => /missing.wav/.test(track.label))?.disabled);
    await evaluate(`(() => { const select=document.querySelector('#audio-track'); select.value=[...select.options].find(o=>o.textContent.startsWith('multi-foa.mp4 / 2')).value; select.dispatchEvent(new Event('change')); })()`);
    await wait('__PANO_PLAYER__.getState().audioTrackIndex === 1 && !__PANO_PLAYER__.getState().switchingTrack');
    await evaluate('document.querySelector("#play").click()');
    await wait('__PANO_PLAYER__.getState().currentTime > .15');
    await evaluate('document.querySelector("#play").click()');
    assert.equal(await evaluate('__PANO_PLAYER__.getState().paused'), true);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    workbench = await connect(targets.find(item => item.type === 'page'));
    const screenshot = await workbench.call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'));
    const result = { name, fallback, initial, passed: true };
    await fs.writeFile(path.join(output, name + '.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ name, passed: true, tracks: initial.tracks.length, fallback }));
  } finally {
    client?.socket.close(); workbench?.socket.close(); await fs.writeFile(done, '{}');
    if (!exited) await Promise.race([once(child, 'exit'), sleep(10000)]);
    if (!exited) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await fs.writeFile(path.join(output, name + '.log'), log);
  }
}

(async () => {
  await fs.mkdir(path.join(output, 'configs'), { recursive: true });
  const source = path.join(root, 'output/playwright/web/multi-foa.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-map', '0:v:0', '-c', 'copy', '-an', path.join(output, 'silent.mp4')]);
  await fs.writeFile(path.join(output, 'labels # \u6807\u6ce8.json'), JSON.stringify({ version: 1,
    annotations: [{ start: 0, end: 100, label: 'JSON imported', bbox: [.2, .2, .6, .7] }] }));
  for (const fallback of [false, true]) {
    const name = fallback ? 'silent-fallback' : 'video-audio-default';
    const filename = path.join(output, 'configs', name + (fallback ? '.JSONPP' : '.jsonpp'));
    await fs.writeFile(filename, JSON.stringify({ version: 1, video_path: fallback ? '../silent.mp4' : '../../web/multi-foa.mp4',
      audio_path: ['../missing.wav', '../../foa.wav', '../../web/multi-foa.mp4'], annotation: '../labels # \u6807\u6ce8.json' }));
    await runCase(name, filename, fallback);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

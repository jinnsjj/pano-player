// node tests/hevc-native.cjs <HEVC file> [output directory]; PANO_PLAYER_CODE can override the VS Code executable.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  assert.ok(process.argv[2], 'Provide a local HEVC fixture');
  const output = path.resolve(process.argv[3] || path.join(__dirname, '../output/playwright/hevc-native'));
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-hevc-native-'));
  await fs.mkdir(path.join(profile, 'user/User'), { recursive: true });
  await fs.writeFile(path.join(profile, 'user/User/settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
    'workbench.startupEditor': 'none',
  }));
  const done = path.join(profile, 'done.json'), ready = path.join(profile, 'ready.json');
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const env = { ...process.env, PANO_PLAYER_TEST_VIDEO: path.resolve(process.argv[2]),
    PANO_PLAYER_TEST_READY: ready, PANO_PLAYER_TEST_DONE: done };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.PANO_PLAYER_CODE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  await fs.access(executable);
  const child = spawn(executable, ['--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    '--user-data-dir=' + path.join(profile, 'user'), '--extensions-dir=' + path.join(profile, 'extensions'),
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
    '--extensionDevelopmentPath=' + path.resolve(__dirname, '..'),
    '--extensionTestsPath=' + path.join(__dirname, 'hevc-native-host.cjs')], { env });
  let log = '', exited = false;
  child.on('exit', () => { exited = true; });
  child.stdout.on('data', value => { log += value; }); child.stderr.on('data', value => { log += value; });
  const report = { source: path.resolve(process.argv[2]), checkpoints: [] };
  let socket;
  try {
    let target;
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      try {
        await fs.access(ready);
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        report.targets = targets.map(({ id, type, url }) => ({ id, type, url }));
        target = targets.find(item => item.type === 'iframe' && item.url.includes('shijunjie.pano-player'));
        if (target) break;
      } catch {}
      if (exited) throw new Error('Isolated VS Code exited before its webview opened');
      await sleep(200);
    }
    assert.ok(target, 'Isolated extension webview must open');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    let executionContext;
    const contexts = new Map();
    const pending = new Map();
    socket.onmessage = event => {
      const data = JSON.parse(event.data); const task = pending.get(data.id);
      if (data.method === 'Runtime.executionContextCreated') contexts.set(data.params.context.id, data.params.context);
      if (data.method === 'Runtime.executionContextDestroyed') contexts.delete(data.params.executionContextId);
      if (task) { pending.delete(data.id); data.error ? task.reject(new Error(data.error.message)) : task.resolve(data.result); }
    };
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression, contextId = executionContext) => {
      const result = await call('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, timeout = 150000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await evaluate(expression)) return; await sleep(100); }
      throw new Error('Native HEVC state timed out: ' + expression);
    };
    await call('Runtime.enable', {});
    const contextDeadline = Date.now() + 30000;
    while (Date.now() < contextDeadline && executionContext === undefined) {
      for (const context of contexts.values()) {
        try { if (await evaluate('!!window.__PANO_PLAYER__', context.id)) { executionContext = context.id; break; } } catch {}
      }
      if (executionContext === undefined) await sleep(100);
    }
    report.contexts = [...contexts.values()];
    if (executionContext === undefined) {
      report.page = await evaluate('({url: location.href, body: document.body.innerText, frames: [...document.querySelectorAll("iframe")].map(f=>({src:f.src,id:f.id}))})');
      throw new Error('Native player execution context did not appear');
    }
    await evaluate('window.nativeHevcVideo = __PANO_PLAYER__.monitor.video');
    const snapshot = async name => {
      const state = await evaluate(`(() => {
        const video = nativeHevcVideo, canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video.element, 0, 0, 32, 16);
        const pixels = [...ctx.getImageData(0, 0, 32, 16).data].filter((_, i) => i % 4 !== 3);
        return { ...__PANO_PLAYER__.getState(), userAgent: navigator.userAgent, backend: video.videoDecoder,
          codec: video.videoCodec, codecString: video.videoCodecString, frames: video.frames,
          error: video.error?.message, videoEndTime: video.videoEndTime, videoBlocked: video.videoBlocked,
          pixelRange: Math.max(...pixels) - Math.min(...pixels), detail: document.querySelector('#detail').textContent,
          empty: !document.querySelector('#empty').hidden, atMs: performance.now() };
      })()`);
      report.checkpoints.push({ name, ...state });
      assert.equal(state.error, undefined);
      assert.equal(state.backend, 'FFmpeg/WASM', 'This native environment must really select the software HEVC backend');
      assert.equal(state.empty, false); assert.ok(state.pixelRange > 20);
      assert.match(state.detail, /Video: HEVC \(H.265\).*FFmpeg\/WASM/);
      return state;
    };
    await waitFor('nativeHevcVideo.frames > 0 && __PANO_PLAYER__.getState().ready');
    await snapshot('initial');
    await evaluate('document.querySelector("#play").click()');
    await waitFor('nativeHevcVideo.currentTime > .12 && nativeHevcVideo.frames > 3');
    for (let i = 0; i < 6; i++) {
      await sleep(200); const state = await snapshot('playing-' + i);
      assert.ok(state.currentTime - state.videoEndTime < .25, 'PCM must remain close to slow video');
    }
    await evaluate('document.querySelector("#play").click()');
    const paused = await snapshot('paused'); await sleep(150);
    assert.ok(Math.abs((await snapshot('still-paused')).currentTime - paused.currentTime) < .03);
    await evaluate('nativeHevcVideo.currentTime = .75');
    await waitFor('!nativeHevcVideo.seeking && nativeHevcVideo.videoEndTime >= .72');
    await snapshot('seeked');
    if (await evaluate('document.querySelectorAll("#audio-track option").length > 1')) {
      await evaluate('document.querySelector("#audio-track").value = \'["primary",1]\'; document.querySelector("#audio-track").dispatchEvent(new Event("change"))');
      await waitFor('!__PANO_PLAYER__.getState().switchingTrack', 45000);
      assert.equal((await snapshot('track-switched')).audioTrackIndex, 1);
    }
    await evaluate('document.querySelector("#view-spatial").click()');
    await waitFor('!!__PANO_PLAYER__.view?.active', 30000);
    assert.ok(await evaluate(`(() => {
      const view = __PANO_PLAYER__.view; view.render(); const gl = view.gpu.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.some((value, i) => i % 4 !== 3 && value > 30);
    })()`), 'Native Perspective must display the software-decoded picture');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const pageTarget = targets.find(item => item.type === 'page');
    assert.ok(pageTarget, 'Native screenshot requires the top-level workbench target');
    const onmessage = socket.onmessage;
    socket.close(); socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = onmessage;
    const image = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(output, 'native-webview.png'), Buffer.from(image.data, 'base64'));
    report.passed = true;
    console.log(JSON.stringify({ passed: true, checkpoints: report.checkpoints.length, firstFrameMs: report.checkpoints[0].firstFrameMs }));
  } catch (error) { report.failure = error.message; throw error; }
  finally {
    socket?.close(); await fs.writeFile(done, '{}');
    await Promise.race([once(child, 'exit'), sleep(15000)]);
    if (!exited) child.kill('SIGTERM');
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(output, 'host.log'), log);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

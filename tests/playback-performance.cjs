// Run `node build.cjs` first, then node tests/playback-performance.cjs <video> [output directory].
// PANO_PLAYBACK_SECONDS controls the measured interval (default 8 seconds).
// PANO_PLAYBACK_INTERACTIONS=1 checks transport/seeks/Perspective; PANO_PLAYBACK_EOF=1 also checks replay.
// PANO_PLAYBACK_PROFILE reuses only a generated temporary profile, including its playback cache.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  assert.ok(process.argv[2], 'Provide a local video fixture');
  const seconds = Number(process.env.PANO_PLAYBACK_SECONDS || 8);
  assert.ok(Number.isFinite(seconds) && seconds >= 1, 'PANO_PLAYBACK_SECONDS must be at least 1');
  const minimumRatio = Number(process.env.PANO_PLAYBACK_MIN_RATIO || .9);
  const minimumFps = Number(process.env.PANO_PLAYBACK_MIN_FPS || 27);
  const maximumFirstFrameMs = process.env.PANO_PLAYBACK_MAX_FIRST_FRAME_MS === undefined ? Infinity :
    Number(process.env.PANO_PLAYBACK_MAX_FIRST_FRAME_MS);
  assert.ok(maximumFirstFrameMs > 0, 'Maximum first-frame time must be positive');
  const readyTimeout = Number(process.env.PANO_PLAYBACK_READY_TIMEOUT_MS || 300000);
  assert.ok(Number.isFinite(readyTimeout) && readyTimeout >= 1000, 'Playback readiness timeout must be at least 1000ms');
  const output = path.resolve(process.argv[3] || path.join(__dirname, '../output/playwright/playback-performance'));
  await fs.mkdir(output, { recursive: true });
  const temporaryRoot = await fs.realpath(os.tmpdir());
  let profile;
  if (process.env.PANO_PLAYBACK_PROFILE) {
    profile = path.resolve(process.env.PANO_PLAYBACK_PROFILE);
    const realProfile = await fs.realpath(profile);
    assert.equal(path.dirname(realProfile), temporaryRoot, 'Reused test profile must remain in the temporary directory');
    assert.match(path.basename(profile), /^pano-playback-performance-[A-Za-z0-9_-]+$/,
      'Never reuse a normal VS Code user profile');
    await fs.access(path.join(profile, 'user/User/settings.json'));
  } else {
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pano-playback-performance-'));
  }
  await fs.mkdir(path.join(profile, 'user/User'), { recursive: true });
  await fs.writeFile(path.join(profile, 'user/User/settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
    'workbench.startupEditor': 'none',
  }));
  const done = path.join(profile, 'done.json'), ready = path.join(profile, 'ready.json');
  await fs.rm(done, { force: true });
  await fs.rm(ready, { force: true });
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const env = { ...process.env, PANO_PLAYER_TEST_VIDEO: path.resolve(process.argv[2]),
    PANO_PLAYER_TEST_READY: ready, PANO_PLAYER_TEST_DONE: done };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.PANO_PLAYER_CODE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  await fs.access(executable);
  const child = spawn(executable, ['--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + path.join(profile, 'user'), '--extensions-dir=' + path.join(profile, 'extensions'),
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
    '--extensionDevelopmentPath=' + path.resolve(__dirname, '..'),
    '--extensionTestsPath=' + path.join(__dirname, 'hevc-native-host.cjs')], { env });
  let log = '', exited = false, socket;
  const auxiliarySockets = new Set();
  child.on('exit', () => { exited = true; });
  child.stdout.on('data', value => { log += value; });
  child.stderr.on('data', value => { log += value; });
  const waitForExit = timeout => new Promise(resolve => {
    if (exited) { resolve(); return; }
    const finish = () => { clearTimeout(timer); child.off('exit', finish); resolve(); };
    const timer = setTimeout(finish, timeout);
    child.once('exit', finish);
  });
  const report = { source: path.resolve(process.argv[2]), profile, seconds, minimumRatio, minimumFps,
    maximumFirstFrameMs: Number.isFinite(maximumFirstFrameMs) ? maximumFirstFrameMs : undefined, samples: [] };
  try {
    let target, workbench;
    const targetDeadline = Date.now() + 60000;
    while (Date.now() < targetDeadline) {
      try {
        await fs.access(ready);
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = targets.find(item => item.type === 'iframe' && item.url.includes('shijunjie.pano-player'));
        workbench = targets.find(item => item.type === 'page');
        if (target) break;
      } catch {}
      if (exited) throw new Error('Isolated VS Code exited before its webview opened');
      await sleep(200);
    }
    assert.ok(target, 'Isolated extension webview must open');
    const callTarget = async (target, method, params) => {
      const connection = new WebSocket(target.webSocketDebuggerUrl);
      auxiliarySockets.add(connection);
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('CDP connection timed out')), 30000);
          connection.onopen = () => { clearTimeout(timeout); resolve(); };
          connection.onerror = error => { clearTimeout(timeout); reject(error); };
        });
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('CDP timed out: ' + method)), 30000);
          connection.onmessage = event => {
            const data = JSON.parse(event.data);
            if (data.id !== 1) return;
            clearTimeout(timeout);
            data.error ? reject(new Error(data.error.message)) : resolve(data.result);
          };
          connection.send(JSON.stringify({ id: 1, method, params }));
        });
      } finally {
        connection.close(); auxiliarySockets.delete(connection);
      }
    };
    if (workbench) await callTarget(workbench, 'Page.bringToFront', {});
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0, executionContext;
    const contexts = new Map(), pending = new Map();
    socket.onmessage = event => {
      const data = JSON.parse(event.data), task = pending.get(data.id);
      if (data.method === 'Runtime.executionContextCreated') contexts.set(data.params.context.id, data.params.context);
      if (data.method === 'Runtime.executionContextDestroyed') contexts.delete(data.params.executionContextId);
      if (task) {
        pending.delete(data.id);
        data.error ? task.reject(new Error(data.error.message)) : task.resolve(data.result);
      }
    };
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 30000);
      pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); },
        reject: error => { clearTimeout(timeout); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression, contextId = executionContext) => {
      const result = await call('Runtime.evaluate', { expression, contextId, awaitPromise: true,
        returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, timeout = readyTimeout) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(100); }
      throw new Error('Playback state timed out: ' + expression);
    };
    await call('Runtime.enable', {});
    const contextDeadline = Date.now() + 30000;
    while (Date.now() < contextDeadline && executionContext === undefined) {
      for (const context of contexts.values()) {
        try {
          if (await evaluate('!!window.__PANO_PLAYER__', context.id)) { executionContext = context.id; break; }
        } catch {}
      }
      if (executionContext === undefined) await sleep(100);
    }
    assert.notEqual(executionContext, undefined, 'Native player execution context must appear');
    await waitFor('__PANO_PLAYER__.getState().ready && __PANO_PLAYER__.getState().firstFrameMs !== null');
    report.codecSupport = await evaluate(`(async () => {
      const support = {};
      for (const codec of ['avc1.640034', 'vp09.00.51.08', 'hev1.1.6.H183.90']) {
        try { support[codec] = await VideoDecoder.isConfigSupported({ codec, codedWidth: 4096,
          codedHeight: 4096, hardwareAcceleration: 'prefer-hardware' }); }
        catch (error) { support[codec] = { supported: false, error: error.message }; }
      }
      return support;
    })()`);
    report.initial = await evaluate(`(() => {
      const state = __PANO_PLAYER__.getState(), video = __PANO_PLAYER__.monitor.video;
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
      const ctx = canvas.getContext('2d'); ctx.drawImage(video.element || video, 0, 0, 32, 16);
      const pixels = [...ctx.getImageData(0, 0, 32, 16).data].filter((_, i) => i % 4 !== 3);
      return { ...state, backend: video.videoDecoder || 'Native', codec: video.videoCodecString,
        width: video.videoWidth, height: video.videoHeight, channels: video.channels ?? state.listening?.channels ?? 0,
        sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
        canvasWidth: video.element?.width ?? video.videoWidth, canvasHeight: video.element?.height ?? video.videoHeight,
        audioCodec: video.codec, audioCodecString: video.audioCodecString, sampleRate: video.sampleRate,
        pixelRange: Math.max(...pixels) - Math.min(...pixels),
        error: video.error?.message, userAgent: navigator.userAgent, visibility: document.visibilityState };
    })()`);
    assert.equal(report.initial.error, undefined, report.initial.error);
    assert.ok(report.initial.pixelRange > 20, 'Decoded video must contain real image pixels');
    assert.ok(report.initial.firstFrameMs <= maximumFirstFrameMs,
      `First decoded frame must arrive within ${maximumFirstFrameMs}ms (${report.initial.firstFrameMs.toFixed(1)}ms)`);
    const sample = () => evaluate(`(() => {
      const state = __PANO_PLAYER__.getState(), video = __PANO_PLAYER__.monitor.video;
      return { atMs: performance.now(), currentTime: video.currentTime, frames: state.videoQuality?.total ?? video.frames,
        dropped: state.videoQuality?.dropped ?? video.dropped, stalls: state.stalls,
        blocked: !!video.videoBlocked, paused: video.paused, videoEndTime: video.videoEndTime,
        error: video.error?.message, contextState: __PANO_PLAYER__.monitor.context?.state,
        readyState: video.readyState, audioPending: video.audioPending, endFrame: video.endFrame,
        duration: video.duration, epoch: video.epoch, seeking: !!video.seeking, ended: !!video.ended };
    })()`);
    await evaluate('document.querySelector("#play").click()');
    await evaluate('__PANO_PLAYER__.monitor.resume()');
    await waitFor('!__PANO_PLAYER__.monitor.context || __PANO_PLAYER__.monitor.context.state === "running"', 10000);
    const first = await sample(); report.samples.push(first);
    while ((report.samples.at(-1).atMs - first.atMs) / 1000 < seconds) {
      await sleep(100); report.samples.push(await sample());
    }
    const last = report.samples.at(-1);
    await evaluate('document.querySelector("#play").click()');
    const wallSeconds = (last.atMs - first.atMs) / 1000;
    let blockedSeconds = 0, stalledSeconds = 0, maximumVideoLag = 0;
    for (let i = 1; i < report.samples.length; i++) {
      const previous = report.samples[i - 1], current = report.samples[i];
      const elapsed = (current.atMs - previous.atMs) / 1000;
      if (previous.blocked) blockedSeconds += elapsed;
      if (current.currentTime - previous.currentTime < elapsed * .1) stalledSeconds += elapsed;
      if (Number.isFinite(current.videoEndTime)) maximumVideoLag = Math.max(maximumVideoLag, current.currentTime - current.videoEndTime);
    }
    report.metrics = { backend: report.initial.backend, firstFrameMs: report.initial.firstFrameMs,
      wallSeconds, mediaSeconds: last.currentTime - first.currentTime,
      realtimeRatio: (last.currentTime - first.currentTime) / wallSeconds,
      presentedFrames: last.frames - first.frames, presentedFps: (last.frames - first.frames) / wallSeconds,
      droppedFrames: last.dropped - first.dropped, stalls: last.stalls - first.stalls,
      blockedSeconds, stalledSeconds, maximumVideoLag,
      maximumAudioLead: report.initial.channels ? maximumVideoLag : 0 };
    console.log(JSON.stringify(report.metrics, null, 2));
    assert.ok(report.samples.every(item => !item.error), 'Playback must remain error-free');
    assert.ok(report.samples.every(item => !item.paused), 'Playback must not stop during the measurement');
    assert.ok(report.metrics.maximumAudioLead < .25, 'PCM must remain close to decoded video');
    assert.ok(report.metrics.presentedFps >= minimumFps,
      `Smooth playback must present at least ${minimumFps} frames per second`);
    assert.ok(report.metrics.realtimeRatio >= minimumRatio,
      `Playback must sustain realtime (${report.metrics.realtimeRatio.toFixed(3)} < ${minimumRatio})`);
    if (process.env.PANO_PLAYBACK_INTERACTIONS === '1') {
      const interactions = report.interactions = { checkpoints: [] };
      const checkpoint = async name => {
        const state = await sample(); interactions.checkpoints.push({ name, ...state });
        assert.equal(state.error, undefined, state.error);
        return state;
      };
      await waitFor('__PANO_PLAYER__.monitor.video.paused', 10000);
      await sleep(100);
      const paused = await checkpoint('paused');
      await sleep(300);
      const stillPaused = await checkpoint('still-paused');
      assert.ok(Math.abs(stillPaused.currentTime - paused.currentTime) < .03, 'Paused playback time must remain stable');
      const duration = paused.duration;
      assert.ok(Number.isFinite(duration) && duration > 1, 'Transport checks require a finite video longer than 1 second');
      const waitForSeek = async (targetTime, before, expectedEpoch) => {
        await waitFor(`(() => {
          const video = __PANO_PLAYER__.monitor.video, quality = video.getVideoPlaybackQuality?.();
          return !video.seeking && Math.abs(video.currentTime - ${targetTime}) < .06 &&
            (quality?.totalVideoFrames ?? video.frames) > ${before.frames} &&
            (video.epoch === undefined || video.epoch === ${expectedEpoch ?? 'undefined'}) &&
            (video.videoEndTime === undefined || (video.videoEndTime >= ${targetTime - .04} &&
              video.videoEndTime <= ${targetTime + .25}));
        })()`, 45000);
      };
      const targetTime = Math.min(20, duration * .4);
      await evaluate(`__PANO_PLAYER__.monitor.video.currentTime = ${targetTime}`);
      await waitForSeek(targetTime, stillPaused, stillPaused.epoch === undefined ? undefined : stillPaused.epoch + 1);
      const sought = await checkpoint('seeked');
      assert.ok(sought.paused, 'Seeking while paused must not start playback');
      const rapidTargets = [Math.min(duration - .5, targetTime + 5), Math.max(.1, targetTime - 3), Math.min(5, duration * .25)];
      await evaluate(`${JSON.stringify(rapidTargets)}.forEach(time => { __PANO_PLAYER__.monitor.video.currentTime = time; })`);
      await waitForSeek(rapidTargets.at(-1), sought, sought.epoch === undefined ? undefined : sought.epoch + rapidTargets.length);
      const rapidSought = await checkpoint('rapid-seeked');
      assert.ok(rapidSought.paused, 'Rapid seeks must preserve paused state');
      interactions.rapidTargets = rapidTargets;
      await evaluate('document.querySelector("#view-spatial").click()');
      await waitFor('!!__PANO_PLAYER__.view?.active', 30000);
      interactions.perspective = await evaluate(`(() => {
        const view = __PANO_PLAYER__.view; view.render();
        const gl = view.gpu.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let brightPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 30 || pixels[i + 1] > 30 || pixels[i + 2] > 30) brightPixels++;
        }
        return { width, height, brightPixels, contextLost: gl.isContextLost(), state: view.getState() };
      })()`);
      assert.equal(interactions.perspective.contextLost, false, 'Perspective GPU context must stay available');
      assert.ok(interactions.perspective.brightPixels > 0, 'Perspective must render nonblank source pixels');
      assert.ok(workbench, 'Native screenshot requires the top-level workbench target');
      const image = await callTarget(workbench, 'Page.captureScreenshot', { format: 'png' });
      interactions.perspective.screenshot = path.join(output, 'native-perspective.png');
      await fs.writeFile(interactions.perspective.screenshot, Buffer.from(image.data, 'base64'));
      if (process.env.PANO_PLAYBACK_EOF === '1') {
        const beforeEnd = await sample(), endTarget = duration - .5;
        await evaluate(`__PANO_PLAYER__.monitor.video.currentTime = ${endTarget}`);
        await waitForSeek(endTarget, beforeEnd, beforeEnd.epoch === undefined ? undefined : beforeEnd.epoch + 1);
        await checkpoint('near-end');
        await evaluate('document.querySelector("#play").click()');
        await evaluate('__PANO_PLAYER__.monitor.resume()');
        await waitFor('__PANO_PLAYER__.monitor.video.ended && __PANO_PLAYER__.monitor.video.paused', 15000);
        const ended = await checkpoint('ended');
        assert.ok(Math.abs(ended.currentTime - duration) < .1, 'EOF must finish at the source duration');
        await evaluate('document.querySelector("#play").click()');
        await evaluate('__PANO_PLAYER__.monitor.resume()');
        await waitFor(`(() => {
          const video = __PANO_PLAYER__.monitor.video;
          return !video.paused && !video.ended && video.currentTime > .15 && video.currentTime < 2 &&
            (video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.frames) > ${ended.frames};
        })()`, 30000);
        await checkpoint('replayed');
        await evaluate('document.querySelector("#play").click()');
      }
    }
    report.passed = true;
  } catch (error) {
    report.failure = error.message; throw error;
  } finally {
    socket?.close();
    for (const connection of auxiliarySockets) connection.close();
    await fs.writeFile(done, '{}');
    if (!exited) await waitForExit(15000);
    if (!exited) {
      child.kill('SIGTERM');
      await waitForExit(5000);
    }
    if (!exited) {
      child.kill('SIGKILL');
      await waitForExit(5000);
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(output, 'host.log'), log);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

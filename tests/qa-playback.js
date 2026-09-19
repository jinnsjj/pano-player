(async () => {
  const w = document.getElementById('active-frame').contentWindow;
  const d = w.document;
  const v = d.getElementById('video');
  const state = () => w.__FOA_POWERMAP__.getState();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => {
    const start = Date.now();
    while (!predicate()) { if (Date.now() - start > 30000) throw new Error('Condition timed out: ' + d.body.innerText); await sleep(50); }
  };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await wait(() => state().ready);
  v.pause();
  v.currentTime = 0;
  await wait(() => !v.seeking);
  await v.play();
  await wait(() => !v.paused);
  const began = performance.now();
  const start = state();
  const samples = [];
  w.__FOA_QA_SAMPLES__ = samples;
  let audioPeak = null;
  let audioContext;
  let ownsAudioContext = false;
  let analyzer;
  try {
    const monitor = w.__FOA_POWERMAP__.monitor;
    audioContext = monitor?.context || new w.AudioContext();
    ownsAudioContext = !monitor?.context;
    await audioContext.resume();
    const source = monitor?.output || audioContext.createMediaStreamSource(v.captureStream());
    analyzer = audioContext.createAnalyser(); source.connect(analyzer);
    await sleep(200);
    const wave = new Float32Array(analyzer.fftSize);
    analyzer.getFloatTimeDomainData(wave);
    audioPeak = Math.max(...wave.map(Math.abs));
  } catch (error) { audioPeak = String(error); }
  while (performance.now() - began < 61000) {
    await sleep(1000);
    samples.push({ wall: (performance.now() - began) / 1000, ...state() });
    const latest = samples.at(-1);
    assert(latest.mappedAt === null || Math.abs(latest.currentTime - latest.mappedAt) < .55, 'Stale map left visible');
  }
  v.pause();
  await wait(() => state().mappedAt !== null && Math.abs(state().mappedAt - v.currentTime) < .05);
  const finish = state();
  assert(finish.currentTime - start.currentTime > 59, 'Playback stalled');
  assert(finish.received - start.received > 330, 'Too few map updates');
  const pixels = d.getElementById('overlay').getContext('2d').getImageData(0, 0, 140, 70).data;
  const alphaPixels = pixels.filter((x, i) => i % 4 === 3 && x > 0).length;
  assert(alphaPixels > 0, 'Blank overlay');
  assert(v.webkitAudioDecodedByteCount > 0, 'No decoded audio');
  const generation = finish.generation;
  v.currentTime = 12;
  await wait(() => !v.seeking && state().mappedAt !== null && Math.abs(state().mappedAt - 12) < .05);
  assert(state().generation > generation, 'Seek did not invalidate generation');
  const seekBack = state();
  v.currentTime = 48;
  await wait(() => !v.seeking && state().mappedAt !== null && Math.abs(state().mappedAt - 48) < .05);
  const seekForward = state();
  const held = v.currentTime; await sleep(600);
  assert(v.currentTime === held, 'Paused video advanced');
  d.getElementById('enabled').click();
  assert(!d.getElementById('enabled').checked, 'Overlay toggle failed');
  const off = d.getElementById('overlay').getContext('2d').getImageData(0, 0, 140, 70).data;
  assert(off.every((x, i) => i % 4 !== 3 || x === 0), 'Disabled overlay not transparent');
  d.getElementById('enabled').click();
  await wait(() => state().mappedAt !== null);
  const quality = v.getVideoPlaybackQuality();
  if (w.__FOA_POWERMAP__.monitor?.output && analyzer) w.__FOA_POWERMAP__.monitor.output.disconnect(analyzer);
  if (ownsAudioContext) await audioContext?.close();
  const result = { elapsed: (performance.now() - began) / 1000, start, finish, alphaPixels,
    audioPeak, audioDecodedBytes: v.webkitAudioDecodedByteCount,
    videoFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames,
    maxAudioDrift: Math.max(...samples.map(s => Math.abs(s.listening?.drift || 0))),
    seekBack, seekForward, samples };
  assert(typeof audioPeak === 'number' && audioPeak > 0, 'No audible output captured');
  if (w.__FOA_POWERMAP__.monitor) assert(result.maxAudioDrift < .15, 'Binaural clock drift');
  w.__FOA_QA_RESULT__ = result;
  return result;
})()

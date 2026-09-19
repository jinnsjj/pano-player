(async () => {
  const frame = document.getElementById('active-frame');
  const w = frame.contentWindow; const d = w.document;
  const video = d.getElementById('video'); const canvas = d.getElementById('overlay');
  const projection = d.getElementById('projection');
  const state = () => w.__FOA_POWERMAP__.getState();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const wait = async predicate => {
    const start = Date.now();
    while (!predicate()) { if (Date.now() - start > 30000) throw new Error(d.body.innerText); await sleep(50); }
  };
  await wait(() => state().ready);
  // Start within the CDP user-gesture window, before asynchronous layout/seek checks.
  await video.play(); video.pause();
  const setMode = mode => { projection.value = mode; projection.dispatchEvent(new w.Event('change')); };
  setMode('180');
  const layouts = [];
  for (const width of [900, 390]) {
    frame.style.width = `${width}px`; frame.style.height = '800px'; await sleep(200);
    const v = video.getBoundingClientRect(); const c = canvas.getBoundingClientRect();
    assert(Math.abs(c.width - 2 * v.width) < .05, 'Full map must be twice the video width');
    assert(Math.abs(v.x - c.x - c.width / 4) < .05, 'Video must be centered with equal black padding');
    assert(v.height === c.height && v.y === c.y, 'Vertical alignment changed');
    assert(Math.abs(v.width / v.height - video.videoWidth / video.videoHeight) < .001, 'Video distorted');
    assert(d.documentElement.scrollWidth <= w.innerWidth, 'Horizontal overflow');
    layouts.push({ viewport: width, video: v.toJSON(), canvas: c.toJSON() });
  }
  const peaks = [];
  for (const [time, expected] of [[1, .25], [6, .75]]) {
    video.currentTime = time;
    await wait(() => !video.seeking && state().mappedAt !== null && Math.abs(state().mappedAt - time) < .05);
    const pixels = canvas.getContext('2d').getImageData(0, 0, 140, 70).data;
    let peak = 0;
    for (let i = 0; i < 140 * 70; i++) if (pixels[i * 4 + 3] > pixels[peak * 4 + 3]) peak = i;
    const x = peak % 140;
    const videoFraction = (x / 140 - .25) * 2;
    assert(pixels[peak * 4 + 3] > 0 && Math.abs(videoFraction - expected) < .06, 'Wrong angular scale in 180 ERP');
    peaks.push({ time, mapColumn: x, videoFraction });
  }
  video.currentTime = 1; await wait(() => !video.seeking); await video.play();
  const before = state(); const src = video.currentSrc;
  setMode('360'); await sleep(300);
  assert(Math.abs(video.getBoundingClientRect().width - canvas.getBoundingClientRect().width) < .05, '360 mode did not restore full width');
  setMode('180'); await sleep(1200);
  const after = state(); video.pause();
  assert(!after.paused && after.currentTime > before.currentTime + 1, 'Projection switch interrupted playback');
  assert(after.session === before.session && after.generation === before.generation && video.currentSrc === src, 'Projection switch restarted media or analysis');
  assert(after.received > before.received, 'Maps stopped updating');
  return { layouts, peaks, before, after };
})()

(async () => {
  const frame = document.getElementById('active-frame');
  const w = frame.contentWindow; const d = w.document;
  const v = d.getElementById('video'); const canvas = d.getElementById('overlay');
  const state = () => w.__PANO_PLAYER__.getState();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const wait = async predicate => {
    const start = Date.now();
    while (!predicate()) { if (Date.now() - start > 30000) throw new Error(d.body.innerText); await sleep(50); }
  };
  await wait(() => state().ready);
  assert(Math.abs(v.videoWidth / v.videoHeight - 16 / 9) < .01, 'Preview distorted');
  const peakAt = async time => {
    v.currentTime = time;
    await wait(() => !v.seeking && state().mappedAt !== null && Math.abs(state().mappedAt - time) < .05);
    const pixels = canvas.getContext('2d').getImageData(0, 0, 140, 70).data;
    let peak = 0;
    for (let i = 0; i < 140 * 70; i++) if (pixels[i * 4 + 3] > pixels[peak * 4 + 3]) peak = i;
    assert(pixels[peak * 4 + 3] > 0, 'Blank overlay');
    return { x: peak % 140, y: Math.floor(peak / 140) };
  };
  const left = await peakAt(1); const right = await peakAt(6);
  assert(Math.abs(left.x - 35) < 4 && Math.abs(right.x - 105) < 4, 'Left/right display is inverted');
  v.currentTime = 0; await wait(() => !v.seeking);
  await v.play(); await sleep(2100); v.pause();
  assert(v.currentTime > 1.8 && state().received > 8, 'Playback or live analysis stalled');
  const layouts = [];
  for (const width of [1200, 390]) {
    frame.style.width = `${width}px`; frame.style.height = '800px'; await sleep(250);
    const video = v.getBoundingClientRect().toJSON(); const overlay = canvas.getBoundingClientRect().toJSON();
    assert(d.documentElement.scrollWidth <= w.innerWidth, 'Horizontal overflow');
    assert(Math.abs(video.width / video.height - v.videoWidth / v.videoHeight) < .001, 'Stage distorted');
    for (const key of ['x', 'y', 'width', 'height']) assert(video[key] === overlay[key], 'Overlay rectangle differs from video');
    layouts.push({ width, video, overlay });
  }
  return { dimensions: [v.videoWidth, v.videoHeight], left, right, state: state(), layouts };
})()

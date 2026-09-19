(async () => {
  const w = document.getElementById('active-frame').contentWindow;
  const d = w.document; const player = w.__FOA_POWERMAP__; const monitor = player.monitor;
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const render = async sign => {
    const context = new w.OfflineAudioContext(2, 4096, 48000);
    const renderer = w.Omnitone.createFOARenderer(context, { channelMap: [0, 1, 2, 3] });
    await renderer.initialize();
    const buffer = context.createBuffer(4, 4096, 48000);
    buffer.getChannelData(0)[0] = .25; buffer.getChannelData(1)[0] = sign * .25;
    const source = context.createBufferSource(); source.buffer = buffer;
    source.connect(renderer.input); renderer.output.connect(context.destination); source.start();
    const output = await context.startRendering();
    return [0, 1].map(ch => output.getChannelData(ch).reduce((sum, value) => sum + value * value, 0));
  };
  const left = await render(1); const right = await render(-1);
  assert(left[0] > left[1] * 1.1 && right[1] > right[0] * 1.1, 'Binaural left/right cue is incorrect');
  const video = d.getElementById('video');
  const mode = d.getElementById('listening');
  mode.value = 'stereo'; mode.dispatchEvent(new w.Event('change'));
  assert(video.volume > 0 && monitor.output.gain.value === 0 && monitor.audio.paused, 'Stereo mode mixes in binaural output');
  video.pause();
  mode.value = 'binaural'; mode.dispatchEvent(new w.Event('change'));
  assert(video.volume === 0, 'Binaural mode leaks stereo proxy');
  d.getElementById('volume').value = '.3'; d.getElementById('volume').dispatchEvent(new w.Event('input'));
  assert(monitor.volume === .3, 'Volume control failed');
  d.getElementById('mute').click(); assert(video.muted && monitor.output.gain.value === 0, 'Mute failed');
  d.getElementById('mute').click();
  await sleep(50);
  return { leftEnergy: left, rightEnergy: right, state: player.getState() };
})()

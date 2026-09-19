(async () => {
  let frame, w, d;
  const state = () => { frame = document.getElementById('active-frame'); w = frame.contentWindow; d = w.document; return w.__FOA_POWERMAP__.getState(); };
  const wait = async predicate => { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 60000) throw new Error(d.body.innerText); await new Promise(r => setTimeout(r, 100)); } };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const before = state();
  const firstOrder = d.getElementById('order');
  firstOrder.value = firstOrder.value === 'WXYZ' ? 'WYZX' : 'WXYZ'; firstOrder.dispatchEvent(new w.Event('change'));
  await wait(() => state().ready && state().session !== before.session && state().mappedAt !== null);
  const changed = state();
  assert(Math.abs(changed.currentTime - before.currentTime) < .05, 'Order change lost position');
  const order = d.getElementById('order');
  order.value = order.value === 'WXYZ' ? 'WYZX' : 'WXYZ'; order.dispatchEvent(new w.Event('change'));
  await wait(() => state().ready && state().session !== changed.session && state().mappedAt !== null);
  const originalWidth = frame.style.width;
  const originalHeight = frame.style.height;
  frame.style.width = '390px'; frame.style.height = '700px';
  await new Promise(r => setTimeout(r, 300));
  const video = d.getElementById('video').getBoundingClientRect();
  const canvas = d.getElementById('overlay').getBoundingClientRect();
  const layout = { width: w.innerWidth, scrollWidth: d.documentElement.scrollWidth, video: video.toJSON(), canvas: canvas.toJSON() };
  assert(layout.scrollWidth <= layout.width, 'Narrow panel horizontally overflows');
  const media = d.getElementById('video');
  const halfSphere = state().projection === '180';
  const aspect = media.videoWidth && media.videoHeight ? media.videoWidth / media.videoHeight * (halfSphere ? 2 : 1) : 2;
  const stage = d.getElementById('stage').getBoundingClientRect();
  assert(Math.abs(stage.width / stage.height - aspect) < .01, 'Media aspect changed');
  if (media.hidden) {
    assert(stage.x === canvas.x && stage.y === canvas.y && stage.width === canvas.width && stage.height === canvas.height, 'Standalone map misaligned');
  } else if (halfSphere) {
    assert(Math.abs(video.width * 2 - canvas.width) < .05 && Math.abs(video.x - canvas.x - canvas.width / 4) < .05
      && video.y === canvas.y && video.height === canvas.height, '180 ERP overlay misaligned');
  } else {
    assert(video.x === canvas.x && video.y === canvas.y && video.width === canvas.width && video.height === canvas.height, 'Overlay misaligned');
  }
  w.__FOA_QA_LAYOUT__ = layout;
  w.__FOA_QA_RESTORE__ = () => { frame.style.width = originalWidth; frame.style.height = originalHeight; };
  return { before, changed, restored: state(), layout };
})()

import { validateFile } from './host.js';
(() => {
  const host = window.parent !== window ? window.parent.panoWebHost : null;
  const file = host?.getFile();
  if (!file) { location.replace('./index.html'); return; }
  const element = document.getElementById('video');
  for (const key of ['decoder', 'pcm', 'worker', 'worklet', 'view']) {
    element.dataset[key] = new URL(element.dataset[key], location.href).href;
  }
  element.dataset.preferences = JSON.stringify(host.preferences.read());
  element.dataset.title = file.name;
  let nextSource = 0;
  const audioFile = document.getElementById('audio-file');
  audioFile.addEventListener('change', () => {
    const selected = audioFile.files[0]; audioFile.value = '';
    if (!selected) return;
    const error = validateFile(selected);
    window.dispatchEvent(new MessageEvent('message', { data: error ? { type: 'audio-source-error', message: error } : {
      type: 'audio-source', source: { id: 'external-' + ++nextSource, name: selected.name, file: selected },
    } }));
  });
  document.title = `${file.name} - PanoPlayer`;
  window.acquireVsCodeApi = () => ({
    file,
    setState() {},
    postMessage(message) {
      if (message.type === 'preferences') host.preferences.save(message.patch);
      if (message.type === 'diagnostic') console.debug('PanoPlayer:', message.text);
      if (message.type === 'select-audio') audioFile.click();
    },
  });
  window.addEventListener('dragover', event => event.preventDefault());
  window.addEventListener('drop', event => {
    event.preventDefault(); host.openFiles(event.dataTransfer.files);
  });
  window.addEventListener('error', event => host.report(`Player error: ${event.message}`));
  const narrow = matchMedia('(max-width: 560px)');
  for (const title of document.querySelectorAll('.floating-titlebar')) {
    const originalTitle = title.title;
    const update = () => { title.tabIndex = narrow.matches ? -1 : 0; title.title = narrow.matches ? '' : originalTitle; };
    narrow.addEventListener('change', update); update();
    // On narrow screens analysis panels flow below the controls rather than covering them.
    for (const type of ['pointerdown', 'keydown']) title.addEventListener(type, event => {
      if (narrow.matches && !event.target.closest('button')) event.stopImmediatePropagation();
    }, true);
  }
})();

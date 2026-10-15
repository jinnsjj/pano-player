import { createIcons, FolderOpen, X, Maximize, Minimize, ExternalLink, CircleHelp } from 'lucide';
import { createPreferences, validateFile, capabilityError } from './host.js';

const $ = id => document.getElementById(id);
const preferences = createPreferences(() => localStorage);
let file = null;
let frame = null;
const icons = () => createIcons({ icons: { FolderOpen, X, Maximize, Minimize, ExternalLink, CircleHelp } });
for (const id of ['help', 'empty-help']) $(id).addEventListener('click', () => $('help-dialog').showModal());
$('help-close').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', event => {
  if (event.target !== $('help-dialog')) return;
  const bounds = event.target.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close();
});
function announce(message) {
  $('message').textContent = message || '';
  $('message').hidden = !message;
}
function closeMedia() {
  frame?.contentWindow?.__PANO_PLAYER__?.dispose();
  frame?.remove(); frame = null; file = null;
  $('filename').textContent = 'No media selected';
  $('filename').removeAttribute('title');
  $('close').disabled = true;
  $('welcome').hidden = false;
  document.title = 'PanoPlayer';
}
function openFile(candidate) {
  const error = capabilityError(window) || validateFile(candidate);
  if (error) { announce(error); return; }
  closeMedia();
  file = candidate;
  $('filename').textContent = file.name;
  $('filename').title = file.name;
  document.title = `${file.name} - PanoPlayer`;
  $('close').disabled = false;
  $('welcome').hidden = true;
  announce(null);
  // A fresh browsing context owns each media session's workers, audio graph and GPU resources.
  frame = document.createElement('iframe');
  frame.id = 'player-frame'; frame.title = 'Media player';
  frame.allow = 'autoplay; fullscreen'; frame.src = './player.html';
  $('workspace').append(frame);
}
window.panoWebHost = Object.freeze({
  getFile: () => file,
  preferences,
  report: announce,
  openFiles(files) {
    if (files.length !== 1) { announce('Select one media file at a time.'); return; }
    openFile(files[0]);
  },
});
function choose() { $('file-input').click(); }
$('open').addEventListener('click', choose);
$('empty-open').addEventListener('click', choose);
$('file-input').addEventListener('change', event => {
  if (event.target.files.length) window.panoWebHost.openFiles(event.target.files);
  event.target.value = '';
});
$('close').addEventListener('click', () => { closeMedia(); announce(null); $('open').focus(); });
let dragDepth = 0;
function clearDrop() { dragDepth = 0; $('drop-target').hidden = true; }
window.addEventListener('dragenter', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth++; $('drop-target').hidden = false;
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) clearDrop(); });
window.addEventListener('dragover', event => { event.preventDefault(); });
window.addEventListener('drop', event => {
  event.preventDefault(); clearDrop();
  window.panoWebHost.openFiles(event.dataTransfer.files);
});
window.addEventListener('blur', clearDrop);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) frame?.contentWindow?.postMessage({ type: 'suspend' }, location.origin);
});
window.addEventListener('pagehide', closeMedia);
$('fullscreen').hidden = !document.fullscreenEnabled;
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { announce('Fullscreen is unavailable in this browser.'); }
});
document.addEventListener('fullscreenchange', () => {
  const label = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  $('fullscreen').title = label; $('fullscreen').setAttribute('aria-label', label);
  $('fullscreen').innerHTML = `<i data-lucide="${document.fullscreenElement ? 'minimize' : 'maximize'}" aria-hidden="true"></i>`;
  icons();
});
icons();
announce(capabilityError(window));

'use strict';
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const { defaults, normalize } = require('./preferences.cjs');
function renderHtml({ title, cspSource, script, style, icons, omnitone, monitor, view, nonce, source, worker, worklet, decoder, pcm, stream, hostMedia = false, preferences }) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; media-src ${cspSource}; connect-src ${cspSource}; worker-src blob:; style-src ${cspSource}; script-src ${cspSource} blob: 'wasm-unsafe-eval' 'nonce-${nonce}';">
<link rel="stylesheet" href="${escape(style)}"><title>${escape(title)} - PanoPlayer</title></head>
<body>
<header>
  <div class="brand"><i data-lucide="scan" aria-hidden="true"></i><strong>PanoPlayer</strong></div>
</header>
<main>
  <div class="viewport">
    <div id="stage">
      <canvas id="video" data-defaults="${escape(JSON.stringify(defaults))}" data-preferences="${escape(JSON.stringify(normalize(preferences)))}" data-host="${hostMedia ? '1' : '0'}" data-source="${escape(source || '')}" data-decoder="${escape(decoder || '')}" data-pcm="${escape(pcm || '')}" data-worker="${escape(worker || '')}" data-worklet="${escape(worklet || '')}" data-view="${escape(view || '')}" aria-label="Panorama video"></canvas>
      <canvas id="projected" aria-label="Single-eye panorama" hidden></canvas>
      <canvas id="overlay" width="140" height="70" aria-label="FOA direction heatmap"></canvas>
      <div id="audio-poster" hidden><i data-lucide="audio-lines" aria-hidden="true"></i><span id="audio-format"></span></div>
      <div id="spatial" tabindex="0" role="region" aria-label="Perspective view; drag or use arrow keys to look, plus and minus to zoom, Home to reset" hidden></div>
      <div id="empty"><i data-lucide="film" aria-hidden="true"></i><span id="status" role="status">Loading media</span><button id="retry" hidden>Retry</button></div>
    </div>
  </div>
  <div id="transport" role="group" aria-label="Playback controls">
    <button id="play" title="Play" aria-label="Play" disabled><i data-lucide="play" aria-hidden="true"></i></button>
    <output id="time" aria-live="off">0:00 / 0:00</output>
    <input id="seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="Playback position" disabled>
    <div class="volume-controls"><button id="mute" title="Mute" aria-label="Mute" disabled><i data-lucide="volume-2" aria-hidden="true"></i></button><input id="volume" type="range" min="0" max="1" step="0.01" value="0.7" aria-label="Volume"><output id="volume-value" aria-hidden="true">70%</output></div>
    <button id="fullscreen" title="Full screen" aria-label="Full screen"><i data-lucide="maximize" aria-hidden="true"></i></button>
  </div>
  <div id="options" role="group" aria-label="Media settings">
    <div id="projection-options" role="group" aria-label="Video settings">
      <label>Projection <select id="projection" aria-label="Video projection"><option value="auto">Auto</option><option value="360">360° ERP</option><option value="180">180° ERP</option><option value="eac">EAC (3×2)</option></select></label>
      <label>Layout <select id="layout" aria-label="Stereo layout"><option value="mono">Mono</option><option value="sbs">Stereo SBS · Left</option><option value="tb">Stereo TB · Top</option></select></label>
      <div id="view-options">
        <div role="tablist" aria-label="View mode">
          <button id="view-flat" role="tab" aria-selected="true" aria-controls="stage"><i data-lucide="panels-top-left" aria-hidden="true"></i>Panorama</button>
          <button id="view-spatial" role="tab" aria-selected="false" aria-controls="stage" tabindex="-1"><i data-lucide="orbit" aria-hidden="true"></i>Perspective</button>
        </div>
        <button id="reset-view" title="Reset view" aria-label="Reset view" disabled><i data-lucide="rotate-ccw" aria-hidden="true"></i></button>
      </div>
      <button id="reset-settings" title="Restore default settings" aria-label="Restore default settings"><i data-lucide="list-restart" aria-hidden="true"></i></button>
    </div>
    <fieldset class="map-settings"><legend><i data-lucide="radar" aria-hidden="true"></i>PowerMap</legend><div class="settings-row">
      <label class="toggle"><input id="enabled" type="checkbox" checked><span>Overlay</span></label>
      <label class="opacity-control">Opacity <input id="opacity" type="range" min="0" max="1" step="0.01" value="0.75" aria-label="Overlay opacity"><output id="opacity-value" aria-hidden="true">75%</output></label>
    </div><span id="music-badge">MUSIC · 1 source</span></fieldset>
    <fieldset class="audio-settings"><legend><i data-lucide="headphones" aria-hidden="true"></i>Audio</legend><div class="settings-row">
      <label>Monitor <select id="listening" aria-label="Listening mode"><option value="binaural">Binaural</option><option value="stereo">Stereo Monitor</option><option id="bypass-option" value="bypass" hidden>Bypass</option></select></label>
      <label>Order <select id="order" aria-label="FOA channel order"><option>WYZX</option><option>WXYZ</option></select></label>
      <label>Norm <select id="normalization" aria-label="FOA input normalization"><option>SN3D</option><option>N3D</option></select></label>
    </div></fieldset>
  </div>
  <footer><span id="detail" role="status">Local media</span><span id="metrics">140 ms · 140 × 70</span></footer>
</main>
<script nonce="${nonce}" src="${escape(icons)}"></script><script nonce="${nonce}" src="${escape(omnitone)}"></script><script type="module" nonce="${nonce}" src="${escape(stream)}"></script><script type="module" nonce="${nonce}" src="${escape(monitor)}"></script><script type="module" nonce="${nonce}" src="${escape(script)}"></script></body></html>`;
}
module.exports = { renderHtml };

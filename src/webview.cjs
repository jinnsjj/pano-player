'use strict';
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const { defaults, normalize } = require('./preferences.cjs');
function meterColumn(id, label, title, clips = false) {
  return `<div class="meter-column"><output id="${id}-max" class="meter-maximum" aria-label="${title} maximum">--</output>
    <div id="${id}" class="loudness-track" role="meter" aria-label="${title}" aria-valuemin="-72" aria-valuemax="0" aria-valuenow="-72" aria-valuetext="No measurement"><span class="loudness-fill"></span><span id="${id}-hold" class="meter-hold" hidden></span></div>
    <output id="${id}-value" aria-live="off">--</output><span class="meter-caption" title="${title}">${label}</span>
    ${clips ? `<output id="${id}-clips" class="meter-clips" aria-label="${title} clipped samples" title="Clipped samples">0</output>` : '<span></span>'}</div>`;
}
function meterGroup(title, unit, kind, columns) {
  return `<section class="meter-group ${kind}" aria-label="${title}"><h3 title="${title} (${unit})">${title}<span>${unit}</span></h3><div class="meter-columns">
    <div class="meter-axis" aria-hidden="true">${[0, -12, -24, -48, -72].map(db => `<span data-db="${db}">${db}</span>`).join('')}</div>${columns}</div></section>`;
}
function renderHtml({ title, cspSource, script, style, icons, logo, omnitone, monitor, view, nonce, source, worker, worklet, decoder, pcm, stream, hostMedia = false, preferences }) {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; media-src ${cspSource}; connect-src ${cspSource}; worker-src blob:; style-src ${cspSource}; script-src ${cspSource} blob: 'wasm-unsafe-eval' 'nonce-${nonce}';">
<link rel="stylesheet" href="${escape(style)}"><title>${escape(title)} - PanoPlayer</title></head>
<body>
<header>
  <div class="brand"><img src="${escape(logo || '')}" width="32" height="32" alt="" aria-hidden="true"><strong>PanoPlayer</strong></div>
</header>
<main>
  <div class="viewport">
    <div id="stage">
      <canvas id="video" data-defaults="${escape(JSON.stringify(defaults))}" data-preferences="${escape(JSON.stringify(normalize(preferences)))}" data-host="${hostMedia ? '1' : '0'}" data-source="${escape(source || '')}" data-decoder="${escape(decoder || '')}" data-pcm="${escape(pcm || '')}" data-worker="${escape(worker || '')}" data-worklet="${escape(worklet || '')}" data-view="${escape(view || '')}" aria-label="Panorama video"></canvas>
      <canvas id="projected" aria-label="Single-eye panorama" hidden></canvas>
      <canvas id="overlay" width="140" height="70" aria-label="FOA direction heatmap"></canvas>
      <div id="audio-poster" hidden><i data-lucide="audio-lines" aria-hidden="true"></i><span id="audio-format"></span></div>
      <canvas id="direction-grid" width="2048" height="1024" aria-label="Direction grid: front 0 degrees, left positive, right negative azimuth" hidden></canvas>
      <div id="spatial" tabindex="0" role="region" aria-label="Perspective view; drag or use arrow keys to look, plus and minus to zoom, Home to reset" hidden></div>
      <div id="empty"><i data-lucide="film" aria-hidden="true"></i><span id="status" role="status">Loading media</span><button id="retry" hidden>Retry</button></div>
    </div>
  </div>
  <div id="transport" role="group" aria-label="Playback controls">
    <button id="play" title="Play" aria-label="Play" disabled><i data-lucide="play" aria-hidden="true"></i></button>
    <output id="time" aria-live="off">0:00 / 0:00</output>
    <input id="seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="Playback position" disabled>
    <div class="volume-controls"><button id="mute" title="Mute" aria-label="Mute" disabled><i data-lucide="volume-2" aria-hidden="true"></i></button><input id="volume" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume"><output id="volume-value" aria-hidden="true">100%</output></div>
    <div id="view-options">
        <div role="tablist" aria-label="View mode">
          <button id="view-flat" role="tab" title="Panorama" aria-label="Panorama" aria-selected="true" aria-controls="stage"><i data-lucide="rectangle-horizontal" aria-hidden="true"></i></button>
          <button id="view-spatial" role="tab" title="Perspective" aria-label="Perspective" aria-selected="false" aria-controls="stage" tabindex="-1"><i data-lucide="view" aria-hidden="true"></i></button>
        </div>
        <button id="reset-view" title="Reset view" aria-label="Reset view" disabled><i data-lucide="rotate-ccw" aria-hidden="true"></i></button>
    </div>
  </div>
  <div id="options" role="group" aria-label="Media settings">
    <div id="projection-options" class="settings-section" role="group" aria-labelledby="projection-heading">
      <h2 id="projection-heading"><i data-lucide="globe" aria-hidden="true"></i>Projection</h2><div class="settings-row">
      <select id="projection" aria-label="Video projection"><option value="auto">Auto</option><option value="360">360° ERP</option><option value="180">180° ERP</option><option value="eac">EAC (3×2)</option></select>
      <label>Layout <select id="layout" aria-label="Stereo layout"><option value="mono">Mono</option><option value="sbs">Stereo SBS · Left</option><option value="tb">Stereo TB · Top</option></select></label>
      <label>Rotation <select id="rotation" aria-label="Video rotation" title="Clockwise source rotation before stereo cropping and projection"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>
      <button id="reset-settings" title="Restore default settings" aria-label="Restore default settings"><i data-lucide="list-restart" aria-hidden="true"></i></button>
    </div></div>
    <div id="overlay-options" class="settings-section" role="group" aria-labelledby="overlay-heading">
      <h2 id="overlay-heading"><i data-lucide="layers" aria-hidden="true"></i>Overlay</h2><div class="settings-row">
      <div class="overlay-control" role="group" aria-label="Grid overlay">
        <label class="toggle"><input id="grid" type="checkbox"><span>Grid</span></label>
        <details id="grid-settings" class="overlay-settings">
          <summary title="Grid settings" aria-label="Grid settings" aria-controls="grid-menu"><i data-lucide="chevron-down" aria-hidden="true"></i></summary>
          <div id="grid-menu" class="overlay-menu">
            <label class="overlay-opacity">Opacity<output id="gridOpacity-value" aria-hidden="true">100%</output><input id="gridOpacity" type="range" min="0" max="1" step="0.01" value="1" aria-label="Grid opacity"></label>
          </div>
        </details>
      </div>
      <div class="overlay-control" role="group" aria-label="PowerMap overlay">
        <label class="toggle"><input id="enabled" type="checkbox"><span>PowerMap</span></label>
        <details id="powermap-settings" class="overlay-settings">
          <summary title="PowerMap settings" aria-label="PowerMap settings" aria-controls="powermap-menu"><i data-lucide="chevron-down" aria-hidden="true"></i></summary>
          <div id="powermap-menu" class="overlay-menu">
            <label>Algorithm<select id="mapAlgorithm" aria-label="PowerMap algorithm"><option value="music">MUSIC</option><option value="pwd">PWD</option></select></label>
            <label>Sources<select id="mapSources" aria-label="MUSIC sources"><option value="1">1</option><option value="2">2</option></select></label>
            <label class="overlay-opacity">Opacity<output id="opacity-value" aria-hidden="true">75%</output><input id="opacity" type="range" min="0" max="1" step="0.01" value="0.75" aria-label="PowerMap opacity"></label>
          </div>
        </details>
      </div>
      <label class="toggle"><input id="meter" type="checkbox" aria-controls="meter-overlay"><span>Meters</span></label>
      <label class="toggle" title="PanoView in Perspective"><input id="overview" type="checkbox" aria-controls="overview-overlay"><span>PanoView</span></label>
    </div></div>
    <div id="audio-options" class="settings-section" role="group" aria-labelledby="audio-heading">
      <h2 id="audio-heading"><i data-lucide="audio-lines" aria-hidden="true"></i>Audio</h2><div class="settings-row">
      <label>Monitor <select id="listening" aria-label="Listening mode"><option value="binaural">Binaural</option><option value="stereo">Stereo Monitor</option><option id="bypass-option" value="bypass" hidden>Bypass</option><option id="no-audio-option" value="none" hidden>No audio</option></select></label>
      <label>Channel <select id="order" aria-label="FOA channel order"><option>WYZX</option><option>WXYZ</option></select></label>
      <label>Norm <select id="normalization" aria-label="FOA input normalization"><option>SN3D</option><option>N3D</option></select></label>
    </div></div>
  </div>
  <footer><span id="detail" role="status">Loading media information</span></footer>
  <section class="floating-overlay" id="meter-overlay" role="dialog" aria-labelledby="meter-heading" tabindex="-1" hidden>
    <div class="floating-titlebar" id="meter-titlebar" tabindex="0" title="Drag or use arrow keys to move meters">
      <h2 id="meter-heading"><i data-lucide="audio-lines" aria-hidden="true"></i>Output Meters</h2>
      <button id="meter-reset" title="Reset all meter statistics" aria-label="Reset all meter statistics"><i data-lucide="rotate-ccw" aria-hidden="true"></i></button>
      <button id="meter-close" title="Close meters" aria-label="Close meters"><i data-lucide="x" aria-hidden="true"></i></button>
    </div>
    <div class="meter-groups">
      ${meterGroup('Peak', 'dBFS', 'peak-group', ['L', 'R'].map((label, i) => meterColumn('meter-peak-' + i, label, label + ' sample peak', true)).join(''))}
      ${meterGroup('True Peak', 'dBTP', 'true-group', ['L', 'R'].map((label, i) => meterColumn('meter-true-' + i, label, label + ' true peak', true)).join(''))}
      ${meterGroup('RMS', 'dBFS', 'rms-group', meterColumn('meter-rms-m', 'M', 'RMS momentary, 400 ms') + meterColumn('meter-rms-i', 'I', 'RMS integrated'))}
      ${meterGroup('LUFS', 'LUFS', 'lufs-group', meterColumn('meter-lufs-m', 'M', 'LUFS momentary, 400 ms') + meterColumn('meter-lufs-s', 'S', 'LUFS short-term, 3 seconds') + meterColumn('meter-lufs-i', 'I', 'LUFS integrated, gated'))}
      <section class="meter-group range-group" aria-label="Loudness range"><h3 title="Loudness range (LU)">LRA<span>LU</span></h3><div class="meter-columns"><div class="meter-column">
        <output id="meter-lra-max" class="meter-maximum" aria-label="Upper loudness range bound">--</output>
        <div id="meter-lra" class="loudness-track" role="meter" aria-label="Loudness range" aria-valuemin="0" aria-valuemax="102.3" aria-valuenow="0" aria-valuetext="No measurement"><span class="loudness-fill"></span></div>
        <output id="meter-lra-value" aria-live="off">--</output><span class="meter-caption">Range</span><span></span>
      </div></div></section>
    </div>
    <div id="meter-status" aria-live="off">Initializing</div>
  </section>
  <section class="floating-overlay" id="overview-overlay" role="dialog" aria-labelledby="overview-heading" tabindex="-1" hidden>
    <div class="floating-titlebar" id="overview-titlebar" tabindex="0" title="Drag or use arrow keys to move PanoView">
      <h2 id="overview-heading"><i data-lucide="globe" aria-hidden="true"></i>PanoView</h2>
      <button id="overview-close" title="Close PanoView" aria-label="Close PanoView"><i data-lucide="x" aria-hidden="true"></i></button>
    </div>
    <div id="overview-content"></div>
  </section>
</main>
<script nonce="${nonce}" src="${escape(icons)}"></script><script nonce="${nonce}" src="${escape(omnitone)}"></script><script type="module" nonce="${nonce}" src="${escape(stream)}"></script><script type="module" nonce="${nonce}" src="${escape(monitor)}"></script><script type="module" nonce="${nonce}" src="${escape(script)}"></script></body></html>`;
}
module.exports = { renderHtml };

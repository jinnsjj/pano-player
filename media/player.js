/* global acquireVsCodeApi, lucide */
import { drawDirectionGrid } from './direction-grid.js';
import { MeterOverlay } from './meter.js';
import { FloatingOverlay } from './floating-overlay.js';
(() => {
  'use strict';
  const api = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const video = new window.StreamPlayer($('video'), api); const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  const defaults = JSON.parse(video.dataset.defaults);
  let preferences = JSON.parse(video.dataset.preferences);
  const stats = { received: 0, discarded: 0, computeMs: 0, firstFrameMs: null, canPlayMs: null, stalls: 0 };
  const monitor = new window.FoaMonitor(video, processingError, acceptMap);
  const meters = new MeterOverlay(monitor, enabled => persist({ meter: enabled }));
  const overview = new FloatingOverlay('overview', enabled => {
    persist({ overview: enabled }); view?.setOverviewEnabled(enabled && overview.available);
  });
  let view; let viewMode = 'flat'; let viewLoading;
  let projector; let projectionLoading; let projectionRequest = 0;
  let ready = false; let mappedAt = null; let lastMap; let processingIssue = false;
  let hasVideo = true; let sourceAspect = 2; let mediaDetail = 'Native media';
  $('projection').disabled = $('layout').disabled = $('rotation').disabled = true;
  function level(id) { $(id + '-value').textContent = Math.round(Number($(id).value) * 100) + '%'; }
  function icons() { lucide.createIcons(); }
  function icon(button, name, label) { button.innerHTML = '<i data-lucide="' + name + '" aria-hidden="true"></i>'; button.setAttribute('aria-label', label); button.setAttribute('title', label); icons(); }
  function diagnostic(text) { api.postMessage({ type: 'diagnostic', text }); }
  function clear() { ctx.clearRect(0, 0, 140, 70); mappedAt = null; view?.mapChanged(); }
  function reset() { monitor.reset(); lastMap = null; clear(); }
  function updateGrid() {
    const enabled = $('grid').checked;
    drawDirectionGrid($('direction-grid'), enabled, Number($('gridOpacity').value));
    $('direction-grid').hidden = !enabled || viewMode === 'spatial';
    view?.setGridEnabled(enabled);
  }
  function persist(patch) {
    preferences = { ...preferences, ...patch };
    api.setState(preferences);
    api.postMessage({ type: 'preferences', patch });
  }
  function eyeAspect() {
    const aspect = Number($('rotation').value) % 180 ? 1 / sourceAspect : sourceAspect;
    return aspect * ($('layout').value === 'sbs' ? .5 : $('layout').value === 'tb' ? 2 : 1);
  }
  function effectiveProjection() {
    return $('projection').value === 'auto' ? (hasVideo && eyeAspect() >= .9 && eyeAspect() <= 1.1 ? '180' : '360') : $('projection').value;
  }
  function applyPreferences() {
    for (const id of ['projection', 'layout', 'rotation', 'listening', 'order', 'normalization', 'opacity', 'gridOpacity', 'volume', 'mapAlgorithm', 'mapSources']) $(id).value = preferences[id];
    $('enabled').checked = preferences.enabled;
    $('grid').checked = preferences.grid; updateGrid();
    meters.setEnabled(preferences.meter);
    overview.setEnabled(preferences.overview);
    monitor.setMode(preferences.listening); monitor.setOrder(preferences.order);
    monitor.setNormalization(preferences.normalization); monitor.setEnabled(preferences.enabled);
    monitor.setPowermap(preferences.mapAlgorithm, preferences.mapSources); updateMapControls();
    lastMap = null; clear();
    monitor.setVolume(preferences.volume); monitor.setMuted(preferences.muted);
    icon($('mute'), preferences.muted ? 'volume-x' : 'volume-2', preferences.muted ? 'Unmute' : 'Mute');
    level('opacity'); level('gridOpacity'); level('volume');
    view?.restore(preferences);
    void selectView(preferences.view);
    if (video.readyState >= 1) metadata(); else void selectProjection();
    draw();
  }
  function layoutProjection() {
    const spatial = viewMode === 'spatial';
    for (const mode of ['flat', 'spatial']) {
      $('view-' + mode).setAttribute('aria-selected', String(mode === viewMode));
      $('view-' + mode).tabIndex = mode === viewMode ? 0 : -1;
    }
    $('stage').setAttribute('role', 'tabpanel');
    $('stage').setAttribute('aria-labelledby', 'view-' + viewMode);
    const projection = effectiveProjection();
    const halfSphere = hasVideo && projection === '180';
    const style = $('stage').style;
    style.setProperty('--video-aspect', String(spatial ? 16 / 9 : hasVideo ? projection === 'eac' ? 2 : eyeAspect() * (halfSphere ? 2 : 1) : 2));
    style.setProperty('--video-left', halfSphere ? '25%' : '0%');
    style.setProperty('--video-width', halfSphere ? '50%' : '100%');
    video.hidden = !hasVideo || spatial || !!video.displayElement; canvas.hidden = spatial;
    $('projected').hidden = !hasVideo || spatial || !video.displayElement;
    $('direction-grid').hidden = spatial || !$('grid').checked;
    $('reset-view').disabled = !spatial;
    overview.setAvailable(spatial && !!view);
    view?.setOverviewEnabled(overview.enabled && overview.available);
    view?.configure(spatial, hasVideo, projection);
  }
  function renderProjection() {
    if (video.displayElement && projector?.render(video.frames)) view?.sourceChanged();
  }
  async function selectProjection() {
    const request = ++projectionRequest;
    try {
      const transformed = hasVideo && (effectiveProjection() === 'eac' || $('layout').value !== 'mono' || $('rotation').value !== '0');
      if (transformed && !projector) {
        if (!window.PanoProjection) await (projectionLoading ||= import(new URL('projection.js', video.dataset.view).href));
        if (request !== projectionRequest) return;
        projector = new window.PanoProjection($('projected'), video.element);
      }
      video.displayElement = transformed ? $('projected') : undefined;
      if (transformed) { projector.configure(effectiveProjection(), $('layout').value, Number($('rotation').value)); projector.render(video.frames); }
      layoutProjection();
    } catch (error) {
      if (request !== projectionRequest) return;
      projector?.dispose(); projector = undefined; projectionLoading = undefined;
      video.displayElement = undefined; $('projection').value = '360'; $('layout').value = 'mono'; $('rotation').value = '0';
      layoutProjection(); $('detail').textContent = 'Projection unavailable: ' + error.message;
      diagnostic('Projection: ' + error.message);
    }
  }
  function draw() {
    ctx.clearRect(0, 0, 140, 70);
    if (!lastMap || !$('enabled').checked) { view?.mapChanged(); return; }
    const rgba = new Uint8ClampedArray(lastMap);
    const opacity = Number($('opacity').value);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] *= opacity;
    ctx.putImageData(new ImageData(rgba, 140, 70), 0, 0);
    view?.mapChanged();
  }
  function acceptMap(data) {
    if (data.generation !== monitor.generation || !$('enabled').checked || Math.abs(video.currentTime - data.time) > .28
        || (mappedAt !== null && data.time < mappedAt)) { stats.discarded++; return; }
    if (data.rgba.length !== 140 * 70 * 4) return;
    processingIssue = false;
    mappedAt = data.time; lastMap = data.rgba; draw(); stats.received++; stats.computeMs = data.computeMs;
    updateDetail();
  }
  function format(time) {
    const t = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }
  function transport() {
    $('time').textContent = format(video.currentTime) + ' / ' + format(video.duration);
    $('seek').value = video.currentTime;
    $('seek').max = Number.isFinite(video.duration) ? video.duration : 0;
    $('seek').disabled = !Number.isFinite(video.duration) || video.duration <= 0;
  }
  function updateClock() {
    transport();
    updateDetail();
    if (mappedAt !== null && Math.abs(video.currentTime - mappedAt) > .28) { clear(); lastMap = null; }
  }
  function updateDetail() {
    if (processingIssue) return;
    const items = [mediaDetail];
    if (video.channels === 0) items.push('No audio');
    else {
      if (video.channels) items.push(video.channels + 'ch');
      if (video.sampleRate > 0) items.push((video.sampleRate / 1000) + ' kHz');
      if ([1, 2].includes(video.channels)) items.push('Bypass');
      else {
        items.push(monitor.order + ' / ' + monitor.normalization, monitor.ready ? monitor.mode : 'initializing spatial audio');
        items.push('PowerMap' + ($('enabled').checked ? '' : ' off') + ': ' + preferences.mapAlgorithm.toUpperCase());
        if (preferences.mapAlgorithm === 'music') items.push(preferences.mapSources + (preferences.mapSources === 1 ? ' source' : ' sources'));
        items.push('140 × 70', '140 ms interval');
        if (stats.received && $('enabled').checked) items.push(stats.computeMs.toFixed(1) + ' ms DSP');
      }
    }
    const text = items.join(' · ');
    if ($('detail').textContent !== text) $('detail').textContent = text;
  }
  function tick(now) {
    video.render();
    renderProjection();
    meters.render(now);
    if (!video.paused) { updateClock(); view?.render(); }
    requestAnimationFrame(tick);
  }
  function processingError(error) {
    processingIssue = true;
    clear(); lastMap = null;
    $('detail').textContent = error.message;
    diagnostic('DSP: ' + error.message);
  }
  function metadata() {
    const bypass = [1, 2].includes(video.channels);
    const noAudio = video.channels === 0;
    for (const id of ['enabled', 'opacity', 'order', 'normalization', 'listening']) $(id).disabled = bypass || noAudio;
    updateMapControls();
    $('volume').disabled = $('mute').disabled = noAudio;
    meters.setAvailable(!noAudio);
    $('bypass-option').hidden = !bypass;
    $('no-audio-option').hidden = !noAudio;
    if (bypass || noAudio) {
      $('listening').value = noAudio ? 'none' : 'bypass'; $('enabled').checked = false;
      monitor.enabled = false; clear(); lastMap = null;
    } else {
      $('listening').value = preferences.listening; $('enabled').checked = preferences.enabled;
      monitor.enabled = preferences.enabled;
    }
    hasVideo = video.videoWidth > 0 && video.videoHeight > 0;
    $('audio-poster').hidden = hasVideo || !bypass;
    $('audio-format').textContent = video.channels === 1 ? 'Mono audio' : 'Stereo audio';
    sourceAspect = hasVideo ? video.videoWidth / video.videoHeight : 2;
    $('projection').disabled = $('layout').disabled = $('rotation').disabled = !hasVideo;
    mediaDetail = hasVideo ? video.videoWidth + ' × ' + video.videoHeight : 'Audio';
    updateDetail();
    void selectProjection(); transport();
  }
  function firstFrame() {
    renderProjection(); if (!video.displayElement) view?.sourceChanged();
    $('empty').hidden = true;
    if (stats.firstFrameMs === null) { stats.firstFrameMs = performance.now(); diagnostic('First decoded frame: ' + stats.firstFrameMs.toFixed(1) + ' ms'); }
  }
  function canPlay() {
    ready = true; $('empty').hidden = true;
    $('play').disabled = false; $('mute').disabled = video.channels === 0; transport();
    if (stats.canPlayMs === null) { stats.canPlayMs = performance.now(); diagnostic('Streaming canplay: ' + stats.canPlayMs.toFixed(1) + ' ms'); }
  }
  video.addEventListener('loadedmetadata', metadata);
  video.addEventListener('loadeddata', firstFrame);
  video.addEventListener('canplay', canPlay);
  video.addEventListener('durationchange', transport);
  function mediaError() {
    ready = false; reset();
    const message = 'Playback failed: ' + (video.error?.message || 'codec or resource unavailable');
    $('empty').hidden = false; $('status').textContent = message; $('retry').hidden = false;
    diagnostic(message);
  }
  video.addEventListener('error', mediaError);
  video.addEventListener('seeking', reset);
  video.addEventListener('seeked', transport);
  video.addEventListener('play', () => { icon($('play'), 'pause', 'Pause'); });
  video.addEventListener('timeupdate', updateClock);
  function playbackReport() {
    const q = video.getVideoPlaybackQuality?.();
    diagnostic('Playback: ' + JSON.stringify({ ...stats, currentTime: video.currentTime,
      channels: monitor.channelCount, totalFrames: q?.totalVideoFrames, droppedFrames: q?.droppedVideoFrames }));
  }
  video.addEventListener('pause', () => { icon($('play'), 'play', 'Play'); playbackReport(); });
  video.addEventListener('waiting', () => { if (video.currentTime > 0) stats.stalls++; });
  video.addEventListener('ended', () => { icon($('play'), 'play', 'Play'); transport(); });
  $('play').disabled = $('mute').disabled = false;
  $('play').addEventListener('click', () => {
    if (!video.paused) video.pause();
    else {
      // Resume AudioContext in the gesture; PCM starts as soon as the first bounded chunk is ready.
      void monitor.resume().catch(processingError);
      void video.play().catch(error => { $('detail').textContent = error.message; });
    }
  });
  $('seek').addEventListener('input', () => { video.currentTime = Number($('seek').value); });
  for (const id of ['seek', 'volume', 'opacity', 'gridOpacity']) {
    const slider = $(id);
    slider.addEventListener('pointerdown', () => { slider.dataset.pointerFocus = ''; });
    for (const type of ['keydown', 'blur']) slider.addEventListener(type, () => { delete slider.dataset.pointerFocus; });
  }
  $('volume').addEventListener('input', () => { monitor.setVolume(Number($('volume').value)); level('volume'); persist({ volume: Number($('volume').value) }); });
  $('mute').addEventListener('click', () => {
    monitor.setMuted(!monitor.muted);
    icon($('mute'), monitor.muted ? 'volume-x' : 'volume-2', monitor.muted ? 'Unmute' : 'Mute');
    persist({ muted: monitor.muted });
  });
  $('listening').addEventListener('change', () => { monitor.setMode($('listening').value); persist({ listening: $('listening').value }); updateDetail(); });
  $('enabled').addEventListener('change', () => { monitor.setEnabled($('enabled').checked); lastMap = null; clear(); persist({ enabled: $('enabled').checked }); updateDetail(); });
  function updateMapControls() {
    $('mapAlgorithm').disabled = [0, 1, 2].includes(video.channels);
    $('mapSources').disabled = $('mapAlgorithm').disabled || $('mapAlgorithm').value !== 'music';
  }
  for (const id of ['mapAlgorithm', 'mapSources']) $(id).addEventListener('change', () => {
    const mapAlgorithm = $('mapAlgorithm').value, mapSources = Number($('mapSources').value);
    monitor.setPowermap(mapAlgorithm, mapSources); lastMap = null; clear();
    persist({ mapAlgorithm, mapSources }); updateMapControls(); updateDetail();
  });
  const menus = [$('grid-settings'), $('powermap-settings')];
  for (const menu of menus) menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
  });
  window.addEventListener('click', event => {
    for (const menu of menus) if (!menu.contains(event.target)) menu.open = false;
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const menu of menus) if (menu.open) {
      menu.open = false; menu.querySelector('summary').focus(); event.preventDefault();
    }
  });
  $('opacity').addEventListener('input', () => { level('opacity'); persist({ opacity: Number($('opacity').value) }); draw(); });
  $('projection').addEventListener('change', () => { persist({ projection: $('projection').value }); void selectProjection(); });
  $('layout').addEventListener('change', () => { persist({ layout: $('layout').value }); void selectProjection(); });
  $('rotation').addEventListener('change', () => { persist({ rotation: $('rotation').value }); void selectProjection(); });
  $('grid').addEventListener('change', () => { persist({ grid: $('grid').checked }); updateGrid(); });
  $('gridOpacity').addEventListener('input', () => { level('gridOpacity'); persist({ gridOpacity: Number($('gridOpacity').value) }); updateGrid(); });
  async function selectView(mode) {
    viewMode = mode;
    try {
      if (mode === 'spatial' && !view) {
        if (!window.FoaView) await (viewLoading ||= import(video.dataset.view));
        if (viewMode !== 'spatial') return;
        view = new window.FoaView($('spatial'), video, canvas, monitor, $('direction-grid'), $('overview-content'));
        view.setGridEnabled($('grid').checked);
        view.restore(preferences);
        view.onChange = camera => persist(camera);
      }
      layoutProjection();
    } catch (error) {
      view?.dispose(); view = undefined; viewLoading = undefined; viewMode = 'flat'; $('spatial').hidden = true;
      layoutProjection(); $('detail').textContent = 'Perspective view unavailable: ' + error.message;
    }
  }
  for (const mode of ['flat', 'spatial']) {
    $('view-' + mode).addEventListener('click', () => { persist({ view: mode }); void selectView(mode); });
    $('view-' + mode).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'flat' : event.key === 'End' ? 'spatial' : mode === 'flat' ? 'spatial' : 'flat';
      persist({ view: next }); void selectView(next); $('view-' + next).focus();
    });
  }
  $('reset-view').addEventListener('click', () => view?.reset());
  $('reset-settings').addEventListener('click', () => { persist({ ...defaults }); applyPreferences(); });
  $('order').addEventListener('change', () => { monitor.setOrder($('order').value); lastMap = null; clear(); persist({ order: $('order').value }); updateDetail(); });
  $('normalization').addEventListener('change', () => {
    monitor.setNormalization($('normalization').value); lastMap = null; clear(); updateClock();
    persist({ normalization: $('normalization').value });
  });
  $('retry').addEventListener('click', () => location.reload());
  window.addEventListener('message', ({ data }) => { if (data?.type === 'suspend') video.pause(); });
  window.addEventListener('pagehide', () => { projectionRequest++; projector?.dispose(); view?.dispose(); monitor.dispose(); });
  window.__PANO_PLAYER__ = { monitor, get view() { return view; }, getState: () => ({
    ...stats, ready, generation: monitor.generation, currentTime: video.currentTime, paused: video.paused, mappedAt,
    projection: hasVideo ? effectiveProjection() : 'audio', projectionMode: $('projection').value, preferences: { ...preferences }, layout: $('layout').value, listening: monitor.getState(), view: view?.getState(),
    videoQuality: (() => { const q = video.getVideoPlaybackQuality?.(); return q && { total: q.totalVideoFrames, dropped: q.droppedVideoFrames }; })(),
  }) };
  applyPreferences(); icons(); layoutProjection(); requestAnimationFrame(tick);
  if (video.readyState >= 2) firstFrame();
  if (video.readyState >= 3) canPlay();
  if (video.error) mediaError();
  void monitor.prepare();
})();

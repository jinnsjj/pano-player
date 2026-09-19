/* global acquireVsCodeApi, lucide */
(() => {
  'use strict';
  const api = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const video = new window.StreamPlayer($('video'), api); const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  const saved = api.getState() || {};
  const stats = { received: 0, discarded: 0, computeMs: 0, firstFrameMs: null, canPlayMs: null, stalls: 0 };
  const monitor = new window.FoaMonitor(video, processingError, acceptMap);
  let view; let viewMode = 'flat'; let viewLoading;
  let projector; let projectionLoading; let projectionRequest = 0;
  let ready = false; let mappedAt = null; let lastMap; let processingIssue = false;
  let hasVideo = true; let sourceAspect = 2; let mediaDetail = 'Native media';
  $('listening').value = 'binaural'; $('order').value = 'WYZX'; $('projection').value = '360';
  $('normalization').value = 'SN3D'; $('layout').value = 'mono';
  $('projection').disabled = $('layout').disabled = true;
  $('enabled').checked = saved.enabled !== false; $('opacity').value = saved.opacity ?? .75;
  function level(id) { $(id + '-value').textContent = Math.round(Number($(id).value) * 100) + '%'; }
  level('opacity');
  monitor.setVolume(.7); monitor.enabled = $('enabled').checked;
  function icons() { lucide.createIcons(); }
  function icon(button, name, label) { button.innerHTML = '<i data-lucide="' + name + '" aria-hidden="true"></i>'; button.setAttribute('aria-label', label); button.setAttribute('title', label); icons(); }
  function diagnostic(text) { api.postMessage({ type: 'diagnostic', text }); }
  function clear() { ctx.clearRect(0, 0, 140, 70); mappedAt = null; view?.mapChanged(); }
  function reset() { monitor.reset(); lastMap = null; clear(); }
  function persist() { api.setState({ enabled: $('enabled').checked, opacity: Number($('opacity').value) }); }
  function layoutProjection() {
    const spatial = viewMode === 'spatial';
    for (const mode of ['flat', 'spatial']) {
      $('view-' + mode).setAttribute('aria-selected', String(mode === viewMode));
      $('view-' + mode).tabIndex = mode === viewMode ? 0 : -1;
    }
    $('stage').setAttribute('role', 'tabpanel');
    $('stage').setAttribute('aria-labelledby', 'view-' + viewMode);
    const halfSphere = hasVideo && $('projection').value === '180';
    const style = $('stage').style;
    const eyeAspect = sourceAspect * ($('layout').value === 'sbs' ? .5 : $('layout').value === 'tb' ? 2 : 1);
    style.setProperty('--video-aspect', String(spatial ? 16 / 9 : hasVideo ? $('projection').value === 'eac' ? 2 : eyeAspect * (halfSphere ? 2 : 1) : 2));
    style.setProperty('--video-left', halfSphere ? '25%' : '0%');
    style.setProperty('--video-width', halfSphere ? '50%' : '100%');
    video.hidden = !hasVideo || spatial || !!video.displayElement; canvas.hidden = spatial;
    $('projected').hidden = !hasVideo || spatial || !video.displayElement;
    $('reset-view').disabled = !spatial;
    view?.configure(spatial, hasVideo, $('projection').value);
  }
  function renderProjection() {
    if (video.displayElement && projector?.render(video.frames)) view?.sourceChanged();
  }
  async function selectProjection() {
    const request = ++projectionRequest;
    try {
      const transformed = $('projection').value === 'eac' || $('layout').value !== 'mono';
      if (transformed && !projector) {
        if (!window.PanoProjection) await (projectionLoading ||= import(new URL('projection.js', video.dataset.view).href));
        if (request !== projectionRequest) return;
        projector = new window.PanoProjection($('projected'), video.element);
      }
      video.displayElement = transformed ? $('projected') : undefined;
      if (transformed) { projector.configure($('projection').value, $('layout').value); projector.render(video.frames); }
      layoutProjection();
    } catch (error) {
      if (request !== projectionRequest) return;
      projector?.dispose(); projector = undefined; projectionLoading = undefined;
      video.displayElement = undefined; $('projection').value = '360'; $('layout').value = 'mono';
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
    $('metrics').textContent = data.computeMs.toFixed(1) + ' ms DSP · 140 ms interval';
    $('detail').textContent = mediaDetail + ' · 4ch ' + monitor.order + ' / ' + monitor.normalization + ' · ' + monitor.mode;
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
    if (monitor.ready && !processingIssue) $('detail').textContent = mediaDetail + (monitor.bypass
      ? ' · ' + video.channels + 'ch · Bypass'
      : ' · 4ch ' + monitor.order + ' / ' + monitor.normalization + ' · ' + monitor.mode);
    if (mappedAt !== null && Math.abs(video.currentTime - mappedAt) > .28) { clear(); lastMap = null; }
  }
  function tick() {
    video.render();
    renderProjection();
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
    $('music-badge').hidden = bypass;
    for (const id of ['enabled', 'opacity', 'order', 'normalization', 'listening']) $(id).disabled = bypass;
    $('bypass-option').hidden = !bypass;
    if (bypass) {
      $('listening').value = 'bypass'; $('enabled').checked = false;
      monitor.enabled = false; clear(); lastMap = null; $('metrics').textContent = 'Bypass';
    }
    hasVideo = video.videoWidth > 0 && video.videoHeight > 0;
    $('audio-poster').hidden = hasVideo || !bypass;
    $('audio-format').textContent = video.channels === 1 ? 'Mono audio' : 'Stereo audio';
    sourceAspect = hasVideo ? video.videoWidth / video.videoHeight : 2;
    $('projection').disabled = $('layout').disabled = !hasVideo;
    $('projection').value = hasVideo && sourceAspect >= .9 && sourceAspect <= 1.1 ? '180' : '360';
    mediaDetail = hasVideo ? video.videoWidth + ' × ' + video.videoHeight + ' streaming preview' : bypass ? 'Audio' : 'Audio · PowerMap';
    $('detail').textContent = mediaDetail + (bypass ? ' · ' + video.channels + 'ch · Bypass' : ' · initializing spatial audio');
    layoutProjection(); transport();
  }
  function firstFrame() {
    renderProjection(); if (!video.displayElement) view?.sourceChanged();
    $('empty').hidden = true;
    if (stats.firstFrameMs === null) { stats.firstFrameMs = performance.now(); diagnostic('First decoded frame: ' + stats.firstFrameMs.toFixed(1) + ' ms'); }
  }
  function canPlay() {
    ready = true; $('empty').hidden = true;
    $('play').disabled = $('mute').disabled = false; transport();
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
  $('volume').addEventListener('input', () => { monitor.setVolume(Number($('volume').value)); level('volume'); });
  $('mute').addEventListener('click', () => {
    monitor.setMuted(!monitor.muted);
    icon($('mute'), monitor.muted ? 'volume-x' : 'volume-2', monitor.muted ? 'Unmute' : 'Mute');
  });
  $('listening').addEventListener('change', () => monitor.setMode($('listening').value));
  $('enabled').addEventListener('change', () => { monitor.setEnabled($('enabled').checked); lastMap = null; clear(); persist(); });
  $('opacity').addEventListener('input', () => { level('opacity'); persist(); draw(); });
  $('projection').addEventListener('change', () => { void selectProjection(); });
  $('layout').addEventListener('change', () => { void selectProjection(); });
  async function selectView(mode) {
    viewMode = mode;
    try {
      if (mode === 'spatial' && !view) {
        if (!window.FoaView) await (viewLoading ||= import(video.dataset.view));
        if (viewMode !== 'spatial') return;
        view = new window.FoaView($('spatial'), video, canvas, monitor);
      }
      layoutProjection();
    } catch (error) {
      view?.dispose(); view = undefined; viewLoading = undefined; viewMode = 'flat'; $('spatial').hidden = true;
      layoutProjection(); $('detail').textContent = 'Perspective view unavailable: ' + error.message;
    }
  }
  for (const mode of ['flat', 'spatial']) {
    $('view-' + mode).addEventListener('click', () => { void selectView(mode); });
    $('view-' + mode).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'flat' : event.key === 'End' ? 'spatial' : mode === 'flat' ? 'spatial' : 'flat';
      void selectView(next); $('view-' + next).focus();
    });
  }
  $('reset-view').addEventListener('click', () => view?.reset());
  $('order').addEventListener('change', () => { monitor.setOrder($('order').value); lastMap = null; clear(); });
  $('normalization').addEventListener('change', () => {
    monitor.setNormalization($('normalization').value); lastMap = null; clear(); updateClock();
  });
  $('retry').addEventListener('click', () => location.reload());
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.body.requestFullscreen(); }
    catch { $('detail').textContent = 'Use VS Code: Toggle Full Screen.'; }
  });
  window.addEventListener('message', ({ data }) => { if (data?.type === 'suspend') video.pause(); });
  window.addEventListener('pagehide', () => { projectionRequest++; projector?.dispose(); view?.dispose(); monitor.dispose(); });
  window.__FOA_POWERMAP__ = { monitor, get view() { return view; }, getState: () => ({
    ...stats, ready, generation: monitor.generation, currentTime: video.currentTime, paused: video.paused, mappedAt,
    projection: hasVideo ? $('projection').value : 'audio', layout: $('layout').value, listening: monitor.getState(), view: view?.getState(),
    videoQuality: (() => { const q = video.getVideoPlaybackQuality?.(); return q && { total: q.totalVideoFrames, dropped: q.droppedVideoFrames }; })(),
  }) };
  icons(); layoutProjection(); requestAnimationFrame(tick);
  if (video.readyState >= 1) metadata();
  if (video.readyState >= 2) firstFrame();
  if (video.readyState >= 3) canPlay();
  if (video.error) mediaError();
  void monitor.prepare();
})();

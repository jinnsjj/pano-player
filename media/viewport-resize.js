export function attachViewportResize(stage, handle, layout, transport) {
  let pointer, lastMax;
  const events = new AbortController();
  const on = (type, listener) => handle.addEventListener(type, listener, { signal: events.signal });
  const limits = () => {
    const style = getComputedStyle(stage.parentElement);
    const width = stage.parentElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const aspect = Number(getComputedStyle(stage).getPropertyValue('--video-aspect')) || 2;
    const padding = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, property) => sum + (parseFloat(style[property]) || 0), 0);
    // Keep the transport and a usable portion of settings visible, even after manual resizing.
    const settingsHeight = Math.min(160, layout.clientHeight / 3);
    const available = layout.clientHeight - transport.getBoundingClientRect().height
      - handle.getBoundingClientRect().height - padding - settingsHeight;
    const max = Math.max(1, Math.min(available, width / aspect));
    return { min: Math.min(120, max), max };
  };
  const sync = () => {
    const { min, max } = limits();
    if (max !== lastMax) { stage.style.setProperty('--stage-max-height', `${max}px`); lastMax = max; }
    handle.setAttribute('aria-valuemin', Math.round(min));
    handle.setAttribute('aria-valuemax', Math.round(max));
    handle.setAttribute('aria-valuenow', Math.round(stage.getBoundingClientRect().height));
  };
  const resize = height => {
    const { min, max } = limits();
    stage.style.setProperty('--stage-height', `${Math.max(min, Math.min(max, height))}px`);
  };
  on('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    pointer = { id: event.pointerId, y: event.clientY };
    handle.setPointerCapture(event.pointerId); handle.focus(); event.preventDefault();
  });
  on('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    resize(stage.getBoundingClientRect().height + event.clientY - pointer.y);
    pointer.y = event.clientY;
  });
  const release = event => {
    if (pointer?.id !== event.pointerId) return;
    pointer = undefined;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  on('pointerup', release); on('pointercancel', release);
  on('lostpointercapture', () => { pointer = undefined; });
  on('keydown', event => {
    const { min, max } = limits();
    const height = stage.getBoundingClientRect().height;
    const next = { ArrowUp: height - 20, ArrowDown: height + 20, Home: min, End: max }[event.key];
    if (next === undefined) return;
    event.preventDefault(); event.stopPropagation(); resize(next);
  });
  on('dblclick', () => { stage.style.removeProperty('--stage-height'); });
  const observer = new ResizeObserver(sync);
  for (const element of [stage, stage.parentElement, layout, transport, handle]) observer.observe(element);
  window.addEventListener('resize', sync, { signal: events.signal }); sync();
  return () => { events.abort(); observer.disconnect(); };
}

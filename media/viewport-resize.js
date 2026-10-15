export function attachViewportResize(stage, handle) {
  let pointer;
  const events = new AbortController();
  const on = (type, listener) => handle.addEventListener(type, listener, { signal: events.signal });
  const limits = () => {
    const style = getComputedStyle(stage.parentElement);
    const width = stage.parentElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const aspect = Number(getComputedStyle(stage).getPropertyValue('--video-aspect')) || 2;
    const max = Math.max(1, Math.min(window.innerHeight, width / aspect));
    return { min: Math.min(120, max), max };
  };
  const sync = () => {
    const { min, max } = limits();
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
  const observer = new ResizeObserver(sync); observer.observe(stage); observer.observe(stage.parentElement);
  window.addEventListener('resize', sync, { signal: events.signal }); sync();
  return () => { events.abort(); observer.disconnect(); };
}

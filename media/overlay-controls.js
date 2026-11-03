export function attachOverlayDisclosure(button, panel) {
  const events = new AbortController();
  const setOpen = open => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  const closeOnEscape = event => {
    if (event.key !== 'Escape' || panel.hidden) return;
    setOpen(false); button.focus(); event.preventDefault(); event.stopPropagation();
  };
  button.addEventListener('click', () => setOpen(panel.hidden), { signal: events.signal });
  for (const element of [button, panel]) element.addEventListener('keydown', closeOnEscape, { signal: events.signal });
  setOpen(false);
  return () => { events.abort(); setOpen(false); };
}

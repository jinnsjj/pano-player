const $ = id => document.getElementById(id);

export class FloatingOverlay {
  constructor(id, onChange) {
    this.panel = $(id + '-overlay'); this.toggle = $(id); this.available = true;
    const toggle = enabled => {
      this.setEnabled(enabled); onChange(enabled);
      (enabled ? this.panel : this.toggle).focus({ preventScroll: true });
    };
    this.toggle.addEventListener('change', () => toggle(this.toggle.checked));
    $(id + '-close').addEventListener('click', () => toggle(false));
    this.panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); toggle(false); } });
    const title = $(id + '-titlebar');
    title.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const bounds = this.panel.getBoundingClientRect();
      this.drag = { x: event.clientX - bounds.x, y: event.clientY - bounds.y };
      title.focus({ preventScroll: true });
      title.setPointerCapture(event.pointerId); event.preventDefault();
    });
    title.addEventListener('pointermove', event => {
      if (this.drag) this.position(event.clientX - this.drag.x, event.clientY - this.drag.y);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) title.addEventListener(type, () => { this.drag = null; });
    title.addEventListener('keydown', event => {
      if (event.target !== title || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const bounds = this.panel.getBoundingClientRect(), step = event.shiftKey ? 40 : 10;
      this.position(bounds.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
        bounds.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
    });
    window.addEventListener('resize', () => this.clamp());
  }
  clamp() {
    if (!this.panel.hidden) { const bounds = this.panel.getBoundingClientRect(); this.position(bounds.x, bounds.y); }
  }
  position(x, y) {
    const bounds = this.panel.getBoundingClientRect();
    this.panel.style.left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, x)) + 'px';
    this.panel.style.top = Math.max(8, Math.min(window.innerHeight - bounds.height - 8, y)) + 'px';
    this.panel.style.right = 'auto';
  }
  setEnabled(enabled) {
    this.enabled = Boolean(enabled); this.toggle.checked = this.enabled;
    this.panel.hidden = !this.enabled || !this.available;
    this.clamp();
  }
  setAvailable(available) {
    this.available = available; this.toggle.disabled = !available;
    this.setEnabled(this.enabled);
  }
}

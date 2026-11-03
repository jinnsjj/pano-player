export class OverlayLayer {
  constructor({ id, stage, getView, projectionUrl, order = 2, onError }) {
    this.id = id; this.stage = stage; this.getView = getView; this.projectionUrl = projectionUrl;
    this.order = order; this.onError = onError; this.frame = 0;
    this.canvas = document.createElement('canvas');
    this.output = document.createElement('canvas'); this.output.width = 2048; this.output.height = 1024;
    this.output.hidden = true; this.output.setAttribute('aria-hidden', 'true');
    this.output.dataset.pluginLayer = id; this.output.style.zIndex = String(order);
    stage.insertBefore(this.output, stage.querySelector('#center-marker'));
    this.projected = document.createElement('canvas');
  }
  update({ visible = true } = {}) { this.visible = Boolean(visible); this.render(this.settings, true); }
  render(settings, force = false) {
    if (this.disposed || !settings) return;
    this.settings = settings;
    const visible = this.visible && settings.hasVideo;
    const transformed = settings.projection === 'eac' || settings.layout !== 'mono' || settings.rotation !== 0;
    const view = this.getView();
    this.output.hidden = !visible || settings.viewMode === 'spatial' || (transformed && !this.projector);
    const key = [visible, settings.projection, settings.layout, settings.rotation, settings.viewMode].join('|');
    if (!force && key === this.key && view === this.view) return;
    this.key = key; this.view = view;
    if (!visible) {
      this.output.getContext('2d').clearRect(0, 0, 2048, 1024);
      view?.setOverlayLayer(this.id, this.output, false, this.order); return;
    }
    let image = this.canvas;
    if (transformed) {
      if (!this.projector) {
        if (!this.loading) this.loading = this.prepare().catch(error => {
          if (!this.disposed) this.onError(error);
        });
        view?.setOverlayLayer(this.id, this.output, false, this.order); return;
      }
      this.projector.configure(settings.projection, settings.layout, settings.rotation);
      this.projector.render(++this.frame); image = this.projected;
    }
    const context = this.output.getContext('2d'), half = settings.projection === '180';
    context.clearRect(0, 0, 2048, 1024);
    context.drawImage(image, half ? 512 : 0, 0, half ? 1024 : 2048, 1024);
    view?.setOverlayLayer(this.id, this.output, true, this.order);
  }
  async prepare() {
    if (!window.PanoProjection) await import(new URL('projection.js', this.projectionUrl).href);
    if (this.disposed) return;
    this.projector = new window.PanoProjection(this.projected, this.canvas); this.render(this.settings, true);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.getView()?.removeOverlayLayer(this.id); this.projector?.dispose(); this.output.remove();
  }
}

import { Scene, PerspectiveCamera, SphereGeometry, VideoTexture, CanvasTexture,
  MeshBasicMaterial, Mesh, WebGLRenderer, SRGBColorSpace, LinearFilter } from './three.module.js';
import { viewFootprint } from './view-footprint.js';

class FoaView {
  constructor(host, video, map, monitor) {
    this.host = host; this.video = video; this.monitor = monitor;
    this.yaw = 0; this.pitch = 0; this.active = false;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(72, 2, .1, 100);
    this.camera.rotation.order = 'YXZ';
    this.geometry = new SphereGeometry(10, 64, 40);
    this.geometry.scale(-1, 1, 1); this.geometry.rotateY(-Math.PI / 2);
    this.videoTexture = video.element ? new CanvasTexture(video.displayElement || video.element) : new VideoTexture(video); this.videoTexture.colorSpace = SRGBColorSpace;
    this.mapTexture = new CanvasTexture(map);
    for (const texture of [this.videoTexture, this.mapTexture]) {
      texture.minFilter = texture.magFilter = LinearFilter; texture.generateMipmaps = false;
    }
    this.picture = new MeshBasicMaterial({ map: this.videoTexture });
    // 180 ERP occupies the front half; never stretch or repeat it onto the rear.
    this.picture.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
        'if (vMapUv.x < 0.0 || vMapUv.x > 1.0) discard;\n#include <map_fragment>');
    };
    this.background = new Mesh(this.geometry, this.picture); this.scene.add(this.background);
    this.heatmap = new MeshBasicMaterial({ map: this.mapTexture, transparent: true, depthWrite: false });
    this.overlay = new Mesh(this.geometry, this.heatmap); this.overlay.scale.setScalar(.992);
    this.scene.add(this.overlay);
    this.gpu = new WebGLRenderer({ antialias: true });
    this.gpu.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    host.append(this.gpu.domElement);
    this.thumbnail = document.createElement('canvas');
    this.thumbnail.id = 'pano-thumbnail'; this.thumbnail.width = 240; this.thumbnail.height = 120;
    this.thumbnail.setAttribute('aria-label', 'Panorama overview with current field of view');
    host.append(this.thumbnail);
    this.thumbContext = this.thumbnail.getContext('2d');
    this.footprint = document.createElement('canvas'); this.footprint.width = 240; this.footprint.height = 120;
    this.resize = new ResizeObserver(() => this.render()); this.resize.observe(host);
    this.events = new AbortController();
    const on = (type, callback, options = {}) => host.addEventListener(type, callback, { ...options, signal: this.events.signal });
    on('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      host.setPointerCapture(event.pointerId); host.focus();
    });
    on('pointermove', event => {
      if (this.pointer?.id !== event.pointerId) return;
      this.orient(this.yaw + (event.clientX - this.pointer.x) * .005,
        this.pitch + (event.clientY - this.pointer.y) * .005);
      this.pointer.x = event.clientX; this.pointer.y = event.clientY;
    });
    on('lostpointercapture', () => { this.pointer = null; });
    on('wheel', event => { event.preventDefault(); this.zoom(this.camera.fov + event.deltaY * .05); }, { passive: false });
    on('keydown', event => {
      const direction = { ArrowLeft: [.1, 0], ArrowRight: [-.1, 0], ArrowUp: [0, .1], ArrowDown: [0, -.1] }[event.key];
      if (direction) { event.preventDefault(); this.orient(this.yaw + direction[0], this.pitch + direction[1]); }
      else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); this.zoom(this.camera.fov + (event.key === '-' ? 5 : -5)); }
      else if (event.key === 'Home') { event.preventDefault(); this.reset(); }
    });
  }
  configure(active, hasVideo, projection) {
    this.active = active; this.host.hidden = !active;
    this.background.visible = hasVideo;
    this.videoTexture.repeat.x = projection === '180' ? 2 : 1;
    this.videoTexture.offset.x = projection === '180' ? -.5 : 0;
    const image = this.video.displayElement || this.video.element || this.video;
    if (image !== this.videoTexture.image || image.width !== this.sourceWidth || image.height !== this.sourceHeight) {
      // Reallocate storage when a paused layout switch changes the canvas dimensions.
      this.videoTexture.dispose(); this.videoTexture.image = image;
      this.sourceWidth = image.width; this.sourceHeight = image.height;
    }
    this.thumbnailAt = 0;
    this.sourceChanged();
    this.orient(this.yaw, this.pitch);
  }
  orient(yaw, pitch) {
    const previousYaw = this.yaw, previousPitch = this.pitch;
    this.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.pitch = Math.max(-Math.PI / 2 + .05, Math.min(Math.PI / 2 - .05, pitch));
    this.camera.rotation.set(this.active ? this.pitch : 0, this.active ? this.yaw : 0, 0, 'YXZ');
    this.camera.updateMatrixWorld(true);
    this.monitor.setOrientation(this.camera.matrixWorld);
    this.render();
    if (Math.abs(this.yaw - previousYaw) > 1e-10 || Math.abs(this.pitch - previousPitch) > 1e-10) this.changed();
  }
  changed() { this.onChange?.({ yaw: this.yaw, pitch: this.pitch, fov: this.camera.fov }); }
  zoom(fov) { this.camera.fov = Math.max(35, Math.min(110, fov)); this.render(); this.changed(); }
  restore({ yaw, pitch, fov }) { this.camera.fov = fov; this.orient(yaw, pitch); }
  reset() { this.camera.fov = 72; this.orient(0, 0); this.changed(); }
  mapChanged() { this.mapTexture.needsUpdate = true; this.render(); }
  sourceChanged() { this.videoTexture.needsUpdate = true; if (this.video.paused) this.render(); }
  render() {
    if (!this.active) return;
    // A texture created while paused may never receive a video-frame callback.
    if (this.video.readyState >= 2 && this.frameTime !== this.video.currentTime) {
      this.videoTexture.needsUpdate = true; this.frameTime = this.video.currentTime;
    }
    const width = this.host.clientWidth; const height = this.host.clientHeight;
    if (!width || !height) return;
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height; this.gpu.setSize(width, height, false);
    }
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.gpu.render(this.scene, this.camera);
    this.drawThumbnail();
  }
  drawThumbnail() {
    const key = [this.yaw, this.pitch, this.camera.fov, this.camera.aspect].join(',');
    const changed = key !== this.footprintKey;
    if (changed) {
      this.footprintKey = key;
      this.footprint.getContext('2d').putImageData(new ImageData(
        viewFootprint(this.camera.matrixWorld.elements, this.camera.fov, this.camera.aspect, 240, 120), 240, 120), 0, 0);
    }
    // The overview needs only 10 video updates/sec; camera changes remain immediate.
    const now = performance.now();
    if (!changed && now - (this.thumbnailAt || 0) < 100) return;
    this.thumbnailAt = now;
    const ctx = this.thumbContext;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 240, 120);
    if (this.background.visible && this.video.readyState >= 2) {
      const half = this.videoTexture.repeat.x === 2;
      ctx.drawImage(this.videoTexture.image, half ? 60 : 0, 0, half ? 120 : 240, 120);
    }
    ctx.drawImage(this.mapTexture.image, 0, 0, 240, 120);
    ctx.drawImage(this.footprint, 0, 0);
  }
  dispose() {
    this.events.abort(); this.resize.disconnect();
    for (const resource of [this.geometry, this.videoTexture, this.mapTexture, this.picture, this.heatmap, this.gpu]) resource.dispose();
    this.gpu.domElement.remove();
    this.thumbnail.remove();
  }
  getState() { return { active: this.active, yaw: this.yaw, pitch: this.pitch, fov: this.camera.fov }; }
}
window.FoaView = FoaView;

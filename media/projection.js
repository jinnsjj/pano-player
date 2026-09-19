import { Scene, Camera, PlaneGeometry, Mesh, ShaderMaterial, CanvasTexture,
  WebGLRenderer, LinearFilter, Vector2 } from './three.module.js';

// EAC 3x2: left/front/right, down/back/up, with the conventional two-pixel padding.
// Coordinates use x=right, y=down, z=front, matching FFmpeg v360's EAC layout.
export const projectionFragment = `
uniform sampler2D source;
uniform vec2 eyeSize;
uniform vec2 crop;
uniform bool eac;
varying vec2 texCoord;
const float PI = 3.141592653589793;
vec2 eacUV(vec2 uv) {
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (uv.y - 0.5) * PI;
  vec3 d = vec3(sin(lon) * cos(lat), sin(lat), cos(lon) * cos(lat));
  vec3 a = abs(d);
  vec2 face, p;
  if (a.y >= a.x && a.y >= a.z) {
    face = vec2(d.y > 0.0 ? 0.0 : 2.0, 1.0);
    p = vec2(-d.z / d.y, -d.x / a.y);
  } else if (a.x >= a.z) {
    face = vec2(d.x > 0.0 ? 2.0 : 0.0, 0.0);
    p = vec2(-d.z / d.x, d.y / a.x);
  } else if (d.z > 0.0) {
    face = vec2(1.0, 0.0); p = d.xy / d.z;
  } else {
    face = vec2(1.0, 1.0); p = vec2(d.y, d.x) / d.z;
  }
  p = atan(p) * (2.0 / PI) + 0.5;
  vec2 pad = 2.0 / eyeSize;
  return vec2((p.x + face.x) * (1.0 - 2.0 * pad.x) / 3.0 + pad.x,
    p.y * (0.5 - 2.0 * pad.y) + pad.y + 0.5 * face.y);
}
void main() {
  vec2 uv = vec2(texCoord.x, 1.0 - texCoord.y);
  if (eac) uv = eacUV(uv);
  // Clamp inside the selected eye, so filtering cannot bleed the other eye.
  uv = clamp(uv, 0.5 / eyeSize, 1.0 - 0.5 / eyeSize) * crop;
  gl_FragColor = texture2D(source, vec2(uv.x, 1.0 - uv.y));
}`;

export class PanoProjection {
  constructor(canvas, source) {
    this.source = source;
    this.texture = new CanvasTexture(source);
    this.texture.minFilter = this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new ShaderMaterial({
      uniforms: { source: { value: this.texture }, eyeSize: { value: new Vector2() },
        crop: { value: new Vector2(1, 1) }, eac: { value: false } },
      vertexShader: 'varying vec2 texCoord; void main() { texCoord = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: projectionFragment,
      depthTest: false, depthWrite: false,
    });
    this.geometry = new PlaneGeometry(2, 2);
    this.scene = new Scene(); this.scene.add(new Mesh(this.geometry, this.material));
    this.camera = new Camera();
    // Spatial textures and the overview also sample this canvas while paused.
    this.gpu = new WebGLRenderer({ canvas, preserveDrawingBuffer: true });
    this.gpu.debug.onShaderError = () => { throw new Error('Projection shader could not compile.'); };
  }
  configure(projection, layout) {
    const crop = this.material.uniforms.crop.value;
    crop.set(layout === 'sbs' ? .5 : 1, layout === 'tb' ? .5 : 1);
    const width = Math.max(1, Math.floor(this.source.width * crop.x));
    const height = Math.max(1, Math.floor(this.source.height * crop.y));
    this.material.uniforms.eyeSize.value.set(width, height);
    this.material.uniforms.eac.value = projection === 'eac';
    // Match angular resolution along the equator, without exceeding the GPU limit.
    const outWidth = projection === 'eac' ? Math.round(width * 4 / 3) : width;
    const outHeight = projection === 'eac' ? Math.round(outWidth / 2) : height;
    const scale = Math.min(1, this.gpu.capabilities.maxTextureSize / Math.max(outWidth, outHeight));
    this.gpu.setSize(Math.max(1, Math.floor(outWidth * scale)), Math.max(1, Math.floor(outHeight * scale)), false);
    this.frame = undefined;
  }
  render(frame) {
    if (frame === this.frame) return false;
    this.frame = frame; this.texture.needsUpdate = true;
    this.gpu.render(this.scene, this.camera); return true;
  }
  dispose() {
    for (const resource of [this.texture, this.material, this.geometry, this.gpu]) resource.dispose();
  }
}
window.PanoProjection = PanoProjection;

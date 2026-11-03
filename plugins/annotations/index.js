import { AnnotationOverlay } from './annotation-overlay.js';

export function activate(api) {
  if (api.apiVersion !== 1) throw new Error('PanoPlayer plugin API 1 is required.');
  return new AnnotationOverlay(api);
}

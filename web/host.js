import { normalize } from '../src/preferences.cjs';

export const preferencesKey = 'panoplayer.web.preferences.v1';
export function createPreferences(getStorage) {
  let current = normalize();
  try { current = normalize(JSON.parse(getStorage().getItem(preferencesKey))); } catch {}
  return {
    read: () => ({ ...current }),
    save(patch) {
      current = normalize({ ...current, ...patch });
      try { getStorage().setItem(preferencesKey, JSON.stringify(current)); } catch {}
    },
  };
}

export function validateFile(file) {
  if (!file || typeof file.slice !== 'function') return 'Select a local media file.';
  if (!file.size) return 'This file is empty. Select another file.';
  if (!/\.(mp4|webm|wav|flac|mov|mkv)$/i.test(file.name)) {
    return 'Unsupported file type. Select MP4, WebM, WAV, FLAC, MOV or MKV.';
  }
  return null;
}

export function capabilityError(scope) {
  if (!scope.isSecureContext) return 'Open PanoPlayer over HTTPS or localhost.';
  if (!scope.Worker || !scope.AudioContext || !scope.AudioWorkletNode || !scope.VideoDecoder) {
    return 'This browser is missing required media APIs. Open PanoPlayer in a recent Chrome or Edge browser.';
  }
  return null;
}

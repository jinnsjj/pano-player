export const pluginApiVersion = 1;
export const pluginPackageLimit = 5 * 1024 * 1024;

export function validatePluginPackage(value) {
  if (!value || value.format !== 'panoplayer-plugin' || value.apiVersion !== pluginApiVersion) {
    throw new Error('This package requires a different PanoPlayer plugin API. Supported API: 1.');
  }
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(value.id)) throw new Error('Invalid plugin ID.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) throw new Error('Invalid plugin name.');
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.version) || value.version.length > 64) throw new Error('Invalid plugin version.');
  if (typeof value.code !== 'string' || !value.code.trim() || value.code.length > 4 * 1024 * 1024) throw new Error('Invalid plugin module.');
  if (value.css !== undefined && (typeof value.css !== 'string' || value.css.length > 512 * 1024)) throw new Error('Invalid plugin stylesheet.');
  return { format: value.format, apiVersion: value.apiVersion, id: value.id, name: value.name,
    version: value.version, code: value.code, css: value.css || '' };
}

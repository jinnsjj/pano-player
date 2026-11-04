const maxPayloadBytes = 1024 * 1024;
const maxResources = 1024;
const maxResourceLength = 32768;
const formats = [
  ['application/vnd.code.uri-list', 'uri-list'],
  ['resourceurls', 'uris'],
  ['codefiles', 'paths'],
  ['text/uri-list', 'uri-list'],
];

export function parseDropResources(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  for (const [format, kind] of formats) {
    const type = types.find(value => typeof value === 'string' && value.toLowerCase() === format);
    if (!type) continue;
    const payload = dataTransfer.getData(type);
    if (typeof payload !== 'string') throw new Error('Invalid dropped resource payload.');
    if (payload.length > maxPayloadBytes || new TextEncoder().encode(payload).byteLength > maxPayloadBytes) {
      throw new Error('Dropped resource payload exceeds 1 MiB.');
    }
    if (!payload.trim()) return [];
    let values;
    if (kind === 'uri-list') {
      values = payload.split(/\r\n|\n|\r/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    } else {
      try { values = JSON.parse(payload); }
      catch { throw new Error('Invalid dropped resource JSON.'); }
    }
    if (!Array.isArray(values)) throw new Error('Dropped resources must be a list of strings.');
    if (values.length > maxResources) throw new Error('Too many dropped resources (maximum 1,024).');
    const seen = new Set(), resources = [];
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Dropped resources must contain nonempty strings.');
      if (value.length > maxResourceLength) throw new Error('A dropped resource exceeds 32,768 characters.');
      if (kind === 'paths') {
        if (!value.startsWith('/') && !/^[a-z]:[\\/]/i.test(value)) throw new Error('Dropped file paths must be absolute.');
      } else {
        try { new URL(value); }
        catch { throw new Error('Dropped resource URIs must be absolute URLs.'); }
      }
      if (seen.has(value)) continue;
      seen.add(value); resources.push(kind === 'paths' ? { path: value } : { uri: value });
    }
    return resources;
  }
  return null;
}

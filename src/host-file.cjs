const fs = require('node:fs/promises');

// The webview pipelines one read ahead per stream, ramping chunks up to 1 MiB.
// Video, audio, envelope and external-audio readers can overlap, so allow
// enough in-flight reads for all of them while keeping memory bounded (16 MiB).
const maxLength = 1048576;
const maxActive = 16;

function hostFile(file, reply) {
  let handle, size, disposed = false, active = 0;
  return {
    async read(message) {
      const { id, offset, length } = message;
      if (!Number.isSafeInteger(id) || id < 0) return;
      try {
        if (disposed || active >= maxActive || !Number.isSafeInteger(offset) || offset < 0 ||
            !Number.isSafeInteger(length) || length < 1 || length > maxLength) throw new Error('Invalid media range request.');
        active++;
        try {
          handle ??= fs.open(file, 'r');
          const fd = await handle;
          size ??= (await fd.stat()).size;
          // A dedicated buffer (not Node's shared pool) can be posted without another copy.
          const data = new Uint8Array(Math.min(length, Math.max(0, size - offset)));
          const { bytesRead } = data.length ? await fd.read(data, 0, data.length, offset) : { bytesRead: 0 };
          if (!disposed) await reply({ type: 'media-range', id, size,
            data: bytesRead === data.length ? data.buffer : data.buffer.slice(0, bytesRead) });
        } finally { active--; }
      } catch (error) { if (!disposed) await reply({ type: 'media-range', id, error: error.message }); }
    },
    dispose() { disposed = true; void handle?.then(fd => fd.close()).catch(() => {}); },
  };
}
module.exports = { hostFile, maxLength, maxActive };

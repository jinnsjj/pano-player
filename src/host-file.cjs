const fs = require('node:fs/promises');

function hostFile(file, reply) {
  let handle, size, disposed = false, active = 0;
  return {
    async read(message) {
      const { id, offset, length } = message;
      if (!Number.isSafeInteger(id) || id < 0) return;
      try {
        if (disposed || active >= 4 || !Number.isSafeInteger(offset) || offset < 0 ||
            !Number.isSafeInteger(length) || length < 1 || length > 262144) throw new Error('Invalid media range request.');
        active++;
        try {
          handle ??= fs.open(file, 'r');
          const fd = await handle;
          size ??= (await fd.stat()).size;
          const data = Buffer.alloc(Math.min(length, Math.max(0, size - offset)));
          const { bytesRead } = await fd.read(data, 0, data.length, offset);
          if (!disposed) await reply({ type: 'media-range', id, size, data: data.buffer.slice(data.byteOffset, data.byteOffset + bytesRead) });
        } finally { active--; }
      } catch (error) { if (!disposed) await reply({ type: 'media-range', id, error: error.message }); }
    },
    dispose() { disposed = true; void handle?.then(fd => fd.close()).catch(() => {}); },
  };
}
module.exports = { hostFile };

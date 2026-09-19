const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runProcess, AnalyzerClient } = require('../src/media.cjs');
test('process errors include actionable executable name', async () => {
  await assert.rejects(runProcess('/no/such/ffmpeg', []), /ffmpeg/);
});
test('process execution preserves argument boundaries', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', "a '; b"]);
  assert.equal(result, "a '; b");
});
test('abort terminates and rejects process', async () => {
  const controller = new AbortController();
  const result = runProcess(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, /cancel/i);
});
test('already aborted process never starts', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal }), /cancel/i);
});

const fs = require('node:fs/promises');
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${process.env.FOA_CDP_PORT || 19338}/json/list`)).json();
  const target = list.find(x => x.type === 'iframe' && x.url.includes('spatial-audio-tools.foa-powermap-player'));
  if (!target) throw new Error('FOA Webview not found');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const requests = new Map();
  const network = [];
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { requests.get(m.id)?.(m); requests.delete(m.id); } else if (m.method === 'Network.responseReceived' || m.method === 'Network.loadingFailed') network.push(m); };
  const send = (method, params) => new Promise(resolve => { const n = ++id; requests.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const expression = process.argv[2] === '--file' ? await fs.readFile(process.argv[3], 'utf8') : process.argv[2];
  if (process.env.FOA_NETWORK) await send('Network.enable', {});
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  const value = result.result?.result?.value;
  if (process.env.FOA_REPORT && value) await fs.writeFile(process.env.FOA_REPORT, JSON.stringify(value, null, 2));
  if (value?.samples) {
    const latency = value.samples.map(s => s.computeMs).sort((a, b) => a - b);
    console.log(JSON.stringify({ ...value, samples: undefined, sampleCount: value.samples.length,
      dspMedianMs: latency[Math.floor(latency.length / 2)], dspP95Ms: latency[Math.floor(latency.length * .95)],
      maxMapAge: Math.max(...value.samples.filter(s => s.mappedAt !== null).map(s => Math.abs(s.currentTime - s.mappedAt))) }, null, 2));
  } else console.log(JSON.stringify(result, null, 2));
  if (process.env.FOA_NETWORK) {
    console.log(JSON.stringify(network, null, 2));
    for (const n of network.filter(n => n.method === 'Network.responseReceived')) {
      const body = await send('Network.getResponseBody', { requestId: n.params.requestId });
      if (body.result) {
        const bytes = Buffer.from(body.result.body, body.result.base64Encoded ? 'base64' : 'utf8');
        console.log({ length: bytes.length, first: bytes.subarray(0, 20).toString('hex') });
      } else console.log(body);
    }
  }
  ws.close();
  if (result.result?.exceptionDetails || result.error) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

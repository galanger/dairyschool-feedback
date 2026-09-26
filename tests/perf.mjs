// Page weight and time-to-usable for a participant on a slow mobile connection (production path).
import { chromium, devices } from 'playwright-core';
import { startServer, SEM } from './fake-gas-server.mjs';
const BASE = 'http://127.0.0.1:8765/';
const server = await startServer(8790);
const browser = await chromium.launch({ channel: 'chrome' });
for (const [label, net] of [['Slow 3G (400 kb/s, 400 ms)', { d: 400 * 1024 / 8, u: 400 * 1024 / 8, l: 400 }], ['Fast 3G (1.6 Mb/s, 150 ms)', { d: 1.6 * 1024 * 1024 / 8, u: 750 * 1024 / 8, l: 150 }]]) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], bypassCSP: true });
  await ctx.route('**/config.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.DSF_CONFIG={backendUrl:'http://127.0.0.1:8790/exec',defaultSeminar:null};" }));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.l, downloadThroughput: net.d, uploadThroughput: net.u });
  let bytes = 0; const files = [];
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  page.on('response', (r) => files.push(r.url().replace(/^https?:\/\/[^/]+/, '')));
  const t0 = Date.now();
  await page.goto(`${BASE}?s=${SEM}`);
  await page.waitForSelector('.hero h1');
  const tWelcome = Date.now() - t0;
  await page.click('.bar-inner .btn-primary'); await page.waitForSelector('.names');
  console.log(`${label}: welcome usable in ${(tWelcome / 1000).toFixed(1)} s · ${Math.round(bytes / 1024)} KB · ${files.filter((f) => !f.startsWith('/echo') && !f.startsWith('/exec')).length} files`);
  await ctx.close();
}
await browser.close(); server.close();

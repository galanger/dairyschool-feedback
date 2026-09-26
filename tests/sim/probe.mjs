import { execFileSync } from 'node:child_process';
import { startSimServer } from './server.mjs';
const sim = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8' });
const dev = Object.values(JSON.parse(sim('list', 'devices', 'available', '-j')).devices).flat().find((d) => d.name === 'iPhone 17e');
try { sim('boot', dev.udid); } catch { /* already booted */ }
sim('bootstatus', dev.udid, '-b');
const { server, run, expectNewPage } = await startSimServer(8770);
for (let i = 0; i < 8; i++) { try { expectNewPage(); sim('openurl', dev.udid, `http://127.0.0.1:8770/?nav=${Date.now()}&s=demo#results`); break; } catch { await new Promise((r) => setTimeout(r, 8000)); } }
const step = async (op, a = {}) => { const r = await run({ op, ...a }, 60000); if (!r.ok) throw new Error(r.info); return r.info; };
await step('wait', { ms: 1000 });
await step('clear'); await step('reload'); await step('wait', { ms: 1200 });
await step('fill', { sel: '#pass', value: 'demo' });
await step('tap', { sel: '.gate button[type=submit]' });
await step('select', { sel: '.rs-head select', value: 'bovicura-2023' }); await step('wait', { ms: 900 });
await step('tap', { sel: '.tabs button', text: 'Client sheet' }); await step('wait', { ms: 600 });
console.log(await step('probeSheet'));
console.log(await step('probeZoom'));
server.close();

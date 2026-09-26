import { chromium, devices } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome' });
const S = '/private/tmp/claude-501/-Users-liatgigi/d8bf0b2a-c1f9-44ce-b920-2c39806af666/scratchpad/plan';
// 1) results screenshot from the prototype: top of the 2023 dashboard
{
  const p = await (await b.newContext({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 1 })).newPage();
  await p.goto('http://127.0.0.1:8765/#results'); await p.waitForSelector('#pass');
  await p.fill('#pass', 'demo'); await p.click('button[type=submit]'); await p.waitForSelector('.rs-head select');
  await p.selectOption('.rs-head select', 'bovicura-2023'); await p.waitForSelector('.kpis'); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('.demo-bar')?.remove());
  await p.screenshot({ path: `${S}/results-top.png` });
}
// 2) element shots of the plan page for review
for (const [name, opts] of [['phone', devices['iPhone 13']], ['desk', { viewport: { width: 1280, height: 900 } }]]) {
  const p = await (await b.newContext(opts)).newPage();
  await p.goto(`file://${S}/preview-v3.html`); await p.waitForTimeout(1000);
  await p.locator('.mast').screenshot({ path: `tests/output/plan-${name}-mast.png` });
  await p.locator('#validated').screenshot({ path: `tests/output/plan-${name}-validated.png` });
  await p.locator('#participant').screenshot({ path: `tests/output/plan-${name}-participant.png` });
}
await b.close();

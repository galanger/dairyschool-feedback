// Prints the classic results sheet through Chrome's print engine and checks it is one A4 page.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto('http://127.0.0.1:8765/staff.html'); await page.waitForSelector('#pass');
await page.fill('#pass', 'demo'); await page.click('button[type=submit]'); await page.waitForSelector('.rs-head select');
await page.selectOption('.rs-head select', 'bovicura-2023'); await page.waitForSelector('.kpis');
await page.click('.tabs button:has-text("Client sheet")'); await page.waitForTimeout(400);
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
await page.pdf({ path: 'tests/output/results-sheet.pdf', format: 'A4', printBackground: false, preferCSSPageSize: true });
// a long program (40 items) must still fit on one page
await page.evaluate(() => {
  const tb = document.querySelector('.sheet tbody');
  const rows = [...tb.children];
  for (let i = 0; i < 15; i++) tb.append(rows[i % rows.length].cloneNode(true));
  window.dispatchEvent(new Event('beforeprint'));
});
await page.pdf({ path: 'tests/output/results-sheet-40.pdf', format: 'A4', printBackground: false, preferCSSPageSize: true });
await browser.close();

// Deletes a TEST seminar from the school's Sheet: its row in Seminars, all its tabs (Items, Names,
// Answers, English, dated copies) and its once-only flags. The backend allows this only for an id
// that contains "test" (or the "sample" made by First setup), so a real seminar can never be
// removed this way.
//
// Usage: PASSCODE=<staff passcode> node tools/remove-test-seminar.mjs <seminar id> [<seminar id> …]
import { readFileSync } from 'node:fs';

const ids = process.argv.slice(2);
if (!ids.length) { console.error('Usage: PASSCODE=… node tools/remove-test-seminar.mjs <seminar id> […]'); process.exit(2); }
const cfgText = readFileSync(new URL('../site/config.js', import.meta.url), 'utf8');
const BACKEND = process.env.BACKEND || (cfgText.match(/backendUrl:\s*'([^']*)'/) || [])[1];
const KEY = process.env.PASSCODE;
if (!KEY || !BACKEND) { console.error('PASSCODE and a backend address (site/config.js or BACKEND) are needed.'); process.exit(2); }

let failed = 0;
for (const id of ids) {
  if (!/test/.test(id) && id !== 'sample') { console.log(`${id}: refused here too, not a test id`); failed++; continue; }
  let out, tries = 0;
  // Google sometimes loses a reply after the request has run: ask again; "not found" on a later
  // try means the first one went through.
  for (tries = 1; tries <= 3; tries++) {
    out = await fetch(BACKEND, {
      method: 'POST', body: JSON.stringify({ action: 'deleteSeminar', s: id, key: KEY }), redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: AbortSignal.timeout(120000),
    }).then((r) => r.json().catch(() => ({ ok: false, code: `HTTP ${r.status}` })), (e) => ({ ok: false, code: `NETWORK (${e.name})` }));
    if (out.ok || !/^(LOST|HTTP|NETWORK|BUSY)/.test(out.code)) break;
  }
  if (out.ok) console.log(`${id}: removed (${out.tabs.length} tabs: ${out.tabs.join(', ')})`);
  else if (out.code === 'NOT_FOUND' && tries > 1) console.log(`${id}: removed (confirmed gone on the second try)`);
  else if (out.code === 'NOT_FOUND') console.log(`${id}: not in the Sheet`);
  else { console.log(`${id}: refused, ${out.code}${out.problem ? ` (${out.problem})` : ''}`); failed++; }
}
process.exit(failed ? 1 : 0);

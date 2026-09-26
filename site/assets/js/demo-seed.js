// Starting data for the prototype's in-browser backend.
// demo-2023.local.js (real 2023 answers) exists only on the local machine and in the
// private prototype; it is git-ignored so it can never reach the public site.
import { DEMO_SEMINAR } from './demo-data.js';

export async function buildSeed() {
  const seminars = { demo: { ...DEMO_SEMINAR, used: {}, responses: [] } };
  // The 2023 answers exist only on the development machine and inside the private prototype
  // bundle: the public site never even asks for the file.
  const local = !!window.DSF_INLINE || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local) {
    try {
      const m = await import('./demo-2023.local.js');
      if (m.BOVICURA_2023) seminars[m.BOVICURA_2023.id] = m.BOVICURA_2023;
    } catch { /* not available */ }
  }
  return { version: 5, seminars };
}

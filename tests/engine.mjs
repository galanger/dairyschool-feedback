// Which browser engine the e2e suites run on: ENGINE=chrome (default) | webkit | firefox.
// WebKit is the engine of every iPhone browser (Safari, and Chrome/Telegram/Viber on iOS).
import { chromium, webkit, firefox } from 'playwright-core';

export const ENGINE = process.env.ENGINE || 'chrome';
export const BUNDLE = !!process.env.BUNDLE;

// The deployed site has one page per role; the single-file prototype switches views by hash.
export function viewUrl(base, view, { s, key } = {}) {
  const q = s ? `?s=${encodeURIComponent(s)}` : '';
  if (BUNDLE) return view === 'guide' ? `${base}${q}#guide-${key ?? ''}` : view === 'staff' ? `${base}${q}#results` : `${base}${q}`;
  if (view === 'guide') return `${base}guide.html${q}#${key ?? ''}`;
  if (view === 'staff') return `${base}staff.html${q}`;
  return `${base}${q}`;
}
export const isChromium = ENGINE === 'chrome';

export function launch() {
  if (ENGINE === 'webkit') return webkit.launch();
  if (ENGINE === 'firefox') return firefox.launch();
  // Chrome's Local Network Access check prompts before a page calls 127.0.0.1 (our local stand-in
  // for Google). Production is public→public (github.io → script.google.com), where it never applies.
  return chromium.launch({ channel: 'chrome', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWarn'] });
}

// Firefox has no mobile emulation: keep the phone-sized screen and touch, drop isMobile.
export function adapt(opts = {}) {
  if (ENGINE !== 'firefox') return opts;
  const { isMobile, ...rest } = opts;
  return rest;
}

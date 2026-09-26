// Loads a stylesheet or classic script once, resolving when ready.
const done = new Map();
export function loadStyles(href) {
  if (window.DSF_INLINE) return Promise.resolve(); // prototype bundle: styles already inline
  if (!done.has(href)) done.set(href, new Promise((res) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
    l.onload = res; l.onerror = res; document.head.append(l);
  }));
  return done.get(href);
}
export function loadScript(src) {
  if (window.DSF_INLINE) return Promise.resolve();
  if (!done.has(src)) done.set(src, new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = rej; document.head.append(s);
  }));
  return done.get(src);
}

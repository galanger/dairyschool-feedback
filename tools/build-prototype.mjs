// Builds one self-contained HTML file of the prototype (for a private preview link).
// Includes the private 2023 data if site/assets/js/demo-2023.local.js exists.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['site/assets/js/app.js'], bundle: true, format: 'iife', write: false,
  target: ['es2020'], minify: true, legalComments: 'none',
});
const logo = `data:image/png;base64,${readFileSync('site/assets/img/logo.png').toString('base64')}`;
const js = out.outputFiles[0].text.replaceAll('assets/img/logo.png', logo);
const css = readFileSync('site/assets/css/app.css', 'utf8') + readFileSync('site/assets/css/staff.css', 'utf8');
const qr = readFileSync('site/assets/vendor/qrcode.js', 'utf8');
const html = `<title>Dairy School Survey</title>
<style>${css}</style>
<script>window.DSF_CONFIG={backendUrl:null,publicUrl:null,defaultSeminar:'demo'};window.DSF_INLINE=true;</script>
<script>${qr}</script>
<div id="app"></div>
<script>${js.replaceAll('</script', '<\\/script')}</script>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/prototype.html', html);
// A full-document copy for local testing.
writeFileSync('dist/prototype-local.html', `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="icon" href="data:,"></head><body>${html}</body></html>`);
console.log('dist/prototype.html', Math.round(html.length / 1024), 'KB');

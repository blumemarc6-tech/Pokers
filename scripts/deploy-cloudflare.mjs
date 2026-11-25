#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   POKETA – auf Cloudflare Pages veröffentlichen (ohne Wrangler)
   Packt Seite, config.js, Datenschutz, Web-App-Dateien und Icons in ein Pages-Skript (_worker.js) und lädt es
   über die Cloudflare-API hoch. Braucht nur einen API-Token mit
   „Cloudflare Pages: Edit“.

     CLOUDFLARE_API_TOKEN=…  [CLOUDFLARE_ACCOUNT_ID=…]  node scripts/deploy-cloudflare.mjs [projekt] [branch]
   ═══════════════════════════════════════════════════════════════ */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';

/* Dateien, die ausgeliefert werden: [Pfad, Datei, Content-Type, binär?] */
export const FILES = [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/index.html', 'index.html', 'text/html; charset=utf-8'],
  ['/config.js', 'config.js', 'application/javascript; charset=utf-8'],
  ['/datenschutz', 'datenschutz.html', 'text/html; charset=utf-8'],
  ['/datenschutz.html', 'datenschutz.html', 'text/html; charset=utf-8'],
  ['/studio', 'studio.html', 'text/html; charset=utf-8'],
  ['/studio.html', 'studio.html', 'text/html; charset=utf-8'],
  ['/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json'],
  ['/sw.js', 'sw.js', 'application/javascript; charset=utf-8'],
  ['/icons/icon.svg', 'icons/icon.svg', 'image/svg+xml'],
  ['/icons/icon-192.png', 'icons/icon-192.png', 'image/png', true],
  ['/icons/icon-512.png', 'icons/icon-512.png', 'image/png', true],
  ['/icons/apple-touch-icon.png', 'icons/apple-touch-icon.png', 'image/png', true],
  ['/icons/favicon-32.png', 'icons/favicon-32.png', 'image/png', true],
  ['/favicon.ico', 'icons/favicon-32.png', 'image/png', true]
];

/* Erzeugt den Quelltext des Pages-Skripts. routes: {pfad: [contentType, inhalt, base64?]} */
export function buildWorker(routes){
  return `// Automatisch erzeugt von scripts/deploy-cloudflare.mjs – nicht von Hand bearbeiten
const ROUTES = ${JSON.stringify(routes)};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY'
};
const NO_CACHE = ['/', '/index.html', '/config.js', '/sw.js', '/manifest.webmanifest', '/studio', '/studio.html'];
const bin = {};
export default {
  async fetch(request){
    const url = new URL(request.url);
    if(request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: SECURITY });
    const r = ROUTES[url.pathname];
    if(!r) return new Response('Nicht gefunden', { status: 404, headers: { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' } });
    let body = r[1];
    if(r[2]) body = bin[url.pathname] || (bin[url.pathname] = Uint8Array.from(atob(r[1]), c => c.charCodeAt(0)));
    return new Response(request.method === 'HEAD' ? null : body, { headers: {
      ...SECURITY, 'Content-Type': r[0],
      'Cache-Control': NO_CACHE.includes(url.pathname) ? 'no-cache' : 'public, max-age=604800'
    } });
  }
};
`;
}

async function cf(p, opt = {}){
  const r = await fetch(API + p, { ...opt, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, ...(opt.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if(!j.success) throw new Error(`${p}: ${r.status} ${JSON.stringify(j.errors || j)}`);
  return j.result;
}

if(import.meta.url === `file://${process.argv[1]}`){
  const project = process.argv[2] || 'poketa', branch = process.argv[3] || 'main';
  if(!process.env.CLOUDFLARE_API_TOKEN){ console.error('CLOUDFLARE_API_TOKEN fehlt.'); process.exit(1); }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || (await cf('/accounts'))[0].id;
  const build = Date.now().toString(36);
  const routes = {};
  for(const [route, file, type, binary] of FILES){
    const buf = await readFile(path.join(ROOT, file));
    let text = binary ? buf.toString('base64') : buf.toString('utf8');
    if(file === 'sw.js') text = text.replace('__BUILD__', build);    // neuer Cache je Veröffentlichung
    routes[route] = binary ? [type, text, true] : [type, text];
  }
  const worker = buildWorker(routes);
  const form = new FormData();
  form.append('manifest', '{}');
  form.append('branch', branch);
  form.append('_worker.js', new Blob([worker], { type: 'application/javascript+module' }), '_worker.js');
  const d = await cf(`/accounts/${account}/pages/projects/${project}/deployments`, { method: 'POST', body: form });
  console.log('Veröffentlicht:', d.url, `(${d.environment})`);
}

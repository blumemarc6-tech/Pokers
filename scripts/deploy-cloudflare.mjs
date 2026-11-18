#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   POKETA – auf Cloudflare Pages veröffentlichen (ohne Wrangler)
   Packt index.html + config.js in ein Pages-Skript (_worker.js) und lädt es
   über die Cloudflare-API hoch. Braucht nur einen API-Token mit
   „Cloudflare Pages: Edit“.

     CLOUDFLARE_API_TOKEN=…  [CLOUDFLARE_ACCOUNT_ID=…]  node scripts/deploy-cloudflare.mjs [projekt] [branch]
   ═══════════════════════════════════════════════════════════════ */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';

/* Erzeugt den Quelltext des Pages-Skripts */
export function buildWorker(files){
  const routes = {
    '/': ['text/html; charset=utf-8', files.html],
    '/index.html': ['text/html; charset=utf-8', files.html],
    '/config.js': ['application/javascript; charset=utf-8', files.config],
    '/datenschutz': ['text/html; charset=utf-8', files.privacy],
    '/datenschutz.html': ['text/html; charset=utf-8', files.privacy]
  };
  return `// Automatisch erzeugt von scripts/deploy-cloudflare.mjs – nicht von Hand bearbeiten
const ROUTES = ${JSON.stringify(routes)};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY'
};
export default {
  async fetch(request){
    const url = new URL(request.url);
    if(request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: SECURITY });
    const r = ROUTES[url.pathname];
    if(!r) return new Response('Nicht gefunden', { status: 404, headers: { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(request.method === 'HEAD' ? null : r[1], { headers: {
      ...SECURITY, 'Content-Type': r[0],
      'Cache-Control': url.pathname === '/config.js' ? 'no-cache' : 'public, max-age=0, must-revalidate'
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
  const worker = buildWorker({
    html: await readFile(path.join(ROOT, 'index.html'), 'utf8'),
    config: await readFile(path.join(ROOT, 'config.js'), 'utf8'),
    privacy: await readFile(path.join(ROOT, 'datenschutz.html'), 'utf8')
  });
  const form = new FormData();
  form.append('manifest', '{}');
  form.append('branch', branch);
  form.append('_worker.js', new Blob([worker], { type: 'application/javascript+module' }), '_worker.js');
  const d = await cf(`/accounts/${account}/pages/projects/${project}/deployments`, { method: 'POST', body: form });
  console.log('Veröffentlicht:', d.url, `(${d.environment})`);
}

#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   POKETA – ein Promo-Video öffentlich bereitstellen (für Instagram-Posting)
   Legt bei Bedarf das Pages-Projekt „poketa-media“ an und veröffentlicht
   genau EIN Video unter https://poketa-media.pages.dev/<dateiname>.
   (Pages-Skripte sind auf wenige MB begrenzt – daher ein Video pro Deploy.)

     CLOUDFLARE_API_TOKEN=…  node scripts/deploy-media.mjs promo/poketa-video-kurz-kartenwert.mp4
   ═══════════════════════════════════════════════════════════════ */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';
const PROJECT = 'poketa-media';

async function cf(p, opt = {}, allowFail){
  const r = await fetch(API + p, { ...opt, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, ...(opt.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if(!j.success && !allowFail) throw new Error(`${p}: ${r.status} ${JSON.stringify(j.errors || j)}`);
  return j;
}

const file = process.argv[2];
if(!file){ console.error('Pfad zum Video fehlt.'); process.exit(1); }
const name = path.basename(file);
const data = (await readFile(file)).toString('base64');
const account = (await cf('/accounts')).result[0].id;

const exists = await cf(`/accounts/${account}/pages/projects/${PROJECT}`, {}, true);
if(!exists.success){
  await cf(`/accounts/${account}/pages/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: PROJECT, production_branch: 'main' }) });
  console.log('Projekt angelegt:', PROJECT);
}

const worker = `const NAME=${JSON.stringify('/' + name)};const B64=${JSON.stringify(data)};let BIN;
export default{async fetch(req){const u=new URL(req.url);
 if(u.pathname!==NAME)return new Response('Nicht gefunden',{status:404});
 BIN=BIN||Uint8Array.from(atob(B64),c=>c.charCodeAt(0));
 const h={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600'};
 const m=/bytes=(\\d*)-(\\d*)/.exec(req.headers.get('range')||'');
 if(m){const s=m[1]?+m[1]:BIN.length-(+m[2]);const e=m[1]&&m[2]?Math.min(+m[2],BIN.length-1):BIN.length-1;
  return new Response(req.method==='HEAD'?null:BIN.slice(s,e+1),{status:206,headers:{...h,'Content-Range':\`bytes \${s}-\${e}/\${BIN.length}\`,'Content-Length':String(e-s+1)}});}
 return new Response(req.method==='HEAD'?null:BIN,{headers:{...h,'Content-Length':String(BIN.length)}});}};`;

const form = new FormData();
form.append('manifest', '{}');
form.append('branch', 'main');
form.append('_worker.js', new Blob([worker], { type: 'application/javascript+module' }), '_worker.js');
const d = (await cf(`/accounts/${account}/pages/projects/${PROJECT}/deployments`, { method: 'POST', body: form })).result;
console.log('Veröffentlicht:', d.url, '→ https://' + PROJECT + '.pages.dev/' + name);

/* ═══════════════════════════════════════════════════════════════
   POKETA – Konto-Sync
   GET    → { data: {cards, wishes, notes, updatedAt} | null }
   PUT    ← { cards, wishes, notes, baseUpdatedAt }
          → 200 { updatedAt }  |  409 { error, data }  (Stand auf dem Server ist neuer)
   DELETE → 200 { ok: true }

   Nur für angemeldete Nutzer (Netlify Identity: Netlify prüft das
   Bearer-Token und legt den Nutzer in context.clientContext.user ab).
   Gespeichert wird pro Konto ein Eintrag in Netlify Blobs.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const { getStore, connectLambda } = require('@netlify/blobs');

const STORE = 'poketa-sync';
const MAX_BODY = 2 * 1024 * 1024;   // 2 MB pro Anfrage
const MAX_ITEMS = 20000;            // je Liste (Karten / Wünsche)
const MAX_NOTES = 200000;           // Zeichen

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

function header(event, name){
  const h = event.headers || {};
  const k = Object.keys(h).find(x => x.toLowerCase() === name);
  return k ? String(h[k]) : '';
}

/* Schreibende Anfragen nur von der eigenen Seite (zusätzlich zum Token). */
function originOk(event){
  const origin = header(event, 'origin');
  if(!origin) return true;                       // kein Browser-Request (z. B. curl mit Token)
  let o;
  try{ o = new URL(origin); }catch(e){ return false; }
  const allowed = new Set(
    [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]
      .filter(Boolean).map(u => { try{ return new URL(u).host; }catch(e){ return ''; } })
  );
  const host = header(event, 'x-forwarded-host') || header(event, 'host');
  if(host) allowed.add(host);
  return allowed.has(o.host);
}

function parseBody(event){
  if(!event.body) return { err: 'Leere Anfrage.' };
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if(Buffer.byteLength(raw, 'utf8') > MAX_BODY) return { err: 'Zu viele Daten (max. 2 MB).', status: 413 };
  let b;
  try{ b = JSON.parse(raw); }catch(e){ return { err: 'Ungültiges JSON.' }; }
  if(!b || typeof b !== 'object' || Array.isArray(b)) return { err: 'Ungültige Daten.' };

  const cards = b.cards == null ? [] : b.cards;
  const wishes = b.wishes == null ? [] : b.wishes;
  const notes = b.notes == null ? '' : b.notes;
  const isObjList = a => Array.isArray(a) && a.every(x => x && typeof x === 'object' && !Array.isArray(x));
  if(!isObjList(cards) || !isObjList(wishes)) return { err: 'Ungültige Listen.' };
  if(cards.length > MAX_ITEMS || wishes.length > MAX_ITEMS) return { err: 'Zu viele Einträge.', status: 413 };
  if(typeof notes !== 'string') return { err: 'Ungültige Notizen.' };
  if(notes.length > MAX_NOTES) return { err: 'Notizen zu lang.', status: 413 };
  const base = b.baseUpdatedAt == null ? null : String(b.baseUpdatedAt);
  return { data: { cards, wishes, notes }, base };
}

/* Neuer, streng steigender Zeitstempel (auch bei zwei Schreibvorgängen in derselben Millisekunde). */
function nextStamp(prev){
  let t = Date.now();
  const p = prev ? Date.parse(prev) : 0;
  if(p && t <= p) t = p + 1;
  return new Date(t).toISOString();
}

/* Kern – getrennt von Netlify, damit er sich testen lässt. */
async function handle(event, user, store){
  const method = event.httpMethod;
  if(method === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if(!user || !user.sub) return reply(401, { error: 'Nicht angemeldet.' });
  if(!['GET', 'PUT', 'DELETE'].includes(method)) return reply(405, { error: 'Methode nicht erlaubt.' });
  if(method !== 'GET' && !originOk(event)) return reply(403, { error: 'Unerlaubte Herkunft.' });

  const key = 'u/' + user.sub;

  if(method === 'GET'){
    const cur = await store.get(key, { type: 'json' });
    return reply(200, { data: cur || null });
  }

  if(method === 'DELETE'){
    await store.delete(key);
    return reply(200, { ok: true });
  }

  // PUT
  const p = parseBody(event);
  if(p.err) return reply(p.status || 400, { error: p.err });

  const cur = await store.getWithMetadata(key, { type: 'json' });
  const curData = cur && cur.data;
  if(curData && curData.updatedAt !== p.base){
    return reply(409, { error: 'Auf dem Server gibt es einen neueren Stand.', data: curData });
  }

  const updatedAt = nextStamp(curData && curData.updatedAt);
  const doc = Object.assign({}, p.data, { updatedAt });
  const res = await store.setJSON(key, doc, curData && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
  if(res && res.modified === false){
    // Zwischen Lesen und Schreiben hat ein anderes Gerät gespeichert
    const now = await store.get(key, { type: 'json' });
    return reply(409, { error: 'Auf dem Server gibt es einen neueren Stand.', data: now || null });
  }
  return reply(200, { updatedAt });
}

exports.handler = async (event, context) => {
  try{
    const user = context && context.clientContext && context.clientContext.user;
    if(!user) return reply(401, { error: 'Nicht angemeldet.' });
    connectLambda(event);
    const store = getStore({ name: STORE, consistency: 'strong' });
    return await handle(event, user, store);
  }catch(e){
    console.error('sync error', e);
    return reply(500, { error: 'Serverfehler.' });
  }
};

exports._handle = handle;   // für Tests

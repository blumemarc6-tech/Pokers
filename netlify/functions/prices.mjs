/* ═══════════════════════════════════════════════════════════════
   POKETA – Preisverlauf abrufen & Karten vormerken
   GET  /api/prices?ids=273699,660224
   POST /api/prices  { ids:[…], track:[…] }   (track = neu vorzumerkende IDs)
   → { history: { <idProduct>: [[datum, trend, avg1, avg7, avg30, low], …] }, last }
   Öffentlich (Preise sind öffentlich), aber begrenzt: max. 40 IDs pro Anfrage,
   Vormerken nur von der eigenen Seite, max. 50 000 vorgemerkte Produkte.
   ═══════════════════════════════════════════════════════════════ */
import { getStore } from '@netlify/blobs';
import core from '../lib/price-history.js';

const { cleanIds, readHistory, track } = core;

const json = (status, body, extra) => new Response(JSON.stringify(body), {
  status,
  headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, extra || {})
});

function sameOrigin(req){
  const origin = req.headers.get('origin');
  if(!origin) return false;
  try{
    const o = new URL(origin).host;
    const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]
      .filter(Boolean).map(u => { try{ return new URL(u).host; }catch(e){ return ''; } });
    allowed.push(new URL(req.url).host, req.headers.get('x-forwarded-host') || '');
    return allowed.includes(o);
  }catch(e){ return false; }
}

export default async (req) => {
  try{
    const store = getStore({ name: 'poketa-prices', consistency: 'strong' });
    let ids, toTrack = [];

    if(req.method === 'GET'){
      ids = cleanIds(String(new URL(req.url).searchParams.get('ids') || '').split(','));
    }else if(req.method === 'POST'){
      const raw = await req.text();
      if(raw.length > 4000) return json(413, { error: 'Zu groß.' });
      let b; try{ b = JSON.parse(raw); }catch(e){ return json(400, { error: 'Ungültiges JSON.' }); }
      ids = cleanIds(b && b.ids);
      if(sameOrigin(req)) toTrack = cleanIds(b && b.track).filter(id => ids.includes(id));
    }else{
      return json(405, { error: 'Methode nicht erlaubt.' });
    }
    if(!ids.length) return json(400, { error: 'Keine gültigen IDs.' });

    const today = new Date().toISOString().slice(0, 10);
    const [history, last] = await Promise.all([
      readHistory(store, ids),
      store.get('meta/last', { type: 'json' }),
      toTrack.length ? track(store, toTrack, today) : 0
    ]);
    return json(200, { history, last: last || null },
      req.method === 'GET' ? { 'Cache-Control': 'public, max-age=900' } : { 'Cache-Control': 'no-store' });
  }catch(e){
    console.error('prices error', e);
    return json(500, { error: 'Serverfehler.' });
  }
};

export const config = { path: '/api/prices' };

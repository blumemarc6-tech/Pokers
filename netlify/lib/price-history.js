/* ═══════════════════════════════════════════════════════════════
   POKETA – Preisverlauf (gemeinsamer Kern für die Functions)

   Cardmarket bietet keine kostenlose Historie. Deshalb:
   - Jede geöffnete Karte merkt ihre Cardmarket-Produkt-IDs vor  (track/<idProduct>)
   - Ein täglicher Job lädt den offiziellen Cardmarket-Price-Guide und hängt
     für alle vorgemerkten IDs einen Tagespunkt an                (hist/<bucket>)
   Ein Punkt: [datum, trend, avg1, avg7, avg30, low]
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const PRICE_GUIDE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const BUCKETS = 128;          // Verlauf ist auf 128 Blobs verteilt (wenige Schreibvorgänge pro Tag)
const MAX_POINTS = 400;       // gut ein Jahr pro Produkt
const MAX_IDS = 40;           // pro Anfrage
const MAX_TRACKED = 50000;    // Obergrenze vorgemerkter Produkte

const bucketKey = id => 'hist/' + (id % BUCKETS);

function cleanIds(list){
  if(!Array.isArray(list)) return [];
  const out = [];
  for(const x of list){
    const n = Number(x);
    if(Number.isInteger(n) && n > 0 && n < 1e9 && !out.includes(n)) out.push(n);
    if(out.length >= MAX_IDS) break;
  }
  return out;
}

const num = v => (typeof v === 'number' && isFinite(v) && v > 0) ? Math.round(v * 100) / 100 : null;

/* Price-Guide-Eintrag → Tagespunkt. Fehlt der normale Preis (nur Holo-Version gehandelt), Holo-Werte nehmen. */
function pointFrom(date, g){
  let p = [date, num(g.trend), num(g.avg1), num(g.avg7), num(g.avg30), num(g.low)];
  if(p.slice(1).every(v => v === null)){
    p = [date, num(g['trend-holo']), num(g['avg1-holo']), num(g['avg7-holo']), num(g['avg30-holo']), num(g['low-holo'])];
  }
  return p.slice(1).some(v => v !== null) ? p : null;
}

/* Verlauf für IDs lesen: { <id>: [[datum, trend, avg1, avg7, avg30, low], …] } */
async function readHistory(store, ids){
  const byBucket = {};
  ids.forEach(id => { (byBucket[bucketKey(id)] = byBucket[bucketKey(id)] || []).push(id); });
  const out = {};
  await Promise.all(Object.keys(byBucket).map(async key => {
    const b = await store.get(key, { type: 'json' });
    byBucket[key].forEach(id => { out[id] = (b && b.h && b.h[id]) || []; });
  }));
  return out;
}

/* Neue IDs vormerken (vorhandene bleiben unverändert). Gibt die Zahl neu vorgemerkter IDs zurück. */
async function track(store, ids, today){
  if(!ids.length) return 0;
  const meta = await store.get('meta/count', { type: 'json' });
  if(meta && meta.tracked >= MAX_TRACKED) return 0;
  const res = await Promise.all(ids.map(id => store.setJSON('track/' + id, { since: today }, { onlyIfNew: true })));
  return res.filter(r => !r || r.modified !== false).length;
}

/* Täglicher Job: Price-Guide anwenden. guide = geparstes JSON des Price-Guides. */
async function snapshot(store, guide, opts){
  opts = opts || {};
  const date = String(guide.createdAt || new Date().toISOString()).slice(0, 10);
  const index = new Map();
  (guide.priceGuides || []).forEach(g => index.set(g.idProduct, g));

  const { blobs } = await store.list({ prefix: 'track/' });
  const ids = blobs.map(b => Number(b.key.slice(6))).filter(n => Number.isInteger(n) && n > 0);

  const byBucket = {};
  ids.forEach(id => { (byBucket[bucketKey(id)] = byBucket[bucketKey(id)] || []).push(id); });

  let written = 0, missing = 0;
  const keys = Object.keys(byBucket);
  const limit = opts.concurrency || 8;
  for(let i = 0; i < keys.length; i += limit){
    await Promise.all(keys.slice(i, i + limit).map(async key => {
      const b = (await store.get(key, { type: 'json' })) || { v: 1, h: {} };
      b.h = b.h || {};
      let changed = false;
      byBucket[key].forEach(id => {
        const g = index.get(id);
        const p = g && pointFrom(date, g);
        if(!p){ missing++; return; }
        const arr = b.h[id] || [];
        if(arr.length && arr[arr.length - 1][0] === date) arr[arr.length - 1] = p;   // Job lief heute schon
        else arr.push(p);
        b.h[id] = arr.slice(-MAX_POINTS);
        written++; changed = true;
      });
      if(changed) await store.setJSON(key, b);
    }));
  }
  const summary = { date, tracked: ids.length, written, missing, at: new Date().toISOString() };
  await store.setJSON('meta/count', { tracked: ids.length });
  await store.setJSON('meta/last', summary);
  return summary;
}

module.exports = { PRICE_GUIDE_URL, BUCKETS, MAX_IDS, MAX_TRACKED, cleanIds, pointFrom, readHistory, track, snapshot };

#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   POKETA – täglicher Preis-Snapshot
   Lädt den offiziellen Cardmarket-Price-Guide (Pokémon) und speichert für
   jede vorgemerkte Karte den Tagespreis in Supabase.
   Läuft als GitHub Action (.github/workflows/price-snapshot.yml).

   Umgebung:
     SUPABASE_URL               https://<projekt>.supabase.co
     SUPABASE_SERVICE_ROLE_KEY  Service-Key (nur als GitHub-Secret, nie im Frontend!)
     PRICE_GUIDE_FILE           optional: lokale Datei statt Download (Tests)
   ═══════════════════════════════════════════════════════════════ */
import { readFile } from 'node:fs/promises';

export const PRICE_GUIDE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';

const num = v => (typeof v === 'number' && isFinite(v) && v > 0) ? Math.round(v * 100) / 100 : null;

/* Price-Guide-Eintrag → Zeile. Wird nur die Holo-Version gehandelt, Holo-Werte nehmen. */
export function rowFrom(day, g){
  let r = { id: g.idProduct, day, trend: num(g.trend), avg1: num(g.avg1), avg7: num(g.avg7), avg30: num(g.avg30), low: num(g.low) };
  if([r.trend, r.avg1, r.avg7, r.avg30, r.low].every(v => v === null)){
    r = { id: g.idProduct, day, trend: num(g['trend-holo']), avg1: num(g['avg1-holo']), avg7: num(g['avg7-holo']), avg30: num(g['avg30-holo']), low: num(g['low-holo']) };
  }
  return [r.trend, r.avg1, r.avg7, r.avg30, r.low].some(v => v !== null) ? r : null;
}

/* Tag des Price-Guides (Cardmarket erstellt ihn nachts, Zeitangabe mit Offset) */
export const guideDay = guide => String(guide.createdAt || new Date().toISOString()).slice(0, 10);

export async function run({ url, key, guide, fetchImpl = fetch, log = console.log }){
  const rpc = async (fn, body) => {
    const r = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const txt = await r.text();
    if(!r.ok) throw new Error(`${fn}: ${r.status} ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : null;
  };

  const tracked = new Set((await rpc('list_tracked')).map(Number));
  const day = guideDay(guide);
  const rows = [];
  let missing = 0;   // wird unten gesetzt
  for(const g of guide.priceGuides || []){
    if(!tracked.has(g.idProduct)) continue;
    const r = rowFrom(day, g);
    if(r) rows.push(r);
  }
  missing = tracked.size - rows.length;   // nicht im Guide oder ohne Preis

  let written = 0;
  for(let i = 0; i < rows.length; i += 5000){
    written += await rpc('ingest_prices', { p_rows: rows.slice(i, i + 5000) });
  }
  const summary = { day, tracked: tracked.size, written, missing };
  log('Snapshot ' + JSON.stringify(summary));
  return summary;
}

/* Direkt aufgerufen (GitHub Action) */
if(import.meta.url === `file://${process.argv[1]}`){
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if(!url || !key){ console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen.'); process.exit(1); }
  let guide;
  if(process.env.PRICE_GUIDE_FILE){
    guide = JSON.parse(await readFile(process.env.PRICE_GUIDE_FILE, 'utf8'));
  }else{
    const r = await fetch(PRICE_GUIDE_URL, { headers: { Accept: 'application/json' } });
    if(!r.ok){ console.error('Price-Guide nicht ladbar:', r.status); process.exit(1); }
    guide = await r.json();
  }
  console.log('Price-Guide', guide.createdAt, '·', (guide.priceGuides || []).length, 'Produkte');
  await run({ url, key, guide });
}

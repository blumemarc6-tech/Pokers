/* ═══════════════════════════════════════════════════════════════
   POKETA – täglicher Preis-Snapshot (Scheduled Function)
   Lädt den offiziellen Cardmarket-Price-Guide (Pokémon) und speichert für
   jede vorgemerkte Karte den Tagespreis. Cardmarket erstellt den Guide
   nachts (~03:00 MEZ), deshalb läuft der Job um 05:15 UTC.
   Manuell starten: Netlify → Functions → price-snapshot → „Run now“.
   ═══════════════════════════════════════════════════════════════ */
import { getStore } from '@netlify/blobs';
import core from '../lib/price-history.js';

export default async () => {
  const started = Date.now();
  const r = await fetch(core.PRICE_GUIDE_URL, { headers: { 'Accept': 'application/json' } });
  if(!r.ok){
    console.error('Price-Guide nicht ladbar:', r.status);
    return new Response('price guide ' + r.status, { status: 502 });
  }
  const guide = await r.json();
  const store = getStore({ name: 'poketa-prices', consistency: 'strong' });
  const summary = await core.snapshot(store, guide);
  console.log('Snapshot', JSON.stringify(summary), (Date.now() - started) + ' ms');
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '15 5 * * *' };

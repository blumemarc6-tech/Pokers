/* Test für scripts/price-snapshot.mjs mit nachgebildeter Supabase-API.
   Optional mit echtem Price-Guide: PRICE_GUIDE=/pfad/price_guide_6.json npm test */
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { run, rowFrom, guideDay } from '../scripts/price-snapshot.mjs';

assert.deepStrictEqual(rowFrom('d', { idProduct: 1, trend: 10, avg1: 9, avg7: 9.5, avg30: 8, low: 5 }),
  { id: 1, day: 'd', trend: 10, avg1: 9, avg7: 9.5, avg30: 8, low: 5 });
assert.deepStrictEqual(rowFrom('d', { idProduct: 2, trend: null, 'trend-holo': 4, 'avg30-holo': 3 }),
  { id: 2, day: 'd', trend: 4, avg1: null, avg7: null, avg30: 3, low: null }, 'nur Holo');
assert.strictEqual(rowFrom('d', { idProduct: 3 }), null);
assert.strictEqual(guideDay({ createdAt: '2026-11-17T02:51:10+0100' }), '2026-11-17');

function fakeSupabase(tracked){
  const calls = [];
  const fetchImpl = async (url, opt) => {
    const fn = url.split('/rpc/')[1], body = JSON.parse(opt.body);
    calls.push({ fn, body, key: opt.headers.apikey });
    const out = fn === 'list_tracked' ? tracked : fn === 'ingest_prices' ? body.p_rows.length : null;
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  return { calls, fetchImpl };
}

const guide = { createdAt: '2026-11-17T02:51:10+0100', priceGuides: [
  { idProduct: 273699, trend: 290.28, avg1: 150, avg7: 392.3, avg30: 415.74, low: 90 },
  { idProduct: 660224, trend: 3489.25, avg30: 2445.05 },
  { idProduct: 1, trend: 1 } ] };
const f = fakeSupabase([273699, 660224, 42]);
const sum = await run({ url: 'https://x.supabase.co', key: 'service', guide, fetchImpl: f.fetchImpl, log: () => {} });
assert.deepStrictEqual(sum, { day: '2026-11-17', tracked: 3, written: 2, missing: 1 });
assert.strictEqual(f.calls[1].body.p_rows.length, 2, 'nur vorgemerkte Produkte');
assert.ok(f.calls.every(c => c.key === 'service'));

const PG = process.env.PRICE_GUIDE;
if(PG && existsSync(PG)){
  const real = JSON.parse(readFileSync(PG, 'utf8'));
  const ids = real.priceGuides.slice(0, 20000).map(x => x.idProduct);
  const f2 = fakeSupabase(ids);
  const t = Date.now();
  const s2 = await run({ url: 'https://x', key: 'k', guide: real, fetchImpl: f2.fetchImpl, log: () => {} });
  console.log('Echter Price-Guide:', real.priceGuides.length, 'Produkte ·', JSON.stringify(s2), '·', f2.calls.length, 'Aufrufe ·', Date.now() - t, 'ms');
  assert.ok(s2.written > 19000);
}
console.log('snapshot.test.mjs: alle Tests bestanden');

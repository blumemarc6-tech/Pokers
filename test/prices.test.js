/* Tests für netlify/lib/price-history.js – In-Memory-Store.
   Optional mit echtem Price-Guide: PRICE_GUIDE=/pfad/price_guide_6.json npm test */
'use strict';
const assert = require('assert');
const fs = require('fs');
const core = require('../netlify/lib/price-history.js');

function memStore(){
  const m = new Map();
  return {
    m, writes: 0,
    async get(k){ return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v, o = {}){ if(o.onlyIfNew && m.has(k)) return { modified: false }; this.writes++; m.set(k, JSON.stringify(v)); return { modified: true }; },
    async list({ prefix }){ return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; }
  };
}

(async () => {
  assert.deepStrictEqual(core.cleanIds([1, '2', 2, -1, 'x', 3.5, 1e10]), [1, 2]);
  assert.strictEqual(core.cleanIds(Array.from({ length: 99 }, (_, i) => i + 1)).length, core.MAX_IDS);

  const g = { idProduct: 1, trend: 10, avg1: 9, avg7: 9.5, avg30: 8, low: 5 };
  assert.deepStrictEqual(core.pointFrom('2026-01-01', g), ['2026-01-01', 10, 9, 9.5, 8, 5]);
  assert.deepStrictEqual(core.pointFrom('d', { trend: null, 'trend-holo': 4, 'avg30-holo': 3 }), ['d', 4, null, null, 3, null], 'nur Holo');
  assert.strictEqual(core.pointFrom('d', {}), null);

  const s = memStore();
  assert.strictEqual(await core.track(s, [273699, 660224], '2026-11-18'), 2);
  assert.strictEqual(await core.track(s, [273699], '2026-11-19'), 0, 'schon vorgemerkt');
  assert.deepStrictEqual(await s.get('track/273699'), { since: '2026-11-18' });

  const guide = d => ({ createdAt: d + 'T02:51:10+0100', priceGuides: [
    { idProduct: 273699, trend: 290.28, avg1: 150, avg7: 392.3, avg30: 415.74, low: 90 },
    { idProduct: 660224, trend: 3489.25, avg1: 1410, avg7: 2698.24, avg30: 2445.05, low: 979 } ] });
  let r = await core.snapshot(s, guide('2026-11-18'));
  assert.deepStrictEqual([r.tracked, r.written, r.missing], [2, 2, 0]);
  await core.snapshot(s, guide('2026-11-18'));                       // gleicher Tag → ersetzt
  r = await core.snapshot(s, guide('2026-11-19'));
  const h = await core.readHistory(s, [273699, 660224, 42]);
  assert.strictEqual(h[273699].length, 2);
  assert.deepStrictEqual(h[273699][1], ['2026-11-19', 290.28, 150, 392.3, 415.74, 90]);
  assert.deepStrictEqual(h[42], []);
  assert.deepStrictEqual(await s.get('meta/count'), { tracked: 2 });

  // Obergrenze
  await s.setJSON('meta/count', { tracked: core.MAX_TRACKED });
  assert.strictEqual(await core.track(s, [999], 'd'), 0);

  // Echter Price-Guide (optional)
  if(process.env.PRICE_GUIDE && fs.existsSync(process.env.PRICE_GUIDE)){
    const real = JSON.parse(fs.readFileSync(process.env.PRICE_GUIDE, 'utf8'));
    const s2 = memStore();
    const ids = real.priceGuides.slice(0, 3000).map(x => x.idProduct);
    for(let i = 0; i < ids.length; i += 40) await core.track(s2, ids.slice(i, i + 40), 'd');
    const t = Date.now(); s2.writes = 0;
    const sum = await core.snapshot(s2, real);
    console.log('Echter Price-Guide:', real.priceGuides.length, 'Produkte ·', JSON.stringify(sum), '·', s2.writes, 'Schreibvorgänge ·', Date.now() - t, 'ms');
    assert.strictEqual(sum.tracked, 3000);
    assert.ok(sum.written > 2500);
    assert.ok(s2.writes <= core.BUCKETS + 2);
  }
  console.log('prices.test.js: alle Tests bestanden');
})().catch(e => { console.error(e); process.exit(1); });

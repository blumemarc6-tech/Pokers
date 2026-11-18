/* Tests für netlify/functions/sync.js – ohne Netlify, mit In-Memory-Store.  Start: npm test */
'use strict';
const assert = require('assert');
const { _handle: handle } = require('../netlify/functions/sync.js');

function memStore(){
  const m = new Map(); let n = 0;
  return {
    m,
    async get(k){ const e = m.get(k); return e ? JSON.parse(e.v) : null; },
    async getWithMetadata(k){ const e = m.get(k); return e ? { data: JSON.parse(e.v), etag: e.etag, metadata: {} } : null; },
    async setJSON(k, v, o = {}){
      const e = m.get(k);
      if(o.onlyIfNew && e) return { modified: false };
      if(o.onlyIfMatch && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
      const etag = '"' + (++n) + '"'; m.set(k, { v: JSON.stringify(v), etag }); return { modified: true, etag };
    },
    async delete(k){ m.delete(k); }
  };
}
const ev = (method, body, headers) => ({
  httpMethod: method, body: body === undefined ? null : JSON.stringify(body),
  headers: Object.assign({ host: 'poketa.example' }, headers || {})
});
const J = r => JSON.parse(r.body || 'null');
const alice = { sub: 'alice', email: 'a@x.de' }, bob = { sub: 'bob' };

(async () => {
  const s = memStore();

  assert.strictEqual((await handle(ev('GET'), null, s)).statusCode, 401, 'ohne Nutzer → 401');
  assert.deepStrictEqual(J(await handle(ev('GET'), alice, s)), { data: null }, 'leer');

  const r1 = await handle(ev('PUT', { cards: [{ id: 'a' }], wishes: [], notes: 'n', baseUpdatedAt: null }, { origin: 'https://poketa.example' }), alice, s);
  assert.strictEqual(r1.statusCode, 200); const u1 = J(r1).updatedAt; assert.ok(u1);

  const g = J(await handle(ev('GET'), alice, s)).data;
  assert.deepStrictEqual(g, { cards: [{ id: 'a' }], wishes: [], notes: 'n', updatedAt: u1 });
  assert.deepStrictEqual(J(await handle(ev('GET'), bob, s)), { data: null }, 'Konten getrennt');

  // Veralteter Stand → 409 mit Serverdaten
  const c = await handle(ev('PUT', { cards: [], baseUpdatedAt: null }), alice, s);
  assert.strictEqual(c.statusCode, 409); assert.strictEqual(J(c).data.updatedAt, u1);

  // Passender Stand → 200, Zeitstempel steigt
  const r2 = await handle(ev('PUT', { cards: [{ id: 'b' }], baseUpdatedAt: u1 }), alice, s);
  assert.strictEqual(r2.statusCode, 200); assert.ok(J(r2).updatedAt > u1);

  // Wettlauf: etag ändert sich zwischen Lesen und Schreiben → 409
  const race = memStore(); await race.setJSON('u/alice', { cards: [], wishes: [], notes: '', updatedAt: 'T1' });
  const orig = race.getWithMetadata.bind(race);
  race.getWithMetadata = async k => { const r = await orig(k); await race.setJSON(k, { cards: [], wishes: [], notes: '', updatedAt: 'T2' }); return r; };
  const rr = await handle(ev('PUT', { cards: [], baseUpdatedAt: 'T1' }), alice, race);
  assert.strictEqual(rr.statusCode, 409); assert.strictEqual(J(rr).data.updatedAt, 'T2');

  // Herkunft, Größe, Validierung, Methode
  assert.strictEqual((await handle(ev('PUT', { cards: [] }, { origin: 'https://evil.example' }), alice, s)).statusCode, 403);
  assert.strictEqual((await handle(ev('DELETE', undefined, { origin: 'https://evil.example' }), alice, s)).statusCode, 403);
  assert.strictEqual((await handle(ev('PUT', { notes: 'x'.repeat(2.1 * 1024 * 1024) }), alice, s)).statusCode, 413);
  assert.strictEqual((await handle(ev('PUT', { cards: 'nein' }), alice, s)).statusCode, 400);
  assert.strictEqual((await handle(ev('PUT', { cards: [1, 2] }), alice, s)).statusCode, 400);
  assert.strictEqual((await handle({ httpMethod: 'PUT', body: '{kaputt', headers: {} }, alice, s)).statusCode, 400);
  assert.strictEqual((await handle(ev('POST', {}), alice, s)).statusCode, 405);

  // Löschen
  assert.strictEqual((await handle(ev('DELETE'), alice, s)).statusCode, 200);
  assert.deepStrictEqual(J(await handle(ev('GET'), alice, s)), { data: null });
  // Nach dem Löschen darf ein Gerät mit altem Stand neu schreiben
  assert.strictEqual((await handle(ev('PUT', { cards: [], baseUpdatedAt: u1 }), alice, s)).statusCode, 200);

  console.log('sync.test.js: alle Tests bestanden');
})().catch(e => { console.error(e); process.exit(1); });

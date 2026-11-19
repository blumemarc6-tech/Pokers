#!/usr/bin/env bash
# Testet supabase/schema.sql gegen ein lokales Postgres (mit nachgebildetem Supabase-auth-Schema).
# Aufruf: bash test/schema.test.sh   (braucht psql + laufenden Postgres-Server, DB über PG*-Variablen)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${PGDATABASE:-poketa_test}"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -X -t -o /dev/null -v ON_ERROR_STOP=1 -d $DB"

# Supabase-Umgebung nachbilden: Rollen, auth.users, auth.uid()
$P <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
SQL

$P -f supabase/schema.sql
$P -f supabase/schema.sql          # zweimal: muss wiederholbar sein
$P -c "grant select on all tables in schema public to anon, authenticated" # wie Supabase-Standard

$P <<'SQL'
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as
  $$ begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice '✓ %', msg; end $$;

-- ── Konto A ──
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.check(get_user_data() is null, 'leer am Anfang');
select pg_temp.check((save_user_data('[{"id":"x"}]', '[]', 'n', null)->>'ok')::boolean, 'erstes Speichern');
select pg_temp.check(get_user_data()->'cards' = '[{"id":"x"}]', 'Daten gelesen');
select set_config('t.base', get_user_data()->>'updatedAt', false);
select pg_temp.check(not (save_user_data('[]', '[]', '', null)->>'ok')::boolean, 'veralteter Stand → Konflikt');
select pg_temp.check((save_user_data('[]', '[]', '', null)->'data'->'cards') = '[{"id":"x"}]', 'Konflikt liefert Serverdaten');
select pg_temp.check((save_user_data('[{"id":"y"}]', '[]', '', current_setting('t.base'))->>'ok')::boolean, 'passender Stand → gespeichert');
select pg_temp.check((get_user_data()->>'updatedAt')::timestamptz > current_setting('t.base')::timestamptz, 'Zeitstempel steigt');
select pg_temp.check((select count(*) from user_data) = 1, 'RLS: A sieht nur eigene Zeile');

-- ── Konto B ──
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.check(get_user_data() is null, 'B sieht A nicht (Funktion)');
select pg_temp.check((select count(*) from user_data) = 0, 'B sieht A nicht (Tabelle)');
select pg_temp.check((save_user_data('[]', '[]', 'b', null)->>'ok')::boolean, 'B speichert eigene Daten');
select pg_temp.check((delete_user_data()->>'ok')::boolean, 'B löscht eigene Daten');
select pg_temp.check(get_user_data() is null, 'danach leer');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.check(get_user_data()->'cards' = '[{"id":"y"}]', 'A unberührt');

-- Validierung
do $$ begin perform save_user_data('{"a":1}', '[]', '', null); raise exception 'FAIL: Objekt statt Liste'; exception when sqlstate '22023' then raise notice '✓ ungültige Liste abgelehnt'; end $$;
do $$ begin perform save_user_data('[]', '[]', repeat('x', 200001), null); raise exception 'FAIL: zu lang'; exception when sqlstate '54000' then raise notice '✓ zu große Daten abgelehnt'; end $$;
reset role;

-- ── Anonym ──
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin perform get_user_data(); raise exception 'FAIL: anon darf get_user_data'; exception when insufficient_privilege then raise notice '✓ anon: keine Konto-Daten'; end $$;
do $$ begin perform list_tracked(); raise exception 'FAIL: anon darf list_tracked'; exception when insufficient_privilege then raise notice '✓ anon: kein list_tracked'; end $$;
do $$ begin perform ingest_prices('[]'); raise exception 'FAIL: anon darf ingest'; exception when insufficient_privilege then raise notice '✓ anon: kein ingest_prices'; end $$;
select pg_temp.check(track_products(array[273699, 660224, 273699, -5]) = 2, 'vormerken (Duplikate/ungültige ignoriert)');
select pg_temp.check(track_products(array[273699]) = 0, 'schon vorgemerkt');
select pg_temp.check((select count(*) from tracked_products) = 0, 'anon liest Tabelle nicht direkt');
select pg_temp.check(get_price_history(array[273699]) = '{}', 'noch kein Verlauf');
reset role;

-- ── Täglicher Job (service_role) ──
set role service_role;
select pg_temp.check(list_tracked() = array[273699, 660224]::bigint[], 'Job liest vorgemerkte IDs');
select pg_temp.check(ingest_prices('[{"id":273699,"day":"2026-11-17","trend":290.28,"avg1":150,"avg7":392.3,"avg30":415.74,"low":90},
                                     {"id":999,"day":"2026-11-17","trend":1}]') = 1, 'nur vorgemerkte IDs gespeichert');
select pg_temp.check(ingest_prices('[{"id":273699,"day":"2026-11-17","trend":291}]') = 1, 'gleicher Tag wird ersetzt');
reset role;
set role anon;
select pg_temp.check(get_price_history(array[273699, 660224]) = '{"273699": [["2026-11-17", 291, null, null, null, null]]}', 'Verlauf lesen');
reset role;
SQL
echo "schema.test.sh: alle Tests bestanden"

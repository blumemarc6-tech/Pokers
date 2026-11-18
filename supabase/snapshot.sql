-- ═══════════════════════════════════════════════════════════════
-- POKETA – täglicher Preis-Snapshot direkt in Supabase (pg_cron + pg_net)
-- Nach schema.sql im SQL-Editor ausführen (wiederholbar).
--
-- 05:10 UTC  snapshot_fetch()   lädt den Cardmarket-Price-Guide (asynchron über pg_net)
-- 05:20–06:50 alle 10 Min. snapshot_ingest()  speichert die Tagespreise aller
--            vorgemerkten Karten, sobald die Antwort da ist (läuft pro Tag einmal durch)
-- ═══════════════════════════════════════════════════════════════
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.snapshot_runs (
  id         bigserial primary key,
  request_id bigint,
  started    timestamptz not null default now(),
  finished   timestamptz,
  result     jsonb
);
alter table public.snapshot_runs enable row level security;

create or replace function public.snapshot_fetch()
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare rid bigint;
begin
  select net.http_get(
    url := 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json',
    timeout_milliseconds := 120000
  ) into rid;
  insert into public.snapshot_runs (request_id) values (rid);
  return rid;
end;
$$;

create or replace function public.snapshot_ingest()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  run public.snapshot_runs;
  resp record;
  g jsonb;
  d date;
  n int;
  res jsonb;
begin
  select * into run from public.snapshot_runs where finished is null order by id desc limit 1;
  if not found then return jsonb_build_object('status', 'nichts zu tun'); end if;

  select status_code, content, error_msg into resp from net._http_response where id = run.request_id;
  if not found then
    if run.started < now() - interval '3 hours' then
      update public.snapshot_runs set finished = now(), result = '{"status":"keine Antwort"}' where id = run.id;
    end if;
    return jsonb_build_object('status', 'wartet');
  end if;
  if resp.status_code is distinct from 200 then
    res := jsonb_build_object('status', 'fehler', 'http', resp.status_code, 'error', resp.error_msg);
    update public.snapshot_runs set finished = now(), result = res where id = run.id;
    return res;
  end if;

  g := resp.content::jsonb;
  d := left(g->>'createdAt', 10)::date;

  insert into public.price_history (id_product, day, trend, avg1, avg7, avg30, low)
  select id, d,
    case when holo then th  else t  end, case when holo then a1h else a1 end,
    case when holo then a7h else a7 end, case when holo then a30h else a30 end,
    case when holo then lh  else l  end
  from (
    select (e->>'idProduct')::bigint as id,
      nullif((e->>'trend')::numeric, 0) t,        nullif((e->>'avg1')::numeric, 0) a1,
      nullif((e->>'avg7')::numeric, 0) a7,        nullif((e->>'avg30')::numeric, 0) a30,
      nullif((e->>'low')::numeric, 0) l,
      nullif((e->>'trend-holo')::numeric, 0) th,  nullif((e->>'avg1-holo')::numeric, 0) a1h,
      nullif((e->>'avg7-holo')::numeric, 0) a7h,  nullif((e->>'avg30-holo')::numeric, 0) a30h,
      nullif((e->>'low-holo')::numeric, 0) lh
    from jsonb_array_elements(g->'priceGuides') e
  ) x
  cross join lateral (select (t is null and a1 is null and a7 is null and a30 is null and l is null) as holo) h
  where id in (select id_product from public.tracked_products)
    and coalesce(t, a1, a7, a30, l, th, a1h, a7h, a30h, lh) is not null
  on conflict (id_product, day) do update
    set trend = excluded.trend, avg1 = excluded.avg1, avg7 = excluded.avg7, avg30 = excluded.avg30, low = excluded.low;
  get diagnostics n = row_count;

  res := jsonb_build_object('status', 'ok', 'day', d, 'written', n,
                            'tracked', (select count(*) from public.tracked_products));
  update public.snapshot_runs set finished = now(), result = res where id = run.id;
  delete from net._http_response where id = run.request_id;   -- 16 MB Antwort wieder freigeben
  delete from public.snapshot_runs where started < now() - interval '60 days';
  return res;
end;
$$;

revoke all on function public.snapshot_fetch()  from public, anon, authenticated;
revoke all on function public.snapshot_ingest() from public, anon, authenticated;

-- Zeitplan (vorhandene Einträge ersetzen)
select cron.unschedule(jobid) from cron.job where jobname in ('poketa-fetch', 'poketa-ingest');
select cron.schedule('poketa-fetch',  '10 5 * * *',      'select public.snapshot_fetch()');
select cron.schedule('poketa-ingest', '*/10 5-6 * * *',  'select public.snapshot_ingest()');

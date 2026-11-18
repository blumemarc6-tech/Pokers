-- ═══════════════════════════════════════════════════════════════
-- POKETA – Supabase-Schema
-- Einmal komplett im Supabase SQL-Editor ausführen (kann gefahrlos
-- erneut ausgeführt werden).
--
--  user_data         Sammlung, Wunschliste, Grading-Notizen pro Konto
--  tracked_products  Cardmarket-Produkte, deren Preis täglich gespeichert wird
--  price_history     ein Tagespunkt pro Produkt (aus dem Cardmarket-Price-Guide)
--
-- Zugriff nur über die Funktionen unten. Row Level Security ist überall an:
-- ein Konto sieht ausschließlich seine eigenen Daten.
-- ═══════════════════════════════════════════════════════════════

-- ── Konto-Daten ────────────────────────────────────────────────
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  cards      jsonb not null default '[]'::jsonb,
  wishes     jsonb not null default '[]'::jsonb,
  notes      text  not null default '',
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;

drop policy if exists "user_data: eigene Zeile lesen" on public.user_data;
create policy "user_data: eigene Zeile lesen" on public.user_data
  for select to authenticated using (user_id = auth.uid());

-- Laden: eigene Daten oder null
create or replace function public.get_user_data()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cards', cards, 'wishes', wishes, 'notes', notes, 'updatedAt', updated_at)
  from public.user_data where user_id = auth.uid();
$$;

-- Speichern mit Konflikterkennung: p_base = updatedAt des Stands, auf dem das Gerät aufbaut.
-- Ergebnis: {ok:true, updatedAt} oder {ok:false, data:<Stand auf dem Server>}
create or replace function public.save_user_data(p_cards jsonb, p_wishes jsonb, p_notes text, p_base text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur public.user_data;
  base timestamptz := nullif(p_base, '')::timestamptz;
  ts timestamptz;
  n int;
begin
  if uid is null then raise exception 'Nicht angemeldet.' using errcode = '28000'; end if;
  p_cards := coalesce(p_cards, '[]'::jsonb); p_wishes := coalesce(p_wishes, '[]'::jsonb); p_notes := coalesce(p_notes, '');
  if jsonb_typeof(p_cards) <> 'array' or jsonb_typeof(p_wishes) <> 'array' then
    raise exception 'Ungültige Daten.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_cards) > 20000 or jsonb_array_length(p_wishes) > 20000
     or length(p_notes) > 200000
     or octet_length(p_cards::text) + octet_length(p_wishes::text) + octet_length(p_notes) > 2 * 1024 * 1024 then
    raise exception 'Zu viele Daten (max. 2 MB).' using errcode = '54000';
  end if;

  select * into cur from public.user_data where user_id = uid for update;
  if not found then
    ts := clock_timestamp();
    insert into public.user_data (user_id, cards, wishes, notes, updated_at)
      values (uid, p_cards, p_wishes, p_notes, ts)
      on conflict (user_id) do nothing;
    get diagnostics n = row_count;
    if n = 1 then return jsonb_build_object('ok', true, 'updatedAt', ts); end if;
    select * into cur from public.user_data where user_id = uid for update;   -- anderes Gerät war schneller
  end if;

  if cur.updated_at is distinct from base then
    return jsonb_build_object('ok', false, 'data',
      jsonb_build_object('cards', cur.cards, 'wishes', cur.wishes, 'notes', cur.notes, 'updatedAt', cur.updated_at));
  end if;

  ts := greatest(clock_timestamp(), cur.updated_at + interval '1 millisecond');
  update public.user_data set cards = p_cards, wishes = p_wishes, notes = p_notes, updated_at = ts where user_id = uid;
  return jsonb_build_object('ok', true, 'updatedAt', ts);
end;
$$;

create or replace function public.delete_user_data()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet.' using errcode = '28000'; end if;
  delete from public.user_data where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Preisverlauf ───────────────────────────────────────────────
create table if not exists public.tracked_products (
  id_product bigint primary key check (id_product > 0),
  since      date not null default current_date
);
create table if not exists public.price_history (
  id_product bigint not null,
  day        date   not null,
  trend numeric(12,2), avg1 numeric(12,2), avg7 numeric(12,2), avg30 numeric(12,2), low numeric(12,2),
  primary key (id_product, day)
);
alter table public.tracked_products enable row level security;
alter table public.price_history enable row level security;
-- keine Policies: Zugriff nur über die Funktionen bzw. den Service-Key des täglichen Jobs

-- Karten vormerken (öffentlich, aber begrenzt: 40 IDs pro Aufruf, max. 50 000 insgesamt)
create or replace function public.track_products(p_ids bigint[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if (select count(*) from public.tracked_products) >= 50000 then return 0; end if;
  insert into public.tracked_products (id_product)
    select distinct x from unnest(p_ids[1:40]) as x where x > 0 and x < 1000000000
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Verlauf lesen: { "<id>": [[tag, trend, avg1, avg7, avg30, low], …] }
create or replace function public.get_price_history(p_ids bigint[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(id_product::text, pts), '{}'::jsonb) from (
    select id_product, jsonb_agg(jsonb_build_array(day, trend, avg1, avg7, avg30, low) order by day) as pts
    from public.price_history
    where id_product = any (p_ids[1:40]) and day > current_date - 400
    group by id_product
  ) t;
$$;

-- Für den täglichen Job (nur mit Service-Key)
create or replace function public.list_tracked()
returns bigint[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id_product order by id_product), '{}') from public.tracked_products;
$$;

create or replace function public.ingest_prices(p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.price_history (id_product, day, trend, avg1, avg7, avg30, low)
    select r.id, r.day, r.trend, r.avg1, r.avg7, r.avg30, r.low
    from jsonb_to_recordset(p_rows) as r(id bigint, day date, trend numeric, avg1 numeric, avg7 numeric, avg30 numeric, low numeric)
    where r.id in (select id_product from public.tracked_products)
  on conflict (id_product, day) do update
    set trend = excluded.trend, avg1 = excluded.avg1, avg7 = excluded.avg7, avg30 = excluded.avg30, low = excluded.low;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── Rechte ─────────────────────────────────────────────────────
revoke all on function public.get_user_data()                          from public, anon;
revoke all on function public.save_user_data(jsonb, jsonb, text, text) from public, anon;
revoke all on function public.delete_user_data()                       from public, anon;
revoke all on function public.track_products(bigint[])                 from public;
revoke all on function public.get_price_history(bigint[])              from public;
revoke all on function public.list_tracked()                           from public, anon, authenticated;
revoke all on function public.ingest_prices(jsonb)                     from public, anon, authenticated;

grant execute on function public.get_user_data()                          to authenticated;
grant execute on function public.save_user_data(jsonb, jsonb, text, text) to authenticated;
grant execute on function public.delete_user_data()                       to authenticated;
grant execute on function public.track_products(bigint[])                 to anon, authenticated, service_role;
grant execute on function public.get_price_history(bigint[])              to anon, authenticated, service_role;
grant execute on function public.list_tracked()                           to service_role;
grant execute on function public.ingest_prices(jsonb)                     to service_role;

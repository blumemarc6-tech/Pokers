# POKETA – Betrieb auf Cloudflare Pages + Supabase

**Live:** <https://poketa.pages.dev>

## Was eingerichtet ist

| Teil | Wo | Details |
|---|---|---|
| Website | Cloudflare Pages, Projekt `poketa` | wird von `scripts/deploy-cloudflare.mjs` als Pages-Skript veröffentlicht |
| Anmeldung | Supabase Auth, Projekt `zyhafbncnadtpsvijaza` | E-Mail + Passwort (mit Bestätigung), Passwort-Reset; Site-URL `https://poketa.pages.dev` |
| Konto-Daten | Supabase-Tabelle `user_data` | nur über Funktionen, Row Level Security, Konflikterkennung ([`supabase/schema.sql`](supabase/schema.sql)) |
| Preisverlauf | Supabase-Tabellen `tracked_products`, `price_history` | täglich 05:10 UTC per `pg_cron`/`pg_net` aus dem Cardmarket-Price-Guide ([`supabase/snapshot.sql`](supabase/snapshot.sql)) |
| Zugangsdaten fürs Frontend | [`config.js`](config.js) | Projekt-URL + öffentlicher *publishable* Key (darf öffentlich sein) |

## Noch offen (braucht dich)

1. **E-Mails an Nutzer:** Supabase verschickt ohne eigenen Mail-Server Bestätigungs- und Reset-Mails
   **nur an Mitglieder deines Supabase-Teams**. Für echte Nutzer unter
   *Authentication → Emails → SMTP Settings* einen Anbieter eintragen (z. B. Resend oder Brevo, beide mit Gratis-Kontingent).
   Alternative: *Authentication → Sign In / Providers → Email → „Confirm email“* ausschalten.
2. **Google-Login:** In der [Google Cloud Console](https://console.cloud.google.com/apis/credentials) eine
   *OAuth-Client-ID (Webanwendung)* anlegen, als Weiterleitungs-URI
   `https://zyhafbncnadtpsvijaza.supabase.co/auth/v1/callback` eintragen, dann Client-ID und Secret in Supabase unter
   *Authentication → Sign In / Providers → Google* einfügen. Der Google-Button erscheint danach automatisch.
3. **Apple-Login (später):** braucht ein Apple-Developer-Konto. Provider in Supabase einschalten – der Button erscheint automatisch.

## Neu veröffentlichen

```bash
CLOUDFLARE_API_TOKEN=<Token mit „Cloudflare Pages: Edit“> node scripts/deploy-cloudflare.mjs poketa main
```

## Datenbank ändern

`supabase/schema.sql` bzw. `supabase/snapshot.sql` im Supabase-SQL-Editor erneut ausführen (beide sind wiederholbar).
Letzte Snapshot-Läufe: `select * from snapshot_runs order by id desc;`

## Tests

```bash
npm test          # Snapshot-Logik (scripts/price-snapshot.mjs, manuelle Alternative zum pg_cron-Job)
npm run test:db   # Schema gegen lokales Postgres (braucht psql)
```

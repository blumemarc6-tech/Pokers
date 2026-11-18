# POKETA einrichten – Cloudflare Pages + Supabase

Alles kostenlos. Dauer: ca. 20 Minuten. Reihenfolge einhalten.

## 1. Supabase-Projekt anlegen

1. Auf <https://supabase.com> registrieren → **New project** (Region z. B. *Frankfurt*). Datenbank-Passwort notieren.
2. Links **SQL Editor** → **New query** → den kompletten Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
   Erwartet: „Success. No rows returned“.
3. **Project Settings → API** öffnen und zwei Werte kopieren:
   - **Project URL** (z. B. `https://abcd1234.supabase.co`)
   - **anon / publishable key**
   - Den **service_role / secret key** brauchst du erst in Schritt 4 – der kommt **nie** in die Website.

## 2. Werte in `config.js` eintragen

Datei [`config.js`](config.js) im Repo bearbeiten (direkt auf GitHub über den Stift):

```js
window.POKETA_CONFIG = {
  supabaseUrl: 'https://abcd1234.supabase.co',
  supabaseAnonKey: 'eyJ… oder sb_publishable_…'
};
```

Solange die Werte leer sind, läuft POKETA wie früher ohne Konto.

## 3. Website auf Cloudflare Pages

1. Auf <https://dash.cloudflare.com> registrieren → **Workers & Pages → Create → Pages → Connect to Git**.
2. Repo `Pokers` wählen. Branch: `claude/poketa-account-ui-ikh7qr` (oder `main`, falls gemerged).
3. Build-Einstellungen: **Framework preset: None**, **Build command: leer**, **Build output directory: `/`** → **Save and Deploy**.
4. Du bekommst eine Adresse wie `https://pokers.pages.dev`.

## 4. Anmeldung in Supabase einstellen

**Authentication → URL Configuration**
- **Site URL**: deine Cloudflare-Adresse, z. B. `https://pokers.pages.dev`
- **Redirect URLs**: dieselbe Adresse hinzufügen, plus `https://*.pokers.pages.dev/**` für Vorschau-Deploys

**Authentication → Sign In / Providers**
- **Email**: an. „Confirm email“ an lassen (neue Konten bestätigen ihre E-Mail) oder abschalten.
- **Google**: an. Dafür in der [Google Cloud Console](https://console.cloud.google.com/apis/credentials) eine *OAuth-Client-ID (Webanwendung)* erstellen,
  als *Autorisierte Weiterleitungs-URI* die **Callback URL** eintragen, die Supabase beim Google-Provider anzeigt
  (`https://<projekt>.supabase.co/auth/v1/callback`). Client-ID und Secret in Supabase einfügen.
- **Apple** (später): braucht ein Apple-Developer-Konto (99 $/Jahr). Sobald du den Provider in Supabase einschaltest,
  erscheint der Button „Mit Apple fortfahren“ automatisch – am Code muss nichts geändert werden.

**Optional – eigene E-Mails:** Supabase verschickt im Gratis-Plan nur wenige Mails pro Stunde. Für echten Betrieb unter
**Authentication → Emails → SMTP Settings** einen Mail-Anbieter (z. B. Resend, Brevo) eintragen.

## 5. Täglicher Preis-Snapshot (GitHub Action)

Im GitHub-Repo: **Settings → Secrets and variables → Actions → New repository secret**
- `SUPABASE_URL` = Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = service_role / secret key

Dann **Actions → Preis-Snapshot → Run workflow** einmal manuell starten. Danach läuft er jeden Tag um 05:17 UTC
und speichert die Cardmarket-Preise aller Karten, die jemand in POKETA geöffnet hat.

> Hinweis: GitHub pausiert geplante Actions, wenn im Repo 60 Tage lang nichts passiert. Dann einfach wieder auf „Enable“ klicken.

## Testen (für Entwickler)

```bash
npm test                 # Preis-Snapshot-Skript
npm run test:db          # Datenbank-Schema gegen lokales Postgres (braucht psql)
```

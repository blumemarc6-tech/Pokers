/* POKETA – Verbindung zu Supabase
   Werte findest du im Supabase-Dashboard unter Project Settings → API:
     supabaseUrl      = Project URL
     supabaseAnonKey  = anon / publishable key  (öffentlich, darf hier stehen)
   NIEMALS den service_role- bzw. secret-Key hier eintragen!
   Solange die Werte leer sind, läuft POKETA wie früher ohne Konto. */
window.POKETA_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};

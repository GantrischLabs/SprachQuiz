/* ============================================================
   Konto & Synchronisation (Supabase)
   Leer lassen = Quiz läuft wie bisher, Fortschritt nur auf
   diesem Gerät. Einrichtung: siehe supabase/README.md

   Der Publishable Key (sb_publishable_…) ist für den Browser gedacht und
   darf öffentlich im Repo stehen – geschützt wird über die
   Rechte in supabase/setup.sql. Den Secret Key (sb_secret_…)
   NIE hier eintragen.
   ============================================================ */

window.QUIZ_CONFIG = {
  supabaseUrl: "https://xvkpmsbsyehrktntvguv.supabase.co/rest/v1/",              // Project Settings → Data API → Project URL
  supabaseAnonKey: "sb_publishable_RRPTCEFuf-MFTyLhxCOVwQ_RBn404eh",          // Project Settings → API Keys → Publishable key
  registrierungErlaubt: true    // false = nur von Dir eingeladene Eltern können sich anmelden
};

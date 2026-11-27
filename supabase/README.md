# Konto & Fortschritt auf allen Geräten (Supabase)

Mit einem Eltern-Konto wird der Fortschritt jedes Kindes gespeichert: XP, Ränge, Fehlerliste und angefangene Runden. Auf Tablet, Handy und Computer ist er dann gleich.

Solange `config.js` leer ist, läuft das Quiz genau wie bisher. Der Fortschritt bleibt dann nur auf dem Gerät.

## So funktioniert es

- **Ein Login pro Familie** (E-Mail + Passwort der Eltern).
- **Ein Profil pro Kind**, nur mit Vorname. Weitere Angaben zu den Kindern werden nicht gespeichert.
- Jedes Gerät merkt sich das zuletzt gewählte Profil. Das Kind landet beim Öffnen also direkt bei sich und muss sich nicht anmelden.
- Ohne Internet wird lokal weitergespeichert und später automatisch hochgeladen.
- Beim ersten Profil kann der bisherige Fortschritt auf dem Gerät übernommen werden. Das Häkchen ist vorgewählt.
- Jede Familie sieht nur ihre eigenen Profile. Das ist in der Datenbank abgesichert (Row Level Security).
- Übt dasselbe Kind abwechselnd auf mehreren Geräten (auch offline oder mitten in einer Runde), wird der Fortschritt zusammengeführt: XP und Übungstage zählen zusammen, Sterne bleiben, und wurde dasselbe Wort auf beiden Geräten geübt, gilt die tiefere Lernstufe. Die Regeln stehen in [`abgleich.js`](../abgleich.js).

## Einrichtung (einmalig, ca. 15 Minuten)

1. **Projekt anlegen:** Auf [supabase.com](https://supabase.com) ein neues Projekt anlegen, z.B. `sprachen-quiz`. Ein Gratis-Konto erlaubt zwei Projekte, die Boulder-App nutzt das andere. Als Region eine europäische wählen (Zürich, falls angeboten, sonst Frankfurt).
2. **Tabellen anlegen:** Im **SQL Editor** den Inhalt von [`setup.sql`](setup.sql) einfügen und **Run** klicken. Das Skript darf später erneut laufen.
3. **Adresse eintragen (wichtig für die Mails):** Unter **Authentication → URL Configuration**:
   - *Site URL*: die Adresse des Quiz, `https://sprachquiz.gantrischlabs.ch/`
   - *Redirect URLs*: dieselbe Adresse nochmals hinzufügen.

   Ohne diesen Schritt führen die Links in der Bestätigungs- und der Passwort-Mail ins Leere.
4. **App verbinden:** Die **Project URL** (unter **Project Settings → Data API**, Form `https://<projekt-id>.supabase.co`) und den **Publishable Key** (unter **Project Settings → API Keys**, beginnt mit `sb_publishable_`) in [`config.js`](../config.js) eintragen. Committen.
   - Der Publishable Key darf öffentlich sein. Den **Secret Key** (`sb_secret_…`) und die alten Legacy-Keys (`anon`, `service_role`) **nicht** verwenden – die alten werden Ende 2026 abgeschaltet, der Secret Key umgeht alle Rechte.
5. **Wach halten:** Gratis-Projekte pausieren nach 7 Tagen ohne Zugriff. Gerade in den Ferien kann das passieren. Der Workflow [`supabase-wach-halten.yml`](../.github/workflows/supabase-wach-halten.yml) fragt die Datenbank zweimal pro Woche an. Unter **Actions** einmal manuell starten (*Run workflow*) und prüfen, ob er grün wird.

## Stand zurücksetzen (Rollback)

Vor jeder Übungssitzung merkt sich die Datenbank den bisherigen Stand eines Kindes (`progress_history`). Als Sitzung gilt das erste Hochladen nach mindestens 10 ruhigen Minuten. Die Versionen bleiben 30 Tage. So lässt sich zum Beispiel ein Test im Profil eines Kindes rückgängig machen.

**Einmalig:** Nach dem Update [`setup.sql`](setup.sql) nochmals im **SQL Editor** laufen lassen.

**Zurücksetzen** im **SQL Editor**:

1. Versionen eines Kindes anzeigen. Den Namen anpassen:
   ```sql
   SELECT
   	h.id,
   	h.saved_at AT TIME ZONE 'Europe/Zurich'	AS stand_vor,
   	h.data -> 'xp'							AS xp
   FROM public.progress_history	AS h
   JOIN public.profiles			AS p ON p.id = h.profile_id
   WHERE p.name = 'Name'
   ORDER BY h.saved_at DESC
   LIMIT 20;
   ```
   `stand_vor` ist der Zeitpunkt, an dem die Sitzung danach begann. Die Version zeigt den Stand unmittelbar davor.
2. Die passende `id` zurückspielen:
   ```sql
   SELECT public.progress_restore(123);
   ```
3. Alle Geräte übernehmen diesen Stand beim nächsten Öffnen unverändert. Was ein Gerät seit dem letzten Abgleich noch nicht hochgeladen hat, wird dabei verworfen.

Auch der Rollback selbst lässt sich rückgängig machen: Der Stand davor liegt als neueste Version im Verlauf. Die App selbst kann weder den Verlauf lesen noch zurücksetzen, das geht nur im SQL Editor.

## Wer darf ein Konto erstellen?

- **Standard:** Jeder mit dem Link kann über *Konto erstellen* ein Eltern-Konto anlegen und bekommt eine Bestätigungs-Mail.
- **Nur eingeladene Familien:** Unter **Authentication → Sign In / Providers** die Option *Allow new users to sign up* ausschalten und in `config.js` `registrierungErlaubt: false` setzen. Eltern lädst Du dann unter **Authentication → Users → Invite user** ein.

Der eingebaute Mailversand von Supabase ist stark begrenzt (nur wenige Mails pro Stunde). Für ein paar Familien reicht das. Wenn Bestätigungs-Mails nicht ankommen:
- etwas warten, oder
- unter **Authentication → Sign In / Providers → Email** die Option *Confirm email* ausschalten, oder
- den Benutzer direkt unter **Authentication → Users → Add user** mit *Auto Confirm User* anlegen.

## Erste Anmeldung auf einem Gerät mit bisherigem Fortschritt

1. Im Menü oben auf **Fortschritt auf allen Geräten** tippen.
2. Anmelden (oder Konto erstellen).
3. Profil für das Kind anlegen. Das Häkchen **Bisherigen Fortschritt übernehmen** steht schon.
4. Auf den anderen Geräten anmelden und dasselbe Profil wählen. Fertig.

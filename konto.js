// ════════════════════════════════════════════════════════════
//  KONTO & SYNCHRONISATION (Supabase) – optional
//
//  Ohne Eintrag in config.js passiert hier nichts: das Quiz
//  speichert wie bisher nur im Browser (Schlüssel franz_quiz_v1).
//
//  Mit Konto:
//  - Ein Eltern-Login (E-Mail + Passwort) pro Familie.
//  - Pro Kind ein Profil. Das Gerät merkt sich das zuletzt
//    gewählte Profil, das Kind landet also direkt bei sich.
//  - Jedes Profil hat seinen eigenen lokalen Speicher
//    (franz_quiz_v1__<profil-id>) und wird mit der Datenbank
//    abgeglichen. Übt das Kind auf mehreren Geräten, werden die
//    Stände zusammengeführt (Regeln in abgleich.js).
//  - Ohne Netz wird lokal weitergespeichert und später
//    abgeglichen.
//  - Wurde ein Stand in der Datenbank zurückgesetzt (Rollback, siehe
//    supabase/README.md), übernimmt jedes Gerät ihn unverändert.
// ════════════════════════════════════════════════════════════
// Supabase zeigt im Dashboard teils die API-Adresse mit «/rest/v1/» an.
// Die Bibliothek braucht die reine Projekt-Adresse – beides soll gehen.
function projektUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");
}

const Konto = (() => {
  const cfg = window.QUIZ_CONFIG || {};
  const konfiguriert = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
  const GAST = 'franz_quiz_v1';
  const LS_PROFIL = 'franz_quiz_profil';

  let client = null;
  let session = null;
  let profile = [];            // Profile des angemeldeten Kontos
  let profil = leseProfil();   // aktives Profil auf diesem Gerät { id, name }
  let status = 'ok';           // ok | laedt | offline | abgemeldet
  let ansicht = null;          // null = automatisch, sonst 'login' | 'neu-pw' | 'profile'
  let meldung = null;          // { text, fehler }
  let verwalten = false;       // Profile löschen erlauben

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- Lokaler Zustand ---------------- */

  function leseProfil() {
    if (!konfiguriert) return null;
    try { return JSON.parse(localStorage.getItem(LS_PROFIL)) || null; } catch (e) { return null; }
  }

  function merkeProfil(p) {
    profil = p ? { id: p.id, name: p.name } : null;
    try {
      if (profil) localStorage.setItem(LS_PROFIL, JSON.stringify(profil));
      else localStorage.removeItem(LS_PROFIL);
    } catch (e) {}
  }

  // Speicherschlüssel des aktiven Profils, null = Gast (wie bisher)
  function schluessel() {
    return profil ? `${GAST}__${profil.id}` : null;
  }

  function leseLokal(key) {
    try { const roh = localStorage.getItem(key); return roh ? JSON.parse(roh) : null; } catch (e) { return null; }
  }

  function hatFortschritt(d) {
    return !!d && ((d.xp && (d.xp.fr > 0 || d.xp.en > 0)) || Object.keys(d.decks || {}).length > 0);
  }

  // Gast-Stand inkl. Umzug vom ganz alten Format (quiz_xp)
  function gastStand() {
    const d = leseLokal(GAST);
    if (d) return d;
    const alt = parseInt((() => { try { return localStorage.getItem('quiz_xp'); } catch (e) { return null; } })() || '0');
    return alt > 0 ? { xp: { fr: alt, en: 0 } } : null;
  }

  /* ---------------- Supabase laden ---------------- */

  function ladeSkript(src, geladen) {
    if (geladen()) return Promise.resolve(true);
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(geladen());
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(false), 10000);
    });
  }

  function ladeBibliothek() {
    return ladeSkript(SUPABASE_JS, () => !!(window.supabase && window.supabase.createClient));
  }

  // abgleich.js lädt index.html. Hat ein Gerät noch eine ältere index.html
  // im Cache, fehlt die Datei – dann hier nachladen.
  function ladeAbgleich() {
    return ladeSkript('abgleich.js', () => !!window.Abgleich);
  }

  async function start() {
    if (!konfiguriert) return;
    renderLeiste();

    if (!(await ladeBibliothek())) { status = 'offline'; renderLeiste(); return; }
    await ladeAbgleich();

    client = window.supabase.createClient(projektUrl(cfg.supabaseUrl), cfg.supabaseAnonKey);
    client.auth.onAuthStateChange((ev, s) => {
      session = s;
      // Link aus der "Passwort vergessen"-Mail geöffnet
      if (ev === 'PASSWORD_RECOVERY') { ansicht = 'neu-pw'; zeigeKonto(); }
    });

    try { session = (await client.auth.getSession()).data.session; } catch (e) { session = null; }

    window.addEventListener('online', () => { hochladenJetzt(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') hochladenJetzt();
      // Zurück in der App: Stand von anderen Geräten holen, aber nie mitten in einer Runde
      else if (!document.body.classList.contains('quiz')) synchronisiere();
    });

    if (!session) {
      if (profil) status = 'abgemeldet';
      renderLeiste();
      return;
    }

    try {
      await ladeProfile();
    } catch (e) {
      console.error(e);
      status = 'offline';
      renderLeiste();
      return;
    }

    // Profil wurde auf einem anderen Gerät gelöscht
    if (profil && !profile.some(p => p.id === profil.id)) wechsleZuGast();

    if (profil) await synchronisiere();
    else if (ansicht !== 'neu-pw') zeigeKonto();   // angemeldet, aber noch kein Kind gewählt
    renderLeiste();
  }

  /* ---------------- Abgleich ---------------- */

  // Übt ein Kind auf mehreren Geräten, werden die Stände zusammengeführt
  // (abgleich.js). Dazu merkt sich jedes Gerät pro Profil die «Basis»:
  // den letzten Stand, der sicher auch in der Datenbank liegt.
  // Ablauf: Stand der Datenbank holen → zusammenführen → hochladen.
  // Hochgeladen wird nur, wenn in der Datenbank noch derselbe Stand liegt
  // (gleiches updated_at). Hat ein anderes Gerät inzwischen etwas
  // hochgeladen, wird neu geholt und nochmals zusammengeführt.

  let timer = null;
  let ausstehend = false;      // Änderungen hier, die noch nicht in der Datenbank sind
  let kette = Promise.resolve();

  function basisSchluessel(id) { return `${GAST}__${id}__basis`; }

  function merkeBasis(id, stand) {
    try { localStorage.setItem(basisSchluessel(id), JSON.stringify(stand)); } catch (e) {}
  }

  // Rollback-Nummer: steigt, wenn ein Stand in der Datenbank zurückgesetzt wurde
  // (progress_restore in setup.sql). Ist sie höher als hier bekannt, verwirft
  // das Gerät seinen Stand, statt ihn wieder hineinzumischen.
  function rollbackSchluessel(id) { return `${GAST}__${id}__rollback`; }
  function bekannterRollback(id) {
    try { return Number(localStorage.getItem(rollbackSchluessel(id))) || 0; } catch (e) { return 0; }
  }
  function merkeRollback(id, nr) {
    try { localStorage.setItem(rollbackSchluessel(id), String(nr)); } catch (e) {}
  }

  // Stand der Datenbank holen. Läuft auch, solange setup.sql noch ohne
  // Rollback-Spalte ist (dann gilt Rollback-Nummer 0).
  async function holeZeile(id) {
    const frage = spalten => client.from('progress').select(spalten).eq('profile_id', id).maybeSingle();
    let antwort = await frage('data, updated_at, rollback_no');
    if (antwort.error && /rollback_no/.test(String(antwort.error.message))) antwort = await frage('data, updated_at');
    return antwort;
  }

  // Werte aus index.html, die die Regeln brauchen (Wochenziel, Fehlerliste)
  function optionen() {
    return {
      wochenStart: typeof wochenStart === 'function' ? wochenStart() : null,
      sprachen: typeof SPRACHEN !== 'undefined' ? SPRACHEN : ['fr', 'en'],
      maxFehler: typeof MAX_FEHLER !== 'undefined' ? MAX_FEHLER : 80,
    };
  }

  // Wird von speichere() nach jeder Änderung aufgerufen
  function geaendert() {
    if (!profil) return;
    ausstehend = true;
    clearTimeout(timer);
    timer = setTimeout(hochladenJetzt, 2500);
  }

  // Eigene Änderungen abgleichen – nur wenn es welche gibt
  function hochladenJetzt() { return abgleichen(true); }

  // Auch ohne eigene Änderungen nachschauen, was andere Geräte geübt haben
  function synchronisiere() { return abgleichen(false); }

  // Immer nur ein Abgleich aufs Mal, die nächsten warten in der Kette
  function abgleichen(nurEigene) {
    clearTimeout(timer);
    timer = null;
    const lauf = kette.then(() => abgleichLauf(nurEigene));
    kette = lauf.catch(() => {});
    return lauf;
  }

  async function abgleichLauf(nurEigene) {
    if (!client || !session || !profil) return;
    if (nurEigene && !ausstehend) return;
    if (!window.Abgleich) { status = 'offline'; renderLeiste(); return; }
    const id = profil.id;
    if (!nurEigene) { status = 'laedt'; renderLeiste(); }
    try {
      for (let versuch = 1; versuch <= 3; versuch++) {
        const { data: zeile, error } = await holeZeile(id);
        if (error) throw error;
        if (!profil || profil.id !== id) return;   // inzwischen gewechselt

        // In der Datenbank zurückgesetzt: diesen Stand übernehmen, wie er ist
        const rollback = (zeile && zeile.rollback_no) || 0;
        if (rollback > bekannterRollback(id)) {
          merkeBasis(id, zeile.data);
          merkeRollback(id, rollback);
          ausstehend = false;
          uebernehmeDaten(zeile.data);
          status = 'ok';
          return;
        }

        const lokal = JSON.parse(JSON.stringify(daten));
        ausstehend = false;
        const zusammen = zeile
          ? Abgleich.zusammenfuehren(leseLokal(basisSchluessel(id)), lokal, zeile.data, optionen())
          : lokal;

        if (!zeile || !Abgleich.gleich(zusammen, zeile.data)) {
          const neu = { data: zusammen, updated_at: new Date().toISOString() };
          const { data: ok, error: e2 } = zeile
            ? await client.from('progress').update(neu)
                .eq('profile_id', id).eq('updated_at', zeile.updated_at).select('profile_id')
            : await client.from('progress').insert({ profile_id: id, ...neu }).select('profile_id');
          if (e2 && !istKonflikt(e2)) throw e2;
          // Ein anderes Gerät war schneller: neu holen und nochmals zusammenführen
          if (e2 || !ok || !ok.length) { ausstehend = true; continue; }
        }

        merkeBasis(id, zusammen);
        uebernehmeZusammen(id, lokal, zusammen);
        status = 'ok';
        return;
      }
      // Dreimal überholt: etwas später nochmals
      ausstehend = true;
      timer = setTimeout(hochladenJetzt, 2500);
    } catch (e) {
      console.error(e);
      ausstehend = true;
      status = istAuthFehler(e) ? 'abgemeldet' : 'offline';
    } finally {
      renderLeiste();
    }
  }

  // Den zusammengeführten Stand hier übernehmen. Was während des Abgleichs
  // noch geübt wurde, kommt obendrauf und geht beim nächsten Mal hoch.
  function uebernehmeZusammen(id, lokal, zusammen) {
    if (profil && profil.id === id) {
      const jetzt = JSON.parse(JSON.stringify(daten));
      const neu = Abgleich.zusammenfuehren(lokal, jetzt, zusammen, optionen());
      if (!Abgleich.gleich(neu, zusammen)) ausstehend = true;
      if (!Abgleich.gleich(neu, jetzt)) uebernehmeDaten(neu);
      return;
    }
    // Profil inzwischen gewechselt: dessen Speicher auf diesem Gerät nachführen
    const key = `${GAST}__${id}`;
    const gespeichert = leseLokal(key);
    if (!gespeichert) return;
    const neu = Abgleich.zusammenfuehren(lokal, gespeichert, zusammen, optionen());
    try { localStorage.setItem(key, JSON.stringify(neu)); } catch (e) {}
  }

  function istKonflikt(e) {
    return String(e && e.code) === '23505' || /duplicate key/i.test(String(e && e.message));
  }

  function istAuthFehler(e) {
    const m = String((e && (e.message || e.code)) || '');
    return /JWT|401|42501|permission|row-level/i.test(m);
  }

  /* ---------------- Profile ---------------- */

  async function ladeProfile() {
    const { data, error } = await client.from('profiles').select('id, name').order('created_at', { ascending: true });
    if (error) throw error;
    profile = data || [];
  }

  async function waehleProfil(p) {
    await hochladenJetzt();   // Stand des bisherigen Profils sichern
    merkeProfil(p);
    status = 'ok';
    uebernehmeDaten(leseLokal(schluessel()) || leereDaten());
    ansicht = null;
    meldung = null;
    zumMenu();
    await synchronisiere();
  }

  function wechsleZuGast() {
    merkeProfil(null);
    uebernehmeDaten(gastStand() || leereDaten());
  }

  async function neuesProfil(name, gastUebernehmen) {
    const { data, error } = await client.from('profiles').insert({ name }).select('id, name');
    if (error) throw error;
    const p = data[0];

    if (gastUebernehmen) {
      const gast = gastStand();
      if (gast) {
        gast.geaendert = Date.now();
        try { localStorage.setItem(`${GAST}__${p.id}`, JSON.stringify(gast)); } catch (e) {}
        const { error: e2 } = await client.from('progress').upsert({ profile_id: p.id, data: gast, updated_at: new Date().toISOString() });
        if (e2) throw e2;
      }
    }

    await ladeProfile();
    await waehleProfil(p);
  }

  async function loescheProfil(p) {
    if (!confirm(`Profil «${p.name}» mit dem ganzen Fortschritt löschen?`)) return;
    const { error } = await client.from('profiles').delete().eq('id', p.id);
    if (error) throw error;
    try {
      localStorage.removeItem(`${GAST}__${p.id}`);
      localStorage.removeItem(basisSchluessel(p.id));
      localStorage.removeItem(rollbackSchluessel(p.id));
    } catch (e) {}
    if (profil && profil.id === p.id) wechsleZuGast();
    await ladeProfile();
    renderKonto();
  }

  /* ---------------- Ansicht: Leiste im Menü ---------------- */

  // Kleines Rund-Icon in der Kopfzeile, links der Sprachwahl:
  // Anfangsbuchstabe des Kindes. Antippen öffnet die Konto-Seite.
  function renderLeiste() {
    const el = document.getElementById('konto-icon');
    if (!el) return;
    if (!konfiguriert) { el.innerHTML = ''; return; }

    const warnung = status === 'offline' || status === 'abgemeldet';
    let zeichen, titel, klasse = '';
    if (profil) {
      zeichen = esc((profil.name.trim()[0] || '?').toUpperCase());
      titel = profil.name + ' – ' + ({
        ok: 'Profil wechseln',
        laedt: 'wird abgeglichen …',
        offline: 'gerade offline, wird später gespeichert',
        abgemeldet: 'abgemeldet, tippen zum Anmelden',
      }[status] || 'Profil wechseln');
    } else if (session) {
      zeichen = '?';
      titel = 'Wer übt? Profil wählen';
      klasse = 'ohne';
    } else {
      zeichen = '👤';
      titel = 'Anmelden – Fortschritt auf allen Geräten';
      klasse = 'ohne emoji';
    }

    el.innerHTML = `
      <button class="konto-icon ${klasse} ${warnung ? 'warnung' : ''} ${status === 'laedt' ? 'laedt' : ''}"
              onclick="Konto.zeigeKonto()" title="${esc(titel)}" aria-label="${esc(titel)}">${zeichen}</button>`;
  }


  /* ---------------- Ansicht: Konto-Seite ---------------- */

  function zeigeKonto() {
    if (!konfiguriert) return;
    document.body.classList.remove('quiz');
    document.body.classList.add('konto');
    document.getElementById('kopf').textContent = '✦ Konto ✦';
    renderKonto();
    window.scrollTo(0, 0);
  }

  function aktuelleAnsicht() {
    if (ansicht) return ansicht;
    return session ? 'profile' : 'login';
  }

  function renderKonto() {
    const el = document.getElementById('konto');
    if (!el) return;

    const info = meldung
      ? `<p class="konto-meldung ${meldung.fehler ? 'fehler' : ''}">${esc(meldung.text)}</p>`
      : '';

    if (!client) {
      el.innerHTML = `<div class="konto-karte"><h2>Konto</h2>
        <p>Die Verbindung zum Speicher ist gerade nicht möglich. Der Fortschritt wird auf diesem Gerät gesichert.</p></div>`;
      return;
    }

    const v = aktuelleAnsicht();

    if (v === 'neu-pw') {
      el.innerHTML = `
        <form class="konto-karte" onsubmit="event.preventDefault(); Konto.setzePasswort()">
          <h2>Neues Passwort</h2>
          ${info}
          <label>Neues Passwort<input id="k-pw-neu" type="password" autocomplete="new-password" minlength="6" required></label>
          <button class="restart-btn" type="submit">Speichern</button>
        </form>`;
      return;
    }

    if (v === 'login') {
      el.innerHTML = `
        <form class="konto-karte" onsubmit="event.preventDefault(); Konto.anmelden()">
          <h2>Eltern-Login</h2>
          <p>Mit einem Konto wird der Fortschritt jedes Kindes gespeichert und ist auf allen Geräten gleich.</p>
          ${info}
          <label>E-Mail<input id="k-mail" type="email" autocomplete="email" required></label>
          <label>Passwort<input id="k-pw" type="password" autocomplete="current-password" minlength="6" required></label>
          <button class="restart-btn" type="submit">Anmelden</button>
          ${cfg.registrierungErlaubt !== false
            ? `<button class="menu-btn" type="button" onclick="Konto.registrieren()">Konto erstellen</button>` : ''}
          <button class="link-btn" type="button" onclick="Konto.passwortVergessen()">Passwort vergessen?</button>
        </form>
        <button class="link-btn" type="button" onclick="zumMenu()">Ohne Anmeldung üben (nur auf diesem Gerät)</button>`;
      return;
    }

    // Profile
    const gast = gastStand();
    const angebot = hatFortschritt(gast);
    const liste = profile.map(p => `
      <div class="profil-zeile">
        <button class="profil ${profil && profil.id === p.id ? 'aktiv' : ''}" onclick="Konto.waehle('${esc(p.id)}')">
          <span class="emoji">🧙</span><b>${esc(p.name)}</b>
        </button>
        ${verwalten ? `<button class="profil-weg" onclick="Konto.loesche('${esc(p.id)}')" aria-label="${esc(p.name)} löschen">✕</button>` : ''}
      </div>`).join('');

    el.innerHTML = `
      <div class="konto-karte">
        <h2>Wer übt?</h2>
        ${info}
        <div class="profil-liste">${liste || '<p>Noch kein Profil – lege für jedes Kind eines an.</p>'}</div>
        <form class="profil-neu" onsubmit="event.preventDefault(); Konto.neu()">
          <label>Neues Profil (Vorname)<input id="k-name" type="text" maxlength="30" autocomplete="off" required></label>
          ${angebot ? `
            <label class="haken"><input id="k-gast" type="checkbox" ${profile.length === 0 ? 'checked' : ''}>
              Bisherigen Fortschritt von diesem Gerät übernehmen</label>` : ''}
          <button class="menu-btn" type="submit">＋ Profil anlegen</button>
        </form>
      </div>
      <div class="konto-fuss">
        <span>${esc(session && session.user ? session.user.email : '')}</span>
        ${profile.length ? `<button class="link-btn" type="button" onclick="Konto.verwalten()">${verwalten ? 'Fertig' : 'Profile verwalten'}</button>` : ''}
        <button class="link-btn" type="button" onclick="Konto.abmelden()">Abmelden</button>
      </div>`;
  }

  // Neu zeichnen, ohne dass Getipptes (E-Mail, Name) verloren geht
  function zeigeMeldung(text, fehler) {
    meldung = { text, fehler: !!fehler };
    const merken = ['k-mail', 'k-name'].map(id => [id, (document.getElementById(id) || {}).value]);
    renderKonto();
    merken.forEach(([id, wert]) => {
      const el = document.getElementById(id);
      if (el && wert) el.value = wert;
    });
  }

  function fehlerText(e) {
    const m = String((e && e.message) || e || '');
    if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort falsch.';
    if (/email not confirmed/i.test(m)) return 'Bitte zuerst den Link in der Bestätigungs-Mail öffnen.';
    if (/already registered|already exists/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto.';
    if (/signups? not allowed|signup is disabled/i.test(m)) return 'Neue Konten sind nicht freigeschaltet.';
    if (/password/i.test(m) && /6|short|weak/i.test(m)) return 'Das Passwort ist zu kurz (mind. 6 Zeichen).';
    if (/fetch|network|Failed to/i.test(m)) return 'Keine Verbindung zum Speicher.';
    return m || 'Unbekannter Fehler.';
  }

  function eingaben() {
    const mail = (document.getElementById('k-mail') || {}).value || '';
    const pw = (document.getElementById('k-pw') || {}).value || '';
    return { email: mail.trim(), password: pw };
  }

  // Für Links aus Mails: zurück auf genau diese Seite, ohne #...
  function rueckweg() { return location.href.split('#')[0]; }

  /* ---------------- Aktionen ---------------- */

  async function anmelden() {
    const { email, password } = eingaben();
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session;
      meldung = null;
      ansicht = null;
      await ladeProfile();
      // Auf diesem Gerät schon ein Profil gemerkt (z.B. nach Ablauf der Anmeldung)?
      if (profil && profile.some(p => p.id === profil.id)) { await waehleProfil(profil); return; }
      if (profil) wechsleZuGast();
      renderKonto();
      renderLeiste();
    } catch (e) {
      zeigeMeldung(fehlerText(e), true);
    }
  }

  async function registrieren() {
    const { email, password } = eingaben();
    if (!email || password.length < 6) {
      zeigeMeldung('Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen eingeben.', true);
      return;
    }
    try {
      const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: rueckweg() } });
      if (error) throw error;
      if (data.session) {
        session = data.session;
        await ladeProfile();
        meldung = null;
        renderKonto();
      } else {
        zeigeMeldung('Fast geschafft: Wir haben eine Mail geschickt. Den Link darin öffnen, dann hier anmelden.');
      }
    } catch (e) {
      zeigeMeldung(fehlerText(e), true);
    }
  }

  async function passwortVergessen() {
    const { email } = eingaben();
    if (!email) { zeigeMeldung('Bitte zuerst die E-Mail-Adresse eingeben.', true); return; }
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: rueckweg() });
      if (error) throw error;
      zeigeMeldung('Mail ist unterwegs. Über den Link darin kannst du ein neues Passwort setzen.');
    } catch (e) {
      zeigeMeldung(fehlerText(e), true);
    }
  }

  async function setzePasswort() {
    const pw = (document.getElementById('k-pw-neu') || {}).value || '';
    try {
      const { error } = await client.auth.updateUser({ password: pw });
      if (error) throw error;
      ansicht = null;
      meldung = { text: 'Passwort geändert.', fehler: false };
      await ladeProfile();
      renderKonto();
    } catch (e) {
      zeigeMeldung(fehlerText(e), true);
    }
  }

  async function abmelden() {
    await hochladenJetzt();
    try { await client.auth.signOut(); } catch (e) {}
    session = null;
    profile = [];
    verwalten = false;
    meldung = null;
    ansicht = null;
    status = 'ok';
    wechsleZuGast();
    renderKonto();
    renderLeiste();
  }

  async function neu() {
    const name = ((document.getElementById('k-name') || {}).value || '').trim();
    const gast = !!(document.getElementById('k-gast') || {}).checked;
    if (!name) return;
    try {
      await neuesProfil(name, gast);
    } catch (e) {
      zeigeMeldung(fehlerText(e), true);
    }
  }

  async function waehle(id) {
    const p = profile.find(x => x.id === id);
    if (p) await waehleProfil(p);
  }

  async function loesche(id) {
    const p = profile.find(x => x.id === id);
    if (!p) return;
    try { await loescheProfil(p); } catch (e) { zeigeMeldung(fehlerText(e), true); }
  }

  return {
    konfiguriert,
    start, schluessel, geaendert, renderLeiste, zeigeKonto,
    anmelden, registrieren, passwortVergessen, setzePasswort, abmelden,
    neu, waehle, loesche,
    verwalten() { verwalten = !verwalten; renderKonto(); },
  };
})();

// Als window.Konto erreichbar machen: index.html prüft mit «window.Konto»,
// damit das Quiz auch ohne diese Datei läuft
window.Konto = Konto;

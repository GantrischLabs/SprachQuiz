// ════════════════════════════════════════════════════════════
//  ABGLEICH ZWISCHEN GERÄTEN – zusammenführen statt ersetzen
//
//  Übt ein Kind abwechselnd auf Handy und iPad, gibt es zwei
//  Stände. Gemessen wird an der «Basis»: dem letzten Stand, den
//  dieses Gerät sicher mit der Datenbank geteilt hat. Was seither
//  hier oder dort dazukam, landet im gemeinsamen Stand:
//
//  - Sterne und «schon einmal richtig»: kommen nur dazu → vereinigen
//  - Zähler (XP, Übungstage fürs Wochenziel, neue Wörter pro Tag,
//    gespielte Runden): Basis + Zuwachs hier + Zuwachs dort
//  - Lernstufe pro Wort und «Meine Fehler»: übernehmen, was ein
//    Gerät geändert hat. Dasselbe Wort auf beiden geübt → die
//    tiefere Stufe gewinnt, das Wort kommt also eher nochmals.
//  - Alles andere (Einstellungen, angefangene Runde, zuletzt
//    geübte Liste): was sich geändert hat; auf beiden → der jüngere.
//
//  Ohne Basis (erster Abgleich, Speicher gesperrt) dient der ältere
//  der beiden Stände als Basis: dann gewinnt wie früher der jüngere,
//  nur Sterne und Erfolge gehen nie verloren.
//
//  Nur reine Funktionen ohne Zugriff auf Seite oder Speicher,
//  damit sie sich einzeln testen lassen. Verwendet in konto.js.
// ════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  function kopie(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function istObjekt(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function zahl(x) { return typeof x === 'number' && isFinite(x) ? x : 0; }

  // Gleicher Inhalt? Die Reihenfolge der Schlüssel zählt nicht, denn
  // die Datenbank (JSONB) sortiert sie beim Speichern um.
  function gleich(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b)
        && a.length === b.length && a.every((x, i) => gleich(x, b[i]));
    }
    const ka = Object.keys(a).filter(k => a[k] !== undefined);
    const kb = Object.keys(b).filter(k => b[k] !== undefined);
    return ka.length === kb.length && ka.every(k => gleich(a[k], b[k]));
  }

  // Allgemeine Regel: was nur eine Seite geändert hat, gilt;
  // haben beide geändert, gilt der jüngere Stand
  function dreiWege(b, l, s, lokalJuenger) {
    if (gleich(l, b)) return kopie(s);
    if (gleich(s, b)) return kopie(l);
    return kopie(lokalJuenger ? l : s);
  }

  // Ein Objekt Schlüssel für Schlüssel zusammenführen
  function proSchluessel(b, l, s, fn) {
    b = istObjekt(b) ? b : {};
    l = istObjekt(l) ? l : {};
    s = istObjekt(s) ? s : {};
    const r = {};
    new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(s)]).forEach(k => {
      const v = fn(b[k], l[k], s[k]);
      if (v !== undefined) r[k] = v;
    });
    return r;
  }

  // Zähler: Basis + Zuwachs hier + Zuwachs dort, nie unter 0
  function zaehler(b, l, s) {
    return Math.max(0, zahl(l) + zahl(s) - zahl(b));
  }

  // Zähler pro Schlüssel, z.B. { fr: 120, en: 40 } oder { Tag: Antworten }.
  // Was beide Seiten weggeräumt haben, bleibt weg. ohneNull: leere Tage weglassen.
  function zaehlerProSchluessel(b, l, s, ohneNull) {
    b = istObjekt(b) ? b : {};
    l = istObjekt(l) ? l : {};
    s = istObjekt(s) ? s : {};
    const r = {};
    new Set([...Object.keys(l), ...Object.keys(s)]).forEach(k => {
      const n = zaehler(b[k], l[k], s[k]);
      if (n > 0 || !ohneNull) r[k] = n;
    });
    return r;
  }

  // Lernstand eines Worts: { s: Stufe 0–5, f: fällig ab Tag, t: Tag des letzten Fehlers }
  function wortStand(b, l, s) {
    if (gleich(l, b)) return kopie(s);
    if (gleich(s, b)) return kopie(l);
    if (!istObjekt(l)) return kopie(s);
    if (!istObjekt(s)) return kopie(l);
    // Auf beiden Geräten geübt: die tiefere Stufe gewinnt,
    // bei gleicher Stufe das Wort, das früher wieder fällig ist
    const sieger = zahl(l.s) !== zahl(s.s)
      ? (zahl(l.s) < zahl(s.s) ? l : s)
      : (zahl(l.f) <= zahl(s.f) ? l : s);
    const r = kopie(sieger);
    const fehlerTage = [l.t, s.t].filter(t => typeof t === 'number');
    if (fehlerTage.length) r.t = Math.max(...fehlerTage);
    return r;
  }

  // Stand einer Liste: { geuebt, verlauf, letzteQuote, beste, zuletzt }
  function deckStand(b, l, s) {
    if (gleich(l, b)) return kopie(s);
    if (gleich(s, b)) return kopie(l);
    if (!istObjekt(l)) return kopie(s);
    if (!istObjekt(s)) return kopie(l);
    // Auf beiden Geräten gespielt: Angaben der jüngeren Runde,
    // Runden zusammenzählen, den besseren Prüfungsrekord behalten
    const r = kopie(zahl(l.zuletzt) >= zahl(s.zuletzt) ? l : s);
    r.geuebt = zaehler(istObjekt(b) ? b.geuebt : 0, l.geuebt, s.geuebt);
    if (l.beste !== undefined || s.beste !== undefined) r.beste = Math.max(zahl(l.beste), zahl(s.beste));
    return r;
  }

  // Neue Wörter, die «Heute fällig» heute gebracht hat: { tag, fr: n, en: n }
  function tagesNeu(b, l, s) {
    l = istObjekt(l) ? l : { tag: 0 };
    s = istObjekt(s) ? s : { tag: 0 };
    if (zahl(l.tag) !== zahl(s.tag)) return kopie(zahl(l.tag) > zahl(s.tag) ? l : s);
    const basis = istObjekt(b) && zahl(b.tag) === zahl(l.tag) ? b : {};
    const r = { tag: l.tag };
    new Set([...Object.keys(l), ...Object.keys(s)]).forEach(k => {
      if (k !== 'tag') r[k] = zaehler(basis[k], l[k], s[k]);
    });
    return r;
  }

  // «Meine Fehler»: Liste von { d: Liste, k: Wort }. Neu Gemerktes kommt
  // dazu, was auf einem Gerät erledigt wurde, fällt weg. Höchstens max Einträge.
  function fehlerListe(b, l, s, max) {
    const schl = f => (f && f.d) + '\u0001' + (f && f.k);
    const liste = x => (Array.isArray(x) ? x : []);
    const inB = new Set(liste(b).map(schl));
    const inL = new Set(liste(l).map(schl));
    const inS = new Set(liste(s).map(schl));
    const r = [];
    const gesehen = new Set();
    [...liste(l), ...liste(s)].forEach(f => {
      const k = schl(f);
      if (gesehen.has(k)) return;
      gesehen.add(k);
      const behalten = (inL.has(k) && inS.has(k)) || ((inL.has(k) || inS.has(k)) && !inB.has(k));
      if (behalten) r.push(kopie(f));
    });
    return r.slice(-max);
  }

  // Sterne pro Unité: ['entdeckt', …] – einmal verdient, bleibt verdient
  function sterneListe(b, l, s) {
    if (!Array.isArray(l) && !Array.isArray(s)) return undefined;
    return [...new Set([...(Array.isArray(l) ? l : []), ...(Array.isArray(s) ? s : [])])];
  }

  // «Schon einmal richtig» pro Wort als Bits – Bits kommen nur dazu
  function erfolgBits(b, l, s) {
    const bits = zahl(l) | zahl(s);
    return bits || (l !== undefined || s !== undefined ? 0 : undefined);
  }

  // Übungstage pro Sprache (tageJe) gibt es erst seit Version 30. Fehlt
  // der Zähler, wird er wie tageJe() in index.html aus dem alten
  // gemeinsamen Zähler gebildet – sonst zählte die laufende Woche doppelt.
  function mitTageJe(d, wochenStart, sprachen) {
    if (!istObjekt(d) || d.tageJe || !istObjekt(d.tage) || typeof wochenStart !== 'number') return d;
    const r = Object.assign({}, d, { tageJe: {} });
    Object.entries(d.tage).forEach(([t, n]) => {
      if (Number(t) < wochenStart) return;
      sprachen.forEach(sp => { (r.tageJe[sp] = r.tageJe[sp] || {})[t] = n; });
    });
    return r;
  }

  // basis: letzter gemeinsamer Stand (oder null), lokal: dieses Gerät,
  // server: die Datenbank. optionen: { wochenStart, sprachen, maxFehler }
  function zusammenfuehren(basis, lokal, server, optionen) {
    const o = optionen || {};
    const sprachen = o.sprachen || ['fr', 'en'];
    let l = istObjekt(lokal) ? kopie(lokal) : {};
    let s = istObjekt(server) ? kopie(server) : {};
    let b = istObjekt(basis) ? kopie(basis) : kopie(zahl(l.geaendert) <= zahl(s.geaendert) ? l : s);
    [b, l, s] = [b, l, s].map(d => mitTageJe(d, o.wochenStart, sprachen));

    const lokalJuenger = zahl(l.geaendert) >= zahl(s.geaendert);
    const r = {};
    new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(s)]).forEach(k => {
      let v;
      switch (k) {
        case 'xp':
          v = zaehlerProSchluessel(b.xp, l.xp, s.xp, false);
          break;
        case 'tageJe':
          v = proSchluessel(b.tageJe, l.tageJe, s.tageJe, (bb, ll, ss) => zaehlerProSchluessel(bb, ll, ss, true));
          break;
        case 'tagesNeu':
          v = tagesNeu(b.tagesNeu, l.tagesNeu, s.tagesNeu);
          break;
        case 'decks':
          v = proSchluessel(b.decks, l.decks, s.decks, deckStand);
          break;
        case 'woerter':
          v = proSchluessel(b.woerter, l.woerter, s.woerter, (bb, ll, ss) => {
            if (ll === undefined && ss === undefined) return undefined;
            return proSchluessel(bb, ll, ss, wortStand);
          });
          break;
        case 'erfolge':
          v = proSchluessel(b.erfolge, l.erfolge, s.erfolge, (bb, ll, ss) => {
            if (ll === undefined && ss === undefined) return undefined;
            return proSchluessel(bb, ll, ss, erfolgBits);
          });
          break;
        case 'sterne':
          v = proSchluessel(b.sterne, l.sterne, s.sterne, sterneListe);
          break;
        case 'fehler':
          v = fehlerListe(b.fehler, l.fehler, s.fehler, o.maxFehler || 80);
          break;
        case 'letzteJe':
          v = proSchluessel(b.letzteJe, l.letzteJe, s.letzteJe, (bb, ll, ss) => dreiWege(bb, ll, ss, lokalJuenger));
          break;
        case 'geaendert':
          v = Math.max(zahl(l.geaendert), zahl(s.geaendert)) || undefined;
          break;
        default:
          v = dreiWege(b[k], l[k], s[k], lokalJuenger);
      }
      if (v !== undefined) r[k] = v;
    });
    return r;
  }

  global.Abgleich = { zusammenfuehren, gleich };
})(typeof window !== 'undefined' ? window : globalThis);

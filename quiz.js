// ════════════════════════════════════════════════════════════
//  QUIZ – Ablauf, Speicher, Menü, Runden (früher <script> in index.html)
//  Läuft nach config.js, abgleich.js, konto.js und vokabeln.js.
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
//  VERSION
//  Bei jeder Änderung erhöhen (Nummer des Pull Requests) und dieselbe
//  Nummer in index.html bei quiz.css?v= und quiz.js?v= eintragen. Dazu
//  zeigt die App den Stand der geladenen Seite: GitHub Pages liefert ihn
//  als «Last-Modified» mit, er ändert sich also bei jeder Veröffentlichung.
// ════════════════════════════════════════════════════════════
const APP_VERSION = 36;

function versionText() {
  const stand = new Date(document.lastModified);
  // Ohne Last-Modified meldet der Browser die aktuelle Zeit – dann nur die Nummer
  const bekannt = !isNaN(stand) && Math.abs(Date.now() - stand) > 60 * 1000;
  const zwei = n => String(n).padStart(2, '0');
  return `Version ${APP_VERSION}` + (bekannt
    ? ` · ${zwei(stand.getDate())}.${zwei(stand.getMonth() + 1)}.${stand.getFullYear()} ${zwei(stand.getHours())}:${zwei(stand.getMinutes())}`
    : '');
}

// ════════════════════════════════════════════════════════════
//  SPEICHER
//  Alles unter einem Schlüssel. localStorage kann gesperrt sein
//  (Privatmodus, file://) → darf nie zum Absturz führen.
// ════════════════════════════════════════════════════════════
const SPEICHER = 'franz_quiz_v1';
const MAX_FEHLER = 80;

// Mit Konto hat jedes Kinderprofil seinen eigenen Speicher (konto.js)
function speicherSchluessel() {
  return (window.Konto && Konto.schluessel()) || SPEICHER;
}

function leereDaten() {
  return { version: 1, xp: { fr: 0, en: 0 }, decks: {}, fehler: [],
           letztes: null, laufend: null, vorlesen: true,
           // Lernstand pro Wort: woerter[deckId][schluessel] = { s: Stufe 0–5, f: fällig ab Tag, t: Tag des letzten Fehlers }
           woerter: {},
           // Wie viele neue Wörter die Runde «Heute fällig» am Tag schon gebracht hat
           tagesNeu: { tag: 0 },   // { tag, fr: n, en: n }
          tagesHeute: { tag: 0 }, // { tag, fr: [Wort-Schlüssel], en: […] } – heute in «Heute fällig» geübt
           // Gewählte Sprache im Menü – alle Inhalte und Zähler richten sich danach
           sprache: null,
           // Zuletzt geübte Liste pro Sprache, für «Weiter üben»
           letzteJe: {},
           // Beantwortete Fragen pro Tag (alle Sprachen zusammen), fürs Wochenziel
           tage: {},
           // Was mit einem Wort schon einmal richtig war: erfolge[deckId][schluessel] = Bits (siehe ERFOLG)
           erfolge: {},
           // Verdiente Etappen pro Unité: sterne[gruppenId] = ['entdeckt', …] – einmal verdient, bleibt verdient
           sterne: {},
           // Angefangene Prüfung – eigener Platz, damit sie nicht verloren geht,
           // wenn zwischendurch eine Liste geübt wird (sonst wie «laufend»)
           pruefungLauf: null,
           // Sterne seit der letzten seltenen Überraschung (spätestens beim 6. kommt eine)
           ohneUeberraschung: 0 };
}

function ladeDaten() {
  let d = leereDaten();
  try {
    const roh = localStorage.getItem(speicherSchluessel());
    if (roh) {
      const gespeichert = JSON.parse(roh);
      d = Object.assign(d, gespeichert);
      d.xp = Object.assign({ fr: 0, en: 0 }, gespeichert.xp);
    } else if (speicherSchluessel() === SPEICHER) {
      // Umzug vom alten Format: die bisherigen XP zählten alle für Französisch
      const alt = parseInt(localStorage.getItem('quiz_xp') || '0');
      if (alt > 0) d.xp.fr = alt;
    }
  } catch (e) {}
  return d;
}

function speichere() {
  // Zeitstempel: entscheidet beim Abgleich zwischen Geräten, wenn beide dasselbe geändert haben
  daten.geaendert = Date.now();
  try { localStorage.setItem(speicherSchluessel(), JSON.stringify(daten)); } catch (e) {}
  if (window.Konto) Konto.geaendert();
}

const daten = ladeDaten();

// Ersetzt den ganzen Stand, z.B. beim Profilwechsel oder nach dem
// Abgleich mit anderen Geräten. Der Zeitstempel bleibt dabei unverändert.
function uebernehmeDaten(neu) {
  const d = Object.assign(leereDaten(), neu || {});
  d.xp = Object.assign({ fr: 0, en: 0 }, (neu || {}).xp);
  Object.keys(daten).forEach(k => delete daten[k]);
  Object.assign(daten, d);
  vorlesen = daten.vorlesen !== false;
  try { localStorage.setItem(speicherSchluessel(), JSON.stringify(daten)); } catch (e) {}
  if (!document.body.classList.contains('quiz') && !document.body.classList.contains('konto')) zeigeMenu();
}

// ════════════════════════════════════════════════════════════
//  DECKS AUFBEREITEN
// ════════════════════════════════════════════════════════════
const alleDecks = {};
QUIZ_DATEN.gruppen.forEach(g => {
  g.decks.forEach(d => {
    d.gruppe = g;
    d.sprache = g.sprache;
    d.farbe = g.farbe;
    d.hell = g.hell;
    alleDecks[d.id] = d;
  });
});

// ── Sprachen: ergeben sich aus den Gruppen in vokabeln.js ──
const SPRACHEN = [...new Set(QUIZ_DATEN.gruppen.map(g => g.sprache).filter(Boolean))];
const SPRACH_NAME = { fr: 'Französisch', en: 'Englisch' };
const SPRACH_FLAGGE = { fr: '🇫🇷', en: '🇬🇧' };

// Die im Menü gewählte Sprache. Ohne Wahl: die der zuletzt geübten Liste.
function aktiveSprache() {
  if (SPRACHEN.includes(daten.sprache)) return daten.sprache;
  const letztes = daten.letztes && alleDecks[daten.letztes.deckId];
  return (letztes && SPRACHEN.includes(letztes.sprache)) ? letztes.sprache : SPRACHEN[0];
}

function setzeSprache(sp) {
  if (!SPRACHEN.includes(sp)) return;
  daten.sprache = sp;
  speichere();
  zeigeMenu();
}

// «Heute fällig» ist kein Deck aus vokabeln.js: es sammelt die Wörter
// aller Listen einer Sprache. Pro Sprache gibt es eine eigene Runde.
const HEUTE = {};
SPRACHEN.forEach(sp => {
  HEUTE[sp] = { id: '__heute-' + sp, icon: '🔮', titel: 'Heute fällig', typ: 'heute',
                sprache: sp, farbe: '#6b4a17', hell: '#eee0c4', woerter: [] };
  alleDecks[HEUTE[sp].id] = HEUTE[sp];
});

// Prüfung pro Unité: alle Wörter der Wortlisten – fette selbst schreiben,
// die übrigen 🇩🇪→Fremdsprache auswählen. Rückmeldung erst am Schluss.
// Die Prüfung steht nicht in g.decks und zählt deshalb nicht für «Entdeckt».
const PRUEFUNG = {};
QUIZ_DATEN.gruppen.filter(hatSterne).forEach(g => {
  const d = { id: '__pruefung-' + gruppenId(g), icon: '📝', titel: 'Prüfung', typ: 'pruefung',
              gruppe: g, sprache: g.sprache, farbe: g.farbe, hell: g.hell, woerter: [] };
  PRUEFUNG[gruppenId(g)] = d;
  alleDecks[d.id] = d;
});

// Alle Wörter einer Prüfung → [{ deck, eintrag }]
function pruefungsEintraege(deck) {
  return deck.gruppe.decks.filter(d => d.typ === 'vokabeln')
    .flatMap(d => d.woerter.map(w => ({ deck: d, eintrag: w })));
}

function istPruefung() { return !!aktuell.deck && aktuell.deck.typ === 'pruefung'; }

function standardModus(deck) {
  return { vokabeln: 'f-d', artikel: 'artikel', konjugation: 'konj', zahlen: 'num-f',
           fehler: 'gemischt', heute: 'gemischt', pruefung: 'pruefung' }[deck.typ];
}

function modiVon(deck) {
  const f = deck.sprache === 'en' ? '🇬🇧' : '🇫🇷';
  switch (deck.typ) {
    case 'vokabeln': {
      const modi = [{ id: 'f-d', label: `${f}→🇩🇪` }, { id: 'd-f', label: `🇩🇪→${f}` }];
      // Listen mit fettgedruckten Wörtern: Rechtschreibung üben
      if (deck.woerter.some(w => w.schreiben)) {
        modi.push({ id: 'ordnen', label: '🧩 Ordnen' }, { id: 'schreiben', label: '✍️ Schreiben' });
      }
      return modi;
    }
    case 'artikel':     return [{ id: 'artikel', label: 'un / une / des' }];
    case 'konjugation': return [{ id: 'konj', label: 'Formen' }];
    case 'zahlen':      return [{ id: 'num-f', label: '🔢→🇫🇷' }, { id: 'f-num', label: '🇫🇷→🔢' }];
    default:            return [{ id: 'gemischt', label: 'Gemischt' }];
  }
}

function anzahlWoerter(deck) {
  if (deck.typ === 'heute') return heuteEintraege(deck.sprache).length;
  if (deck.typ === 'pruefung') return pruefungsEintraege(deck).length;
  return deck.typ === 'fehler' ? fehlerEintraege().length : deck.woerter.length;
}

// Stabiler Schlüssel eines Eintrags – für die Fehlerliste
function schluessel(eintrag) {
  return eintrag.num !== undefined ? String(eintrag.num) : eintrag.fr;
}

// ════════════════════════════════════════════════════════════
//  LERNSTAND PRO WORT
//  Jedes Wort hat eine Stufe 0–5. Richtig (wenn fällig) = eine
//  Stufe hoch und längere Pause, falsch = eine Stufe zurück und
//  heute nochmals. Ab Stufe 4 «sitzt» ein Wort.
//  Zahlen haben keinen Lernstand: 1000 Einträge, die einer Regel
//  folgen, sind kein Wortschatz.
// ════════════════════════════════════════════════════════════
const PAUSE_TAGE = [0, 1, 3, 7, 14, 30];   // Pause nach Erreichen der Stufe
const STUFE_SITZT = 4;
const MAX_STUFE = 5;
const NEU_PRO_TAG = 10;                    // neue Wörter pro Tag in «Heute fällig»
const HEUTE_PRO_TAG = 25;                  // Wörter pro Tag und Sprache in «Heute fällig», neue eingeschlossen
const MIT_LERNSTAND = ['vokabeln', 'artikel', 'konjugation'];
// Ab dieser Stufe steigt ein Wort nur noch, wenn es Deutsch→Fremdsprache
// gewusst wurde. Fremdsprache→Deutsch hält es dann auf seiner Stufe.
const STUFE_NUR_ABRUFEN = 2;
// Fettgedruckte Wörter (schreiben: true) brauchen danach mehr:
// Stufe 2→3 Buchstaben ordnen, ab Stufe 3 selbst schreiben.
const RANG = { erkennen: 0, abrufen: 1, ordnen: 2, schreiben: 3 };
function noetigerRang(k, stufe) {
  if (stufe < STUFE_NUR_ABRUFEN) return 0;
  if (!k.schreiben) return RANG.abrufen;
  return stufe === STUFE_NUR_ABRUFEN ? RANG.ordnen : RANG.schreiben;
}
const RANG_HINWEIS = { 1: '🇩🇪→{f}', 2: '🧩 Ordnen', 3: '✍️ Schreiben' };

// Fortlaufende Tagesnummer nach Ortszeit – ein Tag beginnt um Mitternacht
function heuteTag() {
  const d = new Date();
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}

function hatLernstand(deck) {
  return !!deck && MIT_LERNSTAND.includes(deck.typ);
}

function standVon(deckId, k) {
  return (daten.woerter[deckId] || {})[k] || null;
}

// Wörter, die heute in «Heute fällig» schon dran waren (pro Sprache) –
// für das Tageslimit. Schlüssel: Liste + Wort.
function heuteSchluessel(deckId, k) { return deckId + '|' + k; }
function heuteGeuebt(sprache) {
  const t = daten.tagesHeute;
  return new Set(t && t.tag === heuteTag() ? (t[sprache] || []) : []);
}

// Neue Wörter, die «Heute fällig» heute in dieser Sprache schon gebracht hat
function neuHeute(sprache) {
  const t = daten.tagesNeu;
  return t && t.tag === heuteTag() ? (t[sprache] || 0) : 0;
}

// Trägt eine Antwort ein. Gibt { vorher, nachher, neu } zurück,
// oder null für Karten ohne Lernstand.
function lerne(k, richtig) {
  if (!hatLernstand(alleDecks[k.deckId])) return null;
  const heute = heuteTag();
  if (aktuell.deck && aktuell.deck.typ === 'heute') {
    // Fürs Tageslimit merken; ein Wort zählt nur einmal, auch wenn es nochmals kommt
    const sp = aktuell.deck.sprache;
    const t = daten.tagesHeute && daten.tagesHeute.tag === heute ? daten.tagesHeute : { tag: heute };
    const s = heuteSchluessel(k.deckId, k.schluessel);
    t[sp] = t[sp] || [];
    if (!t[sp].includes(s)) t[sp].push(s);
    daten.tagesHeute = t;
  }
  const deckStand = daten.woerter[k.deckId] || (daten.woerter[k.deckId] = {});
  const alt = deckStand[k.schluessel];
  const w = alt || { s: 0, f: heute };
  const vorher = w.s;
  // Karten aus älteren, angefangenen Runden haben noch keine Richtung: wie bisher behandeln
  const rang = k.richtung in RANG ? RANG[k.richtung] : Infinity;
  const noetig = noetigerRang(k, w.s);
  const nurErkannt = rang < noetig;
  let gebremst = 0;

  if (richtig === 'akzent') {
    // Nur Akzente falsch: weder Auf- noch Abstieg, das Wort bleibt fällig
    deckStand[k.schluessel] = w;
    return { vorher, nachher: w.s, neu: !alt, gebremst: 0, akzent: true };
  }

  if (!richtig) {
    w.s = Math.max(0, w.s - 1);
    w.f = heute;          // kommt heute nochmals
    w.t = heute;
  } else if (w.f <= heute) {
    if (nurErkannt) {
      // Nur erkannt: zählt nicht als Fortschritt. Das Wort bleibt fällig
      // und kommt in «Heute fällig» in der Richtung Deutsch→Fremdsprache.
      gebremst = noetig;
    } else if (w.t === heute) {
      // Heute schon einmal falsch: gilt als geübt, steigt aber erst morgen wieder
      w.f = heute + 1;
    } else {
      w.s = Math.min(MAX_STUFE, w.s + 1);
      w.f = heute + PAUSE_TAGE[w.s];
    }
  }
  // Richtig, aber noch nicht fällig: nichts ändert sich. So lässt sich
  // eine Liste nicht an einem Abend «fertig» tippen.

  deckStand[k.schluessel] = w;
  if (!alt && aktuell.deck && aktuell.deck.typ === 'heute') {
    const sp = aktuell.deck.sprache;
    const t = daten.tagesNeu && daten.tagesNeu.tag === heute ? daten.tagesNeu : { tag: heute };
    t[sp] = (t[sp] || 0) + 1;
    daten.tagesNeu = t;
  }
  return { vorher, nachher: w.s, neu: !alt, gebremst };
}

// Zählt für ein Deck: wie viele Wörter sitzen, wie viele sind unterwegs –
// und den Fortschritt in Prozent: jede Stufe bis «sitzt» zählt gleich viel
// (Stufe 1 = 25 %, Stufe 4 und höher = 100 % pro Wort)
function lernstandVon(deck) {
  const stand = daten.woerter[deck.id] || {};
  let sitzen = 0, unterwegs = 0, stufen = 0;
  deck.woerter.forEach(w => {
    const e = stand[schluessel(w)];
    if (!e) return;
    if (e.s >= STUFE_SITZT) sitzen++; else unterwegs++;
    stufen += Math.min(e.s, STUFE_SITZT);
  });
  const gesamt = deck.woerter.length;
  let fortschritt = gesamt ? Math.round(stufen / (gesamt * STUFE_SITZT) * 100) : 0;
  if (stufen > 0) fortschritt = Math.max(1, fortschritt);             // Geübtes zeigt nie 0 %
  if (fortschritt === 100 && sitzen < gesamt) fortschritt = 99;       // 100 % erst, wenn alle sitzen
  return { sitzen, unterwegs, gesamt, fortschritt };
}

// Fällige Wörter einer Sprache bis und mit Tag `bis` → [{ deck, eintrag, stand }]
function faelligeEintraege(bis, sprache) {
  const raus = [];
  Object.keys(daten.woerter).forEach(deckId => {
    const deck = alleDecks[deckId];
    if (!hatLernstand(deck) || deck.sprache !== sprache) return;
    const stand = daten.woerter[deckId];
    deck.woerter.forEach(w => {
      const e = stand[schluessel(w)];
      if (e && e.f <= bis) raus.push({ deck, eintrag: w, stand: e });
    });
  });
  return raus;
}

// Neue Wörter kommen nur aus Listen, die schon einmal geübt wurden –
// zuletzt geübte zuerst, also der aktuelle Schulstoff vor dem alten.
function neueEintraege(max, sprache) {
  if (max <= 0) return [];
  const decks = Object.values(alleDecks)
    .filter(d => hatLernstand(d) && d.sprache === sprache && daten.decks[d.id])
    .sort((a, b) => (daten.decks[b.id].zuletzt || 0) - (daten.decks[a.id].zuletzt || 0));
  const raus = [];
  for (const deck of decks) {
    const stand = daten.woerter[deck.id] || {};
    for (const w of mische(deck.woerter)) {
      if (stand[schluessel(w)]) continue;
      raus.push({ deck, eintrag: w, stand: null });
      if (raus.length >= max) return raus;
    }
  }
  return raus;
}

// Die Runde «Heute fällig»: höchstens HEUTE_PRO_TAG Wörter pro Tag und
// Sprache. Zuerst Fälliges (am längsten Wartendes voran), dann mit neuen
// Wörtern auffüllen. Was heute schon dran war und wieder fällig ist (falsch
// beantwortet), kommt nochmals, ohne nochmals zu zählen. Der Rest wartet.
function heuteEintraege(sprache) {
  const schon = heuteGeuebt(sprache);
  const frei = Math.max(0, HEUTE_PRO_TAG - schon.size);
  const istSchon = e => schon.has(heuteSchluessel(e.deck.id, schluessel(e.eintrag)));
  const faellig = faelligeEintraege(heuteTag(), sprache)
    .sort((a, b) => a.stand.f - b.stand.f || a.stand.s - b.stand.s);
  const nochmals = faellig.filter(istSchon);
  const wiederholen = faellig.filter(e => !istSchon(e)).slice(0, frei);
  const platz = Math.min(frei - wiederholen.length, NEU_PRO_TAG - neuHeute(sprache));
  return nochmals.concat(wiederholen, neueEintraege(platz, sprache));
}

// Ist die Tagesportion geschafft, obwohl noch Wörter fällig wären?
function heuteVoll(sprache) {
  return heuteGeuebt(sprache).size >= HEUTE_PRO_TAG && faelligeEintraege(heuteTag(), sprache).length > 0;
}

// ════════════════════════════════════════════════════════════
//  WOCHENZIEL
//  Pro Sprache drei Übungstage pro Woche (dürfen dieselben Tage sein).
//  Ein Tag zählt für eine Sprache, sobald darin TAG_ZIEL Fragen
//  beantwortet sind. daten.tageJe[sprache][tag] = beantwortete Fragen
// ════════════════════════════════════════════════════════════
const WOCHEN_ZIEL = 3;
const TAG_ZIEL = 10;

// Montag = Tag 0 der Woche
function wochenStart() { return heuteTag() - ((new Date().getDay() + 6) % 7); }

// Die Tage einer Sprache. Umstellung vom gemeinsamen Zähler (daten.tage):
// die Übungstage der laufenden Woche gelten einmalig für beide Sprachen.
function tageJe(sprache) {
  if (!daten.tageJe) {
    daten.tageJe = {};
    const start = wochenStart();
    Object.entries(daten.tage || {}).forEach(([t, n]) => {
      if (Number(t) < start) return;
      SPRACHEN.forEach(sp => { (daten.tageJe[sp] = daten.tageJe[sp] || {})[t] = n; });
    });
  }
  return daten.tageJe[sprache] = daten.tageJe[sprache] || {};
}

// { je: { fr: { tage, heute }, en: … }, erreicht } – erreicht, wenn alle Sprachen am Ziel sind
function wocheStand() {
  const heute = heuteTag(), start = wochenStart();
  const je = {};
  SPRACHEN.forEach(sp => {
    const z = tageJe(sp);
    let tage = 0;
    for (let t = start; t < start + 7; t++) if ((z[t] || 0) >= TAG_ZIEL) tage++;
    je[sp] = { tage, heute: z[heute] || 0 };
  });
  return { je, erreicht: SPRACHEN.every(sp => je[sp].tage >= WOCHEN_ZIEL) };
}

// Zählt eine beantwortete Frage für ihre Sprache. Gibt true zurück, wenn
// der Tag genau damit für diese Sprache zum Übungstag geworden ist.
function zaehleAntwort(sprache) {
  const z = tageJe(SPRACHEN.includes(sprache) ? sprache : aktiveSprache());
  const heute = heuteTag();
  z[heute] = (z[heute] || 0) + 1;
  // Alte Tage wegräumen, damit der gespeicherte Stand klein bleibt
  Object.keys(z).forEach(t => { if (Number(t) < heute - 60) delete z[t]; });
  return z[heute] === TAG_ZIEL;
}
const tageText = n => n === 1 ? '1 Tag' : `${n} Tage`;

function rauten(voll, von) {
  return '◆'.repeat(Math.min(voll, von)) + '◇'.repeat(Math.max(0, von - voll));
}

// Je besser ein Wort sitzt, desto schwieriger die Richtung:
// zuerst erkennen (🇫🇷→🇩🇪), ab Stufe 2 selbst wissen (🇩🇪→🇫🇷)
// Je besser ein Wort sitzt, desto anspruchsvoller die Abfrage.
// Fettgedruckte Wörter: ab Stufe 2 Buchstaben ordnen, ab Stufe 3 schreiben.
function heuteModus(deck, stand, eintrag) {
  if (deck.typ !== 'vokabeln') return standardModus(deck);
  const s = stand ? stand.s : 0;
  if (s < STUFE_NUR_ABRUFEN) return 'f-d';
  if (eintrag && eintrag.schreiben) return s === STUFE_NUR_ABRUFEN ? 'ordnen' : 'schreiben';
  return 'd-f';
}

// ════════════════════════════════════════════════════════════
//  STERNE PRO UNITÉ
//  Fünf Etappen, je ein Stern; alle geschafft = Krone. Gezählt wird
//  jede richtige Antwort, egal wo (Liste, Heute fällig, Fehler) –
//  anders als beim Lernstand ohne Wartezeit. Unités ohne fett
//  gedruckte Wörter haben nur die ersten drei Etappen.
// ════════════════════════════════════════════════════════════
const ERFOLG = { erkennen: 1, abrufen: 2, ordnen: 4, schreiben: 8 };
const ETAPPEN = [
  { id: 'entdeckt',    name: 'Entdeckt',    was: 'jede Wortliste einmal fertig gespielt' },
  { id: 'erkannt',     name: 'Erkannt',     was: 'jedes Wort einmal richtig {f}→🇩🇪', bit: 1 },
  { id: 'gewusst',     name: 'Gewusst',     was: 'jedes Wort einmal richtig 🇩🇪→{f}', bit: 2 },
  { id: 'gelegt',      name: 'Gelegt',      was: 'jedes fette Wort einmal richtig geordnet', bit: 4, fett: true },
  { id: 'geschrieben', name: 'Geschrieben', was: 'jedes fette Wort einmal richtig geschrieben', bit: 8, fett: true },
];

function gruppenId(g) { return g.id || g.titel; }

// Unités mit Wortlisten bekommen Sterne (nicht «Übergreifend», nicht «Wiederholen»)
function hatSterne(g) {
  return !!g.sprache && g.decks.some(d => d.typ === 'vokabeln');
}

// Stand aller Etappen einer Unité → [{ ...etappe, fehlt, verdient }]
function etappenVon(g) {
  const vok = g.decks.filter(d => d.typ === 'vokabeln');
  const alle = vok.flatMap(d => d.woerter.map(w => ({ d, w })));
  const fett = alle.filter(x => x.w.schreiben);
  const bits = x => ((daten.erfolge[x.d.id] || {})[schluessel(x.w)]) || 0;
  const verdient = new Set(daten.sterne[gruppenId(g)] || []);
  return ETAPPEN.filter(e => !e.fett || fett.length).map(e => {
    let fehlt;
    // Nur die Wortlisten zählen – un/une (Artikel) nicht
    if (e.id === 'entdeckt') fehlt = vok.filter(d => !(daten.decks[d.id] && daten.decks[d.id].geuebt)).map(d => d.titel);
    else fehlt = (e.fett ? fett : alle).filter(x => !(bits(x) & e.bit));
    return Object.assign({}, e, { fehlt, verdient: verdient.has(e.id) || fehlt.length === 0 });
  });
}

// Neu geschaffte Etappen speichern; gibt sie zurück [{ g, etappe, krone }]
function aktualisiereSterne() {
  const neu = [];
  QUIZ_DATEN.gruppen.filter(hatSterne).forEach(g => {
    const id = gruppenId(g);
    const vorher = new Set(daten.sterne[id] || []);
    const etappen = etappenVon(g);
    const jetzt = etappen.filter(e => e.verdient).map(e => e.id);
    const dazu = jetzt.filter(e => !vorher.has(e));
    if (!dazu.length) return;
    daten.sterne[id] = [...new Set([...vorher, ...jetzt])];
    const krone = etappen.every(e => e.verdient);
    dazu.forEach(e => neu.push({ g, etappe: ETAPPEN.find(x => x.id === e), krone }));
  });
  return neu;
}

// Richtige Antwort vermerken (nur Wortlisten)
function merkeErfolg(k) {
  const bit = ERFOLG[k.richtung];
  const deck = alleDecks[k.deckId];
  if (!bit || !deck || deck.typ !== 'vokabeln') return;
  const e = daten.erfolge[k.deckId] || (daten.erfolge[k.deckId] = {});
  e[k.schluessel] = (e[k.schluessel] || 0) | bit;
}

function sternKopf(g, gi) {
  if (!hatSterne(g)) return '';
  const et = etappenVon(g);
  const n = et.filter(e => e.verdient).length;
  const titel = et.length === n ? 'Krone – alle Etappen geschafft' : `${n} von ${et.length} Sternen`;
  // Neue Sterne fliegen gleich an ihren Platz (Stern-Zauber) – bis dahin leer
  const wartet = wartendeSterne.filter(x => x.gruppe === gruppenId(g));
  const alsKrone = n === et.length && !wartet.some(x => x.krone);
  return `<span class="sterne ${alsKrone ? 'krone' : ''}" role="button" tabindex="0" data-gruppe="${esc(gruppenId(g))}"
      title="${titel}" aria-label="${titel}" onclick="event.stopPropagation(); zeigeEtappen(${gi})">${alsKrone
        ? '👑'
        : et.map(e => {
            const voll = e.verdient && !wartet.some(x => x.etappe === e.id);
            return `<i data-etappe="${e.id}" class="${voll ? 'voll' : ''}">${voll ? '★' : '☆'}</i>`;
          }).join('')}</span>`;
}

// Auf- und zuklappen ohne das Menü neu zu zeichnen – sonst sprängen
// die von Hand auf- oder zugeklappten Gruppen in den Startzustand zurück
const offeneEtappen = new Set();
function zeigeEtappen(gi) {
  const el = document.getElementById('etappen' + gi);
  if (!el) return;
  el.hidden = !el.hidden;
  if (el.hidden) offeneEtappen.delete(gi); else offeneEtappen.add(gi);
}

function etappenListe(g, gi) {
  if (!hatSterne(g)) return '';
  const f = g.sprache === 'en' ? '🇬🇧' : '🇫🇷';
  const et = etappenVon(g);
  const krone = et.every(e => e.verdient);
  return `
    <div class="etappen" id="etappen${gi}" ${offeneEtappen.has(gi) ? '' : 'hidden'}>
      ${et.map(e => {
        const rest = e.id === 'entdeckt'
          ? `noch ${e.fehlt.length === 1 ? '1 Liste' : e.fehlt.length + ' Listen'}: ${e.fehlt.join(', ')}`
          : `noch ${wortZahl(e.fehlt.length)}`;
        return `<div class="etappe ${e.verdient ? 'ok' : ''}">
          <span class="e-stern">${e.verdient ? '★' : '☆'}</span>
          <span><b>${e.name}</b> – ${e.was.replace('{f}', f)}${e.verdient ? '' : `<em>${rest}</em>`}</span>
        </div>`;
      }).join('')}
      <div class="etappe krone-zeile ${krone ? 'ok' : ''}">
        <span class="e-stern">👑</span>
        <span>${krone ? '<b>Krone verdient!</b>' : 'Alle Sterne = Krone'}</span>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  RÄNGE – pro Sprache eine eigene Reihe, in der Zielsprache
// ════════════════════════════════════════════════════════════
const XP_STUFEN = [0, 50, 150, 300, 500, 750, 1000, 1400, 1800, 2500];
const NIVEAUS = {
  fr: ['Première année','Apprentie','Élève sorcière','Préfète','Enchanteresse',
       'Alchimiste','Métamorphe','Duelliste','Sorcière','Grande Magicienne'],
  en: ['First Year','Apprentice','Spell Student','Prefect','Enchantress',
       'Alchemist','Shapeshifter','Duellist','Sorceress','Archmage'],
};

function niveauVon(sprache) {
  const xp = daten.xp[sprache] || 0;
  let idx = 0;
  for (let i = 0; i < XP_STUFEN.length; i++) {
    if (xp >= XP_STUFEN[i]) idx = i; else break;
  }
  const max = idx === XP_STUFEN.length - 1;
  const lo = XP_STUFEN[idx];
  const hi = max ? lo + 500 : XP_STUFEN[idx + 1];
  return { idx, name: (NIVEAUS[sprache] || NIVEAUS.fr)[idx], xp, lo, hi, max };
}

function zeigeNiveau(sprache) {
  const n = niveauVon(sprache);
  document.getElementById('level-badge').textContent = `🪄 ${n.idx + 1}. Rang · ${n.name}`;
  document.getElementById('xp-bar-fill').style.width =
    Math.min(100, ((n.xp - n.lo) / (n.hi - n.lo)) * 100) + '%';
  document.getElementById('xp-label').textContent =
    n.max ? `⏳ ${n.xp} Punkte` : `⏳ ${n.xp - n.lo} / ${n.hi - n.lo}`;
}

function gibXP(sprache, serie) {
  const bonus = Math.min(20, Math.max(0, serie - 1) * 5);
  const gewonnen = 10 + bonus;
  const vorher = niveauVon(sprache).idx;
  daten.xp[sprache] = (daten.xp[sprache] || 0) + gewonnen;
  speichere();
  const nachher = niveauVon(sprache);
  zeigeNiveau(sprache);
  if (nachher.idx > vorher) zeigeLevelUp(nachher.name);
  return gewonnen;
}

function zeigeXPGewinn(xp, serie, el) {
  const p = document.createElement('div');
  p.className = 'xp-popup';
  p.textContent = serie >= 2 ? `+${xp} Punkte ✨` : `+${xp} Punkte`;
  document.body.appendChild(p);
  const r = el.getBoundingClientRect();
  p.style.left = (r.left + r.width / 2) + 'px';
  p.style.top = r.top + 'px';
  setTimeout(() => p.remove(), 1200);
}

function zeigeLevelUp(name) {
  const el = document.createElement('div');
  el.className = 'level-up-toast';
  el.innerHTML = `✦ Neuer Rang ✦<br>🪄 ${name}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

// ════════════════════════════════════════════════════════════
//  SPRACHE / VORLESEN
// ════════════════════════════════════════════════════════════
let vorlesen = daten.vorlesen !== false;

function setzeVorlesen(an) {
  vorlesen = an;
  daten.vorlesen = an;
  speichere();
}

// Grammatik-Kürzel sind zum Lesen gedacht, nicht zum Hören: «(m pl)» käme
// sonst als «m plus» aus dem Lautsprecher. Auf der Karte bleibt das Kürzel
// stehen, nur die Stimme bekommt die ausgeschriebene Form.
const KUERZEL = [
  [/\(\s*m\s*pl\s*\)/gi, 'masculin pluriel'],
  [/\(\s*f\s*pl\s*\)/gi, 'féminin pluriel'],
  [/\(\s*m\s*\)/gi,      'masculin'],
  [/\(\s*f\s*\)/gi,      'féminin'],
];

function fuerDieStimme(text, lang) {
  let t = text;
  if (lang === 'fr-FR') KUERZEL.forEach(([muster, wort]) => { t = t.replace(muster, wort); });
  t = t.replace(/\s*\/\s*/g, ', ');   // «la géo / la géographie» → kurze Pause
  return t.replace(/\s+/g, ' ').trim();
}

function sprich(text, lang) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(fuerDieStimme(text, lang));
  utt.lang = lang;
  utt.rate = 0.88;
  utt.pitch = 1.05;
  const btn = document.getElementById('speak-btn-active');
  if (btn) {
    btn.classList.add('speaking');
    utt.onend = () => btn.classList.remove('speaking');
    utt.onerror = () => btn.classList.remove('speaking');
  }
  window.speechSynthesis.speak(utt);
}

// iOS gibt Sprachausgabe und Töne erst nach einer Berührung frei
let audioEntsperrt = false;
function entsperreAudio() {
  if (audioEntsperrt) return;
  audioEntsperrt = true;

  // Töne sollen auch dann kommen, wenn der Klingelton-Schalter auf lautlos
  // steht (Safari 16.4+); ohne diese Zeile schweigt Web Audio dort.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}

  // Stummes Schnipsel abspielen – damit gilt der Ton-Kontext als freigegeben
  try {
    const ctx = tonKontext();
    if (ctx) {
      const quelle = ctx.createBufferSource();
      quelle.buffer = ctx.createBuffer(1, 1, 22050);
      quelle.connect(ctx.destination);
      quelle.start(0);
    }
  } catch (e) {}

  try {
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch (e) {}
}

function sprichFrage() {
  const k = aktuell.karten[aktuell.index];
  if (k && k.sprechFrage) sprich(k.sprechFrage.text, k.sprechFrage.lang);
}

// ════════════════════════════════════════════════════════════
//  KARTEN BAUEN
// ════════════════════════════════════════════════════════════
const LIMIT = 20;

function mische(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sprachCode(deck) {
  return deck.sprache === 'en' ? 'en-GB' : 'fr-FR';
}

function zahlenFalsche(num, modus) {
  const kandidaten = new Set();
  for (const d of [1, 2, 3, 5, 10, 20, 50, 100]) {
    if (num - d >= 1) kandidaten.add(num - d);
    if (num + d <= 1000) kandidaten.add(num + d);
  }
  return mische([...kandidaten].filter(n => n !== num))
    .slice(0, 3)
    .map(n => modus === 'num-f' ? franzZahl(n) : String(n));
}

// Erzeugt aus einem Eintrag die anzeigefertige Karte
function baueKarte(deck, eintrag, modus) {
  const lang = sprachCode(deck);
  const basis = { deckId: deck.id, schluessel: schluessel(eintrag), sprache: deck.sprache || 'fr',
                  schreiben: !!eintrag.schreiben };

  if (deck.typ === 'zahlen') {
    const numFr = modus === 'num-f';
    return Object.assign(basis, {
      label: numFr ? '🔢 Zahl' : '🇫🇷 Französisch',
      frage: numFr ? String(eintrag.num) : eintrag.fr,
      korrekt: numFr ? eintrag.fr : String(eintrag.num),
      falsche: zahlenFalsche(eintrag.num, modus),
      // In 🔢→🇫🇷 nicht vorlesen, sonst wäre die Antwort verraten
      sprechFrage: numFr ? null : { text: eintrag.fr, lang },
      sprechAntwort: { text: eintrag.fr, lang },
    });
  }

  if (deck.typ === 'artikel') {
    return Object.assign(basis, {
      label: '✏️ un, une oder des?',
      frage: eintrag.fr,
      korrekt: eintrag.de,
      falsche: eintrag.falsche,
      sprechFrage: { text: eintrag.sprechFrage, lang },
      sprechAntwort: { text: eintrag.sprechAntwort, lang },
    });
  }

  if (deck.typ === 'konjugation') {
    return Object.assign(basis, {
      label: '💜 Konjugieren',
      frage: eintrag.fr,
      korrekt: eintrag.de,
      falsche: mische(eintrag.falsche).slice(0, 3),
      sprechFrage: null,
      sprechAntwort: { text: eintrag.sprechAntwort, lang },
    });
  }

  // vokabeln – Rechtschreibung (nur fettgedruckte Wörter)
  if (modus === 'ordnen' || modus === 'schreiben') {
    const formen = schreibFormen(eintrag.fr);
    const ziel = zufall(formen);   // «eine reicht»: abwechselnd eine der Formen
    return Object.assign(basis, {
      richtung: modus,
      schreiben: true,
      label: modus === 'ordnen' ? '🧩 Buchstaben ordnen' : '✍️ Schreib auf ' + (deck.sprache === 'en' ? 'Englisch' : 'Französisch'),
      frage: eintrag.de,
      korrekt: ziel,
      // Beim Schreiben gilt jede der Formen, beim Ordnen die vorgegebene
      formen: modus === 'schreiben' ? formen : [ziel],
      falsche: [],
      sprechFrage: { text: eintrag.de, lang: 'de-DE' },
      sprechAntwort: { text: ziel, lang },
    });
  }

  // vokabeln
  const nachDe = modus === 'f-d';
  const flagge = deck.sprache === 'en' ? '🇬🇧 Englisch' : '🇫🇷 Französisch';
  const korrekt = nachDe ? eintrag.de : eintrag.fr;
  // Gleichlautende Übersetzungen aussortieren, sonst stünde dieselbe
  // Antwort zweimal da – einmal richtig, einmal falsch
  const andere = mische(deck.woerter.filter(w => w !== eintrag))
    .map(w => nachDe ? w.de : w.fr)
    .filter(t => t !== korrekt);
  return Object.assign(basis, {
    // Erkennen (Fremdsprache→Deutsch) ist leichter als selbst wissen (Deutsch→Fremdsprache)
    richtung: nachDe ? 'erkennen' : 'abrufen',
    label: nachDe ? flagge : '🇩🇪 Deutsch',
    frage: nachDe ? eintrag.fr : eintrag.de,
    korrekt,
    falsche: [...new Set(andere)].slice(0, 3),
    sprechFrage: nachDe ? { text: eintrag.fr, lang } : { text: eintrag.de, lang: 'de-DE' },
    sprechAntwort: nachDe ? { text: eintrag.de, lang: 'de-DE' } : { text: eintrag.fr, lang },
  });
}

// Fehlerliste der gewählten Sprache → [{ deck, eintrag }], unbekannte Einträge fallen weg
function fehlerEintraege() {
  const sp = aktiveSprache();
  const raus = [];
  daten.fehler.forEach(f => {
    const deck = alleDecks[f.d];
    if (!deck || deck.typ === 'fehler' || deck.typ === 'heute' || deck.sprache !== sp) return;
    const eintrag = deck.woerter.find(w => schluessel(w) === f.k);
    if (eintrag) raus.push({ deck, eintrag });
  });
  return raus;
}

function baueSession(deck, modus) {
  if (deck.typ === 'heute') {
    return mische(heuteEintraege(deck.sprache)).map(({ deck: d, eintrag, stand }) =>
      baueKarte(d, eintrag, heuteModus(d, stand, eintrag)));
  }
  if (deck.typ === 'pruefung') {
    // Alle Wörter, ohne LIMIT
    return mische(pruefungsEintraege(deck)).map(({ deck: d, eintrag }) =>
      baueKarte(d, eintrag, eintrag.schreiben ? 'schreiben' : 'd-f'));
  }
  const schreibModus = modus === 'ordnen' || modus === 'schreiben';
  const quelle = deck.typ === 'fehler'
    ? fehlerEintraege()
    : deck.woerter.filter(w => !schreibModus || w.schreiben).map(w => ({ deck, eintrag: w }));
  return mische(quelle)
    .slice(0, LIMIT)
    .map(({ deck: d, eintrag }) =>
      baueKarte(d, eintrag, deck.typ === 'fehler' ? standardModus(d) : modus));
}

// ════════════════════════════════════════════════════════════
//  RECHTSCHREIBUNG
// ════════════════════════════════════════════════════════════

// Schreibbare Formen eines Eintrags: Hinweise wie «(m pl)» fallen weg,
// «la mère / la maman» ergibt zwei Formen, «un / une enfant» ebenfalls.
function schreibFormen(fr) {
  const ohneHinweis = fr.replace(/\s*\((?:m|f)(?:\s*pl)?\)/g, '').trim();
  const teile = ohneHinweis.split(/\s+\/\s+/);
  if (teile.length === 2 && /^(un|une|le|la|les)$/i.test(teile[0])) {
    const nomen = teile[1].replace(/^(un|une|le|la|les)\s+/i, '');
    return [teile[0] + ' ' + nomen, teile[1]];
  }
  return teile;
}

// Für den Vergleich: Gross/klein, Apostroph-Art, Leerzeichen und der
// Schlusspunkt zählen nicht. œ gilt wie oe (das Blatt schreibt «soeur»).
function normal(t) {
  return String(t).normalize('NFC').toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/\s+([?!:;.,])/g, '$1')
    .replace(/[.!?\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function ohneAkzente(t) {
  return normal(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// 'richtig' | 'akzent' (nur Akzente falsch) | 'falsch'
function bewerteSchreibung(eingabe, formen) {
  if (formen.some(f => normal(f) === normal(eingabe))) return 'richtig';
  if (formen.some(f => ohneAkzente(f) === ohneAkzente(eingabe))) return 'akzent';
  return 'falsch';
}

// Die Form, der die Eingabe am nächsten kommt – für die Anzeige der Lösung
function naechsteForm(eingabe, formen) {
  const e = normal(eingabe);
  let beste = formen[0], best = -1;
  formen.forEach(f => { const n = lcs(e, normal(f)).length; if (n > best) { best = n; beste = f; } });
  return beste;
}

// Längste gemeinsame Teilfolge zweier Zeichenketten → Liste von [i, j]
function lcs(a, b) {
  const A = [...a], B = [...b];
  const t = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      t[i][j] = A[i] === B[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const paare = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { paare.push([i, j]); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  return paare;
}

// Lösung Buchstabe für Buchstabe: was in der Eingabe fehlte oder anders war, ist markiert
function loesungMarkiert(eingabe, ziel) {
  const z = [...ziel];
  const zl = z.map(c => c.toLowerCase());
  const el = [...String(eingabe).toLowerCase().replace(/[’‘`´]/g, "'")];
  const treffer = new Set(lcs(el, zl).map(p => p[1]));
  return z.map((c, i) => {
    const h = esc(c);
    return treffer.has(i) || /\s/.test(c) ? h : `<mark>${h}</mark>`;
  }).join('');
}

function esc(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ════════════════════════════════════════════════════════════
//  MENÜ
// ════════════════════════════════════════════════════════════
function wannText(zeit) {
  if (!zeit) return null;
  const tage = Math.floor((Date.now() - zeit) / 86400000);
  if (tage <= 0) return 'heute geübt';
  if (tage === 1) return 'gestern geübt';
  if (tage < 7)  return `vor ${tage} Tagen geübt`;
  if (tage < 30) return `vor ${Math.floor(tage / 7)} Wochen geübt`;
  return 'länger nicht geübt';
}

// Die letzten Resultate einer Liste (in Prozent, ältestes zuerst). Ältere Daten
// kennen nur das letzte Resultat – damit beginnt die Reihe.
const VERLAUF_RUNDEN = 3;
function verlaufVon(stand) {
  if (!stand) return [];
  if (Array.isArray(stand.verlauf)) return stand.verlauf;
  return stand.letzteQuote != null ? [stand.letzteQuote] : [];
}

// «70 › 85 › 100 %», bei nur einer Runde «zuletzt 100 %»
function verlaufText(stand) {
  const v = verlaufVon(stand);
  if (!v.length) return '';
  return v.length === 1 ? `zuletzt ${v[0]} %` : `${v.join(' › ')} %`;
}

function untertitel(deck) {
  const n = anzahlWoerter(deck);
  if (deck.typ === 'fehler') {
    return n === 0 ? 'keine Fehler – super!' : `${wortZahl(n)} aus allen Listen`;
  }
  if (n === 0) return 'noch keine Wörter erfasst';
  const stand = daten.decks[deck.id];
  const wann = stand && wannText(stand.zuletzt);
  if (deck.typ === 'pruefung') {
    if (laufendPasst(deck.id, 'pruefung')) {
      const l = daten.pruefungLauf;
      return `angefangen – weiter mit Frage ${l.index + 1} von ${l.karten.length}`;
    }
    if (stand) return `Rekord ${stand.beste} %` + (wann ? ` · ${wann}` : '');
    const schreib = pruefungsEintraege(deck).filter(x => x.eintrag.schreiben).length;
    return `${n} Wörter` + (schreib ? `, ${schreib} davon schreiben` : '');
  }
  // Hinter dem Stand die letzten Resultate der Liste; ohne solche wie bisher «wann»
  const runden = verlaufText(stand);
  const dazu = runden ? ` · ${runden}` : wann ? ` · ${wann}` : '';
  // Sobald ein Wort begonnen ist, zählt, wie viele sitzen
  const l = hatLernstand(deck) ? lernstandVon(deck) : null;
  if (l && l.sitzen + l.unterwegs > 0) {
    return `${l.sitzen} von ${n} sitzen` + dazu;
  }
  return `${n} Wörter` + (dazu || ' · neu');
}


// Im Menü genügt der kurze Deck-Name, die Gruppenzeile steht ja darüber.
// In der Kopfzeile und auf der Weiter-üben-Karte fehlt der Zusammenhang –
// dort kommt die Unité davor, sonst wäre "un / une" nicht eindeutig.
// Der Ring rechts zeigt bei Wortlisten den Fortschritt in Prozent (jede Stufe
// zählt, siehe lernstandVon). Listen ohne Lernstand (Zahlen, Meine Fehler,
// Prüfung) zeigen wie bisher die Quote der letzten Runde.
function ringVon(deck) {
  const stand = daten.decks[deck.id];
  if (hatLernstand(deck)) {
    const l = lernstandVon(deck);
    const begonnen = l.sitzen + l.unterwegs > 0;
    return { p: l.fortschritt, q: l.fortschritt, text: begonnen ? l.fortschritt + '%' : '·',
             zahl: false, titel: `Fortschritt ${l.fortschritt} %: ${l.sitzen} von ${l.gesamt} sitzen, ${l.unterwegs} unterwegs` };
  }
  const quote = stand ? stand.letzteQuote : 0;
  return { p: quote, q: quote, text: stand ? quote + '%' : '·', zahl: false, titel: stand ? 'Letzte Runde' : '' };
}

function wortZahl(n) { return n === 1 ? '1 Wort' : `${n} Wörter`; }

// Karte «Heute fällig» zuoberst im Menü
// Hat sie in dieser Sprache schon etwas geübt?
function begonnenIn(sp) {
  return Object.values(alleDecks).some(d =>
    hatLernstand(d) && d.sprache === sp && (daten.decks[d.id] || daten.woerter[d.id]));
}

function zeigeHeute() {
  const sp = aktiveSprache();
  const H = HEUTE[sp];
  const btn = document.getElementById('heute-btn');
  const begonnen = begonnenIn(sp);
  // Ganz am Anfang gibt es in dieser Sprache noch nichts zu wiederholen
  if (!H || !begonnen) { btn.style.display = 'none'; return; }
  btn.style.display = '';

  const karte = (emoji, titel, unter, aktiv) => {
    btn.className = 'heute' + (aktiv ? '' : ' erledigt');
    btn.disabled = !aktiv;
    btn.onclick = aktiv ? () => oeffneDeck(H.id) : null;
    btn.innerHTML = `
      <span class="emoji">${emoji}</span>
      <span class="t"><b>${titel}</b><span>${unter}</span></span>
      ${aktiv ? '<span class="go">→</span>' : ''}`;
  };

  if (laufendPasst(H.id, standardModus(H))) {
    const l = daten.laufend;
    karte('🔮', 'Heute fällig', `Runde fortsetzen — Frage ${l.index + 1} von ${l.karten.length}`, true);
    return;
  }

  const runde = heuteEintraege(sp);
  const faellig = runde.filter(e => e.stand).length;
  const neu = runde.length - faellig;
  if (faellig + neu > 0) {
    const teile = [];
    if (faellig) teile.push(`${wortZahl(faellig)} zum Wiederholen`);
    if (neu) teile.push(faellig ? `${neu} neue` : (neu === 1 ? '1 neues Wort' : `${neu} neue Wörter`));
    karte('🔮', 'Heute fällig', teile.join(' · '), true);
    return;
  }

  // Bewusst ohne «morgen»: drei Übungstage pro Woche genügen
  if (heuteVoll(sp)) karte('🌙', 'Tagesportion geschafft', `${HEUTE_PRO_TAG} Wörter geübt – bis zum nächsten Mal`, false);
  else karte('🌙', 'Für heute alles geübt', 'bis zum nächsten Mal', false);
}

// Umschalter Französisch / Englisch
function zeigeSprachwahl() {
  const el = document.getElementById('sprachwahl');
  if (SPRACHEN.length < 2) { el.innerHTML = ''; return; }
  const sp = aktiveSprache();
  el.innerHTML = SPRACHEN.map(x =>
    `<button class="${x === sp ? 'aktiv' : ''}" onclick="setzeSprache('${x}')"
             aria-label="${SPRACH_NAME[x] || x}" title="${SPRACH_NAME[x] || x}"
             aria-pressed="${x === sp}">${SPRACH_FLAGGE[x] || x.toUpperCase()}</button>`).join('');
}

// Wochenziel: pro Sprache drei Rauten, eine pro Übungstag; darunter, was noch fehlt
function zeigeWoche() {
  const w = wocheStand();
  const fehlt = SPRACHEN.filter(sp => w.je[sp].tage < WOCHEN_ZIEL);
  const txt = w.erreicht ? '<b>Wochenziel erreicht ✨</b>'
    : fehlt.length === 1 ? `<b>${SPRACH_NAME[fehlt[0]]}</b> noch ${tageText(WOCHEN_ZIEL - w.je[fehlt[0]].tage)}`
    : 'noch ' + fehlt.map((sp, i) => {
        const n = WOCHEN_ZIEL - w.je[sp].tage;
        return `<b>${SPRACH_FLAGGE[sp]} ${i === fehlt.length - 1 ? tageText(n) : n}</b>`;
      }).join(', ');
  // Heute in der gewählten Sprache: «heute ✓» oder «heute noch 4 Fragen»
  const sp = aktiveSprache();
  const h = (w.je[sp] || { heute: 0 }).heute;
  const rest = TAG_ZIEL - h;
  const heute = rest <= 0 ? `heute ${SPRACH_FLAGGE[sp]} ✓`
    : h > 0 ? `heute ${SPRACH_FLAGGE[sp]} noch ${rest === 1 ? '1 Frage' : rest + ' Fragen'}` : '';
  document.getElementById('woche').innerHTML = `
    <span class="w-sprachen">${SPRACHEN.map(x => `<span class="w-sp ${w.je[x].tage >= WOCHEN_ZIEL ? 'fertig' : ''}"
        aria-label="${SPRACH_NAME[x]}: ${w.je[x].tage} von ${WOCHEN_ZIEL} Tagen">${SPRACH_FLAGGE[x]}<span class="w-rauten">${rauten(w.je[x].tage, WOCHEN_ZIEL)}</span></span>`).join('')}</span>
    <span class="w-txt">${txt}</span>
    ${heute ? `<span class="w-heute">${heute}</span>` : ''}`;
}

function vollerTitel(deck) {
  if (!deck.gruppe || !deck.gruppe.sprache) return deck.titel;
  const einheit = deck.gruppe.titel.split(' · ').pop();
  return `${einheit} · ${deck.titel}`;
}
// ════════════════════════════════════════════════════════════
//  AUFBAU DES MENÜS (Felder klasse und bereich: siehe vokabeln.js)
//  Jetzt üben – Heute fällig, Weiter üben, Meine Fehler
//  Aktuelle Klasse – neueste Unité zuoberst und offen, frühere zu
//  Grundlagen – Konjugation, Zahlen usw.
//  Frühere Schuljahre – je eine Zeile, öffnet eine eigene Seite
// ════════════════════════════════════════════════════════════
let menuJahr = null;        // gezeigtes früheres Schuljahr, null = Startseite
const klappStatus = {};     // in dieser Sitzung auf-/zugeklappt: Gruppen-id → offen

function istUnite(g) { return !!g.sprache && !g.bereich; }

// Die höchste Klasse einer Sprache ist die aktuelle
function aktuelleKlasse(sp) {
  const k = QUIZ_DATEN.gruppen.filter(g => istUnite(g) && g.sprache === sp).map(g => g.klasse || 0);
  return k.length ? Math.max(...k) : 0;
}
// Ohne Angabe gehört eine Unité zur aktuellen Klasse
function klasseVon(g) { return g.klasse || aktuelleKlasse(g.sprache); }

function istOffen(g, standard) {
  const id = gruppenId(g);
  return id in klappStatus ? klappStatus[id] : standard;
}

function gruppeHtml(g, offen) {
  const gi = QUIZ_DATEN.gruppen.indexOf(g);
  return `
    <div class="group ${offen ? '' : 'closed'}" id="g${gi}">
      <button class="group-head" onclick="klappe(${gi})">
        <span class="dot" style="background:${g.farbe}"></span>
        <span class="title">${SPRACHEN.length > 1 && g.sprache ? g.titel.split(' · ').slice(1).join(' · ') || g.titel : g.titel}</span>
        ${sternKopf(g, gi)}
        <span class="chev">▼</span>
      </button>
      ${etappenListe(g, gi)}
      <div class="deck-list">
        ${[...g.decks, ...(PRUEFUNG[gruppenId(g)] ? [PRUEFUNG[gruppenId(g)]] : [])].map(d => {
          const leer = anzahlWoerter(d) === 0;
          const r = ringVon(d);
          return `
          <button class="deck ${leer ? 'leer' : ''} ${d.typ === 'pruefung' ? 'pruefung' : ''}"
                  style="--dc:${g.farbe}; --dcl:${g.hell}; --p:${r.p}; --q:${r.q}"
                  ${leer ? 'disabled' : `onclick="oeffneDeck('${d.id}')"`}>
            <span class="icon">${d.icon}</span>
            <span class="txt"><b>${d.titel}</b><span>${untertitel(d)}</span></span>
            <span class="ring ${r.zahl ? 'zahl' : ''}" title="${r.titel}"><i>${r.text}</i></span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
}

// Eine Zeile pro früherem Schuljahr: Anzahl Listen und Sterne zusammengezählt
function jahrZeile(k, gs) {
  const listen = gs.reduce((n, g) => n + g.decks.length, 0);
  const et = gs.filter(hatSterne).flatMap(g => etappenVon(g));
  const n = et.filter(e => e.verdient).length;
  const sterne = !et.length ? ''
    : n === et.length ? '👑'
    : et.length <= 5 ? '★'.repeat(n) + '☆'.repeat(et.length - n)
    : `★ ${n} von ${et.length}`;
  return `
    <button class="resume jahr" onclick="zeigeJahr(${k})">
      <span class="emoji">📚</span>
      <span class="t"><b>${k}. Klasse</b><span>${listen === 1 ? '1 Liste' : listen + ' Listen'}</span></span>
      ${sterne ? `<span class="jahr-sterne" aria-label="${n} von ${et.length} Sternen">${sterne}</span>` : ''}
      <span class="go">→</span>
    </button>`;
}

// Seite eines früheren Schuljahrs zeigen (k) oder zurück zur Startseite (null)
function zeigeJahr(k) {
  menuJahr = k;
  zeigeMenu();
  window.scrollTo(0, 0);
}

// «Meine Fehler» bei «Jetzt üben» – sobald in dieser Sprache geübt wurde
function zeigeJetztDecks(sp) {
  const begonnen = begonnenIn(sp);
  document.getElementById('jetzt-decks').innerHTML = QUIZ_DATEN.gruppen
    .filter(g => g.bereich === 'jetzt').flatMap(g => g.decks)
    .map(d => {
      const n = anzahlWoerter(d);
      if (!n && !begonnen) return '';
      return `
      <button class="resume jetzt-deck" ${n ? `onclick="oeffneDeck('${d.id}')"` : 'disabled'}>
        <span class="emoji">${d.icon}</span>
        <span class="t"><b>${d.titel}</b><span>${untertitel(d)}</span></span>
        ${n ? '<span class="go">→</span>' : ''}
      </button>`;
    }).join('');
}

function zeigeMenu() {
  if (window.Konto) Konto.renderLeiste();
  const sp = aktiveSprache();
  zeigeWoche();
  zeigeSprachwahl();

  const unites = QUIZ_DATEN.gruppen.filter(g => istUnite(g) && g.sprache === sp);
  const aktuell = aktuelleKlasse(sp);
  const frueher = [...new Set(unites.map(klasseVon).filter(k => k < aktuell))].sort((a, b) => b - a);
  if (menuJahr !== null && !frueher.includes(menuJahr)) menuJahr = null;   // z.B. nach Sprachwechsel
  document.getElementById('menu').classList.toggle('jahr', menuJahr !== null);

  let html;
  if (menuJahr !== null) {
    // Seite eines früheren Schuljahrs: neueste Unité oben. Nur eine Gruppe →
    // gleich offen, und ihr Titel genügt als Überschrift
    const gs = unites.filter(g => klasseVon(g) === menuJahr).reverse();
    html = `
      <button class="zurueck" onclick="zeigeJahr(null)">← Alle Listen</button>
      ${gs.length > 1 ? `<div class="abschnitt">${menuJahr}. Klasse</div>` : ''}
      ${gs.map(g => gruppeHtml(g, istOffen(g, gs.length === 1))).join('')}`;
  } else {
    const jetzt = unites.filter(g => klasseVon(g) === aktuell).reverse();
    const grund = QUIZ_DATEN.gruppen.filter(g => g.bereich === 'grundlagen' && g.sprache === sp);
    html = (jetzt.length ? `<div class="abschnitt">${aktuell ? aktuell + '. Klasse' : 'Listen'}</div>` : '')
      + jetzt.map((g, i) => gruppeHtml(g, istOffen(g, i === 0))).join('')
      + (grund.length ? '<div class="abschnitt">Grundlagen</div>' : '')
      + grund.map(g => gruppeHtml(g, istOffen(g, false))).join('')
      + (frueher.length ? '<div class="abschnitt">Frühere Schuljahre</div>' : '')
      + frueher.map(k => jahrZeile(k, unites.filter(g => klasseVon(g) === k))).join('');
  }
  document.getElementById('gruppen').innerHTML = html;
  zeigeJetztDecks(sp);

  zeigeHeute();

  // „Weiter üben" – pro Sprache die zuletzt geübte Liste
  const btn = document.getElementById('resume-btn');
  const alt = daten.letztes && alleDecks[daten.letztes.deckId];
  const merk = daten.letzteJe[sp]
    || (alt && (!alt.sprache || alt.sprache === sp) ? daten.letztes : null);
  const letztes = merk && alleDecks[merk.deckId];
  if (letztes && anzahlWoerter(letztes) > 0) {
    const stand = daten.decks[letztes.id];
    const wann = stand && wannText(stand.zuletzt);
    const offen = laufendPasst(letztes.id, merk.modus);
    const unter = offen
      ? `${vollerTitel(letztes)} — Frage ${daten.laufend.index + 1} von ${daten.laufend.karten.length}`
      : `${vollerTitel(letztes)}${wann ? ' — ' + wann : ''}`;
    btn.innerHTML = `
      <span class="emoji">${offen ? '📜' : '⏱️'}</span>
      <span class="t"><b>${offen ? 'Runde fortsetzen' : 'Weiter üben'}</b><span>${unter}</span></span>
      <span class="go">→</span>`;
    btn.style.display = '';
    btn.onclick = () => oeffneDeck(letztes.id, merk.modus);
  } else {
    btn.style.display = 'none';
  }
  const etwasDa = ['heute-btn', 'resume-btn'].some(id => document.getElementById(id).style.display !== 'none')
    || document.getElementById('jetzt-decks').children.length > 0;
  document.getElementById('jetzt-titel').style.display = etwasDa ? '' : 'none';

  // Fusszeile: was es in dieser Sprache alles gibt
  const decksSp = Object.values(alleDecks).filter(d => d.sprache === sp && d.typ !== 'heute');
  const gesamt = decksSp.reduce((n, d) => n + (d.typ === 'vokabeln' ? d.woerter.length : 0), 0);
  const dazu = [['konjugation', 'Konjugation'], ['zahlen', 'Zahlen'], ['artikel', 'un/une']]
    .filter(([typ]) => decksSp.some(d => d.typ === typ)).map(x => x[1]);
  const liste = dazu.length > 1 ? `${dazu.slice(0, -1).join(', ')} und ${dazu[dazu.length - 1]}` : dazu.join('');
  document.getElementById('hinweis').textContent = `${gesamt} Wörter` + (liste ? ` · dazu ${liste}` : '');

  // Mindestens eine Krone in dieser Sprache (die nicht erst noch kommt): das Profil-Icon trägt sie
  const gekroent = QUIZ_DATEN.gruppen.some(g => g.sprache === sp && hatSterne(g)
    && etappenVon(g).every(e => e.verdient)
    && !wartendeSterne.some(x => x.gruppe === gruppenId(g) && x.krone));
  document.getElementById('konto-icon').classList.toggle('gekroent', gekroent);
  document.getElementById('version').textContent = versionText();
  starteSternFluege();
}

function klappe(gi) {
  const el = document.getElementById('g' + gi);
  el.classList.toggle('closed');
  // Bleibt so, bis die App neu startet – z.B. nach einer Runde zurück im Menü
  klappStatus[gruppenId(QUIZ_DATEN.gruppen[gi])] = !el.classList.contains('closed');
}

function zumMenu() {
  stoppeTimer();
  stoppeCanvas();
  window.speechSynthesis && window.speechSynthesis.cancel();
  document.body.classList.remove('quiz', 'konto');
  document.getElementById('kopf').textContent = '✦ Sprachen Üben ✦';
  zeigeMenu();
  window.scrollTo(0, 0);
}

// ════════════════════════════════════════════════════════════
//  QUIZ
// ════════════════════════════════════════════════════════════
const aktuell = { deck: null, modus: null, index: 0, score: 0, beantwortet: false, karten: [], aufstiege: 0, tagNeu: false, neueSterne: [],
                  antworten: [] };   // nur in der Prüfung: { e: Ergebnis, a: Antwort } pro Frage
let serie = 0;

function oeffneDeck(id, modus) {
  entsperreAudio();
  const deck = alleDecks[id];
  if (!deck) return;
  aktuell.deck = deck;
  aktuell.modus = modus || standardModus(deck);

  // «Heute fällig» und die Prüfung haben ihre eigene Karte im Menü und gehören nicht unter «Weiter üben»
  if (deck.typ !== 'heute' && deck.typ !== 'pruefung') {
    daten.letztes = { deckId: id, modus: aktuell.modus };
    daten.letzteJe[deck.sprache || aktiveSprache()] = daten.letztes;
    speichere();
  }

  document.body.classList.add('quiz');
  document.getElementById('kopf').textContent = vollerTitel(deck);
  document.documentElement.style.setProperty('--c', deck.farbe);
  document.documentElement.style.setProperty('--cl', deck.hell);
  document.getElementById('autoread-toggle').checked = vorlesen;

  // Die Prüfung hat nur eine Art – und ein versehentlicher Tipp soll sie nicht neu starten
  document.getElementById('modi').innerHTML = deck.typ === 'pruefung'
    ? '<span class="modus-fest">📝 Prüfung</span>'
    : modiVon(deck).map(m =>
    `<button class="mode-btn ${m.id === aktuell.modus ? 'active' : ''}"
             onclick="setzeModus('${m.id}')">${m.label}</button>`).join('');

  // Angefangene Runde fortsetzen statt neu beginnen
  if (laufendPasst(id, aktuell.modus)) {
    const l = daten[laufPlatz(deck)];
    stoppeTimer();
    stoppeCanvas();
    serie = 0;
    aktuell.index = l.index;
    aktuell.score = l.score;
    aktuell.aufstiege = l.aufstiege || 0;
    aktuell.neueSterne = l.neueSterne || [];
    aktuell.tagNeu = l.tagNeu === true ? aktiveSprache() : (l.tagNeu || false);
    aktuell.antworten = l.antworten || [];
    aktuell.beantwortet = false;
    aktuell.karten = l.karten;
    zeichneFrage();
  } else {
    starteRunde();
  }
  window.scrollTo(0, 0);
}

// Wo die angefangene Runde liegt: die Prüfung hat ihren eigenen Platz
function laufPlatz(deck) {
  return deck && deck.typ === 'pruefung' ? 'pruefungLauf' : 'laufend';
}

// Passt die gespeicherte Runde zu diesem Deck – und ist sie noch frisch?
function laufendPasst(deckId, modus) {
  const l = daten[laufPlatz(alleDecks[deckId])];
  return !!l
    && l.deckId === deckId
    && l.modus === modus
    // «Meine Fehler» gibt es pro Sprache: eine Runde der anderen Sprache passt nicht
    && (!l.sprache || l.sprache === aktiveSprache())
    && Array.isArray(l.karten)
    && l.index < l.karten.length
    && (Date.now() - l.zeit) < 24 * 3600 * 1000;
}

// Stand der laufenden Runde sichern (überlebt auch einen App-Neustart)
function merkeLaufend(index) {
  daten[laufPlatz(aktuell.deck)] = {
    deckId: aktuell.deck.id,
    modus: aktuell.modus,
    index,
    score: aktuell.score,
    aufstiege: aktuell.aufstiege,
    neueSterne: aktuell.neueSterne,
    tagNeu: aktuell.tagNeu,
    antworten: aktuell.antworten,
    sprache: aktuell.deck.sprache || aktiveSprache(),
    karten: aktuell.karten,
    zeit: Date.now(),
  };
  speichere();
}

function setzeModus(modus) {
  window.speechSynthesis && window.speechSynthesis.cancel();
  aktuell.modus = modus;
  if (aktuell.deck.typ !== 'heute') {
    daten.letztes = { deckId: aktuell.deck.id, modus };
    daten.letzteJe[aktuell.deck.sprache || aktiveSprache()] = daten.letztes;
    speichere();
  }
  document.querySelectorAll('#modi .mode-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('onclick').includes(`'${modus}'`)));
  starteRunde();
}

function starteRunde() {
  stoppeTimer();
  stoppeCanvas();
  serie = 0;
  aktuell.index = 0;
  aktuell.score = 0;
  aktuell.aufstiege = 0;
  aktuell.neueSterne = [];
  aktuell.tagNeu = false;
  aktuell.antworten = [];
  aktuell.beantwortet = false;
  aktuell.karten = baueSession(aktuell.deck, aktuell.modus);
  daten[laufPlatz(aktuell.deck)] = null;   // eine neue Runde ersetzt die angefangene
  if (istPruefung()) { zeigePruefungStart(); return; }
  zeichneFrage();
}

// Vor der Prüfung: was kommt, und dass die Auflösung erst am Schluss kommt
function zeigePruefungStart() {
  const n = aktuell.karten.length;
  const schreib = aktuell.karten.filter(k => k.richtung === 'schreiben').length;
  const f = aktuell.deck.sprache === 'en' ? '🇬🇧' : '🇫🇷';
  const stand = daten.decks[aktuell.deck.id];
  document.getElementById('quiz-area').innerHTML = `
    <div class="result-screen pruefung-start">
      <div class="p-icon">📝</div>
      <h2>${vollerTitel(aktuell.deck)}</h2>
      <ul class="p-regeln">
        <li><span>📚</span>${n} Wörter aus allen Listen der ${aktuell.deck.gruppe.titel.split(' · ').pop()}</li>
        ${schreib ? `<li><span>✍️</span>${schreib} davon schreibst du selbst</li>` : ''}
        <li><span>👆</span>bei ${schreib ? `den übrigen ${n - schreib}` : 'allen'} wählst du 🇩🇪→${f}</li>
        <li><span>🤫</span>Ob es richtig war, siehst du erst am Schluss</li>
      </ul>
      ${stand && stand.beste != null ? `<p class="aufstieg">🏆 Dein Rekord: ${stand.beste} %</p>` : ''}
      <div class="result-btns">
        <button class="restart-btn" id="pruefung-los" onclick="zeichneFrage()">Los geht's</button>
      </div>
    </div>`;
}

function zeichneFrage() {
  const area = document.getElementById('quiz-area');

  if (aktuell.index >= aktuell.karten.length) { zeigeErgebnis(); return; }

  const k = aktuell.karten[aktuell.index];
  zeigeNiveau(k.sprache);
  merkeLaufend(aktuell.index);

  const optionen = mische([k.korrekt, ...k.falsche]);
  const fortschritt = (aktuell.index / aktuell.karten.length) * 100;

  area.innerHTML = `
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" style="width:${fortschritt}%"></div>
    </div>
    <div class="progress-info">
      <span>Frage ${aktuell.index + 1} von ${aktuell.karten.length}</span>
      <span id="score-info">${istPruefung() ? '🤫 Auflösung am Schluss' : `✅ ${aktuell.score} richtig`}</span>
    </div>
    <div class="card">
      <div class="card-label">${k.label}</div>
      <div class="card-word-wrap">
        <div class="card-word">${k.frage}</div>
        ${k.sprechFrage ? '<button class="speak-btn" id="speak-btn-active" onclick="sprichFrage()" title="Vorlesen">🔊</button>' : ''}
      </div>
      <div class="answers" id="answers"></div>
      <div class="feedback" id="feedback"></div>
      <div class="stufe" id="stufe"></div>
      <div class="next-btn-wrap">
        <button class="next-btn hidden" id="next-btn" onclick="naechsteFrage()">
          <div class="countdown-fill"></div><span>Weiter →</span>
        </button>
      </div>
    </div>`;

  if (k.richtung === 'ordnen') { zeichneOrdnen(k); return; }
  if (k.richtung === 'schreiben') { zeichneSchreiben(k); return; }

  const box = document.getElementById('answers');
  const frag = document.createDocumentFragment();
  optionen.forEach(opt => {
    const b = document.createElement('button');
    b.className = 'ans-btn';
    b.textContent = opt;
    b.addEventListener('click', () => istPruefung() ? waehleInPruefung(b, opt, k) : pruefe(b, opt, k));
    frag.appendChild(b);
  });
  // Kurz gesperrt, damit ein Doppeltipp nicht gleich die nächste Antwort trifft
  box.style.pointerEvents = 'none';
  box.appendChild(frag);
  setTimeout(() => { box.style.pointerEvents = ''; }, 350);

  if (vorlesen && k.sprechFrage) setTimeout(sprichFrage, 300);
}

// ── Fehlerliste pflegen ──
function merkeFehler(k) {
  if (daten.fehler.some(f => f.d === k.deckId && f.k === k.schluessel)) return;
  daten.fehler.push({ d: k.deckId, k: k.schluessel });
  if (daten.fehler.length > MAX_FEHLER) daten.fehler.shift();
}

function loescheFehler(k) {
  daten.fehler = daten.fehler.filter(f => !(f.d === k.deckId && f.k === k.schluessel));
}

// Rückmeldungen in der Sprache des Decks – im Englisch-Quiz kein «Magnifique»
const lobText = {
  fr: [
    '✦ Magnifique !', '✦ Parfait !', '✦ Bravo !', '✦ Formidable !',
    '✦ Excellent !', '✦ Superbe !', '✦ Der Zauber sitzt!', '✦ Meisterlich!',
    '✦ Das sass!', '✦ Zauberhaft!',
  ],
  en: [
    '✦ Brilliant!', '✦ Splendid!', '✦ Well done!', '✦ Excellent!',
    '✦ Spot on!', '✦ Marvellous!', '✦ Der Zauber sitzt!', '✦ Meisterlich!',
    '✦ Das sass!', '✦ Zauberhaft!',
  ],
};

const trostText = {
  fr: [
    'Zut ! Der Zauber ging daneben – schau die Antwort an.',
    'Presque ! Merke dir die richtige Antwort.',
    'Noch nicht – aber der Bann bricht bald.',
    'Schau genau hin, dann sitzt der Spruch.',
    'Nächster Versuch, nächster Zauber.',
  ],
  en: [
    'Oops! Der Zauber ging daneben – schau die Antwort an.',
    'Almost! Merke dir die richtige Antwort.',
    'Noch nicht – aber der Bann bricht bald.',
    'Schau genau hin, dann sitzt der Spruch.',
    'Nächster Versuch, nächster Zauber.',
  ],
};
function zufall(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

let weiterTimer = null;
let sprechTimer = null;
function stoppeTimer() {
  if (weiterTimer) { clearTimeout(weiterTimer); weiterTimer = null; }
  if (sprechTimer) { clearTimeout(sprechTimer); sprechTimer = null; }
}

function pruefe(btn, gewaehlt, k) {
  if (aktuell.beantwortet) return;
  aktuell.beantwortet = true;
  stoppeTimer();

  document.querySelectorAll('#answers .ans-btn').forEach(b => {
    b.disabled = true;
    if (b.textContent === k.korrekt) b.classList.add('correct');
  });

  const richtig = gewaehlt === k.korrekt;
  btn.classList.add(richtig ? 'correct' : 'wrong');
  bewerte(k, richtig ? 'richtig' : 'falsch', btn);
}

// Gemeinsamer Teil für alle Fragearten.
// ergebnis: 'richtig' | 'falsch' | 'akzent' (nur bei Schreiben)
function bewerte(k, ergebnis, anker) {
  const feedback = document.getElementById('feedback');
  const richtig = ergebnis === 'richtig';

  if (richtig) {
    aktuell.score++;
    serie++;
    const xp = gibXP(k.sprache, serie);
    zeigeXPGewinn(xp, serie, anker);
    document.getElementById('score-info').textContent =
      `✅ ${aktuell.score} richtig` + (serie >= 2 ? `  🔥 ${serie}` : '');
    feedback.textContent = zufall(lobText[k.sprache] || lobText.fr);
    feedback.className = 'feedback correct';
    tonRichtig();
    // Im Fehler-Deck gilt das Wort damit als aufgeholt
    if (aktuell.deck.typ === 'fehler') loescheFehler(k);
  } else if (ergebnis === 'akzent') {
    // Fast richtig: zählt nicht, landet aber auch nicht in «Meine Fehler»
    serie = 0;
    feedback.textContent = 'Fast! Nur die Akzente stimmen nicht.';
    feedback.className = 'feedback fast';
    tonFalsch();
  } else {
    serie = 0;
    feedback.textContent = zufall(trostText[k.sprache] || trostText.fr);
    feedback.className = 'feedback wrong';
    tonFalsch();
    merkeFehler(k);
  }
  // Fürs Wochenziel: jede beantwortete Frage zählt, egal ob richtig
  if (zaehleAntwort(k.sprache)) aktuell.tagNeu = k.sprache || aktiveSprache();

  // Für die Sterne: was war mit diesem Wort schon einmal richtig?
  if (richtig) {
    merkeErfolg(k);
    aktuell.neueSterne.push(...aktualisiereSterne().map(x => ({ gruppe: gruppenId(x.g), etappe: x.etappe.id, krone: x.krone })));
  }

  // Lernstand des Wortes nachführen und zeigen
  const lern = lerne(k, ergebnis === 'akzent' ? 'akzent' : richtig);
  if (lern) {
    const hoch = lern.nachher > lern.vorher;
    if (hoch) aktuell.aufstiege++;
    const el = document.getElementById('stufe');
    const neuSitzt = hoch && lern.nachher === STUFE_SITZT;
    el.className = 'stufe' + (neuSitzt ? ' sitzt' : '');
    el.innerHTML = neuSitzt
      ? '✨ Dieses Wort sitzt jetzt!'
      : `Stufe <span class="rauten">${'◆'.repeat(lern.nachher)}${'◇'.repeat(MAX_STUFE - lern.nachher)}</span>`
        + (hoch ? ' ⬆' : lern.nachher < lern.vorher ? ' ⬇' : '')
        + (lern.gebremst ? ` · ⬆ nur mit ${RANG_HINWEIS[lern.gebremst].replace('{f}', k.sprache === 'en' ? '🇬🇧' : '🇫🇷')}` : '');
  }

  // Beantwortete Frage gilt als erledigt – beim Fortsetzen geht es
  // mit der nächsten weiter, nicht nochmals mit dieser
  merkeLaufend(aktuell.index + 1);

  // Nur fremdsprachige Antworten vorlesen – deutsche Wörter kann sie selbst
  if (vorlesen && k.sprechAntwort && k.sprechAntwort.lang !== 'de-DE') {
    sprechTimer = setTimeout(() => sprich(k.sprechAntwort.text, k.sprechAntwort.lang), 600);
  }

  // Beim Schreiben bleibt mehr Zeit, um die markierten Buchstaben anzuschauen
  const dauer = richtig ? 2500 : (k.richtung === 'ordnen' || k.richtung === 'schreiben') ? 9000 : 6000;
  const next = document.getElementById('next-btn');
  next.classList.remove('hidden');
  next.style.setProperty('--countdown-dur', (dauer / 1000) + 's');
  void next.offsetWidth;
  next.classList.add('counting');
  weiterTimer = setTimeout(naechsteFrage, dauer);
}

// ── Buchstaben ordnen ──
// Lücken für jeden Buchstaben; Leerzeichen, Apostroph, Bindestrich und
// Satzzeichen stehen schon da. Eine Lücke ist ausgewählt (goldener Rand):
// Ein Stein landet dort, danach springt die Auswahl zur nächsten freien
// Lücke. Antippen einer leeren Lücke wählt sie aus, Antippen einer
// gefüllten legt den Buchstaben zurück und wählt die Lücke aus.
// Lange Einträge werden Wort für Wort gelegt: Es liegen nur die Steine
// des Wortes bereit, in dem die ausgewählte Lücke liegt.
const ORDNEN_WORTWEISE_AB = 10;   // Buchstaben

function zeichneOrdnen(k) {
  // Klein geschrieben: Gross/klein zählt nicht, und «I» und «l» sähen sonst gleich aus
  const ziel = [...k.korrekt.toLowerCase()];
  const istBuchstabe = c => /\p{L}/u.test(c);

  // Wörter zusammenhalten, damit am Zeilenende nicht mitten im Wort umbrochen wird
  const woerter = [];
  let wort = [];
  ziel.forEach((c, i) => {
    if (c === ' ') { if (wort.length) woerter.push(wort); wort = []; }
    else wort.push(i);
  });
  if (wort.length) woerter.push(wort);

  const plaetze = ziel.map((c, i) => istBuchstabe(c) ? i : -1).filter(i => i >= 0);
  const wortVon = new Map();
  woerter.forEach((w, wi) => w.forEach(i => wortVon.set(i, wi)));
  const wortweise = woerter.length > 1 && plaetze.length > ORDNEN_WORTWEISE_AB;

  // Steine: pro Wort gemischt (wortweise) oder alle zusammen
  const mischeBis = (buchst) => {
    let m = buchst;
    for (let n = 0; n < 5; n++) {
      m = mische(buchst);
      if (m.join('') !== buchst.join('') || new Set(buchst).size < 2) break;
    }
    return m;
  };
  let steine = [];   // { c, w }
  if (wortweise) {
    woerter.forEach((w, wi) => {
      const buchst = w.filter(i => istBuchstabe(ziel[i])).map(i => ziel[i]);
      mischeBis(buchst).forEach(c => steine.push({ c, w: wi }));
    });
  } else {
    steine = mischeBis(plaetze.map(i => ziel[i])).map(c => ({ c, w: -1 }));
  }
  const belegt = new Array(ziel.length).fill(null);   // Platz → Stein-Index

  document.getElementById('answers').outerHTML = `
    <div class="ordnen">
      <div class="luecken" id="luecken">${woerter.map((w, wi) => `<span class="l-wort" data-w="${wi}">${w.map(i => istBuchstabe(ziel[i])
        ? `<button class="luecke" data-i="${i}" aria-label="Lücke"></button>`
        : `<span class="fest">${esc(ziel[i])}</span>`).join('')}</span>`).join('')}</div>
      <div class="steine" id="steine">${steine.map((st, j) =>
        `<button class="stein" data-j="${j}" data-w="${st.w}">${esc(st.c)}</button>`).join('')}</div>
      <button class="zurueck-btn" id="zurueck-btn" title="Letzten Buchstaben zurück">⌫</button>
    </div>`;

  const luecken = [...document.querySelectorAll('#luecken .luecke')];
  const steinBtns = [...document.querySelectorAll('#steine .stein')];
  const wortSpans = [...document.querySelectorAll('#luecken .l-wort')];
  const verlauf = [];
  const ersteFreie = () => luecken.find(l => belegt[+l.dataset.i] === null);
  const lueckeVon = i => luecken.find(x => +x.dataset.i === i);
  let auswahl = null;   // Platz-Index der ausgewählten Lücke

  // Nächste freie Lücke nach Platz i: zuerst im selben Wort, dann danach, dann von vorne
  const naechsteFreie = i => {
    const frei = luecken.filter(l => belegt[+l.dataset.i] === null).map(l => +l.dataset.i);
    if (!frei.length) return null;
    const w = wortVon.get(i);
    return frei.find(x => x > i && wortVon.get(x) === w)
      ?? frei.find(x => x > i)
      ?? frei[0];
  };

  // Auswahl zeigen; wortweise: nur die Steine dieses Wortes und das Wort hervorheben
  const zeigeAuswahl = () => {
    if (auswahl === null || belegt[auswahl] !== null) {
      const f = ersteFreie();
      auswahl = f ? +f.dataset.i : null;
    }
    luecken.forEach(l => l.classList.toggle('cursor', +l.dataset.i === auswahl));
    if (!wortweise) return;
    const w = auswahl === null ? -2 : wortVon.get(auswahl);
    steinBtns.forEach(b => b.classList.toggle('weg', +b.dataset.w !== w));
    wortSpans.forEach(s => s.classList.toggle('aktiv', +s.dataset.w === w));
  };

  const setze = j => {
    if (aktuell.beantwortet || auswahl === null) return;
    const i = auswahl;
    const l = lueckeVon(i);
    belegt[i] = j;
    l.textContent = steine[j].c;
    l.classList.add('voll');
    steinBtns[j].disabled = true;
    verlauf.push(i);
    auswahl = naechsteFreie(i);
    zeigeAuswahl();
    if (!ersteFreie()) setTimeout(pruefeOrdnen, 250);
  };
  const leere = i => {
    if (aktuell.beantwortet || belegt[i] === null) return;
    steinBtns[belegt[i]].disabled = false;
    belegt[i] = null;
    const l = lueckeVon(i);
    l.textContent = '';
    l.classList.remove('voll');
    verlauf.splice(verlauf.lastIndexOf(i), 1);
  };
  // Antippen einer Lücke: gefüllt → Buchstabe zurück; in jedem Fall auswählen
  const tippeLuecke = i => {
    if (aktuell.beantwortet) return;
    leere(i);
    auswahl = i;
    zeigeAuswahl();
  };
  const pruefeOrdnen = () => {
    if (aktuell.beantwortet || ersteFreie()) return;
    aktuell.beantwortet = true;
    stoppeTimer();
    const gelegt = ziel.map((c, i) => belegt[i] === null ? c : steine[belegt[i]].c).join('');
    const richtig = gelegt === ziel.join('');
    // Nur die Buchstaben markieren, die wirklich falsch liegen: Ein fehlender
    // oder verschobener Buchstabe soll nicht alle folgenden rot färben
    const soll = plaetze.map(i => ziel[i]);
    const ist = plaetze.map(i => steine[belegt[i]].c);
    const passt = new Set(lcs(ist, soll).map(p => p[0]));
    plaetze.forEach((i, n) => {
      const l = luecken.find(x => +x.dataset.i === i);
      l.disabled = true;
      l.classList.add(passt.has(n) ? 'gut' : 'schlecht');
    });
    wortSpans.forEach(s => s.classList.remove('aktiv'));
    luecken.forEach(l => l.classList.remove('cursor'));
    steinBtns.forEach(b => { b.disabled = true; });
    document.getElementById('zurueck-btn').disabled = true;
    if (!richtig) zeigeLoesung(gelegt, k.korrekt);
    bewerte(k, richtig ? 'richtig' : 'falsch', document.getElementById('luecken'));
  };

  steinBtns.forEach(b => b.addEventListener('click', () => setze(+b.dataset.j)));
  luecken.forEach(l => l.addEventListener('click', () => tippeLuecke(+l.dataset.i)));
  document.getElementById('zurueck-btn').addEventListener('click', () => {
    if (verlauf.length) tippeLuecke(verlauf[verlauf.length - 1]);
  });
  zeigeAuswahl();
  if (vorlesen && k.sprechFrage) setTimeout(sprichFrage, 300);
}

// ── Selbst schreiben ──
const AKZENTE = { fr: ['é', 'è', 'ê', 'à', 'â', 'ç', 'ô', 'î', 'û', 'ù', 'ë', 'ï', 'œ', "'"], en: ["'"] };

function zeichneSchreiben(k) {
  const tasten = AKZENTE[k.sprache] || AKZENTE.fr;
  document.getElementById('answers').outerHTML = `
    <form class="schreiben" id="schreiben" autocomplete="off" onsubmit="return false">
      <input id="eingabe" type="text" inputmode="text" enterkeyhint="done"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             aria-label="Antwort schreiben" placeholder="hier schreiben …">
      <div class="akzente">${tasten.map(t =>
        `<button type="button" class="akzent" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <button type="submit" class="pruefen-btn" id="pruefen-btn">${istPruefung() ? 'Weiter' : 'Prüfen'}</button>
      ${istPruefung() ? '<button type="button" class="weiss-nicht" id="weiss-nicht">Weiss ich nicht</button>' : ''}
      <div class="loesung" id="loesung"></div>
    </form>`;

  const feld = document.getElementById('eingabe');
  document.querySelectorAll('#schreiben .akzent').forEach(b => {
    // pointerdown + preventDefault: das Feld behält den Fokus, die Tastatur bleibt offen
    b.addEventListener('pointerdown', e => e.preventDefault());
    b.addEventListener('click', () => {
      if (aktuell.beantwortet) return;
      const a = feld.selectionStart ?? feld.value.length, z = feld.selectionEnd ?? a;
      feld.value = feld.value.slice(0, a) + b.dataset.t + feld.value.slice(z);
      feld.setSelectionRange(a + b.dataset.t.length, a + b.dataset.t.length);
      feld.focus();
    });
  });

  document.getElementById('schreiben').addEventListener('submit', () => {
    if (aktuell.beantwortet) return;
    const eingabe = feld.value;
    if (!eingabe.trim()) { feld.focus(); return; }
    aktuell.beantwortet = true;
    stoppeTimer();
    const ergebnis = bewerteSchreibung(eingabe, k.formen || [k.korrekt]);
    // Prüfung: nichts zeigen, gleich weiter (die Tastatur bleibt offen)
    if (istPruefung()) { bewertePruefung(k, ergebnis, eingabe); return; }
    feld.readOnly = true;
    feld.classList.add(ergebnis === 'richtig' ? 'gut' : ergebnis === 'akzent' ? 'fast' : 'schlecht');
    feld.blur();   // Tastatur zu, damit die Rückmeldung sichtbar ist
    document.querySelectorAll('#schreiben .akzent, #pruefen-btn').forEach(b => { b.disabled = true; });
    if (ergebnis !== 'richtig') zeigeLoesung(eingabe, naechsteForm(eingabe, k.formen || [k.korrekt]));
    bewerte(k, ergebnis, feld);
  });

  if (istPruefung()) {
    document.getElementById('weiss-nicht').addEventListener('click', () => {
      if (aktuell.beantwortet) return;
      aktuell.beantwortet = true;
      bewertePruefung(k, 'falsch', '');
    });
    // Gleich fokussieren, solange der Tipp auf «Weiter» noch gilt –
    // so bleibt die Tastatur von Wort zu Wort offen
    feld.focus({ preventScroll: true });
  }

  // Fokus nur, wenn die Frage durch Antippen kam – sonst öffnet iOS die Tastatur ohnehin nicht
  setTimeout(() => feld.focus({ preventScroll: true }), 50);
  if (vorlesen && k.sprechFrage) setTimeout(sprichFrage, 300);
}

function zeigeLoesung(eingabe, ziel) {
  let el = document.getElementById('loesung');
  if (!el) {
    el = document.createElement('div');
    el.className = 'loesung';
    el.id = 'loesung';
    document.querySelector('.ordnen').appendChild(el);
  }
  el.innerHTML = `<span>Richtig geschrieben</span><b>${loesungMarkiert(eingabe, ziel)}</b>`;
}

function naechsteFrage() {
  stoppeTimer();
  aktuell.index++;
  aktuell.beantwortet = false;
  zeichneFrage();
}

// ════════════════════════════════════════════════════════════
//  PRÜFUNG
//  Jede Antwort zählt wie beim Üben (Lernstand, Sterne, «Meine Fehler»,
//  Wochenziel) – nur sieht sie erst am Schluss, was richtig war.
// ════════════════════════════════════════════════════════════
function waehleInPruefung(btn, gewaehlt, k) {
  if (aktuell.beantwortet) return;
  aktuell.beantwortet = true;
  document.querySelectorAll('#answers .ans-btn').forEach(b => { b.disabled = true; });
  btn.classList.add('gewaehlt');   // nur «gewählt», nicht richtig oder falsch
  bewertePruefung(k, gewaehlt === k.korrekt ? 'richtig' : 'falsch', gewaehlt);
}

// ergebnis: 'richtig' | 'falsch' | 'akzent'
function bewertePruefung(k, ergebnis, antwort) {
  stoppeTimer();
  const richtig = ergebnis === 'richtig';
  aktuell.antworten[aktuell.index] = { e: ergebnis, a: antwort };
  if (richtig) aktuell.score++;
  // Wie beim Üben: nur ganz Falsches kommt in «Meine Fehler»
  if (ergebnis === 'falsch') merkeFehler(k);
  if (zaehleAntwort(k.sprache)) aktuell.tagNeu = k.sprache || aktiveSprache();
  if (richtig) {
    merkeErfolg(k);
    aktuell.neueSterne.push(...aktualisiereSterne().map(x => ({ gruppe: gruppenId(x.g), etappe: x.etappe.id, krone: x.krone })));
  }
  const lern = lerne(k, ergebnis === 'akzent' ? 'akzent' : richtig);
  if (lern && lern.nachher > lern.vorher) aktuell.aufstiege++;
  merkeLaufend(aktuell.index + 1);

  // Geschriebenes gleich weiter, damit die Tastatur offen bleibt;
  // bei der Auswahl kurz zeigen, was gewählt ist
  if (k.richtung === 'schreiben') naechsteFrage();
  else weiterTimer = setTimeout(naechsteFrage, 250);
}

function zeigeErgebnis() {
  if (istPruefung()) { zeigePruefungErgebnis(); return; }
  const gesamt = aktuell.karten.length;
  const pct = gesamt ? Math.round((aktuell.score / gesamt) * 100) : 0;

  // Fortschritt des Decks merken
  const stand = daten.decks[aktuell.deck.id] || { geuebt: 0 };
  stand.geuebt++;
  stand.verlauf = [...verlaufVon(stand), pct].slice(-VERLAUF_RUNDEN);
  stand.letzteQuote = pct;
  stand.zuletzt = Date.now();
  daten.decks[aktuell.deck.id] = stand;
  daten.laufend = null;   // Runde ist zu Ende
  // «Entdeckt» zählt fertig gespielte Listen – also erst jetzt prüfen
  aktuell.neueSterne.push(...aktualisiereSterne().map(x => ({ gruppe: gruppenId(x.g), etappe: x.etappe.id, krone: x.krone })));
  speichere();

  const { sternZeilen, kronen } = sternMeldungen();
  const auf = aktuell.aufstiege;
  const istHeute = aktuell.deck.typ === 'heute';
  const rest = istHeute ? anzahlWoerter(aktuell.deck) : 0;
  const tagZeile = tagZeileText();
  const { anim, text, sterne } = ergebnisFeier(pct);

  document.getElementById('quiz-area').innerHTML = `
    <div class="result-screen">
      ${anim}
      <div class="stars">${sterne}</div>
      <h2>${text}</h2>
      <div class="result-score">${aktuell.score} / ${gesamt}</div>
      ${auf ? `<p class="aufstieg">⬆ ${auf === 1 ? '1 Wort ist' : `${auf} Wörter sind`} eine Stufe aufgestiegen</p>` : ''}
      ${tagZeile ? `<p class="aufstieg">${tagZeile}</p>` : ''}
      ${sternZeilen.map(z => `<p class="aufstieg stern-zeile">${z}</p>`).join('')}
      ${kronen.map(n => `<p class="aufstieg krone-zeile">👑 Krone für ${n}!</p>`).join('')}
      ${istHeute ? `<p class="aufstieg">${rest ? `🔮 Noch ${wortZahl(rest)} für heute` : '🌙 Für heute ist alles geübt'}</p>` : ''}
      <p>${pct}% richtig beantwortet</p>
      <div class="result-btns">
        ${istHeute && !rest ? '' : `<button class="restart-btn" onclick="starteRunde()">🔄 ${istHeute ? 'Weiter üben' : 'Nochmal üben'}</button>`}
        <button class="menu-btn" onclick="zumMenu()">← Zur Übersicht</button>
      </div>
    </div>`;
  starteSternZauber();
}

// Neue Sterne dieser Runde, pro Unité zusammengefasst
function sternMeldungen() {
  const sternZeilen = [];
  const kronen = [];
  [...new Set(aktuell.neueSterne.map(x => x.gruppe))].forEach(gid => {
    const g = QUIZ_DATEN.gruppen.find(x => gruppenId(x) === gid);
    if (!g) return;
    const name = g.titel.split(' · ').slice(1).join(' · ') || g.titel;
    const eigene = aktuell.neueSterne.filter(x => x.gruppe === gid);
    const namen = eigene.map(x => (ETAPPEN.find(e => e.id === x.etappe) || {}).name).filter(Boolean);
    sternZeilen.push(`⭐ ${namen.length === 1 ? 'Neuer Stern' : namen.length + ' neue Sterne'} in ${name}: ${namen.join(', ')}`);
    if (eigene.some(x => x.krone)) kronen.push(name);
  });
  return { sternZeilen, kronen };
}

// Hat diese Runde den Tag (für ihre Sprache) zum Übungstag gemacht?
function tagZeileText() {
  const sp = aktuell.tagNeu;
  if (!sp) return '';
  const w = wocheStand();
  const tage = (w.je[sp] || { tage: 0 }).tage;
  const f = SPRACH_FLAGGE[sp] || '';
  if (tage === WOCHEN_ZIEL && w.erreicht) return `🏆 Wochenziel erreicht: ${SPRACHEN.length === 2 ? 'beide Sprachen' : 'alle Sprachen'} je ${WOCHEN_ZIEL} Tage!`;
  if (tage === WOCHEN_ZIEL) {
    const fehlt = SPRACHEN.filter(x => w.je[x].tage < WOCHEN_ZIEL)
      .map(x => `${SPRACH_FLAGGE[x]} noch ${tageText(WOCHEN_ZIEL - w.je[x].tage)}`);
    return `${f} ${WOCHEN_ZIEL} von ${WOCHEN_ZIEL} Tagen geschafft – jetzt ${fehlt.join(', ')}`;
  }
  if (tage < WOCHEN_ZIEL) return `${f} ${rauten(tage, WOCHEN_ZIEL)} Übungstag ${tage} von ${WOCHEN_ZIEL} diese Woche`;
  return `${f} ✦ ${tage}. Übungstag diese Woche`;
}

// Animation, Ton und Spruch je nach Resultat
function ergebnisFeier(pct) {
  let anim = '', text = '', sterne = '';
  if (pct === 100)     { text = 'Meisterhaft gezaubert!'; sterne = '✦ ✦ ✦'; konfetti(); tonFanfare(); }
  else if (pct >= 70)  { text = 'Stark gezaubert!'; sterne = '✦ ✦'; anim = baueZauberstab(); stoppeCanvas(); tonSonne(); }
  else if (pct >= 40)  { text = 'Die Kerze brennt noch – weiter!'; sterne = '✦'; anim = baueKerze(); stoppeCanvas(); tonRegenbogen(); }
  else                 { text = 'Der Zauber will noch geübt sein.'; anim = baueNebel(); stoppeCanvas(); tonRegen(); }
  return { anim, text, sterne };
}

// Ende der Prüfung: Resultat in Prozent und alle Fehler mit Lösung
function zeigePruefungErgebnis() {
  const deck = aktuell.deck;
  const karten = aktuell.karten;
  const n = karten.length;
  const ant = karten.map((k, i) => aktuell.antworten[i] || { e: 'falsch', a: '' });
  const richtig = ant.filter(a => a.e === 'richtig').length;
  const akzent = ant.filter(a => a.e === 'akzent').length;
  // Nur Akzente falsch zählt halb
  const pct = n ? Math.round((richtig + akzent / 2) / n * 100) : 0;

  const stand = daten.decks[deck.id] || { geuebt: 0 };
  const rekordVorher = stand.beste;
  stand.geuebt++;
  stand.letzteQuote = pct;
  stand.beste = Math.max(pct, rekordVorher || 0);
  stand.zuletzt = Date.now();
  daten.decks[deck.id] = stand;
  daten.pruefungLauf = null;   // Prüfung ist zu Ende

  // Punkte erst jetzt, damit während der Prüfung nichts verrät, was richtig war
  if (richtig) {
    const vorher = niveauVon(deck.sprache).idx;
    daten.xp[deck.sprache] = (daten.xp[deck.sprache] || 0) + richtig * 10;
    const nachher = niveauVon(deck.sprache);
    zeigeNiveau(deck.sprache);
    if (nachher.idx > vorher) zeigeLevelUp(nachher.name);
  }
  speichere();

  const { sternZeilen, kronen } = sternMeldungen();
  const tagZeile = tagZeileText();
  const auf = aktuell.aufstiege;
  const { anim, text, sterne } = ergebnisFeier(pct);
  const rekord = rekordVorher != null && pct > rekordVorher;

  const fehler = karten.map((k, i) => ({ k, a: ant[i] })).filter(x => x.a.e !== 'richtig');
  const zeile = ({ k, a }) => {
    const formen = k.formen || [k.korrekt];
    const loesung = k.richtung === 'schreiben' && a.a
      ? loesungMarkiert(a.a, naechsteForm(a.a, formen))
      : esc(k.korrekt);
    return `
      <li class="pf pf-${a.e}">
        <span class="pf-de">${esc(k.frage)}</span>
        <span class="pf-du">${a.a ? `<s>${esc(a.a)}</s>` : '<i>keine Antwort</i>'}${a.e === 'akzent' ? ' <em>nur Akzente</em>' : ''}</span>
        <span class="pf-ok">${loesung}</span>
      </li>`;
  };

  document.getElementById('quiz-area').innerHTML = `
    <div class="result-screen pruefung-ergebnis">
      ${anim}
      <div class="stars">${sterne}</div>
      <h2>${text}</h2>
      <div class="result-score">${pct} %</div>
      <p class="p-zahlen">${richtig} von ${n} richtig${akzent ? ` · ${akzent} × nur Akzente falsch (zählt halb)` : ''}</p>
      ${rekord ? `<p class="aufstieg">🏆 Neuer Rekord! Bisher ${rekordVorher} %</p>` : ''}
      ${auf ? `<p class="aufstieg">⬆ ${auf === 1 ? '1 Wort ist' : `${auf} Wörter sind`} eine Stufe aufgestiegen</p>` : ''}
      ${tagZeile ? `<p class="aufstieg">${tagZeile}</p>` : ''}
      ${sternZeilen.map(z => `<p class="aufstieg stern-zeile">${z}</p>`).join('')}
      ${kronen.map(name => `<p class="aufstieg krone-zeile">👑 Krone für ${name}!</p>`).join('')}
      ${fehler.length ? `
      <div class="p-fehler">
        <h3>Das schauen wir noch an (${fehler.length})</h3>
        <ul>${fehler.map(zeile).join('')}</ul>
        ${fehler.some(x => x.a.e === 'falsch') ? '<p class="p-hinweis">Die falschen Wörter sind jetzt auch in «Meine Fehler».</p>' : ''}
      </div>` : ''}
      <div class="result-btns">
        <button class="restart-btn" onclick="starteRunde()">🔄 Neue Prüfung</button>
        <button class="menu-btn" onclick="zumMenu()">← Zur Übersicht</button>
      </div>
    </div>`;
  starteSternZauber();
}

// ════════════════════════════════════════════════════════════
//  STERN-ZAUBER
//  Neuer Stern: am Ende der Runde ein eigener Zauber pro Etappe, dazu eine
//  Melodie, die mit jedem Stern der Unité länger wird. Zurück in der
//  Übersicht fliegt der Stern an seinen Platz. Bei der Krone verschmelzen
//  die Sterne zur Krone, und eine kleine Krone setzt sich aufs Profil-Icon.
// ════════════════════════════════════════════════════════════

// Sterne, die in der Übersicht noch an ihren Platz fliegen: { gruppe, etappe } oder { gruppe, krone: true }
const wartendeSterne = [];
let zauberLaeuft = false;   // solange Zauber angezeigt werden (oder gleich kommen), wartet der Flug
function wenigBewegung() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Ecken eines fünfzackigen Sterns, oben beginnend (aussen, innen, aussen, …)
function sternEcken(cx, cy, aussen, innen) {
  return Array.from({ length: 10 }, (_, i) => {
    const w = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? innen : aussen;
    return [cx + Math.cos(w) * r, cy + Math.sin(w) * r];
  });
}
const punkteText = ecken => ecken.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
const STERN_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${punkteText(sternEcken(50, 52, 47, 19))}"
  fill="url(#zGold)" stroke="#8c6b14" stroke-width="2" stroke-linejoin="round"/></svg>`;

// Jeder Stern spielt einen Ton mehr – der letzte Stern einer Unité die ganze Melodie.
// Gibt die Anzahl Töne zurück.
const STERN_MELODIE = [659, 784, 880, 1047, 1319];
function tonSternMelodie(nr, von) {
  const n = Math.max(1, Math.min(5, Math.ceil(nr / von * 5)));
  STERN_MELODIE.slice(0, n).forEach((f, i) => {
    const letzte = i === n - 1;
    ton(f, 'triangle', letzte ? 0.8 : 0.3, 0.22, i * 0.17);
    ton(f * 2, 'sine', letzte ? 0.6 : 0.2, 0.06, i * 0.17);
  });
  // Glitzern zum Schluss
  [2637, 3136, 2349, 2794].forEach((f, i) => ton(f, 'sine', 0.12, 0.04, (n - 1) * 0.17 + 0.3 + i * 0.06));
  return n;
}
function tonLanden() { ton(1568, 'sine', 0.3, 0.16); ton(2349, 'sine', 0.35, 0.07, 0.05); }

// Die Bühne pro Etappe. zeit = wann der Stern erscheint (ms); tippen = erst auf Antippen
const ZAUBER = {
  entdeckt: {
    zeit: 1950,
    html: () => `
      <div class="z-karte"><svg viewBox="0 0 240 170" aria-hidden="true">
        <path class="pfad" d="M16 152 C 48 156 38 118 72 120 S 104 142 112 96"/>
        <path class="bild" d="M156 64 L170 40 L184 64 M176 64 L192 34 L208 64"/>
        <path class="bild" d="M20 38 q7 -6 14 0 t14 0 t14 0 M30 54 q7 -6 14 0 t14 0"/>
        <path class="bild" d="M196 128 v28 M182 142 h28 M196 126 l-4 8 h8 z"/>
        <path class="bild" d="M44 92 a7 7 0 1 1 0.1 0 M44 99 v8 M60 84 a6 6 0 1 1 0.1 0 M60 90 v7"/>
        <path class="kreuz" d="M111 76 L129 94 M129 76 L111 94"/>
      </svg></div>
      <div class="z-stern">${STERN_SVG}</div>
      <div class="z-lupe"><svg viewBox="0 0 90 90" aria-hidden="true">
        <circle cx="38" cy="38" r="27" fill="rgba(255,250,230,0.22)" stroke="#5a3a1a" stroke-width="6"/>
        <circle cx="38" cy="38" r="27" fill="none" stroke="#c9a227" stroke-width="2.5"/>
        <line x1="58" y1="58" x2="84" y2="84" stroke="#5a3a1a" stroke-width="9" stroke-linecap="round"/>
        <path d="M23 30 a16 16 0 0 1 12 -11" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>
      </svg></div>`,
  },
  erkannt: {
    zeit: 1950,
    html: () => `
      <div class="z-kugel"><div class="z-nebel"></div><div class="z-nebel zwei"></div></div>
      <div class="z-sockel"></div>
      <div class="z-stern">${STERN_SVG}</div>`,
  },
  gewusst: {
    tippen: true,
    html: () => `
      <div class="z-eule" aria-hidden="true"><span class="fluegel">🦉</span><span class="mini">✉️</span></div>
      <div class="z-brief">
        <div class="z-umschlag"></div>
        <div class="z-stern">${STERN_SVG}</div>
        <div class="z-klappe"></div>
        <button class="z-siegel" aria-label="Siegel öffnen"><span class="l"></span><span class="r"></span></button>
      </div>
      <div class="z-tipp">Tippe aufs Siegel</div>`,
  },
  gelegt: {
    zeit: 2450,
    html: s => {
      const wort = s.g.sprache === 'en' ? 'incredible' : 'magnifique';
      const ecken = sternEcken(130, 134, 112, 48);
      let umfang = 0;
      ecken.forEach((p, i) => { const q = ecken[(i + 1) % 10]; umfang += Math.hypot(q[0] - p[0], q[1] - p[1]); });
      const zufall = n => Math.round((Math.random() * 2 - 1) * n);
      return `
        <svg class="z-form" viewBox="0 0 260 260" aria-hidden="true"><polygon points="${punkteText(ecken)}" style="--l:${umfang.toFixed(0)}"/></svg>
        ${[...wort].map((c, i) => `<span class="z-stein" style="left:${ecken[i][0].toFixed(0)}px; top:${ecken[i][1].toFixed(0)}px;
            --x1:${zufall(150)}px; --y1:${zufall(150)}px; --r1:${zufall(360)}deg;
            --x2:${zufall(110)}px; --y2:${zufall(110)}px; --r2:${zufall(270)}deg;
            animation-delay:${(i * 0.05).toFixed(2)}s">${c}</span>`).join('')}`;
    },
  },
  geschrieben: {
    html: () => {
      // In einem Zug, wie man einen Stern von Hand zeichnet
      const e = sternEcken(130, 138, 108, 44).filter((_, i) => i % 2 === 0);
      const d = [0, 2, 4, 1, 3].map((k, i) => `${i ? 'L' : 'M'}${e[k][0].toFixed(1)} ${e[k][1].toFixed(1)}`).join(' ') + ' Z';
      return `
        <svg class="z-schrift" viewBox="0 0 260 260" aria-hidden="true"><path class="z-tinte" d="${d}"/></svg>
        <span class="z-feder" aria-hidden="true">🪶</span>`;
    },
    lauf(el, enthuelle) {
      const pfad = el.querySelector('.z-tinte');
      const feder = el.querySelector('.z-feder');
      const buehne = el.querySelector('.z-buehne');
      const laenge = pfad.getTotalLength();
      pfad.style.strokeDasharray = laenge;
      pfad.style.strokeDashoffset = laenge;
      const dauer = 1900, start = performance.now() + 350;
      feder.style.opacity = 1;
      const schritt = jetzt => {
        if (!el.isConnected) return;
        const t = Math.min(1, Math.max(0, (jetzt - start) / dauer));
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        pfad.style.strokeDashoffset = laenge * (1 - e);
        const p = pfad.getPointAtLength(laenge * e);
        const k = buehne.clientWidth / 260;
        // Die Federspitze sitzt unten links im Zeichen
        feder.style.transform = `translate(${(p.x * k - 4).toFixed(1)}px, ${(p.y * k - 42).toFixed(1)}px)`;
        if (t < 1) { requestAnimationFrame(schritt); return; }
        feder.style.transition = 'transform 0.7s ease-in, opacity 0.7s ease-in';
        feder.style.transform += ' translate(120px, -150px) rotate(25deg)';
        feder.style.opacity = 0;
        enthuelle();
      };
      requestAnimationFrame(schritt);
    },
  },
  krone: {
    rubbeln: true,
    html: () => `
      <div class="z-strahlen"></div>
      <div class="z-krone" aria-hidden="true">👑</div>
      <canvas class="z-folie" role="img" aria-label="Goldfolie – mit dem Finger freirubbeln"></canvas>
      <div class="z-tipp">Rubble mit dem Finger frei</div>
      <button class="z-aufdecken">Einfach aufdecken</button>`,
  },
};

// Rubbellos: Goldfolie auf einem Canvas; was der Finger berührt, wird durchsichtig.
// Ist gut die Hälfte frei, verschwindet der Rest und die Krone erscheint.
const RUBBEL_GROESSE = 210, RUBBEL_FREI = 0.5;
function starteRubbeln(el, enthuelle) {
  const c = el.querySelector('.z-folie');
  const g = RUBBEL_GROESSE;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  c.width = c.height = Math.round(g * dpr);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.scale(dpr, dpr);
  // Goldfolie mit feinem Schraffur-Muster und Glitzerpunkten
  const verlauf = ctx.createLinearGradient(0, 0, g, g);
  [[0, '#a8831a'], [0.3, '#f3dc9b'], [0.5, '#c9a227'], [0.75, '#f0d98a'], [1, '#94720f']].forEach(([o, f]) => verlauf.addColorStop(o, f));
  ctx.fillStyle = verlauf;
  ctx.fillRect(0, 0, g, g);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  for (let x = -g; x < g; x += 9) { ctx.beginPath(); ctx.moveTo(x, g); ctx.lineTo(x + g, 0); ctx.stroke(); }
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = `rgba(255,255,235,${(0.3 + Math.random() * 0.6).toFixed(2)})`;
    ctx.fillRect(Math.random() * g, Math.random() * g, 1.6, 1.6);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(92,62,8,0.5)';
  ctx.font = "700 96px 'Cinzel', Georgia, serif";
  ctx.fillText('?', g / 2, g / 2 - 8);
  ctx.font = "700 15px 'Cinzel', Georgia, serif";
  ctx.fillText('✦ RUBBELN ✦', g / 2, g - 28);

  // Ab jetzt radiert jeder Strich die Folie weg
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = 44;
  ctx.strokeStyle = ctx.fillStyle = '#000';   // deckend, sonst radiert ein Strich nur teilweise
  let aktiv = false, letzter = null, zuege = 0, fertig = false;
  const punkt = e => {
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * g / r.width, y: (e.clientY - r.top) * g / r.height };
  };
  const anteilFrei = () => {
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let frei = 0, n = 0;
    for (let i = 3; i < d.length; i += 4 * 29) { n++; if (d[i] < 40) frei++; }
    return frei / n;
  };
  const aufdecken = () => {
    if (fertig) return;
    fertig = true;
    c.classList.add('weg');
    enthuelle();
  };
  const rubble = p => {
    ctx.beginPath();
    if (letzter) { ctx.moveTo(letzter.x, letzter.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    else { ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.fill(); }
    letzter = p;
    if (++zuege % 3 === 0) tonRubbeln();
    if (zuege % 8 === 0 && anteilFrei() >= RUBBEL_FREI) aufdecken();
  };
  c.addEventListener('pointerdown', e => {
    if (fertig) return;
    e.preventDefault();
    aktiv = true; letzter = null;
    try { c.setPointerCapture(e.pointerId); } catch (_) {}
    rubble(punkt(e));
  });
  c.addEventListener('pointermove', e => { if (aktiv && !fertig) rubble(punkt(e)); });
  const loslassen = () => {
    aktiv = false; letzter = null;
    if (!fertig && zuege && anteilFrei() >= RUBBEL_FREI) aufdecken();
  };
  c.addEventListener('pointerup', loslassen);
  c.addEventListener('pointercancel', loslassen);
  el.querySelector('.z-aufdecken').addEventListener('click', aufdecken);
}
function tonRubbeln() { ton(1600 + Math.random() * 1600, 'triangle', 0.035, 0.03); }

// ── Seltene Überraschung ──
// Bei etwa jedem fünften Stern zufällig, spätestens nach fünf Sternen ohne
let ueberraschungChance = 0.2;
const UEBERRASCHUNGEN = ['drache', 'regenbogen', 'sternschnuppen'];
function waehleUeberraschung() { return UEBERRASCHUNGEN[Math.floor(Math.random() * UEBERRASCHUNGEN.length)]; }
function kommtUeberraschung() {
  const ohne = daten.ohneUeberraschung || 0;
  const ja = ohne >= 5 || Math.random() < ueberraschungChance;
  daten.ohneUeberraschung = ja ? 0 : ohne + 1;
  speichere();
  return ja;
}
function ueberraschungHtml(art) {
  if (art === 'drache') return '<div class="u-drache" aria-hidden="true"><span>🐉</span></div>';
  if (art === 'regenbogen') return '<div class="u-bogen" aria-hidden="true"></div>';
  // Sternschnuppen: sieben Stück, versetzt über den Himmel
  return [[78, 6, 0], [96, 20, 0.25], [60, 2, 0.5], [88, 34, 0.75], [70, 14, 1.0], [104, 8, 1.3], [82, 28, 1.6]]
    .map(([x, y, d]) => `<div class="u-schnuppe" style="--x:${x}%; --y:${y}%; --d:${d}s"></div>`).join('');
}
// Der Drache speit Sternenfunken
function drachenFunken(el) {
  const drache = el.querySelector('.u-drache span');
  if (!drache) return;
  const zeichen = ['★', '✦', '✧', '·'];
  const t = setInterval(() => {
    if (!el.isConnected || !drache.isConnected) { clearInterval(t); return; }
    const r = drache.getBoundingClientRect();
    if (r.right < 0) { clearInterval(t); return; }
    const f = document.createElement('span');
    f.className = 'u-funke';
    f.textContent = zeichen[Math.floor(Math.random() * zeichen.length)];
    f.style.left = (r.left + 4) + 'px';
    f.style.top = (r.top + r.height * 0.32) + 'px';
    f.style.setProperty('--dx', (-30 - Math.random() * 50).toFixed(0) + 'px');
    f.style.setProperty('--dy', (Math.random() * 70 - 20).toFixed(0) + 'px');
    f.addEventListener('animationend', () => f.remove());
    document.body.appendChild(f);
  }, 70);
}
function tonUeberraschung() {
  [784, 880, 1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637].forEach((f, i) => ton(f, 'sine', 0.18, 0.12, i * 0.045));
  [3136, 2637, 3520, 2794].forEach((f, i) => ton(f, 'triangle', 0.15, 0.04, 0.55 + i * 0.09));
}

// Am Ende der Runde: die neuen Sterne nacheinander zeigen, danach allenfalls die Krone
function starteSternZauber() {
  const neu = aktuell.neueSterne || [];
  if (!neu.length) return;
  const schritte = [];
  [...new Set(neu.map(x => x.gruppe))].forEach(gid => {
    const g = QUIZ_DATEN.gruppen.find(x => gruppenId(x) === gid);
    if (!g) return;
    const et = etappenVon(g);
    const eigene = neu.filter(x => x.gruppe === gid && et.some(e => e.id === x.etappe))
      .sort((a, b) => et.findIndex(e => e.id === a.etappe) - et.findIndex(e => e.id === b.etappe));
    // Wie viele Sterne die Unité vor dieser Runde hatte – für die Länge der Melodie
    const vorher = et.filter(e => e.verdient).length - eigene.length;
    eigene.forEach((x, i) => {
      schritte.push({ g, etappe: et.find(e => e.id === x.etappe), nr: vorher + i + 1, von: et.length });
      wartendeSterne.push({ gruppe: gid, etappe: x.etappe });
    });
    if (eigene.some(x => x.krone)) {
      schritte.push({ g, krone: true });
      wartendeSterne.push({ gruppe: gid, krone: true });
    }
  });
  if (!schritte.length) return;
  zauberLaeuft = true;
  let i = 0;
  const weiter = () => {
    if (i < schritte.length) zeigeSternZauber(schritte[i++], weiter);
    else zauberLaeuft = false;
  };
  setTimeout(weiter, wenigBewegung() ? 300 : 900);
}

function zeigeSternZauber(s, fertig) {
  const art = s.krone ? 'krone' : s.etappe.id;
  const z = ZAUBER[art];
  const unite = s.g.titel.split(' · ').slice(1).join(' · ') || s.g.titel;
  const f = s.g.sprache === 'en' ? '🇬🇧' : '🇫🇷';
  const el = document.createElement('div');
  el.className = 'zauber zauber-' + art;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', s.krone ? `Krone für ${unite}` : `Neuer Stern in ${unite}: ${s.etappe.name}`);
  // Seltene Überraschung (nie bei der Krone – die ist schon Überraschung genug)
  const ueber = !s.krone && kommtUeberraschung() ? waehleUeberraschung() : null;
  if (ueber) { el.classList.add('ueberraschung'); el.dataset.ueberraschung = ueber; }
  el.innerHTML = `
    <div class="z-himmel"></div>
    ${ueber ? `<div class="u-buehne">${ueberraschungHtml(ueber)}</div>` : ''}
    <div class="z-buehne">${z.html(s)}</div>
    <div class="z-text">
      <div class="z-titel">${s.krone ? 'Krone für' : 'Neuer Stern'}</div>
      <div class="z-name">${s.krone ? unite : s.etappe.name}</div>
      <div class="z-was">${s.krone ? 'Alle Sterne gesammelt!' : `${unite}: ${s.etappe.was.replace('{f}', f)}`}</div>
    </div>
    <button class="restart-btn z-weiter">Weiter ✦</button>`;
  document.body.appendChild(el);

  const schnell = wenigBewegung();
  let offen = false;
  const enthuelle = () => {
    if (offen || !el.isConnected) return;
    offen = true;
    el.classList.add('offen');
    if (s.krone) { tonFanfare(); konfetti(); }
    else tonSternMelodie(s.nr, s.von);
    if (!ueber) { el.classList.add('bereit'); return; }
    // Die Überraschung kommt kurz nach dem Stern; «Weiter» erst, wenn sie vorbei ist
    setTimeout(() => {
      if (!el.isConnected) return;
      el.classList.add('u-los');
      tonUeberraschung();
      if (ueber === 'drache' && !schnell) drachenFunken(el);
    }, schnell ? 0 : 650);
    setTimeout(() => el.classList.add('bereit'), schnell ? 0 : 3300);
  };
  if (z.rubbeln) {
    starteRubbeln(el, enthuelle);
  } else if (z.tippen) {
    // Erst antippbar, wenn der Brief gelandet ist
    setTimeout(() => el.querySelector('.z-brief').addEventListener('click', enthuelle), schnell ? 0 : 1700);
  } else if (z.lauf && !schnell) {
    z.lauf(el, enthuelle);
  } else {
    setTimeout(enthuelle, schnell ? 150 : z.zeit);
  }
  el.querySelector('.z-weiter').addEventListener('click', () => {
    if (!el.classList.contains('bereit') || el.classList.contains('zu')) return;
    el.classList.add('zu');
    setTimeout(() => { el.remove(); fertig(); }, schnell ? 0 : 250);
  });
}

// ── Flug in der Übersicht ──
let flugLauf = 0;   // ein neues Menü bricht laufende Flüge ab und startet die übrigen neu

function starteSternFluege() {
  const lauf = ++flugLauf;
  document.querySelectorAll('.flug-stern, .flug-spur').forEach(x => x.remove());
  // Nur in der sichtbaren Übersicht
  if (document.body.classList.contains('quiz') || document.body.classList.contains('konto')) return;
  const kopfVon = gid => [...document.querySelectorAll('#gruppen .sterne')].find(x => x.dataset.gruppe === gid);
  const naechster = () => {
    if (lauf !== flugLauf) return;
    // Inzwischen eine Runde gestartet? Dann beim nächsten Menü weiter
    if (document.body.classList.contains('quiz') || document.body.classList.contains('konto')) return;
    // Kommt noch ein Stern-Zauber (z. B. schnell zur Übersicht getippt)? Erst fertig zaubern
    if (zauberLaeuft) { setTimeout(naechster, 400); return; }
    const w = wartendeSterne.find(x => kopfVon(x.gruppe));
    if (!w) return;
    const kopf = kopfVon(w.gruppe);
    const ende = () => {
      const i = wartendeSterne.indexOf(w);
      if (i >= 0) wartendeSterne.splice(i, 1);
      setTimeout(naechster, wenigBewegung() ? 0 : 250);
    };
    if (w.krone) { kroene(kopf, lauf, ende); return; }
    const ziel = kopf.querySelector(`i[data-etappe="${w.etappe}"]`);
    if (!ziel) { ende(); return; }
    zeigeImBild(kopf);
    const r = ziel.getBoundingClientRect();
    const start = { x: innerWidth / 2, y: innerHeight * 0.45 };
    const zielPunkt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    // Erst nach links oben ausholen, dann in einem Bogen an den Platz
    const steuer = { x: Math.max(24, Math.min(start.x, zielPunkt.x) - 120), y: Math.min(start.y, zielPunkt.y) - 70 };
    flug(STERN_SVG, false, start, steuer, zielPunkt, 64, r.height * 1.2, lauf, () => {
      ziel.classList.add('voll', 'landet');
      ziel.textContent = '★';
      tonLanden();
      ende();
    });
  };
  setTimeout(naechster, wenigBewegung() ? 0 : 450);
}

function zeigeImBild(el) {
  const r = el.getBoundingClientRect();
  if (r.top < 60 || r.bottom > innerHeight - 10) el.scrollIntoView({ block: 'center' });
}

// Fliegt inhalt auf einer Bogenbahn von start nach ziel (Bildschirmpunkte)
function flug(inhalt, emoji, start, steuer, ziel, groesse, zielGroesse, lauf, fertig) {
  if (wenigBewegung()) { fertig(); return; }
  const el = document.createElement('div');
  el.className = 'flug-stern' + (emoji ? ' emoji' : '');
  el.innerHTML = inhalt;
  el.style.width = el.style.height = groesse + 'px';
  el.style.margin = `${-groesse / 2}px 0 0 ${-groesse / 2}px`;
  if (emoji) el.style.fontSize = (groesse * 0.85) + 'px';
  document.body.appendChild(el);
  const n = 24, bilder = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * start.x + 2 * u * t * steuer.x + t * t * ziel.x;
    const y = u * u * start.y + 2 * u * t * steuer.y + t * t * ziel.y;
    const sk = (1 - t) * (i < 3 ? 0.6 + i * 0.2 : 1) + t * (zielGroesse / groesse);
    bilder.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${sk.toFixed(3)}) rotate(${emoji ? 0 : Math.round(t * 540)}deg)`,
                  opacity: i === 0 ? 0 : 1, offset: t });
  }
  const anim = el.animate(bilder, { duration: emoji ? 900 : 1250, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
  // Funkenspur
  const spur = setInterval(() => {
    if (!el.isConnected) { clearInterval(spur); return; }
    const b = el.getBoundingClientRect();
    const f = document.createElement('span');
    f.className = 'flug-spur';
    f.style.left = (b.left + b.width / 2 + (Math.random() * 10 - 5)) + 'px';
    f.style.top = (b.top + b.height / 2 + (Math.random() * 10 - 5)) + 'px';
    f.addEventListener('animationend', () => f.remove());
    document.body.appendChild(f);
  }, 30);
  anim.onfinish = () => {
    clearInterval(spur);
    el.remove();
    if (lauf === flugLauf) fertig();
  };
}

// Alle Sterne der Unité verschmelzen zur Krone; eine kleine Krone fliegt aufs Profil-Icon
function kroene(kopf, lauf, fertig) {
  zeigeImBild(kopf);
  const r = kopf.getBoundingClientRect();
  const mitte = r.left + r.width / 2;
  kopf.querySelectorAll('i').forEach(i => {
    const b = i.getBoundingClientRect();
    i.style.setProperty('--dx', (mitte - (b.left + b.width / 2)).toFixed(1) + 'px');
  });
  kopf.classList.add('verschmelzen');
  setTimeout(() => {
    if (lauf !== flugLauf) return;
    kopf.classList.remove('verschmelzen');
    kopf.classList.add('krone', 'kroenung');
    kopf.innerHTML = '👑';
    tonFanfare();
    const wrap = document.getElementById('konto-icon');
    const icon = wrap.querySelector('.konto-icon');
    const ankommen = () => {
      wrap.classList.add('gekroent', 'kroenung');
      setTimeout(() => wrap.classList.remove('kroenung'), 900);
      fertig();
    };
    if (!icon) { fertig(); return; }   // ohne Konto gibt es kein Profil-Icon
    setTimeout(() => {
      if (lauf !== flugLauf) return;
      const a = kopf.getBoundingClientRect(), b = icon.getBoundingClientRect();
      if (b.bottom < 0) { ankommen(); return; }   // Icon gerade nicht im Bild
      const start = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
      const ziel = { x: b.left, y: b.top - 3 };   // dort sitzt die kleine Krone
      flug('👑', true, start, { x: (start.x + ziel.x) / 2, y: Math.min(start.y, ziel.y) - 60 }, ziel, 44, 18, lauf, ankommen);
    }, wenigBewegung() ? 0 : 700);
  }, wenigBewegung() ? 0 : 550);
}

// ════════════════════════════════════════════════════════════
//  ERGEBNIS-ANIMATIONEN
// ════════════════════════════════════════════════════════════
function baueZauberstab() {
  const funken = Array.from({ length: 7 }, (_, i) => {
    const winkel = (-140 + i * 24) * Math.PI / 180;
    const weite = 40 + Math.random() * 34;
    return `<div class="funke" style="
      --dx:${(Math.cos(winkel) * weite).toFixed(0)}px;
      --dy:${(Math.sin(winkel) * weite).toFixed(0)}px;
      animation-delay:${(i * 0.22).toFixed(2)}s;"></div>`;
  }).join('');
  return `<div class="stab-wrap"><div class="stab"></div><div class="stab-licht"></div>${funken}</div>`;
}

function baueKerze() {
  return `
    <div class="kerze-wrap">
      <div class="kerze-koerper"></div>
      <div class="kerze-docht"></div>
      <div class="kerze-flamme"></div>
    </div>`;
}

function baueNebel() {
  const schwaden = Array.from({ length: 7 }, (_, i) => {
    const breite = 70 + Math.random() * 90;
    return `<div class="nebel" style="
      left:${5 + Math.random() * 60}%;
      top:${Math.random() * 60}px;
      width:${breite.toFixed(0)}px;
      height:${(breite * 0.45).toFixed(0)}px;
      animation-duration:${(5 + Math.random() * 4).toFixed(1)}s;
      animation-delay:${(i * 0.7).toFixed(1)}s;"></div>`;
  }).join('');
  return `
    <div style="text-align:center;margin-bottom:4px;">
      <svg class="kessel" width="96" height="62" viewBox="0 0 96 62" fill="none">
        <ellipse cx="48" cy="18" rx="30" ry="8" fill="#1b1410"/>
        <path d="M18 18 C18 44, 30 56, 48 56 C66 56, 78 44, 78 18 Z" fill="#2b2119"/>
        <path d="M22 20 C23 42, 33 52, 48 52 C63 52, 73 42, 74 20 Z" fill="#3a2d21"/>
        <ellipse cx="48" cy="18" rx="26" ry="6.5" fill="#4a3b2a"/>
      </svg>
    </div>
    <div class="nebel-wrap">${schwaden}</div>`;
}

// ── Konfetti ──
let konfettiAnim = null;
let teilchen = [];

function stoppeCanvas() {
  if (konfettiAnim) { cancelAnimationFrame(konfettiAnim); konfettiAnim = null; }
  teilchen = [];
  const c = document.getElementById('anim-canvas');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

function konfetti() {
  stoppeCanvas();
  const canvas = document.getElementById('anim-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  // Goldene Funken statt bunter Schnipsel
  const farben = ['#e9cf7a','#c9a227','#f3dc9b','#8c6b14','#fff3c4','#d9b64a'];
  const formen = ['star','star','circle'];

  function nachschub(anzahl, oben) {
    for (let i = 0; i < anzahl; i++) {
      teilchen.push({
        x: Math.random() * canvas.width,
        y: oben ? -10 : -20 - Math.random() * canvas.height * 0.5,
        size: 6 + Math.random() * 10,
        color: farben[Math.floor(Math.random() * farben.length)],
        shape: formen[Math.floor(Math.random() * formen.length)],
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.2,
        opacity: 1,
        decay: 0.004 + Math.random() * 0.004,
      });
    }
  }
  nachschub(160, false);

  function stern(x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const b = (i * 4 * Math.PI) / 5 + (2 * Math.PI) / 5 - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(b) * r * 0.4, Math.sin(b) * r * 0.4);
    }
    ctx.closePath();
    ctx.restore();
  }

  function schleife() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    teilchen = teilchen.filter(p => p.opacity > 0.05);
    teilchen.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.rotV; p.opacity -= p.decay;
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); ctx.fill();
      } else if (p.shape === 'rect') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
      } else {
        stern(p.x, p.y, p.size / 2, p.rot); ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    if (teilchen.length > 0) konfettiAnim = requestAnimationFrame(schleife);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  konfettiAnim = requestAnimationFrame(schleife);
  setTimeout(() => nachschub(80, true), 800);
}

// ════════════════════════════════════════════════════════════
//  TÖNE
// ════════════════════════════════════════════════════════════
let audioCtx = null;

// iOS: der Ton-Kontext startet angehalten und muss bei jeder Berührung
// wieder aufgeweckt werden – sonst bleiben die Töne stumm, während die
// Sprachausgabe (anderer Weg) weiterhin hörbar ist.
function tonKontext() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}

function ton(freq, typ, dauer, laut, verzug = 0) {
  try {
    const ctx = tonKontext();
    if (!ctx) return;
    const start = ctx.currentTime + verzug;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = typ;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(laut, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dauer);
    osc.start(start);
    osc.stop(start + dauer);
  } catch (e) {}
}
function tonRichtig()    { ton(523,'sine',0.15,0.3,0); ton(784,'sine',0.2,0.3,0.12); }
function tonFalsch()     { ton(220,'sawtooth',0.18,0.15,0); ton(180,'sawtooth',0.18,0.10,0.08); }
function tonFanfare()    { [523,659,784,1047].forEach((f,i) => ton(f,'sine',0.25,0.28,i*0.13)); }
function tonSonne()      { [440,554,659,880].forEach((f,i) => ton(f,'sine',0.2,0.22,i*0.1)); }
function tonRegenbogen() { [349,440,523].forEach((f,i) => ton(f,'triangle',0.3,0.18,i*0.08)); }
function tonRegen()      { ton(330,'triangle',0.2,0.15,0); ton(392,'triangle',0.2,0.15,0.2); ton(330,'triangle',0.2,0.15,0.4); }

// ════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════
document.getElementById('autoread-toggle').checked = vorlesen;
zeigeMenu();
Konto.start();

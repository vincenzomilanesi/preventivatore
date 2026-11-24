/**
 * Logica di business PURA: nessuna chiamata a SpreadsheetApp, CacheService, MailApp…
 * Così si porta 1:1 in JavaScript sul Worker Cloudflare in fase 2 (handoff §7.4.3)
 * e si testa in Node (dev/test_backend.mjs).
 */

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail_(email) {
  return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(email) && email.length <= 254;
}

/** true se il dominio dell'e-mail è tra quelli ammessi (match esatto, niente sottodomini impliciti). */
function isEmailDomainAllowed_(email, allowedDomains) {
  var dom = email.split('@')[1] || '';
  return allowedDomains.indexOf(dom) >= 0;
}

function isValidOtpFormat_(code) {
  return /^\d{6}$/.test(String(code || ''));
}

/** Codice OTP a 6 cifre da una stringa casuale esadecimale (es. due UUID senza trattini). */
function otpFromRandomHex_(hex) {
  var n = parseInt(String(hex).replace(/[^0-9a-f]/gi, '').slice(0, 12), 16);
  return String(n % 1000000).padStart(6, '0');
}

/** Numero preventivo PRV-AAAA-NNNN (+ suffisso entità se preventivi collegati, decisione F). */
function formatPreventivoNumber_(year, n, suffix) {
  return 'PRV-' + year + '-' + String(n).padStart(4, '0') + (suffix ? '-' + suffix : '');
}

/** Converte le righe di un foglio (prima riga = intestazioni) in oggetti. */
function rowsToObjects_(values) {
  if (!values || values.length < 1) return [];
  var hdr = values[0].map(String);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (r.every(function (v) { return v === '' || v === null; })) continue;
    var o = {};
    for (var j = 0; j < hdr.length; j++) o[hdr[j]] = r[j];
    out.push(o);
  }
  return out;
}

/**
 * true se il valore significa "Sì": accetta Sì / Si / SI / sì / sí (spazi e maiuscole ignorati) e la casella
 * di controllo spuntata (true). Tutto il resto (No, vuoto, "Sìx"…) è false.
 */
function isYes_(v) {
  if (v === true) return true;
  var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  s = s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  return s === 'si';
}

/** Utente abilitato al login: presente in Utenti con ATTIVO = Sì (vedi isYes_). */
function findActiveUser_(users, email) {
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (normalizeEmail_(u.EMAIL) === email && isYes_(u.ATTIVO)) {
      return {
        email: email,
        nome: String(u.NOME || ''),
        cognome: String(u.COGNOME || ''),
        dip: String(u.DIP || ''),
        ruolo: String(u.RUOLO || ''),
        profilo: String(u.PROFILO || 'utente') === 'admin' ? 'admin' : 'utente'
      };
    }
  }
  return null;
}

/** Confronto intestazioni foglio vs schema atteso: ritorna l'elenco delle differenze (vuoto = ok). */
function diffHeaders_(actual, expected) {
  var diffs = [];
  for (var i = 0; i < expected.length; i++) {
    if (String(actual[i] || '') !== expected[i]) diffs.push('col ' + (i + 1) + ': atteso "' + expected[i] +
      '", trovato "' + (actual[i] || '') + '"');
  }
  return diffs;
}

/** Chiavi di cache da rimuovere per sbloccare un utente (limite richieste OTP + codice in corso). */
function unlockCacheKeys_(email) {
  return ['otp_rl_' + email, 'otp_' + email];
}

/** Testo sicuro per celle di export (no formule iniettate: =, +, -, @). */
function safeCell_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ================================================================== CLIENTI: normalizzazione e import HubSpot
// Funzioni pure: ricevono tabelle (array di array) e oggetti, restituiscono oggetti. Nessun accesso a fogli/Drive.

/** Testo ripulito: spazi multipli compressi, trim, lunghezza massima opzionale. */
function cleanText_(v, max) {
  var s = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

/** Chiave di confronto/ricerca: minuscole, senza accenti, solo lettere e cifre separate da uno spazio. */
function normKey_(v) {
  var s = String(v === null || v === undefined ? '' : v).toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** P.IVA italiana: 11 cifre con cifra di controllo corretta (00000000000 esclusa). */
function isValidPivaIt_(p) {
  if (!/^\d{11}$/.test(p) || /^0+$/.test(p)) return false;
  var s = 0;
  for (var i = 0; i < 10; i++) {
    var n = Number(p.charAt(i));
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    s += n;
  }
  return (10 - s % 10) % 10 === Number(p.charAt(10));
}

/**
 * P.IVA normalizzata o '' se non valida. Italiana: 11 cifre (prefisso IT, spazi, punti e trattini tolti) con
 * controllo. Estera UE: prefisso paese + 2–13 caratteri alfanumerici, accettata così com'è (non verificabile).
 */
function normPiva_(v) {
  var s = String(v === null || v === undefined ? '' : v).toUpperCase().replace(/[\s.\-]/g, '');
  if (!s) return '';
  var it = s.replace(/^IT/, '');
  if (/^\d+$/.test(it)) return isValidPivaIt_(it) ? it : '';
  return /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI|CHE|GB|SM)[A-Z0-9]{2,13}$/
    .test(s) ? s : '';
}

/** Codice fiscale: persona fisica (16 caratteri con carattere di controllo) o soggetto diverso (11 cifre). */
function isValidCf_(cf) {
  var s = String(cf || '').toUpperCase();
  if (/^\d{11}$/.test(s)) return isValidPivaIt_(s);
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s)) return false;
  var odd = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
  var sum = 0;
  for (var i = 0; i < 15; i++) {
    var c = s.charAt(i);
    var v = /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
    sum += i % 2 === 0 ? odd[v] : v;   // posizioni dispari (1ª, 3ª…) = indice pari
  }
  return String.fromCharCode(65 + sum % 26) === s.charAt(15);
}

/** CF normalizzato (maiuscolo, senza spazi) o '' se non valido. */
function normCf_(v) {
  var s = String(v === null || v === undefined ? '' : v).toUpperCase().replace(/\s/g, '');
  return s && isValidCf_(s) ? s : '';
}

/** Dominio web/e-mail: minuscolo, senza protocollo, www. e percorso. */
function normDomain_(v) {
  return String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#].*$/, '');
}

/** true se il dominio è (o è sottodominio di) un provider di posta/PEC: l'azienda è stata creata da un'e-mail privata. */
function isMailProviderDomain_(d) {
  for (var i = 0; i < MAIL_PROVIDER_DOMAINS.length; i++) {
    var g = MAIL_PROVIDER_DOMAINS[i];
    if (d === g || d.slice(-(g.length + 1)) === '.' + g) return true;
  }
  return false;
}

function normPaese_(v) {
  var s = cleanText_(v, 60);
  var k = s.toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAESE_ALIAS, k) ? PAESE_ALIAS[k] : titleIfUpper_(s);
}

/**
 * Parser CSV (RFC 4180): virgolette, virgolette raddoppiate, a capo dentro i campi, CRLF, BOM UTF-8.
 * Separatore: virgola o punto e virgola, scelto contando quelli della prima riga fuori dalle virgolette.
 */
function parseCsv_(text) {
  var t = String(text || '').replace(/^﻿/, '');
  var first = '', q = false;
  for (var k = 0; k < t.length; k++) {
    var ch = t.charAt(k);
    if (ch === '"') q = !q;
    else if (!q && (ch === '\n' || ch === '\r')) break;
    else if (!q) first += ch;
  }
  var sep = (first.split(';').length > first.split(',').length) ? ';' : ',';
  var rows = [], row = [], field = '', inQ = false, i = 0, n = t.length;
  while (i < n) {
    var c = t.charAt(i);
    if (inQ) {
      if (c === '"') {
        if (t.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === sep) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      i += (c === '\r' && t.charAt(i + 1) === '\n') ? 2 : 1;
      continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Indici delle colonne per chiave logica (primo alias trovato nell'intestazione), -1 se assente. */
function headerIndex_(hdr, aliases) {
  var h = hdr.map(function (x) { return String(x).replace(/^﻿/, '').trim(); });
  var out = {};
  Object.keys(aliases).forEach(function (k) {
    out[k] = -1;
    for (var i = 0; i < aliases[k].length && out[k] < 0; i++) out[k] = h.indexOf(aliases[k][i]);
  });
  return out;
}

/** 'elibra_pg' | 'elibra_pf' | 'aziende' | 'contatti' | '' secondo le intestazioni dell'export. */
function detectHubspotExport_(hdr) {
  var pf = headerIndex_(hdr, ELIBRA_COLS.pf);
  if (pf.ID >= 0 && pf.NOMINATIVO >= 0 && pf.PG >= 0) return 'elibra_pf';
  var pg = headerIndex_(hdr, ELIBRA_COLS.pg);
  if (pg.ID >= 0 && pg.NOME >= 0 && pg.CLIENTE >= 0) return 'elibra_pg';
  var c = headerIndex_(hdr, HUBSPOT_COLS.contatti);
  if (c.ID >= 0 && c.COGNOME >= 0 && c.EMAIL >= 0) return 'contatti';
  var a = headerIndex_(hdr, HUBSPOT_COLS.aziende);
  if (a.ID >= 0 && a.NOME >= 0) return 'aziende';
  return '';
}

function missingCols_(idx, required) {
  return required.filter(function (k) { return idx[k] < 0; });
}

/**
 * Export Aziende → record pronti per il foglio Clienti.
 * Scarti: senza ID, senza nome, dominio di un provider di posta/PEC senza P.IVA (aziende create in automatico
 * da e-mail private, es. le "Artidea" su 191.it). P.IVA non valida → campo vuoto + avviso.
 * Doppioni di P.IVA: resta il record più completo (poi il più recente, poi l'ID minore); gli altri ID HubSpot
 * vanno in ID_HUBSPOT_ALTRI e nel report doppioni.
 */
function prepareAziende_(table) {
  var idx = headerIndex_(table[0] || [], HUBSPOT_COLS.aziende);
  var miss = missingCols_(idx, ['ID', 'NOME']);
  if (miss.length) return { error: 'IMPORT_INTESTAZIONI', mancanti: miss };
  var get = function (r, k) { return idx[k] >= 0 ? r[idx[k]] : ''; };
  var out = { righe: table.length - 1, records: [], scarti: [], avvisi: [], doppioni: [],
    colonneAssenti: Object.keys(idx).filter(function (k) { return idx[k] < 0; }) };
  var seenId = {};
  for (var i = 1; i < table.length; i++) {
    var r = table[i];
    var id = String(get(r, 'ID')).replace(/\D/g, '');
    var nome = cleanText_(get(r, 'NOME'), 200);
    if (!id) { out.scarti.push({ id: '', nome: nome, motivo: 'senza ID record' }); continue; }
    if (seenId[id]) { out.scarti.push({ id: id, nome: nome, motivo: 'ID record ripetuto nel file' }); continue; }
    seenId[id] = true;
    if (!nome) { out.scarti.push({ id: id, nome: '', motivo: 'senza nome azienda' }); continue; }
    var dom = normDomain_(get(r, 'DOMINIO'));
    var pivaRaw = cleanText_(get(r, 'PIVA'));
    var piva = normPiva_(pivaRaw);
    if (!piva && isMailProviderDomain_(dom)) {
      out.scarti.push({ id: id, nome: nome, motivo: 'creata da e-mail di un provider di posta (' + dom + ')' });
      continue;
    }
    if (pivaRaw && !piva) out.avvisi.push({ id: id, nome: nome, motivo: 'P.IVA non valida, non importata: ' + pivaRaw });
    var ind = [cleanText_(get(r, 'INDIRIZZO'), 150), cleanText_(get(r, 'INDIRIZZO2'), 100)].filter(String).join(', ');
    out.records.push({
      ID_HUBSPOT: id, ID_HUBSPOT_ALTRI: '', TIPO: 'azienda', RAGIONE_SOCIALE: nome, PIVA: piva,
      TELEFONO: cleanText_(get(r, 'TELEFONO'), 40), INDIRIZZO: ind, CAP: cleanText_(get(r, 'CAP'), 12),
      CITTA: cleanText_(get(r, 'CITTA'), 80), PROVINCIA: cleanText_(get(r, 'PROVINCIA'), 60),
      PAESE: normPaese_(get(r, 'PAESE')) || normPaese_(get(r, 'NAZIONE')), DOMINIO: dom,
      _mod: cleanText_(get(r, 'MODIFICATO'))
    });
  }
  // doppioni di P.IVA
  var byPiva = {};
  out.records.forEach(function (rec) { if (rec.PIVA) (byPiva[rec.PIVA] = byPiva[rec.PIVA] || []).push(rec); });
  var drop = {};
  Object.keys(byPiva).forEach(function (p) {
    var g = byPiva[p];
    if (g.length < 2) return;
    g.sort(function (a, b) {
      return completeness_(b) - completeness_(a) || (b._mod > a._mod ? 1 : b._mod < a._mod ? -1 : 0) ||
        (a.ID_HUBSPOT.length - b.ID_HUBSPOT.length) || (a.ID_HUBSPOT < b.ID_HUBSPOT ? -1 : 1);
    });
    var others = g.slice(1).map(function (x) { drop[x.ID_HUBSPOT] = true; return x.ID_HUBSPOT; });
    g[0].ID_HUBSPOT_ALTRI = others.join(';');
    out.doppioni.push({ piva: p, tenuto: g[0].ID_HUBSPOT, nome: g[0].RAGIONE_SOCIALE, uniti: others });
  });
  out.records = out.records.filter(function (rec) { return !drop[rec.ID_HUBSPOT]; });
  out.records.forEach(function (rec) { delete rec._mod; });
  return out;
}

function completeness_(rec) {
  return ['PIVA', 'TELEFONO', 'INDIRIZZO', 'CAP', 'CITTA', 'PROVINCIA', 'PAESE', 'DOMINIO']
    .filter(function (k) { return rec[k]; }).length;
}

/**
 * Export Contatti → referenti (contatti associati a un'azienda presente in Clienti) e persone fisiche
 * (contatti senza azienda importata ma con fase del ciclo di vita oltre Lead, decisione C4). Il resto è scartato
 * e conteggiato senza nomi (minimizzazione). aziendaIdx: ID HubSpot azienda → ID_CLIENTE.
 */
function prepareContatti_(table, aziendaIdx) {
  var idx = headerIndex_(table[0] || [], HUBSPOT_COLS.contatti);
  var miss = missingCols_(idx, ['ID', 'NOME', 'COGNOME', 'EMAIL', 'FASE']);
  if (idx.AZIENDA_PRIMARIA < 0 && idx.AZIENDE < 0) miss.push('AZIENDE');
  if (miss.length) return { error: 'IMPORT_INTESTAZIONI', mancanti: miss };
  var get = function (r, k) { return idx[k] >= 0 ? r[idx[k]] : ''; };
  var fasi = HUBSPOT_FASI_AVANZATE.map(normKey_);
  var out = { righe: table.length - 1, referenti: [], persone: [], scarti: [], avvisi: [],
    colonneAssenti: Object.keys(idx).filter(function (k) { return idx[k] < 0; }) };
  var seenId = {};
  for (var i = 1; i < table.length; i++) {
    var r = table[i];
    var id = String(get(r, 'ID')).replace(/\D/g, '');
    if (!id) { out.scarti.push({ id: '', motivo: 'senza ID record' }); continue; }
    if (seenId[id]) { out.scarti.push({ id: id, motivo: 'ID record ripetuto nel file' }); continue; }
    seenId[id] = true;
    var nome = cleanText_(get(r, 'NOME'), 80), cognome = cleanText_(get(r, 'COGNOME'), 80);
    var emailRaw = cleanText_(get(r, 'EMAIL'));
    var email = normalizeEmail_(emailRaw);
    if (email && !isValidEmail_(email)) { out.avvisi.push({ id: id, motivo: 'e-mail non valida, non importata' }); email = ''; }
    if (!nome && !cognome && !email) { out.scarti.push({ id: id, motivo: 'senza nome, cognome ed e-mail' }); continue; }
    var aziende = [String(get(r, 'AZIENDA_PRIMARIA'))].concat(String(get(r, 'AZIENDE')).split(/[;,]/))
      .map(function (x) { return x.replace(/\D/g, ''); }).filter(String);
    var idCliente = '';
    for (var j = 0; j < aziende.length && !idCliente; j++) {
      if (Object.prototype.hasOwnProperty.call(aziendaIdx, aziende[j])) idCliente = aziendaIdx[aziende[j]];
    }
    var tel = cleanText_(get(r, 'TELEFONO'), 40);
    if (idCliente) {
      out.referenti.push({ ID_HUBSPOT: id, ID_CLIENTE: idCliente, NOME: nome, COGNOME: cognome, EMAIL: email, TELEFONO: tel });
    } else if (fasi.indexOf(normKey_(get(r, 'FASE'))) >= 0) {
      var cfRaw = cleanText_(get(r, 'CF'));
      var cf = normCf_(cfRaw);
      if (cfRaw && !cf) out.avvisi.push({ id: id, motivo: 'codice fiscale non valido, non importato' });
      out.persone.push({ ID_HUBSPOT: id, TIPO: 'persona', NOME: nome, COGNOME: cognome, EMAIL: email, TELEFONO: tel, CF: cf });
    } else {
      out.scarti.push({ id: id, motivo: aziende.length ? 'azienda non importata e fase Lead o inferiore'
        : 'senza azienda e fase Lead o inferiore' });
    }
  }
  return out;
}

/** Testo di ricerca di una riga Clienti/Referenti (colonna RICERCA). */
function searchText_(o) {
  var parts = [o.RAGIONE_SOCIALE, o.NOME, o.COGNOME, o.CITTA, o.DOMINIO].map(normKey_);
  [o.PIVA, o.CF, o.EMAIL].forEach(function (x) { if (x) parts.push(String(x).toLowerCase()); });
  return parts.filter(String).join(' ');
}

/**
 * Aggiorna/inserisce i record di una fonte (eLibra o HubSpot) in una tabella (Clienti o Referenti).
 * Idempotente: rieseguito sullo stesso export non cambia nulla. Non cancella: le righe della fonte che non sono
 * più nell'export sono restituite in `assenti`.
 *  - aggancio per ID della fonte (opt.idField, più opt.altField per gli ID HubSpot uniti); se non c'è, aggancio
 *    "di riserva" (opt.fallbackKey: P.IVA, CF, nome del referente…) solo su righe che non hanno ancora quell'ID;
 *  - campi scritti: opt.fields, oppure opt.fieldsOnOwned se la riga appartiene già alla fonte principale
 *    (opt.ownerField valorizzato, cioè ID_ELIBRA): così HubSpot non sovrascrive mai i dati di eLibra.
 * opt: {idField, altField, scope(o), fallbackKey(o|rec), fields, fieldsOnOwned, ownerField, onMatch{},
 *       newDefaults{}, idCol, prefix, nextNum, now, origine, tipo}
 * Ritorna {rows, nuovi, aggiornati, invariati, agganciati, assenti[], nextNum}.
 */
function mergeSource_(existing, incoming, opt) {
  var own = Object.prototype.hasOwnProperty;
  var rows = existing.map(function (o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; });
  var str = function (v) { return v === undefined || v === null ? '' : String(v); };
  var byKey = {}, byFb = {};
  rows.forEach(function (o, i) {
    if (!opt.scope(o)) return;
    if (str(o[opt.idField])) {
      [str(o[opt.idField])].concat(opt.altField ? str(o[opt.altField]).split(';') : []).forEach(function (k) {
        if (k && !own.call(byKey, k)) byKey[k] = i;
      });
    } else if (opt.fallbackKey) {
      var fk = opt.fallbackKey(o);
      if (fk && !own.call(byFb, fk)) byFb[fk] = i;
    }
  });
  var used = {};
  var res = { nuovi: 0, aggiornati: 0, invariati: 0, agganciati: 0, assenti: [], nextNum: opt.nextNum };
  incoming.forEach(function (rec) {
    var keys = [str(rec[opt.idField])].concat(opt.altField ? str(rec[opt.altField]).split(';') : []).filter(String);
    var at = -1;
    for (var i = 0; i < keys.length && at < 0; i++) {
      if (own.call(byKey, keys[i]) && !used[byKey[keys[i]]]) at = byKey[keys[i]];
    }
    var fb = false;
    if (at < 0 && opt.fallbackKey) {
      var fk = opt.fallbackKey(rec);
      if (fk && own.call(byFb, fk) && !used[byFb[fk]]) { at = byFb[fk]; fb = true; }
    }
    if (at >= 0) {
      used[at] = true;
      var o = rows[at], changed = false;
      var fields = (opt.ownerField && str(o[opt.ownerField]) && opt.ownerField !== opt.idField) ? opt.fieldsOnOwned : opt.fields;
      var set = function (f, v) { if (str(o[f]) !== str(v)) { o[f] = str(v); changed = true; } };
      set(opt.idField, rec[opt.idField]);
      if (opt.altField) set(opt.altField, rec[opt.altField]);
      fields.forEach(function (f) { set(f, rec[f]); });
      Object.keys(opt.onMatch || {}).forEach(function (f) { set(f, opt.onMatch[f]); });
      var rt = searchText_(o);
      if (str(o.RICERCA) !== rt) { o.RICERCA = rt; changed = true; }
      if (fb) res.agganciati++;
      if (changed) { o.AGGIORNATO_IL = opt.now; res.aggiornati++; } else res.invariati++;
    } else {
      var n = {};
      n[opt.idCol] = opt.prefix + String(res.nextNum++).padStart(6, '0');
      [opt.idField].concat(opt.altField ? [opt.altField] : [], opt.fields).forEach(function (f) { n[f] = str(rec[f]); });
      if (opt.tipo) n.TIPO = opt.tipo;
      n.ORIGINE = opt.origine; n.CREATO_DA = 'import ' + opt.origine; n.CREATO_IL = opt.now; n.AGGIORNATO_IL = opt.now;
      n.STATO_HUBSPOT = ''; n.ESPORTATO_IL = '';
      Object.keys(opt.newDefaults || {}).forEach(function (f) { n[f] = opt.newDefaults[f]; });
      n.RICERCA = searchText_(n);
      rows.push(n);
      used[rows.length - 1] = true;
      res.nuovi++;
    }
  });
  rows.forEach(function (o, i) {
    if (opt.scope(o) && str(o[opt.idField]) && !used[i]) res.assenti.push(str(o[opt.idField]));
  });
  res.rows = rows;
  return res;
}

/** Testo in maiuscolo → iniziali maiuscole ("ITALIA" → "Italia"); il resto invariato. */
function titleIfUpper_(s) {
  return s && s === s.toUpperCase() && /[A-Z]/.test(s)
    ? s.toLowerCase().replace(/(^|[\s\-'(])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); }) : s;
}

/** Chiave del nominativo indipendente dall'ordine (cognome nome = nome cognome). */
function personKey_(nome, cognome) {
  return normKey_([nome, cognome].join(' ')).split(' ').filter(String).sort().join(' ');
}

/**
 * Export eLibra Persone giuridiche → record azienda per Clienti. Scarti: senza ID, senza ragione sociale,
 * ID ripetuto. P.IVA: "Partita IVA", se vuota "Partita IVA UE". P.IVA/CF non validi → vuoti + avviso.
 * Le P.IVA ripetute in eLibra NON si uniscono (sono anagrafiche distinte): vanno nel report per la pulizia.
 */
function prepareElibraPg_(table) {
  var idx = headerIndex_(table[0] || [], ELIBRA_COLS.pg);
  var miss = missingCols_(idx, ['ID', 'NOME', 'CLIENTE']);
  if (miss.length) return { error: 'IMPORT_INTESTAZIONI', mancanti: miss };
  var get = function (r, k) { return idx[k] >= 0 && r[idx[k]] !== undefined ? r[idx[k]] : ''; };
  var out = { righe: table.length - 1, records: [], scarti: [], avvisi: [], doppioni: [],
    colonneAssenti: Object.keys(idx).filter(function (k) { return idx[k] < 0; }) };
  var seen = {}, byPiva = {};
  for (var i = 1; i < table.length; i++) {
    var r = table[i];
    var id = String(get(r, 'ID')).replace(/\D/g, '');
    var nome = cleanText_(get(r, 'NOME'), 200);
    if (!id) { out.scarti.push({ id: '', nome: nome, motivo: 'senza ID' }); continue; }
    if (seen[id]) { out.scarti.push({ id: id, nome: nome, motivo: 'ID ripetuto nel file' }); continue; }
    seen[id] = true;
    if (!nome) { out.scarti.push({ id: id, nome: '', motivo: 'senza ragione sociale' }); continue; }
    var pRaw = cleanText_(get(r, 'PIVA')) || cleanText_(get(r, 'PIVA_UE'));
    var piva = normPiva_(pRaw);
    if (pRaw && !piva) out.avvisi.push({ id: id, nome: nome, motivo: 'P.IVA non valida, non importata: ' + pRaw });
    var cRaw = cleanText_(get(r, 'CF'));
    if (/^null$/i.test(cRaw)) cRaw = '';
    var cf = normCf_(cRaw);
    if (cRaw && !cf) out.avvisi.push({ id: id, nome: nome, motivo: 'codice fiscale non valido, non importato: ' + cRaw });
    var rec = { ID_ELIBRA: id, TIPO: 'azienda', RAGIONE_SOCIALE: nome, PIVA: piva, CF: cf === piva ? '' : cf,
      INDIRIZZO: cleanText_(get(r, 'INDIRIZZO'), 150), CAP: cleanText_(get(r, 'CAP'), 12),
      CITTA: titleIfUpper_(cleanText_(get(r, 'CITTA'), 80)), PROVINCIA: cleanText_(get(r, 'PROVINCIA'), 60),
      PAESE: normPaese_(get(r, 'PAESE')), CLIENTE_ELIBRA: isYes_(get(r, 'CLIENTE')) ? 'Sì' : 'No' };
    out.records.push(rec);
    if (piva) (byPiva[piva] = byPiva[piva] || []).push(rec);
  }
  Object.keys(byPiva).forEach(function (p) {
    if (byPiva[p].length > 1) out.doppioni.push({ piva: p, ids: byPiva[p].map(function (x) { return x.ID_ELIBRA; }),
      nome: byPiva[p][0].RAGIONE_SOCIALE });
  });
  return out;
}

/**
 * Colonna "PG collegata" di eLibra: "Ragione sociale - Ruolo: … - Segmento: …", ripetuta e concatenata senza
 * separatore quando la persona è collegata a più aziende. Restituisce le ragioni sociali riconosciute: dopo il
 * primo nome, il successivo è il suffisso più lungo del testo dopo "Segmento:" che corrisponde a un'azienda nota.
 */
function parsePgCollegata_(s, known) {
  var parts = String(s || '').split(' - Ruolo: ');
  var names = [];
  if (parts.length < 2) return names;
  if (normKey_(parts[0])) names.push(cleanText_(parts[0]));
  for (var i = 1; i < parts.length - 1; i++) {
    var seg = parts[i].split(' - Segmento: ');
    var rest = seg.length > 1 ? seg.slice(1).join(' - Segmento: ') : '';
    for (var k = 0; k < rest.length; k++) {
      var cand = rest.slice(k);
      if (own_(known, normKey_(cand))) { names.push(cleanText_(cand)); break; }
    }
  }
  return names;
}

function own_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

/**
 * Export eLibra Persone fisiche → clienti persona (Cliente = SI) e referenti (persone collegate ad aziende già in
 * Clienti con ID eLibra; aggancio per ragione sociale). Solo nominativo (eLibra ha cognome e nome in un unico
 * campo: va in COGNOME); ruolo e professione esclusi (decisione 24/11). Scartate le persone non clienti e non
 * collegate. pgIdx: ragione sociale normalizzata → [ID_CLIENTE…] delle aziende eLibra.
 * Nel report non compaiono nomi di persone.
 */
function prepareElibraPf_(table, pgIdx) {
  var idx = headerIndex_(table[0] || [], ELIBRA_COLS.pf);
  var miss = missingCols_(idx, ['ID', 'NOMINATIVO', 'CLIENTE', 'PG']);
  if (miss.length) return { error: 'IMPORT_INTESTAZIONI', mancanti: miss };
  var get = function (r, k) { return idx[k] >= 0 && r[idx[k]] !== undefined ? r[idx[k]] : ''; };
  var out = { righe: table.length - 1, persone: [], referenti: [], scarti: [], avvisi: [],
    colonneAssenti: Object.keys(idx).filter(function (k) { return idx[k] < 0; }) };
  var seen = {};
  for (var i = 1; i < table.length; i++) {
    var r = table[i];
    var id = String(get(r, 'ID')).replace(/\D/g, '');
    if (!id) { out.scarti.push({ id: '', motivo: 'senza ID' }); continue; }
    if (seen[id]) { out.scarti.push({ id: id, motivo: 'ID ripetuto nel file' }); continue; }
    seen[id] = true;
    var nom = cleanText_(get(r, 'NOMINATIVO'), 120);
    if (!nom) { out.scarti.push({ id: id, motivo: 'senza nominativo' }); continue; }
    var cliente = isYes_(get(r, 'CLIENTE'));
    var links = parsePgCollegata_(get(r, 'PG'), pgIdx);
    if (cliente) {
      var cRaw = cleanText_(get(r, 'CF'));
      if (/^null$/i.test(cRaw)) cRaw = '';
      var cf = normCf_(cRaw);
      if (cRaw && !cf) out.avvisi.push({ id: id, motivo: 'codice fiscale non valido, non importato' });
      var pRaw = cleanText_(get(r, 'PIVA'));
      var piva = normPiva_(pRaw);
      if (pRaw && !piva) out.avvisi.push({ id: id, motivo: 'P.IVA non valida, non importata' });
      out.persone.push({ ID_ELIBRA: id, TIPO: 'persona', NOME: '', COGNOME: nom, CF: cf, PIVA: piva,
        INDIRIZZO: cleanText_(get(r, 'INDIRIZZO'), 150), CAP: cleanText_(get(r, 'CAP'), 12),
        CITTA: titleIfUpper_(cleanText_(get(r, 'CITTA'), 80)), PROVINCIA: cleanText_(get(r, 'PROVINCIA'), 60),
        PAESE: normPaese_(get(r, 'PAESE')), CLIENTE_ELIBRA: 'Sì' });
    }
    var linked = 0, seenCli = {};
    links.forEach(function (n) {
      var ids = pgIdx[normKey_(n)] || [];
      if (ids.length !== 1) {
        out.avvisi.push({ id: id, motivo: ids.length ? 'azienda collegata ambigua (più aziende con lo stesso nome), referente non creato'
          : 'azienda collegata non trovata tra le aziende eLibra' });
        return;
      }
      if (seenCli[ids[0]]) return;
      seenCli[ids[0]] = true;
      out.referenti.push({ ID_ELIBRA: id + '/' + ids[0], ID_CLIENTE: ids[0], NOME: '', COGNOME: nom });
      linked++;
    });
    if (!cliente && !linked && !links.length) out.scarti.push({ id: id, motivo: 'non cliente e non collegata ad aziende' });
  }
  return out;
}

// ================================================================== CLIENTI: ricerca
/** Nome da mostrare: ragione sociale (azienda) o nome + cognome (persona). */
function clienteLabel_(o) {
  var pers = cleanText_([o.NOME, o.COGNOME].join(' '));
  return o.TIPO === 'persona' ? (pers || cleanText_(o.RAGIONE_SOCIALE)) : (cleanText_(o.RAGIONE_SOCIALE) || pers);
}

/**
 * Indice compatto per la ricerca: c = clienti [id, tipo, nome, città, P.IVA o CF, testo ricerca],
 * r = referenti [id cliente, nome referente, testo ricerca]. Solo i campi che servono a mostrare i risultati.
 */
function buildClientiIndex_(clienti, referenti) {
  return {
    c: clienti.filter(function (o) { return o.ID_CLIENTE; }).map(function (o) {
      return [o.ID_CLIENTE, o.TIPO, clienteLabel_(o), cleanText_(o.CITTA), o.PIVA || o.CF || '', o.RICERCA || searchText_(o),
        o.CLIENTE_ELIBRA === 'Sì' ? 1 : 0];
    }),
    r: referenti.filter(function (o) { return o.ID_CLIENTE; }).map(function (o) {
      return [o.ID_CLIENTE, cleanText_([o.NOME, o.COGNOME].join(' ')), o.RICERCA || searchText_(o)];
    })
  };
}

/**
 * Ricerca: tutti i termini devono comparire (anche come parte di parola) nel testo di ricerca del cliente o di un
 * suo referente. Con "@" si cerca l'e-mail per intero. Ordine: nome uguale, nome che inizia con la ricerca,
 * tutti i termini a inizio parola del nome, altro, trovato tramite referente; a parità prima i clienti eLibra
 * (con pratiche), poi alfabetico.
 * Ritorna {risultati: [{id, tipo, nome, citta, doc, via, cliente}], totale}.
 */
function searchIndex_(idx, q, limit) {
  var raw = String(q || '').trim().toLowerCase();
  var nq = normKey_(raw);
  var email = raw.indexOf('@') >= 0 ? raw.replace(/\s/g, '') : '';
  var tokens = nq ? nq.split(' ') : [];
  var test = function (s) {
    if (email) return s.indexOf(email) >= 0;
    for (var i = 0; i < tokens.length; i++) if (s.indexOf(tokens[i]) < 0) return false;
    return true;
  };
  var hits = {};
  idx.c.forEach(function (c) {
    if (!test(c[5])) return;
    var nn = normKey_(c[2]);
    var words = nn.split(' ');
    var atStart = tokens.every(function (t) { return words.some(function (w) { return w.indexOf(t) === 0; }); });
    var score = nn === nq ? 0 : nn.indexOf(nq) === 0 ? 1 : atStart ? 2 : 3;
    hits[c[0]] = { c: c, score: score, via: '' };
  });
  var byId = null;
  idx.r.forEach(function (r) {
    if (hits[r[0]] || !test(r[2])) return;
    if (!byId) { byId = {}; idx.c.forEach(function (c) { byId[c[0]] = c; }); }
    if (byId[r[0]]) hits[r[0]] = { c: byId[r[0]], score: 4, via: r[1] };
  });
  var list = Object.keys(hits).map(function (k) { return hits[k]; });
  list.sort(function (a, b) {
    return a.score - b.score || ((b.c[6] || 0) - (a.c[6] || 0)) || (a.c[2].toLowerCase() < b.c[2].toLowerCase() ? -1 : a.c[2].toLowerCase() > b.c[2].toLowerCase() ? 1 : 0);
  });
  return {
    totale: list.length,
    risultati: list.slice(0, limit).map(function (h) {
      return { id: h.c[0], tipo: h.c[1], nome: h.c[2], citta: h.c[3], doc: h.c[4], via: h.via, cliente: !!h.c[6] };
    })
  };
}

/** Ricerca valida: almeno 2 caratteri utili (lettere/cifre), oppure un'e-mail. */
function isSearchQueryOk_(q) {
  var s = String(q || '');
  return s.length <= 80 && (normKey_(s).replace(/ /g, '').length >= 2);
}

// ================================================================== CLIENTI: inserimento dal portale
var FORME_GIURIDICHE = ['srl', 'srls', 'spa', 'snc', 'sas', 'sapa', 'scarl', 'scrl', 'sc', 'ss', 'coop', 'onlus', 'ets',
  'ltd', 'limited', 'llc', 'llp', 'inc', 'corp', 'gmbh', 'ag', 'sa', 'sarl', 'sas', 'bv', 'nv', 'plc', 'societa', 'company', 'co'];

/** Nome confrontabile per i doppioni: chiave normalizzata senza forme giuridiche (S.r.l., SpA…). */
function normName_(v) {
  // sigle puntate: "s r l" → "srl", "s s" → "ss" (sequenze di lettere singole unite)
  var words = [], run = '';
  normKey_(v).split(' ').forEach(function (w) {
    if (/^[a-z]$/.test(w)) { run += w; return; }
    if (run) { words.push(run); run = ''; }
    words.push(w);
  });
  if (run) words.push(run);
  return words.filter(function (w) { return w && FORME_GIURIDICHE.indexOf(w) < 0; }).join(' ');
}

/**
 * Validazione del modulo "Nuovo cliente" (decisione C6). Ritorna {errori: {campo: messaggio}, rec, referente}.
 * rec/referente hanno i nomi delle colonne dei fogli. Nessun accesso ai fogli: i doppioni si controllano dopo.
 */
function validateNuovoCliente_(p) {
  p = p || {};
  var e = {};
  var tipo = p.tipo === 'persona' ? 'persona' : p.tipo === 'azienda' ? 'azienda' : '';
  if (!tipo) e.tipo = 'Scegli azienda o persona fisica.';
  var rs = cleanText_(p.ragioneSociale, 200), nome = cleanText_(p.nome, 80), cognome = cleanText_(p.cognome, 80);
  if (tipo === 'azienda' && rs.length < 2) e.ragioneSociale = 'Indica la ragione sociale.';
  if (tipo === 'persona') {
    if (!nome) e.nome = 'Indica il nome.';
    if (!cognome) e.cognome = 'Indica il cognome.';
  }
  var paese = normPaese_(p.paese) || 'Italia';
  var citta = cleanText_(p.citta, 80);
  if (!citta) e.citta = 'Indica la città.';
  var pivaRaw = cleanText_(p.piva, 30), piva = normPiva_(pivaRaw);
  if (pivaRaw && !piva) e.piva = 'P.IVA non valida (11 cifre con cifra di controllo, o P.IVA UE con prefisso del paese).';
  var cfRaw = cleanText_(p.cf, 20), cf = normCf_(cfRaw);
  if (cfRaw && !cf) e.cf = 'Codice fiscale non valido.';
  var email = normalizeEmail_(p.email);
  if (email && !isValidEmail_(email)) e.email = 'E-mail non valida.';
  if (!piva && !cf && !email && !e.piva && !e.cf && !e.email) {
    e._generale = 'Indica almeno uno tra e-mail, P.IVA e codice fiscale: servono a riconoscere il cliente ed evitare doppioni.';
  }
  var tel = cleanText_(p.telefono, 40);
  if (tel && !/^[+0-9 ()./-]{5,40}$/.test(tel)) e.telefono = 'Telefono non valido (solo cifre, spazi e + ( ) . / -).';
  var cap = cleanText_(p.cap, 12);
  if (cap && paese === 'Italia' && !/^\d{5}$/.test(cap)) e.cap = 'Il CAP italiano ha 5 cifre.';
  var rec = {
    TIPO: tipo, RAGIONE_SOCIALE: tipo === 'azienda' ? rs : '', NOME: tipo === 'persona' ? nome : '',
    COGNOME: tipo === 'persona' ? cognome : '', PIVA: piva, CF: cf && cf !== piva ? cf : '', EMAIL: email, TELEFONO: tel,
    INDIRIZZO: cleanText_(p.indirizzo, 150), CAP: cap, CITTA: citta, PROVINCIA: cleanText_(p.provincia, 60), PAESE: paese,
    DOMINIO: tipo === 'azienda' && email && !e.email && !isMailProviderDomain_(email.split('@')[1]) ? email.split('@')[1] : ''
  };
  var referente = null;
  var r = p.referente || {};
  if (tipo === 'azienda' && (cleanText_(r.nome) || cleanText_(r.cognome) || cleanText_(r.email) || cleanText_(r.telefono))) {
    var vr = validateReferente_(r);
    Object.keys(vr.errori).forEach(function (k) { e['referente.' + k] = vr.errori[k]; });
    referente = vr.rec;
  }
  return { errori: e, rec: rec, referente: referente };
}

/** Validazione di un referente: nome e cognome obbligatori, e-mail e telefono facoltativi ma controllati. */
function validateReferente_(r) {
  r = r || {};
  var e = {};
  var nome = cleanText_(r.nome, 80), cognome = cleanText_(r.cognome, 80);
  if (!nome) e.nome = 'Indica il nome del referente.';
  if (!cognome) e.cognome = 'Indica il cognome del referente.';
  var email = normalizeEmail_(r.email);
  if (email && !isValidEmail_(email)) e.email = 'E-mail del referente non valida.';
  var tel = cleanText_(r.telefono, 40);
  if (tel && !/^[+0-9 ()./-]{5,40}$/.test(tel)) e.telefono = 'Telefono del referente non valido.';
  return { errori: e, rec: { NOME: nome, COGNOME: cognome, EMAIL: email, TELEFONO: tel } };
}

/** Clienti dell'indice con lo stesso nome (senza forme giuridiche) e la stessa città. */
function similarClienti_(idx, rec) {
  var nn = normName_(clienteLabel_(rec)), nc = normKey_(rec.CITTA);
  var np = rec.TIPO === 'persona' ? personKey_(rec.NOME, rec.COGNOME) : '';
  if (!nn) return [];
  return idx.c.filter(function (c) {
    if (normKey_(c[3]) !== nc) return false;
    return c[1] === 'persona' && np ? personKey_('', c[2]) === np : normName_(c[2]) === nn;
  });
}

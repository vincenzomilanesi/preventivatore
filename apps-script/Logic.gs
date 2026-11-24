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
  return Object.prototype.hasOwnProperty.call(PAESE_ALIAS, s) ? PAESE_ALIAS[s] : s;
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

/** 'aziende' | 'contatti' | '' secondo le intestazioni dell'export HubSpot. */
function detectHubspotExport_(hdr) {
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
 * Aggiorna/inserisce record HubSpot in una tabella (Clienti o Referenti). Idempotente: rieseguito sullo stesso
 * export non cambia nulla. Tocca solo le righe ORIGINE=hubspot del tipo indicato e, su quelle, solo `fields`.
 * Non cancella: le righe che non sono più nell'export sono restituite in `assenti`.
 *  existing: oggetti del foglio · incoming: record preparati · opt: {tipo, fields, prefix, nextNum, now, isTarget}
 * Ritorna {rows, nuovi, aggiornati, invariati, assenti[], nextNum}.
 */
function mergeHubspot_(existing, incoming, opt) {
  var rows = existing.map(function (o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; });
  var byKey = {};
  rows.forEach(function (o, i) {
    if (!opt.isTarget(o)) return;
    [String(o.ID_HUBSPOT || '')].concat(String(o.ID_HUBSPOT_ALTRI || '').split(';')).forEach(function (k) {
      if (k && !Object.prototype.hasOwnProperty.call(byKey, k)) byKey[k] = i;
    });
  });
  var used = {}, res = { nuovi: 0, aggiornati: 0, invariati: 0, assenti: [], nextNum: opt.nextNum };
  incoming.forEach(function (rec) {
    var keys = [rec.ID_HUBSPOT].concat(String(rec.ID_HUBSPOT_ALTRI || '').split(';')).filter(String);
    var at = -1;
    for (var i = 0; i < keys.length && at < 0; i++) {
      if (Object.prototype.hasOwnProperty.call(byKey, keys[i]) && !used[byKey[keys[i]]]) at = byKey[keys[i]];
    }
    if (at >= 0) {
      used[at] = true;
      var o = rows[at], changed = false;
      ['ID_HUBSPOT'].concat(opt.fields).forEach(function (f) {
        var v = rec[f] === undefined ? '' : String(rec[f]);
        if (String(o[f] === undefined || o[f] === null ? '' : o[f]) !== v) { o[f] = v; changed = true; }
      });
      var rt = searchText_(o);
      if (o.RICERCA !== rt) { o.RICERCA = rt; changed = true; }
      if (changed) { o.AGGIORNATO_IL = opt.now; res.aggiornati++; } else res.invariati++;
    } else {
      var n = { };
      n[opt.idCol] = opt.prefix + String(res.nextNum++).padStart(6, '0');
      ['ID_HUBSPOT'].concat(opt.fields).forEach(function (f) { n[f] = rec[f] === undefined ? '' : String(rec[f]); });
      if (opt.tipo) n.TIPO = opt.tipo;
      n.ORIGINE = 'hubspot'; n.STATO_HUBSPOT = 'sincronizzato'; n.CREATO_DA = 'import HubSpot';
      n.CREATO_IL = opt.now; n.AGGIORNATO_IL = opt.now; n.ESPORTATO_IL = '';
      n.RICERCA = searchText_(n);
      rows.push(n);
      used[rows.length - 1] = true;
      res.nuovi++;
    }
  });
  rows.forEach(function (o, i) {
    if (opt.isTarget(o) && !used[i]) res.assenti.push(String(o.ID_HUBSPOT));
  });
  res.rows = rows;
  return res;
}

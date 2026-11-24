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

/** Utente abilitato al login: presente in Utenti con ATTIVO = Sì. */
function findActiveUser_(users, email) {
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (normalizeEmail_(u.EMAIL) === email && String(u.ATTIVO).trim() === 'Sì') {
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

/** Testo sicuro per celle di export (no formule iniettate: =, +, -, @). */
function safeCell_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

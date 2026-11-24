/**
 * Passo "Cliente" (SPEC §1 passo 3): ricerca lato server e dettaglio del cliente scelto.
 * L'indice di ricerca (compatto, solo campi da mostrare) sta in CacheService a blocchi per 6 ore e si invalida
 * a ogni import o inserimento. La ricerca non viene scritta nel Log (può contenere dati personali).
 */
var CLIENTI_IDX_KEY = 'cidx_v1';
var CLIENTI_IDX_CHUNK = 40000;     // caratteri per blocco (limite CacheService: 100 KB per valore)
var CLIENTI_IDX_TTL = 21600;       // 6 ore (massimo CacheService)
var CLIENTI_SEARCH_LIMIT = 20;

function actClientiSearch_(p) {
  var q = String(p.q || '');
  if (!isSearchQueryOk_(q)) fail_('QUERY_INVALID');
  return searchIndex_(clientiIndex_(), q, CLIENTI_SEARCH_LIMIT);
}

/** Dettaglio del cliente + referenti (per la scelta "alla c.a. di"). */
function actClientiGet_(p) {
  var id = String(p.id || '');
  if (!/^CLI-\d{6}$/.test(id)) fail_('NOT_FOUND');
  var c = rowsWhere_('Clienti', 'ID_CLIENTE', id)[0];
  if (!c) fail_('NOT_FOUND');
  var refs = rowsWhere_('Referenti', 'ID_CLIENTE', id).map(function (r) {
    return { id: r.ID_REFERENTE, nome: r.NOME, cognome: r.COGNOME, email: r.EMAIL, telefono: r.TELEFONO };
  }).sort(function (a, b) { return (a.cognome + a.nome).localeCompare(b.cognome + b.nome, 'it'); });
  var out = { id: c.ID_CLIENTE, denominazione: clienteLabel_(c), referenti: refs };
  ['CLIENTE_ELIBRA', 'TIPO', 'RAGIONE_SOCIALE', 'NOME', 'COGNOME', 'PIVA', 'CF', 'EMAIL', 'TELEFONO', 'INDIRIZZO', 'CAP', 'CITTA',
    'PROVINCIA', 'PAESE', 'ORIGINE', 'STATO_HUBSPOT'].forEach(function (k) { out[k.toLowerCase()] = c[k]; });
  return out;
}

/**
 * Righe in cui la colonna vale esattamente `value`, lette una per una (TextFinder sulla sola colonna): evita di
 * leggere tutto il foglio (10.000+ righe) per aprire un cliente. Presuppone colonne nell'ordine dello schema.
 */
function rowsWhere_(name, colName, value) {
  var sh = sheet_(name);
  var hdr = REGISTRO_SCHEMA[name];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var found = sh.getRange(2, hdr.indexOf(colName) + 1, last - 1, 1).createTextFinder(String(value))
    .matchEntireCell(true).matchCase(true).findAll();
  return found.map(function (cell) {
    var v = sh.getRange(cell.getRow(), 1, 1, hdr.length).getValues()[0];
    var o = {};
    hdr.forEach(function (h, i) { o[h] = v[i] === undefined || v[i] === null ? '' : String(v[i]); });
    return o;
  });
}

/** Indice di ricerca dalla cache; se manca o è incompleto lo ricostruisce dai fogli. */
function clientiIndex_() {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(CLIENTI_IDX_KEY + '_n') || 0);
  if (n > 0) {
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(CLIENTI_IDX_KEY + '_' + i);
    var got = cache.getAll(keys);
    if (keys.every(function (k) { return got[k] !== undefined && got[k] !== null; })) {
      try { return JSON.parse(keys.map(function (k) { return got[k]; }).join('')); } catch (e) { /* ricostruisce */ }
    }
  }
  return rebuildClientiIndex_();
}

function rebuildClientiIndex_() {
  var idx = buildClientiIndex_(readTable_('Clienti'), readTable_('Referenti'));
  var s = JSON.stringify(idx);
  var put = {}, n = 0;
  for (var i = 0; i < s.length; i += CLIENTI_IDX_CHUNK) put[CLIENTI_IDX_KEY + '_' + n++] = s.slice(i, i + CLIENTI_IDX_CHUNK);
  try {
    var cache = CacheService.getScriptCache();
    cache.putAll(put, CLIENTI_IDX_TTL);
    cache.put(CLIENTI_IDX_KEY + '_n', String(n), CLIENTI_IDX_TTL);   // per ultimo: l'indice è completo
  } catch (e) { /* cache piena o non disponibile: si lavora senza */ }
  return idx;
}

/** Da chiamare dopo ogni modifica a Clienti o Referenti. */
function invalidateClientiIndex_() {
  CacheService.getScriptCache().remove(CLIENTI_IDX_KEY + '_n');
}

// ------------------------------------------------------------------ inserimento dal portale (blocco 4)
/**
 * Nuovo cliente (+ referente facoltativo per le aziende). Esiti (sempre ok:true, il portale li gestisce):
 *  {esito:'errori', errori{campo:msg}} · {esito:'duplicato', clienti[]} (stessa P.IVA, CF o e-mail: bloccante)
 *  {esito:'simile', clienti[]} (stesso nome e città: serve conferma:true) · {esito:'creato', id, referenteId}
 * Nel Log solo gli ID creati.
 */
function actClientiCreate_(p, user) {
  var v = validateNuovoCliente_(p);
  if (Object.keys(v.errori).length) return { esito: 'errori', errori: v.errori };
  var now = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd HH:mm');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var out;
  try {
    var dup = duplicatiCertiCliente_(v.rec);
    if (dup.length) return { esito: 'duplicato', clienti: dup };
    if (!p.conferma) {
      var sim = similarClienti_(clientiIndex_(), v.rec).slice(0, 10).map(indexEntryOut_);
      if (sim.length) return { esito: 'simile', clienti: sim };
    }
    var rec = v.rec;
    rec.ID_CLIENTE = nextFreeId_('Clienti', 'ID_CLIENTE', 'CLI', 'CLI-');
    stampNuovo_(rec, user, now);
    var rows = [rec], refRec = null;
    appendRows_('Clienti', rows);
    if (v.referente) {
      refRec = v.referente;
      refRec.ID_CLIENTE = rec.ID_CLIENTE;
      refRec.ID_REFERENTE = nextFreeId_('Referenti', 'ID_REFERENTE', 'REF', 'REF-');
      stampNuovo_(refRec, user, now);
      appendRows_('Referenti', [refRec]);
    }
    addToClientiIndex_(rows, refRec ? [refRec] : []);
    out = { esito: 'creato', id: rec.ID_CLIENTE, referenteId: refRec ? refRec.ID_REFERENTE : '' };
  } finally {
    lock.releaseLock();
  }
  log_('INFO', 'clienti.create', user.email, out.id + (out.referenteId ? ' + ' + out.referenteId : ''));
  return out;
}

/**
 * Nuovo referente su un cliente esistente. Doppione (bloccante) se lo stesso cliente ha già un referente con la
 * stessa e-mail o lo stesso nominativo: restituisce quello esistente.
 */
function actReferentiCreate_(p, user) {
  var idCliente = String(p.idCliente || '');
  if (!/^CLI-\d{6}$/.test(idCliente)) fail_('NOT_FOUND');
  var v = validateReferente_(p);
  if (Object.keys(v.errori).length) return { esito: 'errori', errori: v.errori };
  var now = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd HH:mm');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var out;
  try {
    if (!rowsWhere_('Clienti', 'ID_CLIENTE', idCliente).length) fail_('NOT_FOUND');
    var key = personKey_(v.rec.NOME, v.rec.COGNOME);
    var same = rowsWhere_('Referenti', 'ID_CLIENTE', idCliente).filter(function (r) {
      return (v.rec.EMAIL && normalizeEmail_(r.EMAIL) === v.rec.EMAIL) || personKey_(r.NOME, r.COGNOME) === key;
    });
    if (same.length) return { esito: 'duplicato', id: same[0].ID_REFERENTE };
    var rec = v.rec;
    rec.ID_CLIENTE = idCliente;
    rec.ID_REFERENTE = nextFreeId_('Referenti', 'ID_REFERENTE', 'REF', 'REF-');
    stampNuovo_(rec, user, now);
    appendRows_('Referenti', [rec]);
    addToClientiIndex_([], [rec]);
    out = { esito: 'creato', id: rec.ID_REFERENTE };
  } finally {
    lock.releaseLock();
  }
  log_('INFO', 'referenti.create', user.email, out.id + ' su ' + idCliente);
  return out;
}

/** Clienti (o clienti dei referenti) con la stessa P.IVA, lo stesso CF o la stessa e-mail. */
function duplicatiCertiCliente_(rec) {
  var found = {}, out = [];
  var add = function (o, motivo) {
    if (!o.ID_CLIENTE || found[o.ID_CLIENTE]) return;
    found[o.ID_CLIENTE] = true;
    out.push({ id: o.ID_CLIENTE, nome: clienteLabel_(o), citta: o.CITTA, doc: o.PIVA || o.CF, motivo: motivo });
  };
  if (rec.PIVA) rowsWhere_('Clienti', 'PIVA', rec.PIVA).forEach(function (o) { add(o, 'stessa P.IVA'); });
  if (rec.CF) {
    rowsWhere_('Clienti', 'CF', rec.CF).forEach(function (o) { add(o, 'stesso codice fiscale'); });
    if (/^\d{11}$/.test(rec.CF)) rowsWhere_('Clienti', 'PIVA', rec.CF).forEach(function (o) { add(o, 'codice fiscale = P.IVA di un cliente'); });
  }
  if (rec.EMAIL) {
    rowsWhere_('Clienti', 'EMAIL', rec.EMAIL).forEach(function (o) { add(o, 'stessa e-mail'); });
    rowsWhere_('Referenti', 'EMAIL', rec.EMAIL).forEach(function (r) {
      var c = rowsWhere_('Clienti', 'ID_CLIENTE', r.ID_CLIENTE)[0];
      if (c) add(c, 'e-mail di un suo referente');
    });
  }
  return out;
}

function stampNuovo_(rec, user, now) {
  rec.ORIGINE = 'configuratore';
  rec.STATO_HUBSPOT = 'da esportare';
  rec.CREATO_DA = user.email;
  rec.CREATO_IL = now;
  rec.AGGIORNATO_IL = now;
  rec.RICERCA = searchText_(rec);
}

/** Prossimo ID libero: contatore + verifica che non esista già (difesa da contatori non allineati). */
function nextFreeId_(sheetName, col, counterKey, prefix) {
  var n = counter_(counterKey);
  var id = prefix + String(n).padStart(6, '0');
  for (var guard = 0; guard < 1000 && rowsWhere_(sheetName, col, id).length; guard++) {
    n++;
    id = prefix + String(n).padStart(6, '0');
  }
  setCounter_(counterKey, n + 1);
  return id;
}

/** Aggiunge righe in fondo al foglio, in formato testo, senza riscrivere le esistenti. */
function appendRows_(name, objs) {
  var sh = sheet_(name);
  var hdr = REGISTRO_SCHEMA[name];
  var values = objs.map(function (o) {
    return hdr.map(function (h) {
      var s = o[h] === undefined || o[h] === null ? '' : String(o[h]);
      return s.charAt(0) === '=' ? "'" + s : s;
    });
  });
  var start = sh.getLastRow() + 1;
  if (sh.getMaxRows() < start + values.length - 1) sh.insertRowsAfter(sh.getMaxRows(), start + values.length - 1 - sh.getMaxRows());
  sh.getRange(start, 1, values.length, hdr.length).setNumberFormat('@').setValues(values);
}

/** Aggiorna l'indice in cache con le righe nuove (se l'indice non c'è, verrà ricostruito alla prossima ricerca). */
function addToClientiIndex_(clienti, referenti) {
  var cache = CacheService.getScriptCache();
  if (!Number(cache.get(CLIENTI_IDX_KEY + '_n') || 0)) return;
  var idx = clientiIndex_();
  var add = buildClientiIndex_(clienti, referenti);
  idx.c = idx.c.concat(add.c);
  idx.r = idx.r.concat(add.r);
  var s = JSON.stringify(idx);
  var put = {}, n = 0;
  for (var i = 0; i < s.length; i += CLIENTI_IDX_CHUNK) put[CLIENTI_IDX_KEY + '_' + n++] = s.slice(i, i + CLIENTI_IDX_CHUNK);
  try {
    cache.remove(CLIENTI_IDX_KEY + '_n');
    cache.putAll(put, CLIENTI_IDX_TTL);
    cache.put(CLIENTI_IDX_KEY + '_n', String(n), CLIENTI_IDX_TTL);
  } catch (e) {
    cache.remove(CLIENTI_IDX_KEY + '_n');
  }
}

function indexEntryOut_(c) {
  return { id: c[0], tipo: c[1], nome: c[2], citta: c[3], doc: c[4], cliente: !!c[6] };
}

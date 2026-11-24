/**
 * Import delle anagrafiche (decisioni C2–C9 e 24/11, SPEC §5bis/§5ter). Lo lancia un admin dal menu del foglio
 * Registro dopo aver messo UN file CSV nella cartella Drive "import_hubspot" (accetta anche gli export eLibra).
 * Ordine: 1) eLibra Persone giuridiche  2) eLibra Persone fisiche  3) HubSpot Aziende  4) HubSpot Contatti.
 * eLibra è la fonte principale: su una riga con ID_ELIBRA, HubSpot aggiunge solo dominio, telefono, e-mail.
 * Idempotente; non cancella righe (quelle non più presenti nella fonte vanno nel foglio Report_import); il file
 * importato viene spostato nel cestino di Drive.
 */
var REPORT_MAX_RIGHE = 5000;
var IMPORT_LABEL = { elibra_pg: 'eLibra – Persone giuridiche', elibra_pf: 'eLibra – Persone fisiche',
  aziende: 'HubSpot – Aziende', contatti: 'HubSpot – Contatti' };

function menuImportaHubspot() {
  var ui = SpreadsheetApp.getUi();
  var files = importFiles_();
  if (!files.length) {
    return ui.alert('Nessun file CSV nella cartella "import_hubspot" (accanto a questo foglio). ' +
      'Carica l\'export (eLibra salvato come CSV, oppure HubSpot) in quella cartella e riprova.');
  }
  if (files.length > 1) {
    return ui.alert('Nella cartella "import_hubspot" ci sono ' + files.length + ' file CSV. ' +
      'Lascia solo quello da importare e riprova. Ordine: eLibra Persone giuridiche, eLibra Persone fisiche, ' +
      'HubSpot Aziende, HubSpot Contatti.');
  }
  var file = files[0];
  var table = parseCsv_(file.getBlob().getDataAsString('UTF-8'));
  var tipo = table.length ? detectHubspotExport_(table[0]) : '';
  if (!tipo) {
    return ui.alert('Il file "' + file.getName() + '" non è un export riconosciuto (eLibra Persone giuridiche o ' +
      'fisiche, HubSpot Aziende o Contatti). Controlla di averlo salvato come CSV con la prima riga di intestazioni.');
  }
  var ok = ui.alert('Importa anagrafiche', 'File: ' + file.getName() + '\nTipo: ' + IMPORT_LABEL[tipo] + '\nRighe: ' +
    (table.length - 1) + '\n\nProcedo con l\'import?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var res = importHubspot_(table, tipo, file.getName());
  if (res.ok) {
    file.setTrashed(true);
    res.lines.push('', 'Il file è stato spostato nel cestino di Drive.');
  }
  ui.alert(res.ok ? 'Import completato' : 'Import non eseguito', res.lines.join('\n'), ui.ButtonSet.OK);
}

/** CSV presenti nella cartella import_hubspot (esclusi quelli nel cestino). */
function importFiles_() {
  var id = cfg_().IMPORT_FOLDER_ID;
  if (!id) fail_('CONFIG_ERROR');
  var it = DriveApp.getFolderById(id).getFiles();
  var out = [];
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed() && /\.csv$/i.test(f.getName())) out.push(f);
  }
  return out;
}

/** Esegue l'import di una tabella già letta. Ritorna {ok, lines[], stats}. */
function importHubspot_(table, tipo, fileName) {
  var now = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd HH:mm');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var res;
  try {
    res = { elibra_pg: importElibraPg_, elibra_pf: importElibraPf_, aziende: importAziende_,
      contatti: importContatti_ }[tipo](table, now);
    if (res.ok) {
      writeReport_(tipo, now, res.report);
      invalidateClientiIndex_();
    }
  } finally {
    lock.releaseLock();
  }
  log_(res.ok ? 'INFO' : 'WARN', 'import.' + tipo, '', fileName + ': ' + res.lines.join(' | '));
  return res;
}

var SCOPE_AZIENDA = function (o) { return o.TIPO === 'azienda'; };
var SCOPE_PERSONA = function (o) { return o.TIPO === 'persona'; };
var SCOPE_TUTTI = function () { return true; };

function importElibraPg_(table, now) {
  var p = prepareElibraPg_(table);
  if (p.error) return headerError_(p);
  var m = mergeSource_(readTable_('Clienti'), p.records, {
    idField: 'ID_ELIBRA', scope: SCOPE_AZIENDA, fields: FIELDS.ELIBRA_AZIENDA, ownerField: 'ID_ELIBRA',
    fallbackKey: function (o) { return o.PIVA ? 'piva:' + o.PIVA : ''; },
    idCol: 'ID_CLIENTE', prefix: 'CLI-', nextNum: counter_('CLI'), now: now, origine: 'elibra', tipo: 'azienda'
  });
  writeTable_('Clienti', m.rows);
  setCounter_('CLI', m.nextNum);
  var report = [];
  p.scarti.forEach(function (s) { report.push(['scartata', s.id, s.nome, s.motivo]); });
  p.avvisi.forEach(function (s) { report.push(['avviso', s.id, s.nome, s.motivo]); });
  p.doppioni.forEach(function (d) {
    report.push(['P.IVA ripetuta in eLibra', d.ids.join(', '), d.nome, 'P.IVA ' + d.piva + ': anagrafiche distinte, da verificare in eLibra']);
  });
  m.assenti.forEach(function (id) { report.push(['non più in eLibra', id, nomeDa_(m.rows, 'ID_ELIBRA', id), 'riga mantenuta']); });
  return done_(report, p, { nuovi: m.nuovi, aggiornati: m.aggiornati, invariati: m.invariati, agganciati: m.agganciati,
    assenti: m.assenti.length }, ['Aziende nel file: ' + p.righe,
    'Nuove: ' + m.nuovi + ' · aggiornate: ' + m.aggiornati + ' · invariate: ' + m.invariati +
      (m.agganciati ? ' (di cui ' + m.agganciati + ' unite a righe HubSpot per P.IVA)' : ''),
    'Scartate: ' + p.scarti.length + ' · avvisi: ' + p.avvisi.length + ' · P.IVA ripetute in eLibra: ' + p.doppioni.length,
    'Non più presenti in eLibra (mantenute): ' + m.assenti.length]);
}

function importElibraPf_(table, now) {
  var clienti = readTable_('Clienti');
  var pgIdx = {};
  clienti.forEach(function (o) {
    if (o.TIPO !== 'azienda' || !o.ID_ELIBRA) return;
    var k = normKey_(o.RAGIONE_SOCIALE);
    if (k) (pgIdx[k] = pgIdx[k] || []).push(o.ID_CLIENTE);
  });
  if (!Object.keys(pgIdx).length) {
    return { ok: false, lines: ['Il foglio Clienti non contiene aziende eLibra: importare prima eLibra Persone giuridiche.'] };
  }
  var p = prepareElibraPf_(table, pgIdx);
  if (p.error) return headerError_(p);
  var mp = mergeSource_(clienti, p.persone, {
    idField: 'ID_ELIBRA', scope: SCOPE_PERSONA, fields: FIELDS.ELIBRA_PERSONA, ownerField: 'ID_ELIBRA',
    fallbackKey: function (o) { return o.CF ? 'cf:' + o.CF : ''; },
    idCol: 'ID_CLIENTE', prefix: 'CLI-', nextNum: counter_('CLI'), now: now, origine: 'elibra', tipo: 'persona'
  });
  var mr = mergeSource_(readTable_('Referenti'), p.referenti, {
    idField: 'ID_ELIBRA', scope: SCOPE_TUTTI, fields: FIELDS.ELIBRA_REFERENTE, ownerField: 'ID_ELIBRA',
    fallbackKey: refKey_, idCol: 'ID_REFERENTE', prefix: 'REF-', nextNum: counter_('REF'), now: now, origine: 'elibra'
  });
  writeTable_('Clienti', mp.rows);
  writeTable_('Referenti', mr.rows);
  setCounter_('CLI', mp.nextNum);
  setCounter_('REF', mr.nextNum);
  var report = countReport_(p);
  mr.assenti.forEach(function (id) { report.push(['referente non più in eLibra', id, '', 'riga mantenuta']); });
  mp.assenti.forEach(function (id) { report.push(['persona non più in eLibra', id, '', 'riga mantenuta']); });
  return done_(report, p, { personeNuove: mp.nuovi, personeAggiornate: mp.aggiornati, personeInvariate: mp.invariati,
    referentiNuovi: mr.nuovi, referentiAggiornati: mr.aggiornati, referentiInvariati: mr.invariati,
    personeAssenti: mp.assenti.length, referentiAssenti: mr.assenti.length }, ['Persone nel file: ' + p.righe,
    'Clienti persona fisica: nuovi ' + mp.nuovi + ' · aggiornati ' + mp.aggiornati + ' · invariati ' + mp.invariati,
    'Referenti di aziende: nuovi ' + mr.nuovi + ' · aggiornati ' + mr.aggiornati + ' · invariati ' + mr.invariati,
    'Non importate: ' + p.scarti.length + ' · avvisi: ' + p.avvisi.length,
    'Non più presenti in eLibra (mantenuti): persone ' + mp.assenti.length + ', referenti ' + mr.assenti.length]);
}

function importAziende_(table, now) {
  var p = prepareAziende_(table);
  if (p.error) return headerError_(p);
  var m = mergeSource_(readTable_('Clienti'), p.records, {
    idField: 'ID_HUBSPOT', altField: 'ID_HUBSPOT_ALTRI', scope: SCOPE_AZIENDA, fields: FIELDS.HUBSPOT_AZIENDA,
    fieldsOnOwned: FIELDS.HUBSPOT_AZIENDA_SU_ELIBRA, ownerField: 'ID_ELIBRA', onMatch: { STATO_HUBSPOT: 'sincronizzato' },
    newDefaults: { STATO_HUBSPOT: 'sincronizzato' }, fallbackKey: function (o) { return o.PIVA ? 'piva:' + o.PIVA : ''; },
    idCol: 'ID_CLIENTE', prefix: 'CLI-', nextNum: counter_('CLI'), now: now, origine: 'hubspot', tipo: 'azienda'
  });
  writeTable_('Clienti', m.rows);
  setCounter_('CLI', m.nextNum);
  var report = [];
  p.scarti.forEach(function (s) { report.push(['scartata', s.id, s.nome, s.motivo]); });
  p.avvisi.forEach(function (s) { report.push(['avviso', s.id, s.nome, s.motivo]); });
  p.doppioni.forEach(function (d) {
    report.push(['doppione P.IVA', d.tenuto, d.nome, 'P.IVA ' + d.piva + ': tenuto ' + d.tenuto + ', da unire in HubSpot: ' +
      d.uniti.join(', ')]);
  });
  m.assenti.forEach(function (id) { report.push(['non più in HubSpot', id, nomeDa_(m.rows, 'ID_HUBSPOT', id), 'riga mantenuta']); });
  return done_(report, p, { nuovi: m.nuovi, aggiornati: m.aggiornati, invariati: m.invariati, agganciati: m.agganciati,
    doppioni: p.doppioni.length, assenti: m.assenti.length }, ['Aziende nel file: ' + p.righe,
    'Nuove: ' + m.nuovi + ' · aggiornate: ' + m.aggiornati + ' · invariate: ' + m.invariati +
      (m.agganciati ? ' (di cui ' + m.agganciati + ' unite a clienti eLibra per P.IVA)' : ''),
    'Scartate: ' + p.scarti.length + ' · avvisi: ' + p.avvisi.length,
    'P.IVA doppie (unite): ' + p.doppioni.length + ' gruppi',
    'Non più presenti in HubSpot (mantenute): ' + m.assenti.length]);
}

function importContatti_(table, now) {
  var clienti = readTable_('Clienti');
  var aziendaIdx = {};
  clienti.forEach(function (o) {
    if (o.TIPO !== 'azienda' || !o.ID_CLIENTE || !o.ID_HUBSPOT) return;
    [String(o.ID_HUBSPOT)].concat(String(o.ID_HUBSPOT_ALTRI || '').split(';')).forEach(function (k) {
      if (k) aziendaIdx[k] = o.ID_CLIENTE;
    });
  });
  if (!Object.keys(aziendaIdx).length) {
    return { ok: false, lines: ['Il foglio Clienti non contiene aziende HubSpot: importare prima l\'export Aziende di HubSpot.'] };
  }
  var p = prepareContatti_(table, aziendaIdx);
  if (p.error) return headerError_(p);
  var mp = mergeSource_(clienti, p.persone, {
    idField: 'ID_HUBSPOT', scope: SCOPE_PERSONA, fields: FIELDS.HUBSPOT_PERSONA, fieldsOnOwned: FIELDS.HUBSPOT_PERSONA_SU_ELIBRA,
    ownerField: 'ID_ELIBRA', onMatch: { STATO_HUBSPOT: 'sincronizzato' }, newDefaults: { STATO_HUBSPOT: 'sincronizzato' },
    fallbackKey: function (o) { return o.CF ? 'cf:' + o.CF : ''; },
    idCol: 'ID_CLIENTE', prefix: 'CLI-', nextNum: counter_('CLI'), now: now, origine: 'hubspot', tipo: 'persona'
  });
  var mr = mergeSource_(readTable_('Referenti'), p.referenti, {
    idField: 'ID_HUBSPOT', scope: SCOPE_TUTTI, fields: FIELDS.HUBSPOT_REFERENTE, fieldsOnOwned: FIELDS.HUBSPOT_REFERENTE_SU_ELIBRA,
    ownerField: 'ID_ELIBRA', onMatch: { STATO_HUBSPOT: 'sincronizzato' }, newDefaults: { STATO_HUBSPOT: 'sincronizzato' },
    fallbackKey: refKey_, idCol: 'ID_REFERENTE', prefix: 'REF-', nextNum: counter_('REF'), now: now, origine: 'hubspot'
  });
  writeTable_('Clienti', mp.rows);
  writeTable_('Referenti', mr.rows);
  setCounter_('CLI', mp.nextNum);
  setCounter_('REF', mr.nextNum);
  var report = countReport_(p);
  mr.assenti.forEach(function (id) { report.push(['referente non più in HubSpot', id, '', 'riga mantenuta']); });
  mp.assenti.forEach(function (id) { report.push(['persona non più in HubSpot', id, '', 'riga mantenuta']); });
  return done_(report, p, { referentiNuovi: mr.nuovi, referentiAggiornati: mr.aggiornati, referentiInvariati: mr.invariati,
    referentiAgganciati: mr.agganciati, personeNuove: mp.nuovi, personeAggiornate: mp.aggiornati,
    personeInvariate: mp.invariati, referentiAssenti: mr.assenti.length, personeAssenti: mp.assenti.length },
    ['Contatti nel file: ' + p.righe,
      'Referenti (contatti di aziende): nuovi ' + mr.nuovi + ' · aggiornati ' + mr.aggiornati + ' · invariati ' + mr.invariati +
        (mr.agganciati ? ' (di cui ' + mr.agganciati + ' uniti a referenti eLibra per nome)' : ''),
      'Clienti persona fisica (fase oltre Lead): nuovi ' + mp.nuovi + ' · aggiornati ' + mp.aggiornati + ' · invariati ' +
        mp.invariati,
      'Non importati: ' + p.scarti.length + ' · avvisi: ' + p.avvisi.length,
      'Non più presenti in HubSpot (mantenuti): referenti ' + mr.assenti.length + ', persone ' + mp.assenti.length]);
}

/** Aggancio di riserva dei referenti: stessa azienda + stesso nominativo (in qualunque ordine). */
function refKey_(o) {
  var k = personKey_(o.NOME, o.COGNOME);
  return o.ID_CLIENTE && k ? o.ID_CLIENTE + '|' + k : '';
}

/** Report delle persone: scarti contati per motivo, avvisi per ID, nessun nome (minimizzazione). */
function countReport_(p) {
  var report = [], perMotivo = {};
  p.scarti.forEach(function (s) { perMotivo[s.motivo] = (perMotivo[s.motivo] || 0) + 1; });
  Object.keys(perMotivo).forEach(function (k) { report.push(['non importati', '', '', perMotivo[k] + ': ' + k]); });
  p.avvisi.forEach(function (s) { report.push(['avviso', s.id, '', s.motivo]); });
  return report;
}

function done_(report, p, stats, lines) {
  stats.righe = p.righe;
  stats.scarti = p.scarti.length;
  stats.avvisi = p.avvisi.length;
  return { ok: true, report: report, stats: stats,
    lines: lines.concat(p.colonneAssenti.length ? ['Colonne non trovate nel file: ' + p.colonneAssenti.join(', ')] : [])
      .concat(['Dettaglio nel foglio Report_import.']) };
}

function headerError_(p) {
  return { ok: false, lines: ['Colonne obbligatorie mancanti nel file: ' + p.mancanti.join(', '),
    'Rifare l\'export con le colonne indicate nella SPEC §5bis/§5ter.'] };
}

function nomeDa_(rows, field, id) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][field]) === id) return rows[i].RAGIONE_SOCIALE || '';
  return '';
}

/** Report dell'ultimo import per tipo: le righe dell'altro tipo restano. */
function writeReport_(tipo, now, report) {
  var keep = readTable_('Report_import').filter(function (o) { return o.IMPORT !== tipo; });
  var add = report.slice(0, REPORT_MAX_RIGHE).map(function (r) {
    return { TS: now, IMPORT: tipo, ESITO: r[0], ID_HUBSPOT: r[1], NOME: r[2], DETTAGLIO: r[3] };
  });
  if (report.length > REPORT_MAX_RIGHE) {
    add.push({ TS: now, IMPORT: tipo, ESITO: 'troncato', ID_HUBSPOT: '', NOME: '',
      DETTAGLIO: 'altre ' + (report.length - REPORT_MAX_RIGHE) + ' righe non mostrate' });
  }
  writeTable_('Report_import', keep.concat(add));
}

// ------------------------------------------------------------------ lettura/scrittura fogli
/** Righe del foglio come oggetti con tutte le colonne dello schema (valori sempre stringa). */
function readTable_(name) {
  var hdr = REGISTRO_SCHEMA[name];
  return rowsToObjects_(sheet_(name).getDataRange().getValues()).map(function (o) {
    var r = {};
    hdr.forEach(function (h) { r[h] = o[h] === undefined || o[h] === null ? '' : String(o[h]); });
    return r;
  });
}

/** Riscrive tutte le righe dati del foglio (intestazione esclusa) in formato testo. */
function writeTable_(name, objs) {
  var sh = sheet_(name);
  var hdr = REGISTRO_SCHEMA[name];
  var values = objs.map(function (o) {
    return hdr.map(function (h) {
      var s = o[h] === undefined || o[h] === null ? '' : String(o[h]);
      return s.charAt(0) === '=' ? "'" + s : s;   // il formato testo non basta contro le formule
    });
  });
  var old = Math.max(sh.getLastRow() - 1, 0);
  var need = values.length + 1;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (old > 0) sh.getRange(2, 1, old, hdr.length).clearContent();
  if (values.length) {
    var rng = sh.getRange(2, 1, values.length, hdr.length);
    if (TEXT_SHEETS.indexOf(name) >= 0) rng.setNumberFormat('@');
    rng.setValues(values);
  }
}

/** Prossimo numero libero del contatore (1 se non esiste). */
function counter_(key) {
  var rows = readTable_('Contatori');
  for (var i = 0; i < rows.length; i++) if (rows[i].CHIAVE === key) return Number(rows[i].VALORE) + 1 || 1;
  return 1;
}

/** Salva l'ultimo numero usato (nextNum - 1). */
function setCounter_(key, nextNum) {
  var rows = readTable_('Contatori');
  var found = false;
  rows.forEach(function (r) { if (r.CHIAVE === key) { r.VALORE = String(nextNum - 1); found = true; } });
  if (!found) rows.push({ CHIAVE: key, VALORE: String(nextNum - 1) });
  writeTable_('Contatori', rows);
}

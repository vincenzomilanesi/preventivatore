/**
 * Import da HubSpot (decisioni C2–C9, SPEC §5bis). Lo lancia un admin (Comunicazione/Marketing) dal menu del
 * foglio Registro dopo aver messo l'export CSV nella cartella Drive "import_hubspot".
 *  1. prima l'export Aziende → foglio Clienti (TIPO azienda);
 *  2. poi l'export Contatti → foglio Referenti (contatti delle aziende) + Clienti (TIPO persona, fase oltre Lead).
 * Idempotente: rilanciato sullo stesso file non cambia nulla. Non cancella righe: quelle non più presenti in
 * HubSpot sono elencate nel foglio Report_import. Il file importato viene spostato nel cestino di Drive
 * (minimizzazione: l'export resta solo in HubSpot).
 */
var CLIENTI_FIELDS_AZIENDA = ['ID_HUBSPOT_ALTRI', 'RAGIONE_SOCIALE', 'PIVA', 'TELEFONO', 'INDIRIZZO', 'CAP', 'CITTA',
  'PROVINCIA', 'PAESE', 'DOMINIO'];
var CLIENTI_FIELDS_PERSONA = ['NOME', 'COGNOME', 'EMAIL', 'TELEFONO', 'CF'];
var REFERENTI_FIELDS = ['ID_CLIENTE', 'NOME', 'COGNOME', 'EMAIL', 'TELEFONO'];
var REPORT_MAX_RIGHE = 5000;

function menuImportaHubspot() {
  var ui = SpreadsheetApp.getUi();
  var files = importFiles_();
  if (!files.length) {
    return ui.alert('Nessun file CSV nella cartella "import_hubspot" (accanto a questo foglio). ' +
      'Esporta da HubSpot, carica il file in quella cartella e riprova.');
  }
  if (files.length > 1) {
    return ui.alert('Nella cartella "import_hubspot" ci sono ' + files.length + ' file CSV. ' +
      'Lascia solo quello da importare (prima Aziende, poi Contatti) e riprova.');
  }
  var file = files[0];
  var table = parseCsv_(file.getBlob().getDataAsString('UTF-8'));
  var tipo = table.length ? detectHubspotExport_(table[0]) : '';
  if (!tipo) {
    return ui.alert('Il file "' + file.getName() + '" non sembra un export Aziende o Contatti di HubSpot ' +
      '(mancano le colonne ID record / Nome azienda oppure Nome / Cognome / E-mail).');
  }
  var ok = ui.alert('Importa da HubSpot', 'File: ' + file.getName() + '\nTipo: ' + tipo + '\nRighe: ' +
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
    res = tipo === 'aziende' ? importAziende_(table, now) : importContatti_(table, now);
    if (res.ok) writeReport_(tipo, now, res.report);
  } finally {
    lock.releaseLock();
  }
  log_(res.ok ? 'INFO' : 'WARN', 'import.' + tipo, '', fileName + ': ' + res.lines.join(' | '));
  return res;
}

function importAziende_(table, now) {
  var p = prepareAziende_(table);
  if (p.error) return headerError_(p);
  var clienti = readTable_('Clienti');
  var m = mergeHubspot_(clienti, p.records, {
    idCol: 'ID_CLIENTE', prefix: 'CLI-', tipo: 'azienda', fields: CLIENTI_FIELDS_AZIENDA, now: now,
    nextNum: counter_('CLI'), isTarget: function (o) { return o.ORIGINE === 'hubspot' && o.TIPO === 'azienda'; }
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
  m.assenti.forEach(function (id) { report.push(['non più in HubSpot', id, nomeCliente_(m.rows, id), 'riga mantenuta']); });
  return {
    ok: true, report: report,
    stats: { righe: p.righe, nuovi: m.nuovi, aggiornati: m.aggiornati, invariati: m.invariati, scarti: p.scarti.length,
      avvisi: p.avvisi.length, doppioni: p.doppioni.length, assenti: m.assenti.length },
    lines: ['Aziende nel file: ' + p.righe,
      'Nuove: ' + m.nuovi + ' · aggiornate: ' + m.aggiornati + ' · invariate: ' + m.invariati,
      'Scartate: ' + p.scarti.length + ' · avvisi: ' + p.avvisi.length,
      'P.IVA doppie (unite): ' + p.doppioni.length + ' gruppi',
      'Non più presenti in HubSpot (mantenute): ' + m.assenti.length]
      .concat(p.colonneAssenti.length ? ['Colonne non trovate nel file: ' + p.colonneAssenti.join(', ')] : [])
      .concat(['Dettaglio nel foglio Report_import.'])
  };
}

function importContatti_(table, now) {
  var clienti = readTable_('Clienti');
  var aziendaIdx = {};
  clienti.forEach(function (o) {
    if (o.TIPO !== 'azienda' || !o.ID_CLIENTE) return;
    [String(o.ID_HUBSPOT || '')].concat(String(o.ID_HUBSPOT_ALTRI || '').split(';')).forEach(function (k) {
      if (k) aziendaIdx[k] = o.ID_CLIENTE;
    });
  });
  if (!Object.keys(aziendaIdx).length) {
    return { ok: false, lines: ['Il foglio Clienti non contiene aziende: importare prima l\'export Aziende.'] };
  }
  var p = prepareContatti_(table, aziendaIdx);
  if (p.error) return headerError_(p);
  var mp = mergeHubspot_(clienti, p.persone, {
    idCol: 'ID_CLIENTE', prefix: 'CLI-', tipo: 'persona', fields: CLIENTI_FIELDS_PERSONA, now: now,
    nextNum: counter_('CLI'), isTarget: function (o) { return o.ORIGINE === 'hubspot' && o.TIPO === 'persona'; }
  });
  var mr = mergeHubspot_(readTable_('Referenti'), p.referenti, {
    idCol: 'ID_REFERENTE', prefix: 'REF-', tipo: '', fields: REFERENTI_FIELDS, now: now,
    nextNum: counter_('REF'), isTarget: function (o) { return o.ORIGINE === 'hubspot'; }
  });
  writeTable_('Clienti', mp.rows);
  writeTable_('Referenti', mr.rows);
  setCounter_('CLI', mp.nextNum);
  setCounter_('REF', mr.nextNum);
  // Report senza nomi delle persone (minimizzazione): scarti contati per motivo, avvisi e assenti per ID
  var report = [], perMotivo = {};
  p.scarti.forEach(function (s) { perMotivo[s.motivo] = (perMotivo[s.motivo] || 0) + 1; });
  Object.keys(perMotivo).forEach(function (k) { report.push(['scartati', '', '', perMotivo[k] + ' contatti: ' + k]); });
  p.avvisi.forEach(function (s) { report.push(['avviso', s.id, '', s.motivo]); });
  mr.assenti.forEach(function (id) { report.push(['referente non più in HubSpot', id, '', 'riga mantenuta']); });
  mp.assenti.forEach(function (id) { report.push(['persona non più in HubSpot', id, '', 'riga mantenuta']); });
  return {
    ok: true, report: report,
    stats: { righe: p.righe, referentiNuovi: mr.nuovi, referentiAggiornati: mr.aggiornati, referentiInvariati: mr.invariati,
      personeNuove: mp.nuovi, personeAggiornate: mp.aggiornati, personeInvariate: mp.invariati, scarti: p.scarti.length,
      avvisi: p.avvisi.length, referentiAssenti: mr.assenti.length, personeAssenti: mp.assenti.length },
    lines: ['Contatti nel file: ' + p.righe,
      'Referenti (contatti di aziende): nuovi ' + mr.nuovi + ' · aggiornati ' + mr.aggiornati + ' · invariati ' + mr.invariati,
      'Clienti persona fisica (fase oltre Lead): nuovi ' + mp.nuovi + ' · aggiornati ' + mp.aggiornati + ' · invariati ' +
        mp.invariati,
      'Non importati: ' + p.scarti.length + ' · avvisi: ' + p.avvisi.length,
      'Non più presenti in HubSpot (mantenuti): referenti ' + mr.assenti.length + ', persone ' + mp.assenti.length]
      .concat(p.colonneAssenti.length ? ['Colonne non trovate nel file: ' + p.colonneAssenti.join(', ')] : [])
      .concat(['Dettaglio nel foglio Report_import.'])
  };
}

function headerError_(p) {
  return { ok: false, lines: ['Colonne obbligatorie mancanti nel file: ' + p.mancanti.join(', '),
    'Rifare l\'export da HubSpot con le colonne indicate nella SPEC §5bis.'] };
}

function nomeCliente_(rows, idHs) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i].ID_HUBSPOT) === idHs) return rows[i].RAGIONE_SOCIALE || '';
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

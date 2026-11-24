/**
 * Menu nel foglio Registro: inizializzazione della struttura, verifica configurazione, cache, dati di prova.
 * Le funzioni di setup NON sovrascrivono mai dati esistenti: creano ciò che manca e segnalano le differenze.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Preventivatore')
    .addItem('Inizializza / verifica struttura', 'menuSetup')
    .addItem('Verifica configurazione', 'menuVerifica')
    .addItem('Svuota cache', 'menuSvuotaCache')
    .addItem('Sblocca utente (limite codici OTP)', 'menuSbloccaUtente')
    .addSeparator()
    .addItem('Dati di prova (utente test)', 'menuDatiProva')
    .addToUi();
}

function menuSetup() {
  var report = setupStructure_();
  SpreadsheetApp.getUi().alert('Struttura', report.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuVerifica() {
  var r = verifyConfig_();
  SpreadsheetApp.getUi().alert(r.ok ? 'Configurazione OK' : 'Configurazione da completare', r.lines.join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuSvuotaCache() {
  CacheService.getScriptCache().remove('users_v1');
  SpreadsheetApp.getUi().alert('Cache utenti svuotata.');
}

/**
 * Trigger semplice: ogni modifica manuale al foglio Utenti svuota la cache utenti, così attivazioni,
 * disattivazioni e cambi di profilo valgono subito (senza attendere i 5 minuti).
 * Non scatta per eliminazione di righe/colonne né per modifiche fatte da script: in quei casi
 * usare il menu "Svuota cache" (per togliere un accesso, meglio ATTIVO = No che cancellare la riga).
 */
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === 'Utenti') {
      CacheService.getScriptCache().remove('users_v1');
    }
  } catch (err) { /* un trigger semplice non deve mai mostrare errori all'utente */ }
}

function menuSbloccaUtente() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Sblocca utente', 'E-mail dell\'utente da sbloccare (azzera il limite di richieste del codice ' +
    'e l\'eventuale codice bloccato dai tentativi errati):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var email = normalizeEmail_(r.getResponseText());
  if (!isValidEmail_(email)) return ui.alert('E-mail non valida.');
  unlockUser_(email);
  ui.alert('Sbloccato ' + email + ': può richiedere subito un nuovo codice.');
}

/** Rimuove dalla cache limite richieste e OTP in corso dell'utente, svuota la cache utenti, scrive nel Log. */
function unlockUser_(email) {
  var cache = CacheService.getScriptCache();
  unlockCacheKeys_(email).forEach(function (k) { cache.remove(k); });
  cache.remove('users_v1');
  log_('INFO', 'admin.sbloccaUtente', email, 'sbloccato dal menu');
}

function menuDatiProva() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Utente di prova', 'E-mail (deve essere di un dominio in ALLOWED_DOMAINS):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var email = normalizeEmail_(r.getResponseText());
  if (!isValidEmail_(email)) return ui.alert('E-mail non valida.');
  sheet_('Utenti').appendRow([email, 'Utente', 'Prova', 'CL', 'Senior', 'admin', 'Sì']);
  CacheService.getScriptCache().remove('users_v1');
  ui.alert('Aggiunto ' + email + ' (admin). Ricordarsi di disattivarlo (ATTIVO = No) a fine collaudo.');
}

/** Crea fogli/intestazioni mancanti, cartella Preventivi, parametri e segreto proxy. Ritorna righe di report. */
function setupStructure_() {
  var ss = SpreadsheetApp.getActive();
  var out = [];
  Object.keys(REGISTRO_SCHEMA).forEach(function (name) {
    var hdr = REGISTRO_SCHEMA[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
      sh.setFrozenRows(1);
      out.push('+ creato foglio ' + name);
    } else {
      var d = diffHeaders_(sh.getRange(1, 1, 1, hdr.length).getValues()[0], hdr);
      out.push(d.length ? '⚠ ' + name + ': ' + d.join('; ') : '✔ ' + name);
    }
  });
  var par = sheet_('Parametri');
  var have = rowsToObjects_(par.getDataRange().getValues()).map(function (r) { return r.CHIAVE; });
  PARAMETRI_DEFAULT.forEach(function (r) {
    if (have.indexOf(r[0]) < 0) { par.appendRow(r); out.push('+ parametro ' + r[0]); }
  });
  var cnt = sheet_('Contatori');
  var key = 'PRV-' + new Date().getFullYear();
  if (rowsToObjects_(cnt.getDataRange().getValues()).every(function (r) { return r.CHIAVE !== key; })) {
    cnt.appendRow([key, 0]);
    out.push('+ contatore ' + key);
  }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PROXY_SECRET')) {
    props.setProperty('PROXY_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
    out.push('+ PROXY_SECRET generato: copiarlo in Cloudflare (Proprietà script > PROXY_SECRET)');
  }
  if (!props.getProperty('PREVENTIVI_FOLDER_ID')) {
    var parent = DriveApp.getFileById(ss.getId()).getParents();
    var folder = parent.hasNext() ? parent.next().createFolder('Preventivi') : DriveApp.createFolder('Preventivi');
    props.setProperty('PREVENTIVI_FOLDER_ID', folder.getId());
    out.push('+ cartella Drive "Preventivi" creata');
  }
  out.push(applyUtentiValidation_(sheet_('Utenti')));
  ['ALLOWED_DOMAINS', 'DB_CATALOGO_ID'].forEach(function (k) {
    if (!props.getProperty(k)) out.push('⚠ manca la proprietà script ' + k + ' (da impostare a mano)');
  });
  return out;
}

/**
 * Tendine sul foglio Utenti (DIP, RUOLO, PROFILO, ATTIVO), righe 2..USERS_VALIDATION_ROWS+1.
 * Idempotente: riapplica le regole a ogni "Inizializza / verifica struttura". Non modifica i valori già presenti
 * (un valore fuori lista resta e viene segnalato dal triangolo rosso del foglio).
 */
function applyUtentiValidation_(sh) {
  var hdr = REGISTRO_SCHEMA.Utenti;
  var dip = catalogoLista_('DIP');
  var fonteDip = dip.length ? 'DB_Catalogo' : 'elenco di riserva';
  if (!dip.length) dip = USERS_DIP_FALLBACK;
  Object.keys(USERS_VALIDATION).forEach(function (col) {
    var spec = USERS_VALIDATION[col];
    var values = col === 'DIP' ? dip : spec.values;
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true)
      .setAllowInvalid(!spec.strict)
      .setHelpText('Valori ammessi: ' + values.join(', ')).build();
    sh.getRange(2, hdr.indexOf(col) + 1, USERS_VALIDATION_ROWS, 1).setDataValidation(rule);
  });
  return '✔ tendine Utenti (DIP da ' + fonteDip + ': ' + dip.length + ' codici)';
}

/** Valori di una colonna del foglio _LISTE di DB_Catalogo (per intestazione), [] se non raggiungibile. */
function catalogoLista_(header) {
  try {
    var v = SpreadsheetApp.openById(cfg_().DB_CATALOGO_ID).getSheetByName('_LISTE').getDataRange().getValues();
    var j = v[0].map(String).indexOf(header);
    if (j < 0) return [];
    var out = [];
    for (var i = 1; i < v.length; i++) {
      var s = String(v[i][j] === null ? '' : v[i][j]).trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  } catch (e) {
    return [];
  }
}

/** Controlli di configurazione senza modifiche. */
function verifyConfig_() {
  var c = cfg_();
  var lines = [], ok = true;
  function chk(cond, okMsg, koMsg) { lines.push((cond ? '✔ ' : '✖ ') + (cond ? okMsg : koMsg)); ok = ok && cond; }
  chk(!!c.PROXY_SECRET, 'PROXY_SECRET presente', 'PROXY_SECRET mancante: eseguire Inizializza struttura');
  chk(c.ALLOWED_DOMAINS.length > 0, 'Domini ammessi: ' + c.ALLOWED_DOMAINS.join(', '), 'ALLOWED_DOMAINS vuoto');
  var ss = SpreadsheetApp.getActive();
  Object.keys(REGISTRO_SCHEMA).forEach(function (n) { chk(!!ss.getSheetByName(n), 'foglio ' + n, 'manca foglio ' + n); });
  try {
    var db = SpreadsheetApp.openById(c.DB_CATALOGO_ID);
    DB_CATALOGO_SHEETS.forEach(function (n) { chk(!!db.getSheetByName(n), 'DB_Catalogo: ' + n, 'DB_Catalogo: manca ' + n); });
  } catch (e) {
    chk(false, '', 'DB_CATALOGO_ID non valido o non accessibile');
  }
  try {
    DriveApp.getFolderById(c.PREVENTIVI_FOLDER_ID);
    chk(true, 'Cartella Preventivi accessibile', '');
  } catch (e) {
    chk(false, '', 'PREVENTIVI_FOLDER_ID non valido');
  }
  var users = rowsToObjects_(sheet_('Utenti').getDataRange().getValues())
    .filter(function (u) { return isYes_(u.ATTIVO); });
  chk(users.length > 0, 'Utenti attivi: ' + users.length, 'Nessun utente attivo in Utenti');
  lines.push('ℹ Quota mail residua oggi: ' + MailApp.getRemainingDailyQuota());
  return { ok: ok, lines: lines };
}

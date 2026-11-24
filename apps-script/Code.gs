/**
 * Router delle azioni. Unico punto di ingresso: doPost, chiamato SOLO dalla Pages Function Cloudflare
 * (functions/api/gas.js), che aggiunge il PROXY_SECRET. Risposte sempre {ok:true,data} | {ok:false,error:'CODICE'}.
 *
 * Per aggiungere un'azione: una riga in routes_() + la funzione handler. auth:true = serve sessione valida,
 * admin:true = serve PROFILO admin.
 */
// Funzione e non variabile globale: gli handler stanno in altri file .gs e l'ordine di caricamento
// dei file non è garantito; così la tabella si costruisce quando tutti i file sono già valutati.
function routes_() {
  return {
    'ping':            { fn: actPing_ },
    'auth.requestOtp': { fn: actRequestOtp_ },
    'auth.verifyOtp':  { fn: actVerifyOtp_ },
    'auth.me':         { fn: actMe_, auth: true },
    'auth.logout':     { fn: actLogout_, auth: true },
    'app.bootstrap':   { fn: actBootstrap_, auth: true },
    'clienti.search':  { fn: actClientiSearch_, auth: true },
    'clienti.get':     { fn: actClientiGet_, auth: true }
  };
}

function doPost(e) {
  var req, user = null;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_REQUEST' });
  }
  if (!req || typeof req !== 'object' || typeof req.action !== 'string') return json_({ ok: false, error: 'BAD_REQUEST' });
  var c = cfg_();
  if (!c.PROXY_SECRET || req.proxySecret !== c.PROXY_SECRET) return json_({ ok: false, error: 'FORBIDDEN' });
  var routes = routes_();
  var route = Object.prototype.hasOwnProperty.call(routes, req.action) ? routes[req.action] : null;
  if (!route) return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  try {
    if (route.auth) {
      user = sessionUser_(req.token);
      if (!user) return json_({ ok: false, error: 'SESSION_EXPIRED' });
      if (route.admin && user.profilo !== 'admin') return json_({ ok: false, error: 'FORBIDDEN' });
    }
    var data = route.fn(req.payload || {}, user, req);
    return json_({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code });
    log_('ERROR', req.action, user ? user.email : '', String(err && err.stack || err));
    return json_({ ok: false, error: 'SERVER_ERROR' });
  }
}

/** Health check senza segreto: non espone dati. Utile per verificare il deploy dal browser. */
function doGet() {
  return json_({ ok: true, data: { app: 'preventivatore', version: APP_VERSION } });
}

// ------------------------------------------------------------------ azioni
function actPing_() {
  return { version: APP_VERSION, ts: new Date().toISOString(), versioneCatalogo: param_('versione_catalogo') };
}

function actMe_(p, user) {
  return user;
}

function actBootstrap_(p, user) {
  // Portale "in bianco": per ora solo utente e versioni. Qui arriveranno pillar, parametri, ecc.
  return { user: user, version: APP_VERSION, versioneCatalogo: param_('versione_catalogo') };
}

// ------------------------------------------------------------------ helper
function fail_(code) {
  var e = new Error(code);
  e.code = code;
  throw e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) fail_('CONFIG_ERROR');
  return sh;
}

function param_(key) {
  var rows = rowsToObjects_(sheet_('Parametri').getDataRange().getValues());
  for (var i = 0; i < rows.length; i++) if (rows[i].CHIAVE === key) return String(rows[i].VALORE);
  return '';
}

function log_(level, action, email, detail) {
  try {
    var lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      sheet_('Log').appendRow([new Date(), level, safeCell_(action), safeCell_(email), safeCell_(String(detail)
        .slice(0, 2000))]);
    } finally {
      lock.releaseLock();
    }
  } catch (e) { /* il log non deve mai rompere una richiesta */ }
}

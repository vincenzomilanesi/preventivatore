/**
 * Login con codice OTP via e-mail (dominio dello Studio), sessione in CacheService.
 * - Nessuna enumerazione: requestOtp risponde sempre {sent:true} se l'e-mail è formalmente valida e del dominio
 *   ammesso, anche se l'utente non esiste o è disattivo (in quel caso non parte nessuna mail; resta il log).
 * - OTP salvato solo come hash, max 5 tentativi, max 3 richieste ogni 15 minuti per e-mail.
 * - Sessione: token casuale, scadenza scorrevole (SESSION_TTL_MIN), utente ricaricato da Utenti a ogni
 *   chiamata (cache 5 min) così una disattivazione ha effetto subito.
 */
var OTP_MAX_TRIES = 5;
var OTP_MAX_REQUESTS = 3;
var OTP_WINDOW_SEC = 15 * 60;

function actRequestOtp_(p) {
  var email = normalizeEmail_(p.email);
  var c = cfg_();
  if (!isValidEmail_(email)) fail_('EMAIL_INVALID');
  if (!isEmailDomainAllowed_(email, c.ALLOWED_DOMAINS)) fail_('DOMAIN_NOT_ALLOWED');
  var cache = CacheService.getScriptCache();
  var rlKey = 'otp_rl_' + email;
  var n = Number(cache.get(rlKey) || 0);
  if (n >= OTP_MAX_REQUESTS) fail_('RATE_LIMITED');
  cache.put(rlKey, String(n + 1), OTP_WINDOW_SEC);

  var user = findActiveUser_(users_(), email);
  if (!user) {
    log_('WARN', 'auth.requestOtp', email, 'utente non abilitato');
    return { sent: true };
  }
  var code = otpFromRandomHex_(Utilities.getUuid() + Utilities.getUuid());
  cache.put('otp_' + email, JSON.stringify({ h: otpHash_(email, code), t: 0 }), c.OTP_TTL_MIN * 60);
  MailApp.sendEmail({
    to: email,
    subject: param_('nota_mail_otp') || 'Codice di accesso al Preventivatore',
    body: 'Il tuo codice di accesso è: ' + code + '\n\nÈ valido ' + c.OTP_TTL_MIN + ' minuti.\n' +
          'Se non hai richiesto tu l\'accesso, ignora questa e-mail.'
  });
  log_('INFO', 'auth.requestOtp', email, 'OTP inviato');
  return { sent: true };
}

function actVerifyOtp_(p) {
  var email = normalizeEmail_(p.email);
  var code = String(p.code || '').trim();
  if (!isValidEmail_(email) || !isValidOtpFormat_(code)) fail_('OTP_INVALID');
  var cache = CacheService.getScriptCache();
  var key = 'otp_' + email;
  var raw = cache.get(key);
  if (!raw) fail_('OTP_EXPIRED');
  var st = JSON.parse(raw);
  if (st.t >= OTP_MAX_TRIES) fail_('OTP_LOCKED');
  if (st.h !== otpHash_(email, code)) {
    st.t += 1;
    cache.put(key, JSON.stringify(st), cfg_().OTP_TTL_MIN * 60);
    log_('WARN', 'auth.verifyOtp', email, 'codice errato, tentativo ' + st.t);
    fail_(st.t >= OTP_MAX_TRIES ? 'OTP_LOCKED' : 'OTP_INVALID');
  }
  cache.remove(key);
  var user = findActiveUser_(users_(), email);
  if (!user) fail_('OTP_INVALID');
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('sess_' + token, email, cfg_().SESSION_TTL_MIN * 60);
  log_('INFO', 'auth.login', email, 'accesso');
  return { token: token, user: user };
}

function actLogout_(p, user, req) {
  CacheService.getScriptCache().remove('sess_' + req.token);
  log_('INFO', 'auth.logout', user.email, '');
  return { loggedOut: true };
}

/** Utente della sessione o null. Rinnova la scadenza (sliding). */
function sessionUser_(token) {
  if (!token || !/^[0-9a-f]{64}$/.test(String(token))) return null;
  var cache = CacheService.getScriptCache();
  var email = cache.get('sess_' + token);
  if (!email) return null;
  var user = findActiveUser_(users_(), email);
  if (!user) {
    cache.remove('sess_' + token);
    return null;
  }
  cache.put('sess_' + token, email, cfg_().SESSION_TTL_MIN * 60);
  return user;
}

function users_() {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('users_v1');
  if (raw) return JSON.parse(raw);
  var rows = rowsToObjects_(sheet_('Utenti').getDataRange().getValues());
  cache.put('users_v1', JSON.stringify(rows), 300);
  return rows;
}

function otpHash_(email, code) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email + '|' + code + '|' + cfg_().PROXY_SECRET);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

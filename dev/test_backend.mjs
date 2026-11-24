/**
 * Test del backend Apps Script nel simulatore (nessun account Google necessario).
 * Uso: node dev/test_backend.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas, seedSheets } from './gas-mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = 'test-secret';
let fails = 0;
const t = (name, cond, extra = '') => { console.log(`${cond ? '✔' : '✖'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const mk = () => createGas({ root: ROOT, props: { PROXY_SECRET: S, ALLOWED_DOMAINS: 'test.invalid' }, sheets: seedSheets() });

let g = mk();
const call = (action, payload, token, secret = S) => g.doPost({ action, payload, token, proxySecret: secret });

// proxy secret e router
t('senza segreto → FORBIDDEN', call('ping', {}, null, 'x').error === 'FORBIDDEN');
t('body null → BAD_REQUEST', JSON.parse(g.ctx.doPost({ postData: { contents: 'null' } }).getContent()).error === 'BAD_REQUEST');
t('azione sconosciuta → UNKNOWN_ACTION', call('pippo').error === 'UNKNOWN_ACTION');
t('azione "toString" non raggiunge Object.prototype', call('toString').error === 'UNKNOWN_ACTION');
const ping = call('ping');
t('ping ok con versioni', ping.ok && ping.data.version === '0.1.1' && ping.data.versioneCatalogo === '20261118-164303');
t('azione protetta senza token → SESSION_EXPIRED', call('app.bootstrap').error === 'SESSION_EXPIRED');

// login
t('e-mail non valida', call('auth.requestOtp', { email: 'xx' }).error === 'EMAIL_INVALID');
t('dominio non ammesso', call('auth.requestOtp', { email: 'a@gmail.com' }).error === 'DOMAIN_NOT_ALLOWED');
let r = call('auth.requestOtp', { email: 'sconosciuto@test.invalid' });
t('utente inesistente: risposta neutra, nessuna mail', r.ok && r.data.sent && g.mails.length === 0);
r = call('auth.requestOtp', { email: 'ex.utente@test.invalid' });
t('utente disattivo: nessuna mail', r.ok && g.mails.length === 0);
r = call('auth.requestOtp', { email: ' Mario.Rossi@TEST.invalid ' });
const otp = g.lastOtp('mario.rossi@test.invalid');
t('utente attivo: mail con OTP a 6 cifre (e-mail normalizzata)', r.ok && /^\d{6}$/.test(otp || ''));
t('OTP non salvato in chiaro in cache', ![...g.cache.values()].some((e) => e.v.includes(otp)));
const wrong = otp === '000000' ? '111111' : '000000';
t('codice errato → OTP_INVALID', call('auth.verifyOtp', { email: 'mario.rossi@test.invalid', code: wrong }).error === 'OTP_INVALID');
r = call('auth.verifyOtp', { email: 'mario.rossi@test.invalid', code: otp });
t('codice corretto → token + utente', r.ok && /^[0-9a-f]{64}$/.test(r.data.token) && r.data.user.profilo === 'admin');
const tok = r.data.token;
t('OTP monouso', call('auth.verifyOtp', { email: 'mario.rossi@test.invalid', code: otp }).error === 'OTP_EXPIRED');
r = call('app.bootstrap', {}, tok);
t('bootstrap con sessione', r.ok && r.data.user.email === 'mario.rossi@test.invalid');
t('logout', call('auth.logout', {}, tok).ok);
t('token non più valido dopo logout', call('auth.me', {}, tok).error === 'SESSION_EXPIRED');

// blocco tentativi e rate limit
g = mk();
call('auth.requestOtp', { email: 'mario.rossi@test.invalid' });
let last;
for (let i = 0; i < 5; i++) last = call('auth.verifyOtp', { email: 'mario.rossi@test.invalid', code: '999999' === g.lastOtp('mario.rossi@test.invalid') ? '888888' : '999999' });
t('5 tentativi errati → OTP_LOCKED', last.error === 'OTP_LOCKED');
t('dopo il blocco anche il codice giusto è rifiutato',
  call('auth.verifyOtp', { email: 'mario.rossi@test.invalid', code: g.lastOtp('mario.rossi@test.invalid') }).error === 'OTP_LOCKED');
call('auth.requestOtp', { email: 'mario.rossi@test.invalid' });
call('auth.requestOtp', { email: 'mario.rossi@test.invalid' });
t('4ª richiesta in 15 min → RATE_LIMITED', call('auth.requestOtp', { email: 'mario.rossi@test.invalid' }).error === 'RATE_LIMITED');

// disattivazione utente con sessione aperta
g = mk();
call('auth.requestOtp', { email: 'mario.rossi@test.invalid' });
const tk = call('auth.verifyOtp', { email: 'mario.rossi@test.invalid', code: g.lastOtp('mario.rossi@test.invalid') }).data.token;
g.ctx.SpreadsheetApp.getActive().getSheetByName('Utenti'); // fogli condivisi per riferimento
const sheets = seedSheets();
g.cache.delete('users_v1');
g.ctx.SpreadsheetApp.getActive = () => ({ getSheetByName: (n) => ({ getDataRange: () => ({ getValues: () =>
  n === 'Utenti' ? [sheets.Utenti[0], ['mario.rossi@test.invalid', 'Mario', 'Rossi', 'CL', 'Head', 'admin', 'No']] : sheets[n] }),
  appendRow() {} }) });
t('utente disattivato → sessione invalidata', call('auth.me', {}, tk).error === 'SESSION_EXPIRED');

// logica pura
const L = g.ctx;
t('formatPreventivoNumber_', L.formatPreventivoNumber_(2026, 12, 'SLB') === 'PRV-2026-0012-SLB');
t('safeCell_ neutralizza formule', L.safeCell_('=HYPERLINK("x")') === '\'=HYPERLINK("x")');
t('diffHeaders_', L.diffHeaders_(['A', 'X'], ['A', 'B']).length === 1);

// ------------------------------------------------------------ v0.1.1
// "Si" accettato come "Sì"
t('isYes_ varianti', ['Sì', 'Si', 'SI', 'sì', ' si ', 'sí', true].every((v) => L.isYes_(v)));
t('isYes_ rifiuta il resto', ['No', '', null, undefined, 'S', 'Sìx', 'yes', false, 1].every((v) => !L.isYes_(v)));
{
  const sh = seedSheets();
  sh.Utenti.push(['anna.bianchi@test.invalid', 'Anna', 'Bianchi', 'TAX', 'Senior', 'utente', 'Si']);
  g = createGas({ root: ROOT, props: { PROXY_SECRET: S, ALLOWED_DOMAINS: 'test.invalid' }, sheets: sh });
  call('auth.requestOtp', { email: 'anna.bianchi@test.invalid' });
  t('utente con ATTIVO = "Si" riceve il codice', /^\d{6}$/.test(g.lastOtp('anna.bianchi@test.invalid') || ''));
}

// onEdit sul foglio Utenti svuota la cache utenti, sugli altri fogli no
{
  g = mk();
  call('auth.requestOtp', { email: 'mario.rossi@test.invalid' }); // popola users_v1
  t('cache utenti popolata', g.cache.has('users_v1'));
  g.ctx.onEdit({ range: g.sheetObj('Log').getRange(2, 1) });
  t('onEdit su Log: cache invariata', g.cache.has('users_v1'));
  g.ctx.onEdit({ range: g.sheetObj('Utenti').getRange(2, 7) });
  t('onEdit su Utenti: cache svuotata', !g.cache.has('users_v1'));
  g.ctx.onEdit(undefined);
  t('onEdit senza evento non va in errore', true);
  // riattivazione immediata: utente disattivo → Sì → codice inviato senza attendere 5 minuti
  const sh = seedSheets();
  g = createGas({ root: ROOT, props: { PROXY_SECRET: S, ALLOWED_DOMAINS: 'test.invalid' }, sheets: sh });
  call('auth.requestOtp', { email: 'ex.utente@test.invalid' });
  sh.Utenti[2][6] = 'Sì';
  g.ctx.onEdit({ range: g.sheetObj('Utenti').getRange(3, 7) });
  call('auth.requestOtp', { email: 'ex.utente@test.invalid' });
  t('utente riattivato riceve il codice subito dopo la modifica', !!g.lastOtp('ex.utente@test.invalid'));
}

// Sblocca utente
{
  g = mk();
  for (let i = 0; i < 3; i++) call('auth.requestOtp', { email: 'mario.rossi@test.invalid' });
  t('pre: utente al limite', call('auth.requestOtp', { email: 'mario.rossi@test.invalid' }).error === 'RATE_LIMITED');
  g.ctx.unlockUser_('mario.rossi@test.invalid');
  t('dopo sblocco: nessuna chiave otp in cache', !g.cache.has('otp_rl_mario.rossi@test.invalid') && !g.cache.has('otp_mario.rossi@test.invalid'));
  const before = g.mails.length;
  t('dopo sblocco: nuova richiesta accettata', call('auth.requestOtp', { email: 'mario.rossi@test.invalid' }).ok && g.mails.length === before + 1);
  t('sblocco registrato nel Log', g.ctx.SpreadsheetApp.getActive().getSheetByName('Log').getDataRange().getValues()
    .some((r) => r[2] === 'admin.sbloccaUtente' && r[3] === 'mario.rossi@test.invalid'));
}

// Tendine sul foglio Utenti
{
  const lst = [['TIPO_PILLAR', 'RUOLO', 'DIP'], ['Dipartimentale', 'Head', 'ICL'], ['Trasversale', 'Senior', 'CL'], ['', '', 'TAX'], ['', '', '']];
  g = createGas({ root: ROOT, props: { PROXY_SECRET: S, ALLOWED_DOMAINS: 'test.invalid', DB_CATALOGO_ID: 'db1' },
    sheets: seedSheets(), catalogo: { _LISTE: lst } });
  const msg = g.ctx.applyUtentiValidation_(g.sheetObj('Utenti'));
  const by = Object.fromEntries(g.validations.map((v) => [v.col, v]));
  t('4 tendine create (DIP, RUOLO, PROFILO, ATTIVO = colonne 4-7)', g.validations.length === 4 && [4, 5, 6, 7].every((c) => by[c]));
  t('DIP letto da DB_Catalogo _LISTE', JSON.stringify(by[4].rule.values) === '["ICL","CL","TAX"]' && /DB_Catalogo/.test(msg));
  t('ATTIVO Sì/No rigida', JSON.stringify(by[7].rule.values) === '["Sì","No"]' && by[7].rule.allowInvalid === false);
  t('PROFILO utente/admin rigida', JSON.stringify(by[6].rule.values) === '["utente","admin"]' && by[6].rule.allowInvalid === false);
  t('RUOLO e DIP con solo avviso', by[5].rule.allowInvalid === true && by[4].rule.allowInvalid === true);
  t('righe 2..501', g.validations.every((v) => v.row === 2 && v.rows === 500));
  g = mk();
  g.ctx.applyUtentiValidation_(g.sheetObj('Utenti'));
  t('catalogo non raggiungibile → elenco di riserva', g.validations.find((v) => v.col === 4).rule.values.length === 12);
}

console.log(fails ? `\n${fails} TEST FALLITI` : '\nTUTTI I TEST BACKEND PASSATI');
process.exit(fails ? 1 : 0);

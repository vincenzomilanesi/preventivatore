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
t('ping ok con versioni', ping.ok && ping.data.version === '0.1.0' && ping.data.versioneCatalogo === '20261118-164303');
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

console.log(fails ? `\n${fails} TEST FALLITI` : '\nTUTTI I TEST BACKEND PASSATI');
process.exit(fails ? 1 : 0);

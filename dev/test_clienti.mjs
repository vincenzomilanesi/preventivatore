/**
 * Test del passo Cliente (ricerca e dettaglio) nel simulatore, con dati inventati.
 * Uso: node dev/test_clienti.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas, seedSheets, seedClienti } from './gas-mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = 'test-secret';
let fails = 0;
const t = (name, cond, extra = '') => { console.log(`${cond ? '✔' : '✖'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };

const g = createGas({ root: ROOT, props: { PROXY_SECRET: S, ALLOWED_DOMAINS: 'test.invalid' }, sheets: seedSheets() });
seedClienti(g);
const call = (action, payload, token) => g.doPost({ action, payload, token, proxySecret: S });
call('auth.requestOtp', { email: 'mario.rossi@test.invalid' });
const tok = call('auth.verifyOtp', { email: 'mario.rossi@test.invalid', code: g.lastOtp('mario.rossi@test.invalid') }).data.token;
const search = (q) => call('clienti.search', { q }, tok);
const ids = (r) => r.data.risultati.map((x) => x.id).join(',');

t('ricerca senza sessione → SESSION_EXPIRED', call('clienti.search', { q: 'alfa' }).error === 'SESSION_EXPIRED');
t('ricerca troppo corta → QUERY_INVALID', search('a').error === 'QUERY_INVALID' && search(' .- ').error === 'QUERY_INVALID');
t('ricerca troppo lunga → QUERY_INVALID', search('x'.repeat(81)).error === 'QUERY_INVALID');
let r = search('alfa');
t('per ragione sociale: ordine nome uguale, inizia con, a inizio parola', r.ok && ids(r) === 'CLI-000002,CLI-000001,CLI-000005', ids(r));
t('risultato con solo i campi da mostrare', JSON.stringify(Object.keys(r.data.risultati[0]).sort()) === '["citta","doc","id","nome","tipo","via"]');
r = search('SOCIETA agric');
t('senza accenti, maiuscole, più termini, parole parziali', ids(r) === 'CLI-000003');
r = search('Neri');
t('persona per cognome', ids(r) === 'CLI-000004' && r.data.risultati[0].tipo === 'persona' && r.data.risultati[0].nome === 'Carla Neri');
r = search('0123456');
t('per P.IVA (anche parziale)', ids(r) === 'CLI-000001' && r.data.risultati[0].doc === '01234567897');
r = search('rssmra80');
t('per codice fiscale', ids(r) === 'CLI-000004');
r = search('bruno.verdi@alfa.test.invalid');
t('per e-mail di un referente → cliente con "via"', ids(r) === 'CLI-000001' && r.data.risultati[0].via === 'Bruno Verdi');
r = search('carla@privato.test.invalid');
t('per e-mail del cliente persona', ids(r) === 'CLI-000004' && r.data.risultati[0].via === '');
r = search('bianchi');
t('per cognome di un referente', ids(r) === 'CLI-000001' && r.data.risultati[0].via === 'Anna Bianchi');
r = search('rossi');
t('referente "Rossini" trovato con "rossi"', ids(r) === 'CLI-000003');
r = search('pesaro');
t('per città', ids(r) === 'CLI-000001');
r = search('nessuno zzz');
t('nessun risultato', r.ok && r.data.totale === 0 && r.data.risultati.length === 0);
t('ricerca non registrata nel Log', !g.ctx.readTable_('Log').some((o) => /alfa|bianchi|0123456/i.test(o.DETTAGLIO)));

// dettaglio
r = call('clienti.get', { id: 'CLI-000001' }, tok);
t('dettaglio cliente con referenti ordinati per cognome', r.ok && r.data.denominazione === 'Alfa Meccanica Srl' && r.data.piva === '01234567897' &&
  r.data.referenti.map((x) => x.cognome).join(',') === 'Bianchi,Verdi');
t('dettaglio senza colonne tecniche', r.ok && !('ricerca' in r.data) && !('id_hubspot' in r.data));
t('dettaglio: ID inesistente → NOT_FOUND', call('clienti.get', { id: 'CLI-999999' }, tok).error === 'NOT_FOUND');
t('dettaglio: ID malformato → NOT_FOUND', call('clienti.get', { id: '../x' }, tok).error === 'NOT_FOUND');

// cache dell'indice
t('indice in cache dopo la prima ricerca', g.cache.has('cidx_v1_n'));
g.ctx.writeTable_('Clienti', g.ctx.readTable_('Clienti').concat([{ ID_CLIENTE: 'CLI-000006', TIPO: 'azienda', RAGIONE_SOCIALE: 'Zeta Nuova', CITTA: 'Rimini', RICERCA: 'zeta nuova rimini' }]));
t('senza invalidazione la cache resta (nessuna rilettura dei fogli)', search('zeta').data.totale === 0);
g.ctx.invalidateClientiIndex_();
t('dopo l\'invalidazione il nuovo cliente si trova', ids(search('zeta')) === 'CLI-000006');
g.cache.delete('cidx_v1_1');
t('blocco di cache mancante → indice ricostruito', search('zeta').ok);

// indice grande: più blocchi < 100 KB, limite 20 risultati
{
  const big = Array.from({ length: 3000 }, (_, i) => ({ ID_CLIENTE: 'CLI-' + String(10 + i).padStart(6, '0'), TIPO: 'azienda',
    RAGIONE_SOCIALE: 'Società di prova numero ' + i + ' àèìòù', CITTA: 'Città ' + (i % 50) }));
  big.forEach((o) => { o.RICERCA = g.ctx.searchText_(o); });
  g.ctx.writeTable_('Clienti', big);
  g.ctx.invalidateClientiIndex_();
  r = search('prova');
  const n = Number(g.cache.get('cidx_v1_n').v);
  t('indice grande in più blocchi', n > 1, `blocchi=${n}`);
  t('massimo 20 risultati, totale reale', r.data.risultati.length === 20 && r.data.totale === 3000);
  r = search('prova');
  t('seconda ricerca dalla cache', r.ok && r.data.totale === 3000);
}

console.log(fails ? `\n${fails} TEST FALLITI` : '\nTUTTI I TEST CLIENTI PASSATI');
process.exit(fails ? 1 : 0);

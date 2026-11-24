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
t('risultato con solo i campi da mostrare', JSON.stringify(Object.keys(r.data.risultati[0]).sort()) === '["citta","cliente","doc","id","nome","tipo","via"]');
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
t('dettaglio letto con ricerca mirata (TextFinder), non rileggendo i fogli', g.textFinds.some((x) => x.sheet === 'Clienti' && x.val === 'CLI-000001') &&
  g.textFinds.some((x) => x.sheet === 'Referenti' && x.val === 'CLI-000001'));
t('dettaglio senza colonne tecniche', r.ok && !('ricerca' in r.data) && !('id_hubspot' in r.data));
t('dettaglio: ID inesistente → NOT_FOUND', call('clienti.get', { id: 'CLI-999999' }, tok).error === 'NOT_FOUND');
t('dettaglio: ID malformato → NOT_FOUND', call('clienti.get', { id: '../x' }, tok).error === 'NOT_FOUND');

// ---------------------------------------------------------------- inserimento (blocco 4)
const create = (p) => call('clienti.create', p, tok);
search('alfa');   // indice in cache: deve aggiornarsi senza ricostruzione
let c = create({ tipo: 'azienda', ragioneSociale: 'x', citta: '' });
t('nuovo: errori di validazione per campo', c.ok && c.data.esito === 'errori' && c.data.errori.ragioneSociale && c.data.errori.citta && c.data.errori._generale);
c = create({ tipo: 'azienda', ragioneSociale: 'Nuova Srl', citta: 'Fano', piva: '01234567890', cf: 'XYZ', email: 'no', cap: '123', telefono: 'abc' });
t('nuovo: P.IVA, CF, e-mail, CAP, telefono non validi', ['piva', 'cf', 'email', 'cap', 'telefono'].every((k) => c.data.errori[k]));
c = create({ tipo: 'persona', citta: 'Roma', email: 'p@x.test.invalid' });
t('nuovo persona: nome e cognome obbligatori', c.data.errori.nome && c.data.errori.cognome);
c = create({ tipo: 'azienda', ragioneSociale: 'Altra Srl', citta: 'Roma', piva: 'IT 01234567897' });
t('doppione certo: stessa P.IVA → cliente esistente', c.data.esito === 'duplicato' && c.data.clienti[0].id === 'CLI-000001' && c.data.clienti[0].motivo === 'stessa P.IVA');
c = create({ tipo: 'persona', nome: 'Mario', cognome: 'Rossi', citta: 'Roma', cf: 'rssmra80a01h501u' });
t('doppione certo: stesso CF', c.data.esito === 'duplicato' && c.data.clienti[0].id === 'CLI-000004');
c = create({ tipo: 'azienda', ragioneSociale: 'Zeta Srl', citta: 'Roma', email: 'Bruno.Verdi@alfa.test.invalid' });
t('doppione certo: e-mail di un referente → suo cliente', c.data.esito === 'duplicato' && c.data.clienti[0].id === 'CLI-000001' && /referente/.test(c.data.clienti[0].motivo));
c = create({ tipo: 'azienda', ragioneSociale: 'ALFA S.R.L.', citta: 'fano', email: 'info@alfanuova.test.invalid' });
t('doppione possibile: stesso nome (senza forma giuridica) e città → conferma', c.data.esito === 'simile' && c.data.clienti[0].id === 'CLI-000002');
c = create({ tipo: 'azienda', ragioneSociale: 'ALFA S.R.L.', citta: 'fano', email: 'info@alfanuova.test.invalid', conferma: true, cap: '01100',
  referente: { nome: 'Gino', cognome: 'Lupi', email: 'gino@alfanuova.test.invalid' } });
t('con conferma: creato con ID dal contatore e referente', c.data.esito === 'creato' && c.data.id === 'CLI-000006' && c.data.referenteId === 'REF-000004', JSON.stringify(c.data));
const nuovo = g.ctx.readTable_('Clienti').find((o) => o.ID_CLIENTE === 'CLI-000006');
t('riga: origine configuratore, da esportare, creato da utente, CAP con zero', nuovo.ORIGINE === 'configuratore' && nuovo.STATO_HUBSPOT === 'da esportare' &&
  nuovo.CREATO_DA === 'mario.rossi@test.invalid' && nuovo.CAP === '01100' && nuovo.PAESE === 'Italia' && nuovo.DOMINIO === 'alfanuova.test.invalid' && nuovo.CLIENTE_ELIBRA === '');
t('scrittura in formato testo, in fondo al foglio', g.formats.some((f) => f.sheet === 'Clienti' && f.f === '@' && f.rows === 1));
t('contatori aggiornati', g.ctx.readTable_('Contatori').find((o) => o.CHIAVE === 'CLI').VALORE === '6' && g.ctx.readTable_('Contatori').find((o) => o.CHIAVE === 'REF').VALORE === '4');
r = search('gino lupi');
t('nuovo cliente e referente subito ricercabili (indice aggiornato)', ids(r) === 'CLI-000006' && r.data.risultati[0].via === 'Gino Lupi');
t('Log: solo gli ID', g.ctx.readTable_('Log').some((o) => o.AZIONE === 'clienti.create' && o.DETTAGLIO === 'CLI-000006 + REF-000004') &&
  !g.ctx.readTable_('Log').some((o) => /Lupi|alfanuova/.test(o.DETTAGLIO)));
c = create({ tipo: 'persona', nome: 'Luca', cognome: 'Mori', citta: 'Pesaro', email: 'luca.mori@x.test.invalid', referente: { nome: 'X' } });
t('persona: il referente viene ignorato', c.data.esito === 'creato' && !c.data.referenteId);
c = create({ tipo: 'azienda', ragioneSociale: 'Contatore Srl', citta: 'Roma', email: 'k@k.test.invalid' });
t('ID libero anche con contatore non allineato', c.data.esito === 'creato' && c.data.id === 'CLI-000008');
g.ctx.setCounter_('CLI', 1);
c = create({ tipo: 'azienda', ragioneSociale: 'Disallineato Srl', citta: 'Roma', email: 'd@d.test.invalid' });
t('contatore indietro: salta gli ID esistenti', c.data.esito === 'creato' && c.data.id === 'CLI-000009', c.data.id);
t('nuovo cliente senza sessione → SESSION_EXPIRED', call('clienti.create', { tipo: 'azienda' }).error === 'SESSION_EXPIRED');

// referente su cliente esistente
const addRef = (p) => call('referenti.create', p, tok);
c = addRef({ idCliente: 'CLI-000003', nome: '', cognome: 'Solo' });
t('referente: nome obbligatorio', c.data.esito === 'errori' && c.data.errori.nome);
c = addRef({ idCliente: 'CLI-000003', nome: 'Dario', cognome: 'Rossini' });
t('referente: stesso nominativo sullo stesso cliente → esistente', c.data.esito === 'duplicato' && c.data.id === 'REF-000003');
c = addRef({ idCliente: 'CLI-000003', nome: 'Eva', cognome: 'Conti', email: 'eva@beta.test.invalid', telefono: '+39 333 1' });
t('referente creato', c.data.esito === 'creato' && /^REF-\d{6}$/.test(c.data.id));
r = call('clienti.get', { id: 'CLI-000003' }, tok);
t('referente nel dettaglio del cliente', r.data.referenti.some((x) => x.cognome === 'Conti'));
c = addRef({ idCliente: 'CLI-000003', nome: 'Altra', cognome: 'Persona', email: 'EVA@beta.test.invalid' });
t('referente: stessa e-mail sullo stesso cliente → esistente', c.data.esito === 'duplicato');
t('referente su cliente inesistente → NOT_FOUND', addRef({ idCliente: 'CLI-999999', nome: 'a', cognome: 'b' }).error === 'NOT_FOUND');
t('ricerca trova il referente nuovo', ids(search('eva conti')) === 'CLI-000003');

// cache dell'indice
t('indice in cache dopo la prima ricerca', g.cache.has('cidx_v1_n'));
g.ctx.writeTable_('Clienti', g.ctx.readTable_('Clienti').concat([{ ID_CLIENTE: 'CLI-000060', TIPO: 'azienda', RAGIONE_SOCIALE: 'Zeta Nuova', CITTA: 'Rimini', RICERCA: 'zeta nuova rimini' }]));
t('senza invalidazione la cache resta (nessuna rilettura dei fogli)', search('zeta').data.totale === 0);
g.ctx.invalidateClientiIndex_();
t('dopo l\'invalidazione il nuovo cliente si trova', ids(search('zeta')) === 'CLI-000060');
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

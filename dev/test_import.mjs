/**
 * Test dell'import HubSpot (Clienti/Referenti) nel simulatore, con dati inventati (dominio test.invalid).
 * Uso: node dev/test_import.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas, seedSheets } from './gas-mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const t = (name, cond, extra = '') => { console.log(`${cond ? '✔' : '✖'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const csv = (rows, sep = ',') => '\uFEFF' + rows.map((r) => r.map(q).join(sep)).join('\r\n') + '\r\n';

function mk(files = []) {
  const sheets = seedSheets();
  const g0 = createGas({ root: ROOT, props: {}, sheets: {} });
  for (const n of ['Clienti', 'Referenti', 'Report_import', 'Contatori']) sheets[n] = [g0.ctx.REGISTRO_SCHEMA[n].slice()];
  sheets.Contatori.push(['PRV-2026', 0]);
  const g = createGas({ root: ROOT, props: { PROXY_SECRET: 's', ALLOWED_DOMAINS: 'test.invalid', IMPORT_FOLDER_ID: 'fold' }, sheets, files });
  return { g, sheets, L: g.ctx };
}
const objs = (L, name) => L.readTable_(name);

// ---------------------------------------------------------------- funzioni pure
{
  const { L } = mk();
  t('P.IVA valida con prefisso IT e spazi', L.normPiva_('IT 012 345 678 97') === '01234567897');
  t('P.IVA con checksum errato → vuota', L.normPiva_('01234567890') === '');
  t('P.IVA estera UE accettata', L.normPiva_('DE123456789') === 'DE123456789');
  t('P.IVA 00000000000 rifiutata', L.normPiva_('00000000000') === '');
  t('CF persona valido', L.normCf_('rssmra80a01h501u') === 'RSSMRA80A01H501U');
  t('CF con controllo errato → vuoto', L.normCf_('RSSMRA80A01H501X') === '');
  t('CF numerico (società) = regole P.IVA', L.isValidCf_('01234567897') && !L.isValidCf_('01234567890'));
  t('normKey_ toglie accenti e punteggiatura', L.normKey_('  Città  S.r.l. – Società ') === 'citta s r l societa');
  t('dominio di provider di posta (anche sottodominio)', L.isMailProviderDomain_('artidea.191.it') && L.isMailProviderDomain_('gmail.com') &&
    !L.isMailProviderDomain_('studiolegalevirgilio.it') && !L.isMailProviderDomain_('x191.it'));
  t('normDomain_', L.normDomain_('HTTPS://www.Esempio.IT/chi-siamo') === 'esempio.it');
  const tab = L.parseCsv_('\uFEFF"a","b;c","d ""q"""\r\n"x","riga\nsu due","" \n1,2,3');
  t('parseCsv_: virgolette, a capo nel campo, BOM, CRLF', tab.length === 3 && tab[0][1] === 'b;c' && tab[0][2] === 'd "q"' &&
    tab[1][1] === 'riga\nsu due' && tab[2][2] === '3');
  t('parseCsv_: separatore punto e virgola', JSON.stringify(L.parseCsv_('a;b\n1;"2,5"')) === '[["a","b"],["1","2,5"]]');
}

// ---------------------------------------------------------------- dati di prova
const HA = ['ID record', 'Nome azienda', 'Nome dominio azienda', 'Partita IVA', 'Indirizzo', 'Indirizzo 2', 'Codice postale',
  'Città', 'Provincia', 'Paese/Regione', 'Nazione', 'Numero di telefono', 'Data ultima modifica'];
const aziende = [HA,
  ['1001', 'Alfa  Srl', 'alfa.test.invalid', 'IT01234567897', 'Via Roma 1', 'Scala B', '01100', 'Viterbo', 'Viterbo', 'Italy', '', '+39 0761 000000', '2026-10-01 10:00'],
  ['1002', 'Alfa S.r.l.', 'alfa2.test.invalid', '01234567897', '', '', '', 'Viterbo', '', '', 'Italy', '', '2026-11-01 10:00'],  // doppione P.IVA meno completo
  ['1003', 'Beta SpA', 'beta.test.invalid', '12345678900', 'Via Po 2', '', '20100', 'Milano', 'Milano', '', 'United States of America', '', '2026-01-01 10:00'], // P.IVA errata
  ['1004', '', 'vuota.test.invalid', '', '', '', '', '', '', '', '', '', ''],                // senza nome
  ['1005', 'Artidea', 'utente.191.it', '', '', '', '', 'Milano', '', 'Italy', '', '', ''],  // provider di posta
  ['1006', '=HYPERLINK("x")', 'gamma.test.invalid', '', '', '', '', 'Pesaro', '', 'Italy', '', '', ''],  // tentativo di formula
  ['1007', 'Delta', 'delta.gmail.com', '12345678903', '', '', '', 'Fano', '', 'Italy', '', '', ''],  // provider ma con P.IVA → tenuta
];
const HC = ['ID record', 'Nome', 'Cognome', 'E-mail', 'Numero di telefono', 'Codice fiscale', 'Associated Company IDs (Primary)',
  'Associated Company IDs', 'Fase del ciclo di vita', 'Data ultima modifica', 'Nome azienda'];
const contatti = [HC,
  ['2001', 'Anna', 'Bianchi', 'anna@alfa.test.invalid', '', '', '1001', '1001', 'Lead', '', 'Alfa'],
  ['2002', 'Bruno', 'Verdi', 'bruno@alfa.test.invalid', '', '', '', '1002;1003', 'Lead', '', ''],          // azienda unita (1002 → 1001)
  ['2003', 'Carla', 'Neri', 'carla@privato.test.invalid', '333', 'RSSMRA80A01H501U', '', '', 'Cliente', '', ''], // persona fisica
  ['2004', 'Dario', 'Gialli', 'dario@x.test.invalid', '', '', '', '', 'Lead', '', ''],                      // lead senza azienda → scartato
  ['2005', 'Elena', 'Blu', 'elena@utente.191.it', '', '', '1005', '1005', 'Lead', '', ''],                  // azienda scartata → scartato
  ['2006', 'Franco', 'Rosa', 'non-una-mail', '', 'XXXXXX00X00X000X', '', '', 'Opportunità', '', ''],       // e-mail e CF non validi
  ['2007', '', '', '', '', '', '1003', '1003', 'Lead', '', ''],                                            // vuoto
];
const file = (name, text) => ({ getName: () => name, isTrashed: () => false, getBlob: () => ({ getDataAsString: () => text }), setTrashed() {} });

// ---------------------------------------------------------------- import aziende
let { g, L } = mk();
let r = L.importHubspot_(L.parseCsv_(csv(aziende)), 'aziende', 'aziende.csv');
let cl = objs(L, 'Clienti');
t('import aziende ok', r.ok, r.lines.join(' | '));
t('tipo riconosciuto', L.detectHubspotExport_(HA) === 'aziende' && L.detectHubspotExport_(HC) === 'contatti' && L.detectHubspotExport_(['x']) === '');
t('4 aziende importate (scartate: senza nome, provider; unita: doppione)', cl.length === 4 && r.stats.scarti === 2 && r.stats.doppioni === 1,
  `righe=${cl.length}`);
const alfa = cl.find((o) => o.ID_HUBSPOT === '1001');
t('doppione: resta il più completo, l\'altro ID in ID_HUBSPOT_ALTRI', alfa && alfa.ID_HUBSPOT_ALTRI === '1002' && !cl.some((o) => o.ID_HUBSPOT === '1002'));
t('campi puliti (spazi, indirizzo unito, CAP con zero iniziale)', alfa.RAGIONE_SOCIALE === 'Alfa Srl' && alfa.INDIRIZZO === 'Via Roma 1, Scala B' && alfa.CAP === '01100');
t('ID cliente progressivo CLI-000001', alfa.ID_CLIENTE === 'CLI-000001' && cl[3].ID_CLIENTE === 'CLI-000004');
t('campi standard', alfa.TIPO === 'azienda' && alfa.ORIGINE === 'hubspot' && alfa.STATO_HUBSPOT === 'sincronizzato' && alfa.CREATO_DA === 'import HubSpot' && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(alfa.CREATO_IL));
const beta = cl.find((o) => o.ID_HUBSPOT === '1003');
t('P.IVA non valida → vuota + avviso', beta.PIVA === '' && r.stats.avvisi === 1);
t('Paese: alias normalizzato e ripiego su Nazione', beta.PAESE === 'United States' && cl.find((o) => o.ID_HUBSPOT === '1002' || o.ID_HUBSPOT_ALTRI === '1002').PAESE === 'Italy');
t('provider di posta con P.IVA valida → tenuta', cl.some((o) => o.ID_HUBSPOT === '1007'));
t('formula neutralizzata in scrittura (apostrofo), riletta come testo', g.escapes.some((e) => e.sheet === 'Clienti' && e.value === '=HYPERLINK("x")') &&
  objs(L, 'Clienti').some((o) => o.RAGIONE_SOCIALE === '=HYPERLINK("x")'));
t('RICERCA compilata', alfa.RICERCA.includes('alfa srl') && alfa.RICERCA.includes('viterbo') && alfa.RICERCA.includes('01234567897'));
t('fogli scritti in formato testo', g.formats.some((f) => f.sheet === 'Clienti' && f.f === '@'));
t('contatore CLI = 4', objs(L, 'Contatori').find((o) => o.CHIAVE === 'CLI').VALORE === '4');
let rep = objs(L, 'Report_import');
t('report: scartate, avviso, doppione', rep.filter((o) => o.ESITO === 'scartata').length === 2 && rep.some((o) => o.ESITO === 'avviso') &&
  rep.some((o) => o.ESITO === 'doppione P.IVA' && o.DETTAGLIO.includes('1002')));
t('log scritto', objs(L, 'Log').some((o) => o.AZIONE === 'import.aziende'));

// idempotenza
r = L.importHubspot_(L.parseCsv_(csv(aziende)), 'aziende', 'aziende.csv');
t('reimport stesso file: nessuna modifica', r.stats.nuovi === 0 && r.stats.aggiornati === 0 && r.stats.invariati === 4 && objs(L, 'Clienti').length === 4);
t('reimport: AGGIORNATO_IL invariato', objs(L, 'Clienti').find((o) => o.ID_HUBSPOT === '1001').AGGIORNATO_IL === alfa.AGGIORNATO_IL);

// aggiornamento + assenti + riga del configuratore intoccata
const cfgRow = { ID_CLIENTE: 'CLI-000099', TIPO: 'azienda', RAGIONE_SOCIALE: 'Nuova dal portale', ORIGINE: 'configuratore', STATO_HUBSPOT: 'da esportare' };
L.writeTable_('Clienti', objs(L, 'Clienti').concat([cfgRow]));
const az2 = aziende.map((row) => row.slice());
az2[1][7] = 'Roma';                  // 1001 cambia città
const az3 = az2.filter((row) => row[0] !== '1007');   // 1007 non più in HubSpot
r = L.importHubspot_(L.parseCsv_(csv(az3)), 'aziende', 'aziende2.csv');
cl = objs(L, 'Clienti');
t('modifica in HubSpot → riga aggiornata', r.stats.aggiornati === 1 && cl.find((o) => o.ID_HUBSPOT === '1001').CITTA === 'Roma');
t('assente in HubSpot → riga mantenuta e segnalata', r.stats.assenti === 1 && cl.some((o) => o.ID_HUBSPOT === '1007') &&
  objs(L, 'Report_import').some((o) => o.ESITO === 'non più in HubSpot' && o.ID_HUBSPOT === '1007'));
t('riga del configuratore non toccata', JSON.stringify(cl.find((o) => o.ID_CLIENTE === 'CLI-000099').STATO_HUBSPOT) === '"da esportare"');
t('ID cliente stabili', cl.find((o) => o.ID_HUBSPOT === '1001').ID_CLIENTE === 'CLI-000001');

// cambio del record "master" in HubSpot: l'ID tenuto diventa 1002 → stessa riga, nessun duplicato
const az4 = az3.map((row) => row.slice());
az4[1][4] = ''; az4[1][5] = ''; az4[1][6] = ''; az4[1][8] = ''; az4[1][11] = '';  // 1001 ora meno completo di 1002
az4[2][4] = 'Via Nuova 9'; az4[2][6] = '01100'; az4[2][8] = 'Viterbo'; az4[2][11] = '+39 0761 1';
r = L.importHubspot_(L.parseCsv_(csv(az4)), 'aziende', 'aziende3.csv');
cl = objs(L, 'Clienti');
const alfa2 = cl.find((o) => o.ID_CLIENTE === 'CLI-000001');
t('master cambiato: stessa riga CLI-000001, ID aggiornati, nessuna nuova', r.stats.nuovi === 0 && alfa2.ID_HUBSPOT === '1002' && alfa2.ID_HUBSPOT_ALTRI === '1001');

// ---------------------------------------------------------------- import contatti
({ g, L } = mk());
r = L.importHubspot_(L.parseCsv_(csv(contatti)), 'contatti', 'contatti.csv');
t('contatti prima delle aziende → bloccato', !r.ok && /importare prima/.test(r.lines[0]));
L.importHubspot_(L.parseCsv_(csv(aziende)), 'aziende', 'aziende.csv');
r = L.importHubspot_(L.parseCsv_(csv(contatti)), 'contatti', 'contatti.csv');
const ref = objs(L, 'Referenti');
cl = objs(L, 'Clienti');
t('import contatti ok', r.ok, r.lines.join(' | '));
t('2 referenti collegati alle aziende', ref.length === 2 && ref.every((o) => o.ID_CLIENTE === 'CLI-000001'));
t('azienda unita: contatto di 1002 collegato al cliente di 1001', ref.find((o) => o.ID_HUBSPOT === '2002').ID_CLIENTE === 'CLI-000001');
t('ID referente REF-000001', ref[0].ID_REFERENTE === 'REF-000001');
const pers = cl.filter((o) => o.TIPO === 'persona');
t('2 clienti persona (fase Cliente / Opportunità)', pers.length === 2 && pers.every((o) => o.ORIGINE === 'hubspot'));
const carla = pers.find((o) => o.ID_HUBSPOT === '2003');
t('persona: CF valido importato, ID cliente progressivo dopo le aziende', carla.CF === 'RSSMRA80A01H501U' && carla.ID_CLIENTE === 'CLI-000005');
const franco = pers.find((o) => o.ID_HUBSPOT === '2006');
t('e-mail e CF non validi → vuoti + avvisi', franco.EMAIL === '' && franco.CF === '' && r.stats.avvisi === 2);
t('scartati: lead senza azienda, azienda scartata, vuoto', r.stats.scarti === 3);
rep = objs(L, 'Report_import').filter((o) => o.IMPORT === 'contatti');
t('report contatti senza nomi di persone', rep.length > 0 && rep.every((o) => o.NOME === '') && !JSON.stringify(rep).includes('Dario'));
t('report aziende conservato', objs(L, 'Report_import').some((o) => o.IMPORT === 'aziende'));
r = L.importHubspot_(L.parseCsv_(csv(contatti)), 'contatti', 'contatti.csv');
t('reimport contatti: nessuna modifica', r.stats.referentiNuovi === 0 && r.stats.referentiAggiornati === 0 && r.stats.personeNuove === 0 &&
  r.stats.personeAggiornate === 0 && objs(L, 'Referenti').length === 2);
// ID HubSpot di persona uguale a un ID azienda: nessuna collisione tra tipi
const c2 = contatti.map((row) => row.slice()); c2[3][0] = '1003';
r = L.importHubspot_(L.parseCsv_(csv(c2)), 'contatti', 'contatti2.csv');
cl = objs(L, 'Clienti');
t('ID contatto = ID azienda: l\'azienda non viene toccata', cl.find((o) => o.TIPO === 'azienda' && o.ID_HUBSPOT === '1003').RAGIONE_SOCIALE === 'Beta SpA' &&
  cl.some((o) => o.TIPO === 'persona' && o.ID_HUBSPOT === '1003'));

// intestazioni mancanti
r = L.importHubspot_(L.parseCsv_(csv([['ID record', 'Nome', 'Cognome', 'E-mail'], ['1', 'a', 'b', 'c@d.it']])), 'contatti', 'x.csv');
t('colonne obbligatorie mancanti → errore leggibile', !r.ok && /FASE/.test(r.lines[0]));

// ---------------------------------------------------------------- cartella Drive
({ g, L } = mk([file('aziende.csv', csv(aziende))]));
t('importFiles_ trova il CSV', L.importFiles_().length === 1);
({ g, L } = mk([file('a.csv', ''), file('b.csv', ''), file('nota.txt', '')]));
t('importFiles_ ignora i non CSV', L.importFiles_().length === 2);

console.log(fails ? `\n${fails} TEST FALLITI` : '\nTUTTI I TEST IMPORT PASSATI');
process.exit(fails ? 1 : 0);

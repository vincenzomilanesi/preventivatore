/**
 * Collaudo end-to-end nel browser: pagina → Pages Function vera → Apps Script simulato (redirect 302 incluso).
 * Prerequisito: node dev/server.mjs 8787 in esecuzione. Uso: node dev/test_e2e.cjs [cartella_screenshot]
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8787';
const OUT = process.argv[2] || '.';
let fails = 0;
const t = (n, c) => { console.log(`${c ? '✔' : '✖'} ${n}`); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE);
  t('vista login', await page.isVisible('#email'));
  await page.screenshot({ path: `${OUT}/01_login.png` });

  await page.fill('#email', 'nome@gmail.com');
  await page.click('button[type=submit]');
  await page.waitForSelector('.msg:has-text("e-mail dello Studio")');
  t('dominio esterno rifiutato con messaggio', true);

  await page.fill('#email', 'mario.rossi@test.invalid');
  await page.click('button[type=submit]');
  await page.waitForSelector('#otp');
  t('vista codice', true);
  await page.fill('#otp', '000001');
  await page.click('button[type=submit]');
  await page.waitForSelector('.msg:has-text("Codice non corretto")');
  t('codice errato segnalato', true);
  const { otp } = await (await page.request.get(`${BASE}/__dev/otp?email=mario.rossi@test.invalid`)).json();
  await page.fill('#otp', otp);
  await page.click('button[type=submit]');
  await page.waitForSelector('.stepper');
  t('home con stepper', (await page.locator('.stepper li').count()) === 7);
  t('nome utente in testata', (await page.textContent('#userName')).includes('Mario Rossi'));
  t('versioni in piè di pagina', /server [0-9.]+ · catalogo 20261118-164303/.test(await page.textContent('#versionInfo')));
  await page.screenshot({ path: `${OUT}/02_home.png` });

  // ---- passo Cliente
  await page.click('text=Avanti →');
  t('passo Cliente con campo di ricerca', (await page.textContent('.step h1')) === 'Cliente' && await page.isVisible('#clienteQ'));
  await page.fill('#clienteQ', 'a');
  await page.waitForTimeout(500);
  t('1 carattere: nessuna ricerca', (await page.locator('.result').count()) === 0);
  await page.fill('#clienteQ', 'alfa');
  await page.waitForSelector('.result');
  const nomi = await page.locator('.r-nome').allTextContents();
  t('ricerca "alfa": 3 risultati nell\'ordine giusto', nomi.join('|') === 'Alfa|Alfa Meccanica Srl|Gamma Alfabeto SpA');
  t('conteggio risultati', /3 clienti trovati/.test(await page.textContent('#clienteStatus')));
  await page.fill('#clienteQ', 'zzzz nessuno');
  await page.waitForSelector('#clienteStatus:has-text("Nessun cliente")');
  t('nessun risultato segnalato', (await page.locator('.result').count()) === 0);
  await page.fill('#clienteQ', 'bruno.verdi@alfa.test.invalid');
  await page.waitForSelector('.r-meta:has-text("referente: Bruno Verdi")');
  t('ricerca per e-mail del referente', (await page.locator('.result').count()) === 1 &&
    (await page.textContent('.r-meta')).includes('cliente con pratiche'));
  await page.screenshot({ path: `${OUT}/04_cliente_ricerca.png` });
  await page.click('.result');
  await page.waitForSelector('#clienteScelto h2');
  t('cliente scelto: dati mostrati', (await page.textContent('#clienteScelto h2')) === 'Alfa Meccanica Srl' &&
    (await page.textContent('.dati')).includes('01234567897') && (await page.textContent('.dati')).includes('Cliente con pratiche'));
  t('referenti nel menu', (await page.locator('#clienteReferente option').count()) === 3);
  await page.selectOption('#clienteReferente', 'REF-000002');
  await page.screenshot({ path: `${OUT}/05_cliente_scelto.png` });
  const draft = await page.evaluate(() => localStorage.getItem('prv_draft_v1'));
  t('bozza: solo ID, nessun dato del cliente', /CLI-000001/.test(draft) && /REF-000002/.test(draft) && !/Alfa|0123|Verdi/.test(draft));
  await page.reload();
  await page.waitForSelector('#clienteScelto h2');
  t('dopo ricarica: cliente e referente conservati', (await page.inputValue('#clienteReferente')) === 'REF-000002');
  await page.click('#btnCambiaCliente');
  t('cambia cliente → di nuovo la ricerca', await page.isVisible('#clienteQ'));
  await page.fill('#clienteQ', 'neri');
  await page.waitForSelector('.r-meta:has-text("persona fisica")');
  await page.click('.result');
  await page.waitForSelector('#clienteScelto h2');
  t('cliente persona senza referenti', (await page.textContent('#clienteScelto')).includes('Nessun referente') &&
    (await page.textContent('.dati')).includes('RSSMRA80A01H501U'));

  // ---- cliente nuovo (blocco 4)
  await page.click('#btnCambiaCliente');
  await page.fill('#clienteQ', 'Impresa Nuova');
  await page.waitForSelector('#clienteStatus:has-text("Nessun cliente")');
  await page.click('#btnNuovoCliente');
  t('modulo nuovo cliente precompilato con la ricerca', (await page.inputValue('#f-ragioneSociale')) === 'Impresa Nuova');
  await page.click('text=Salva cliente');
  await page.waitForSelector('#err-citta:not(:empty)');
  t('campi obbligatori segnalati', (await page.textContent('#nuovoEsito')).includes('almeno uno tra e-mail'));
  await page.fill('#f-citta', 'Roma');
  await page.fill('#f-piva', '01234567897');
  await page.click('text=Salva cliente');
  await page.waitForSelector('.box.warn');
  t('doppione certo: mostra il cliente esistente', (await page.textContent('.box.warn')).includes('Alfa Meccanica Srl') &&
    (await page.textContent('.box.warn')).includes('stessa P.IVA'));
  await page.screenshot({ path: `${OUT}/07_nuovo_doppione.png` });
  await page.click('.box.warn button:has-text("Usa questo")');
  await page.waitForSelector('#clienteScelto h2');
  t('"Usa questo" seleziona il cliente esistente', (await page.textContent('#clienteScelto h2')) === 'Alfa Meccanica Srl');
  await page.click('#btnCambiaCliente');
  await page.fill('#clienteQ', 'alfa');
  await page.waitForSelector('.result');
  await page.click('#btnNuovoCliente');
  await page.fill('#f-citta', 'Fano');
  await page.fill('#f-email', 'info@alfa-nuova.test.invalid');
  await page.fill('#f-cap', '61032');
  await page.fill('#f-referente-nome', 'Gino');
  await page.fill('#f-referente-cognome', 'Lupi');
  await page.click('text=Salva cliente');
  await page.waitForSelector('#btnCreaComunque');
  t('nome simile nella stessa città: chiede conferma', (await page.textContent('.box.warn')).includes('stesso nome'));
  await page.click('#btnCreaComunque');
  await page.waitForSelector('#clienteScelto h2');
  t('cliente creato e selezionato con il suo referente', (await page.textContent('#clienteScelto h2')) === 'alfa' &&
    (await page.inputValue('#clienteReferente')).startsWith('REF-') && (await page.textContent('.dati')).includes('inserito dal portale'));
  await page.click('#btnAggiungiReferente');
  await page.fill('#f-rnome', 'Eva');
  await page.fill('#f-rcognome', 'Conti');
  await page.fill('#f-remail', 'eva@alfa-nuova.test.invalid');
  await page.click('text=Salva referente');
  await page.waitForFunction(() => { const s = document.querySelector('#clienteReferente'); return s && s.options[s.selectedIndex].text.includes('Conti'); });
  t('referente aggiunto e selezionato', (await page.locator('#clienteReferente option').count()) === 3);
  await page.screenshot({ path: `${OUT}/08_nuovo_creato.png` });
  await page.click('#btnCambiaCliente');
  await page.fill('#clienteQ', 'eva conti');
  await page.waitForSelector('.r-meta:has-text("referente: Eva Conti")');
  t('nuovo referente subito ricercabile', true);
  await page.click('.result');

  await page.click('text=Avanti →');
  t('navigazione passi', (await page.textContent('.step h1')) === 'Ambito');
  await page.reload();
  await page.waitForSelector('.stepper');
  t('dopo ricarica: sessione e passo conservati', (await page.textContent('.step h1')) === 'Ambito');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await mobile.goto(BASE);
  const sw = await mobile.evaluate(() => document.documentElement.scrollWidth);
  t('mobile 390px senza scroll orizzontale', sw <= 390);
  await mobile.screenshot({ path: `${OUT}/03_login_mobile.png` });
  await mobile.fill('#email', 'mario.rossi@test.invalid');
  await mobile.click('button[type=submit]');
  await mobile.waitForSelector('#otp');
  const m = await (await mobile.request.get(`${BASE}/__dev/otp?email=mario.rossi@test.invalid`)).json();
  await mobile.fill('#otp', m.otp);
  await mobile.click('button[type=submit]');
  await mobile.waitForSelector('.stepper');
  await mobile.click('.stepper li:nth-child(2) button');
  await mobile.fill('#clienteQ', 'alfa');
  await mobile.waitForSelector('.result');
  t('mobile: ricerca cliente senza scroll orizzontale', (await mobile.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await mobile.screenshot({ path: `${OUT}/06_cliente_mobile.png` });
  await mobile.click('#btnNuovoCliente');
  t('mobile: modulo nuovo cliente senza scroll orizzontale', (await mobile.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await mobile.screenshot({ path: `${OUT}/09_nuovo_mobile.png`, fullPage: true });

  await page.click('#btnLogout');
  await page.waitForSelector('#email');
  t('logout → login', true);
  const r = await page.request.post(`${BASE}/api/gas`, { data: { action: 'auth.me', token: 'a'.repeat(64) } });
  t('API: token falso → SESSION_EXPIRED', (await r.json()).error === 'SESSION_EXPIRED');
  const r2 = await page.request.post(`${BASE}/api/gas`, { data: { action: 'x; drop' } });
  t('proxy: azione malformata → 400', r2.status() === 400);
  t('nessun errore JS in console', errors.length === 0);
  if (errors.length) console.log(errors);
  await browser.close();
  console.log(fails ? `\n${fails} TEST FALLITI` : '\nTUTTI I TEST E2E PASSATI');
  process.exit(fails ? 1 : 0);
})();

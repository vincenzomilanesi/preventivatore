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

  await page.click('text=Avanti →');
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

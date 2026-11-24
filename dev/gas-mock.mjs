/**
 * Simulatore dei servizi Google per collaudare in locale i file apps-script/*.gs SENZA modificarli.
 * Carica i .gs in un contesto vm con stub di PropertiesService, CacheService, SpreadsheetApp, MailApp,
 * Utilities, ContentService, LockService. Solo per sviluppo/test: non va mai deployato.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

export function createGas({ root, props = {}, sheets = {} }) {
  const mails = [];
  const store = new Map(); // cache: key -> {v, exp}
  const now = () => Date.now();
  const sheetObj = (name) => {
    const data = sheets[name];
    return {
      getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
      appendRow: (r) => data.push(r.map((v) => (v instanceof Date ? v.toISOString() : v))),
      getName: () => name,
    };
  };
  const ctx = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...props }),
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = store.get(k); if (!e || e.exp < now()) { store.delete(k); return null; } return e.v; },
        put: (k, v, sec) => { if (sec > 21600) throw new Error('TTL > 6h'); store.set(k, { v: String(v), exp: now() + sec * 1000 }); },
        remove: (k) => store.delete(k),
      }),
    },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => (sheets[n] ? sheetObj(n) : null) }) },
    MailApp: { sendEmail: (m) => mails.push(m), getRemainingDailyQuota: () => 100 },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => [...crypto.createHash(alg).update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
    },
  };
  vm.createContext(ctx);
  const dir = path.join(root, 'apps-script');
  for (const f of ['Config.gs', 'Logic.gs', 'Code.gs', 'Auth.gs', 'Setup.gs']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  return {
    ctx,
    mails,
    cache: store,
    doPost: (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent()),
    lastOtp: (email) => {
      const m = [...mails].reverse().find((x) => x.to === email);
      return m ? (m.body.match(/\b(\d{6})\b/) || [])[1] : null;
    },
  };
}

export function seedSheets() {
  return {
    Utenti: [
      ['EMAIL', 'NOME', 'COGNOME', 'DIP', 'RUOLO', 'PROFILO', 'ATTIVO'],
      ['mario.rossi@test.invalid', 'Mario', 'Rossi', 'CL', 'Head', 'admin', 'Sì'],
      ['ex.utente@test.invalid', 'Ex', 'Utente', 'TP', 'Senior', 'utente', 'No'],
    ],
    Parametri: [['CHIAVE', 'VALORE', 'DESCRIZIONE'], ['versione_catalogo', '20261118-164303', ''],
      ['nota_mail_otp', 'Codice di accesso al Preventivatore Bacciardi Partners', '']],
    Log: [['TS', 'LIVELLO', 'AZIONE', 'UTENTE', 'DETTAGLIO']],
  };
}

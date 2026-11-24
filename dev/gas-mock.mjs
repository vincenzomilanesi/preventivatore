/**
 * Simulatore dei servizi Google per collaudare in locale i file apps-script/*.gs SENZA modificarli.
 * Carica i .gs in un contesto vm con stub di PropertiesService, CacheService, SpreadsheetApp, MailApp,
 * Utilities, ContentService, LockService. Solo per sviluppo/test: non va mai deployato.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

export function createGas({ root, props = {}, sheets = {}, catalogo = null, files = [] }) {
  const mails = [];
  const validations = []; // {sheet, row, col, rows, cols, rule}
  const store = new Map(); // cache: key -> {v, exp}
  const now = () => Date.now();
  const sheetObj = (name) => {
    const data = sheets[name];
    return {
      getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
      appendRow: (r) => data.push(r.map((v) => (v instanceof Date ? v.toISOString() : v))),
      getName: () => name,
      getLastRow: () => data.length,
      getMaxRows: () => Math.max(data.length, 1000),
      getMaxColumns: () => Math.max(26, ...data.map((r) => r.length)),
      insertRowsAfter() {}, insertColumnsAfter() {}, setFrozenRows() {},
      getRange: (row, col, rows = 1, cols = 1) => {
        const rng = {
          setDataValidation: (rule) => { validations.push({ sheet: name, row, col, rows, cols, rule }); },
          getSheet: () => sheetObj(name),
          setNumberFormat: (f) => { formats.push({ sheet: name, row, rows, f }); return rng; },
          createTextFinder: (val) => {
            const tf = {
              matchEntireCell: () => tf, matchCase: () => tf,
              findAll: () => {
                const out = [];
                for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
                  if (String((data[row - 1 + i] || [])[col - 1 + j] ?? '') === String(val)) out.push({ getRow: () => row + i, getColumn: () => col + j });
                }
                textFinds.push({ sheet: name, val });
                return out;
              },
            };
            return tf;
          },
          setFontWeight: () => rng,
          getValues: () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (data[row - 1 + i] || [])[col - 1 + j] ?? '')),
          clearContent: () => { for (let i = 0; i < rows; i++) { const r = data[row - 1 + i]; if (r) for (let j = 0; j < cols; j++) r[col - 1 + j] = ''; } return rng; },
          setValues: (v) => {
            if (v.length !== rows || v.some((r) => r.length !== cols)) throw new Error('setValues: dimensioni errate');
            // come Sheets: l'apostrofo iniziale forza il testo e non viene restituito da getValues
            v.forEach((r, i) => { const t = data[row - 1 + i] || (data[row - 1 + i] = []); r.forEach((x, j) => {
              if (typeof x === 'string' && x.charAt(0) === "'") { escapes.push({ sheet: name, value: x.slice(1) }); x = x.slice(1); }
              t[col - 1 + j] = x;
            }); });
            // le righe completamente vuote in fondo spariscono (come getDataRange dopo clearContent)
            while (data.length > 1 && data[data.length - 1].every((x) => x === '' || x === null || x === undefined)) data.pop();
            return rng;
          },
        };
        return rng;
      },
    };
  };
  const formats = [];
  const escapes = [];
  const textFinds = [];
  const dvBuilder = () => {
    const r = {};
    const b = {
      requireValueInList: (values, dropdown) => { r.values = values.slice(); r.dropdown = dropdown; return b; },
      setAllowInvalid: (v) => { r.allowInvalid = v; return b; },
      setHelpText: (t) => { r.help = t; return b; },
      build: () => ({ ...r }),
    };
    return b;
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
        put: (k, v, sec) => {
          if (sec > 21600) throw new Error('TTL > 6h');
          if (Buffer.byteLength(String(v), 'utf8') > 100 * 1024) throw new Error('valore > 100 KB');
          store.set(k, { v: String(v), exp: now() + sec * 1000 });
        },
        getAll(keys) { const o = {}; keys.forEach((k) => { const v = this.get(k); if (v !== null) o[k] = v; }); return o; },
        putAll(obj, sec) { Object.keys(obj).forEach((k) => this.put(k, obj[k], sec)); },
        remove: (k) => store.delete(k),
      }),
    },
    DriveApp: {
      getFolderById: (id) => {
        if (id !== props.IMPORT_FOLDER_ID) throw new Error('folder not found');
        return { getFiles: () => { const l = files.slice(); return { hasNext: () => l.length > 0, next: () => l.shift() }; } };
      },
    },
    SpreadsheetApp: {
      getActive: () => ({ getSheetByName: (n) => (sheets[n] ? sheetObj(n) : null) }),
      newDataValidation: dvBuilder,
      openById: (id) => {
        if (!catalogo || id !== props.DB_CATALOGO_ID) throw new Error('not found');
        return { getSheetByName: (n) => (catalogo[n] ? { getDataRange: () => ({ getValues: () => catalogo[n].map((r) => r.slice()) }) } : null) };
      },
    },
    MailApp: { sendEmail: (m) => mails.push(m), getRemainingDailyQuota: () => 100 },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => d.toISOString().slice(0, 16).replace('T', ' '),
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
  for (const f of ['Config.gs', 'Logic.gs', 'Code.gs', 'Auth.gs', 'Setup.gs', 'Import.gs', 'Clienti.gs']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  return {
    ctx,
    mails,
    validations,
    formats,
    escapes,
    textFinds,
    sheetObj,
    cache: store,
    doPost: (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent()),
    lastOtp: (email) => {
      const m = [...mails].reverse().find((x) => x.to === email);
      return m ? (m.body.match(/\b(\d{6})\b/) || [])[1] : null;
    },
  };
}

let SCHEMA = null;
/** Schema dei fogli letto da apps-script/Config.gs (una sola fonte di verità). */
function schema() {
  if (!SCHEMA) {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'apps-script', 'Config.gs'), 'utf8'), ctx);
    SCHEMA = ctx.REGISTRO_SCHEMA;
  }
  return SCHEMA;
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
    Clienti: [schema().Clienti.slice()],
    Referenti: [schema().Referenti.slice()],
    Report_import: [['TS', 'IMPORT', 'ESITO', 'ID_HUBSPOT', 'NOME', 'DETTAGLIO']],
    Contatori: [['CHIAVE', 'VALORE'], ['PRV-2026', 0]],
  };
}

/** Clienti e referenti inventati (dominio test.invalid) per il server di sviluppo e i test. */
export function seedClienti(g) {
  const L = g.ctx;
  const now = '2026-11-24 10:00';
  const base = { ORIGINE: 'hubspot', STATO_HUBSPOT: 'sincronizzato', CREATO_DA: 'seed', CREATO_IL: now, AGGIORNATO_IL: now };
  const clienti = [
    { ID_CLIENTE: 'CLI-000001', ID_ELIBRA: '501', CLIENTE_ELIBRA: 'Sì', ID_HUBSPOT: '1001', TIPO: 'azienda', RAGIONE_SOCIALE: 'Alfa Meccanica Srl', PIVA: '01234567897',
      INDIRIZZO: 'Via Roma 1', CAP: '61121', CITTA: 'Pesaro', PROVINCIA: 'Pesaro-Urbino', PAESE: 'Italy', DOMINIO: 'alfa.test.invalid', TELEFONO: '+39 0721 000000' },
    { ID_CLIENTE: 'CLI-000002', ID_HUBSPOT: '1002', TIPO: 'azienda', RAGIONE_SOCIALE: 'Alfa', CITTA: 'Fano', PAESE: 'Italy', DOMINIO: 'alfa2.test.invalid' },
    { ID_CLIENTE: 'CLI-000003', ID_HUBSPOT: '1003', TIPO: 'azienda', RAGIONE_SOCIALE: 'Beta Società Agricola', PIVA: '12345678903', CITTA: 'Urbino', PAESE: 'Italy', DOMINIO: 'beta.test.invalid' },
    { ID_CLIENTE: 'CLI-000004', ID_HUBSPOT: '2003', TIPO: 'persona', NOME: 'Carla', COGNOME: 'Neri', CF: 'RSSMRA80A01H501U', EMAIL: 'carla@privato.test.invalid', CITTA: 'Roma' },
    { ID_CLIENTE: 'CLI-000005', ID_HUBSPOT: '1005', TIPO: 'azienda', RAGIONE_SOCIALE: 'Gamma Alfabeto SpA', CITTA: 'Ancona', PAESE: 'Italy' },
  ].map((o) => ({ ...base, ...o }));
  clienti.forEach((o) => { o.RICERCA = L.searchText_(o); });
  const referenti = [
    { ID_REFERENTE: 'REF-000001', ID_HUBSPOT: '3001', ID_CLIENTE: 'CLI-000001', NOME: 'Anna', COGNOME: 'Bianchi', EMAIL: 'anna.bianchi@alfa.test.invalid', TELEFONO: '' },
    { ID_REFERENTE: 'REF-000002', ID_HUBSPOT: '3002', ID_CLIENTE: 'CLI-000001', NOME: 'Bruno', COGNOME: 'Verdi', EMAIL: 'bruno.verdi@alfa.test.invalid', TELEFONO: '+39 333 0000000' },
    { ID_REFERENTE: 'REF-000003', ID_HUBSPOT: '3003', ID_CLIENTE: 'CLI-000003', NOME: 'Dario', COGNOME: 'Rossini', EMAIL: 'dario@beta.test.invalid', TELEFONO: '' },
  ].map((o) => ({ ...base, ...o }));
  referenti.forEach((o) => { o.RICERCA = L.searchText_(o); });
  L.writeTable_('Clienti', clienti);
  L.writeTable_('Referenti', referenti);
}

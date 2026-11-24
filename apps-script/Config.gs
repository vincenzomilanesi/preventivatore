/**
 * Configurazione del backend Preventivatore (fase 1: Google Sheet + Apps Script).
 *
 * Lo script è "container-bound" al Google Sheet "Preventivatore_Registro".
 * Proprietà dello script (Impostazioni progetto > Proprietà script), create/verificate dal menu
 * "Preventivatore > Inizializza struttura":
 *   PROXY_SECRET          segreto condiviso con la Pages Function Cloudflare (generato dal setup)
 *   ALLOWED_DOMAINS       domini e-mail ammessi al login, separati da virgola (es. bacciardipartners.it)
 *   DB_CATALOGO_ID        ID del Google Sheet DB_Catalogo (SERVIZI, ATTIVITA, PILLAR, _LISTE)
 *   PREVENTIVI_FOLDER_ID  ID della cartella Drive "Preventivi" (creata dal setup)
 *   IMPORT_FOLDER_ID      ID della cartella Drive "import_hubspot" (creata dal setup)
 *   OTP_TTL_MIN           validità codice OTP in minuti (default 10)
 *   SESSION_TTL_MIN       durata sessione in minuti, rinnovata a ogni chiamata (default 240, max 360)
 */
var APP_VERSION = '0.2.0';

/**
 * Valori ammessi nelle tendine del foglio Utenti (create da "Inizializza / verifica struttura").
 * DIP: letto da DB_Catalogo › _LISTE (colonna con intestazione DIP); USERS_DIP_FALLBACK solo se il catalogo
 * non è raggiungibile. RUOLO: regola 6 dell'handoff 18/11. strict=false → valore fuori lista accettato con avviso.
 */
var USERS_VALIDATION = {
  DIP: { strict: false },
  RUOLO: { values: ['Head', 'Of Counsel', 'Senior', 'Junior', 'Trainee'], strict: false },
  PROFILO: { values: ['utente', 'admin'], strict: true },
  ATTIVO: { values: ['Sì', 'No'], strict: true }
};
var USERS_DIP_FALLBACK = ['ICL', 'CL', 'TAX', 'TP', 'GM', 'RE', 'CF', 'LIT', 'LAB', 'SSI', 'CNT', 'OPE'];
var USERS_VALIDATION_ROWS = 500;

/** Schema dei fogli del Registro: deve restare 1:1 con le future liste SharePoint (fase 2). */
var REGISTRO_SCHEMA = {
  Utenti: ['EMAIL', 'NOME', 'COGNOME', 'DIP', 'RUOLO', 'PROFILO', 'ATTIVO'],
  Clienti: ['ID_CLIENTE', 'ID_HUBSPOT', 'ID_HUBSPOT_ALTRI', 'TIPO', 'RAGIONE_SOCIALE', 'NOME', 'COGNOME', 'PIVA', 'CF',
            'EMAIL', 'TELEFONO', 'INDIRIZZO', 'CAP', 'CITTA', 'PROVINCIA', 'PAESE', 'DOMINIO', 'ORIGINE',
            'STATO_HUBSPOT', 'CREATO_DA', 'CREATO_IL', 'AGGIORNATO_IL', 'ESPORTATO_IL', 'RICERCA'],
  Referenti: ['ID_REFERENTE', 'ID_HUBSPOT', 'ID_CLIENTE', 'NOME', 'COGNOME', 'EMAIL', 'TELEFONO', 'ORIGINE',
              'STATO_HUBSPOT', 'CREATO_DA', 'CREATO_IL', 'AGGIORNATO_IL', 'ESPORTATO_IL', 'RICERCA'],
  Report_import: ['TS', 'IMPORT', 'ESITO', 'ID_HUBSPOT', 'NOME', 'DETTAGLIO'],
  Entita: ['ENTITA', 'RAGIONE_SOCIALE', 'SEDE_LEGALE', 'SEDI', 'PIVA', 'CF', 'PEC', 'TELEFONO', 'EMAIL', 'SITO',
           'LOGO_URL'],
  RegistroPreventivi: ['NUMERO', 'DATA', 'UTENTE', 'PILLAR', 'ID_CLIENTE', 'CLIENTE', 'ENTITA', 'SERVIZI', 'TOTALE',
                       'VERSIONE_CATALOGO', 'LINK_PDF', 'LINK_XLSX', 'COLLEGATO_A', 'SUBMISSION_ID', 'NOTE_HTML'],
  Contatori: ['CHIAVE', 'VALORE'],
  Parametri: ['CHIAVE', 'VALORE', 'DESCRIZIONE'],
  Log: ['TS', 'LIVELLO', 'AZIONE', 'UTENTE', 'DETTAGLIO']
};

var PARAMETRI_DEFAULT = [
  ['versione_catalogo', '', 'Versione del catalogo pubblicata (scritta da "Verifica e pubblica catalogo")'],
  ['nota_mail_otp', 'Codice di accesso al Preventivatore Bacciardi Partners', 'Oggetto della mail OTP']
];

/** Fogli scritti come testo semplice (formato @): CAP, P.IVA e ID HubSpot non devono diventare numeri. */
var TEXT_SHEETS = ['Clienti', 'Referenti', 'Report_import'];

/**
 * Colonne degli export HubSpot (chiave logica → intestazioni ammesse, italiano e inglese).
 * Gli export vanno fatti con "solo proprietà nella vista" e le colonne elencate in SPEC §5bis.
 */
var HUBSPOT_COLS = {
  aziende: {
    ID: ['ID record', 'Record ID'], NOME: ['Nome azienda', 'Company name'],
    DOMINIO: ['Nome dominio azienda', 'Company Domain Name'], PIVA: ['Partita IVA'],
    INDIRIZZO: ['Indirizzo', 'Street Address'], INDIRIZZO2: ['Indirizzo 2', 'Street Address 2'],
    CAP: ['Codice postale', 'Postal Code'], CITTA: ['Città', 'City'], PROVINCIA: ['Provincia'],
    PAESE: ['Paese/Regione', 'Country/Region'], NAZIONE: ['Nazione'],
    TELEFONO: ['Numero di telefono', 'Phone Number'], MODIFICATO: ['Data ultima modifica', 'Last Modified Date']
  },
  contatti: {
    ID: ['ID record', 'Record ID'], NOME: ['Nome', 'First Name'], COGNOME: ['Cognome', 'Last Name'],
    EMAIL: ['E-mail', 'Email'], TELEFONO: ['Numero di telefono', 'Phone Number'], CF: ['Codice fiscale'],
    AZIENDA_PRIMARIA: ['Associated Company IDs (Primary)'], AZIENDE: ['Associated Company IDs'],
    FASE: ['Fase del ciclo di vita', 'Lifecycle Stage'], MODIFICATO: ['Data ultima modifica', 'Last Modified Date']
  }
};

/** Fasi del ciclo di vita "oltre Lead": i contatti senza azienda in queste fasi diventano clienti persona (C4). */
var HUBSPOT_FASI_AVANZATE = ['Lead qualificato per il marketing', 'Lead qualificato per le vendite', 'Opportunità',
  'Cliente', 'Evangelist', 'Marketing Qualified Lead', 'Sales Qualified Lead', 'Opportunity', 'Customer'];

/** Provider di posta/PEC: un'azienda HubSpot con questo dominio e senza P.IVA è stata creata da un'e-mail privata. */
var MAIL_PROVIDER_DOMAINS = ['191.it', 'gmail.com', 'googlemail.com', 'libero.it', 'hotmail.com', 'hotmail.it',
  'yahoo.com', 'yahoo.it', 'outlook.com', 'outlook.it', 'alice.it', 'tiscali.it', 'virgilio.it', 'tin.it', 'live.com',
  'live.it', 'icloud.com', 'me.com', 'fastwebnet.it', 'email.it', 'inwind.it', 'iol.it', 'msn.com', 'aol.com',
  'gmx.com', 'gmx.de', 'teletu.it', 'katamail.com', 'pec.it', 'legalmail.it', 'postecert.it', 'arubapec.it'];

var PAESE_ALIAS = { 'United States of America': 'United States', 'England': 'United Kingdom',
  'Scotland': 'United Kingdom', 'Wales': 'United Kingdom', 'Northern Ireland': 'United Kingdom' };

var DB_CATALOGO_SHEETS = ['SERVIZI', 'ATTIVITA', 'PILLAR', '_LISTE'];

function cfg_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  return {
    PROXY_SECRET: p.PROXY_SECRET || '',
    ALLOWED_DOMAINS: (p.ALLOWED_DOMAINS || '').split(',').map(function (d) { return d.trim().toLowerCase(); })
      .filter(String),
    DB_CATALOGO_ID: p.DB_CATALOGO_ID || '',
    PREVENTIVI_FOLDER_ID: p.PREVENTIVI_FOLDER_ID || '',
    IMPORT_FOLDER_ID: p.IMPORT_FOLDER_ID || '',
    OTP_TTL_MIN: Math.min(Number(p.OTP_TTL_MIN || 10), 30),
    SESSION_TTL_MIN: Math.min(Number(p.SESSION_TTL_MIN || 240), 360)   // CacheService: max 6 ore
  };
}

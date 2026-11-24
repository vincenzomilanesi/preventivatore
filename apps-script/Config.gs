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
var APP_VERSION = '0.5.0';

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
  Clienti: ['ID_CLIENTE', 'ID_ELIBRA', 'ID_HUBSPOT', 'ID_HUBSPOT_ALTRI', 'CLIENTE_ELIBRA', 'TIPO', 'RAGIONE_SOCIALE', 'NOME', 'COGNOME', 'PIVA', 'CF',
            'EMAIL', 'TELEFONO', 'INDIRIZZO', 'CAP', 'CITTA', 'PROVINCIA', 'PAESE', 'DOMINIO', 'ORIGINE',
            'STATO_HUBSPOT', 'CREATO_DA', 'CREATO_IL', 'AGGIORNATO_IL', 'ESPORTATO_IL', 'RICERCA'],
  Referenti: ['ID_REFERENTE', 'ID_ELIBRA', 'ID_HUBSPOT', 'ID_CLIENTE', 'NOME', 'COGNOME', 'EMAIL', 'TELEFONO', 'ORIGINE',
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

/** Colonne degli export eLibra (anagrafiche: Persone giuridiche, Persone fisiche), salvati come CSV. */
var ELIBRA_COLS = {
  pg: { ID: ['ID'], NOME: ['Ragione Sociale'], PIVA: ['Partita IVA'], PIVA_UE: ['Partita IVA UE'],
    CF: ['Codice Fiscale'], INDIRIZZO: ['Indirizzo'], CAP: ['CAP'], CITTA: ['Città'], PROVINCIA: ['Provincia'],
    PAESE: ['Paese'], CLIENTE: ['Cliente'] },
  pf: { ID: ['ID'], NOMINATIVO: ['Cognome e Nome'], CF: ['Codice Fiscale'], PIVA: ['Partita IVA'],
    INDIRIZZO: ['Indirizzo'], CAP: ['CAP'], CITTA: ['Città'], PROVINCIA: ['Provincia'], PAESE: ['Paese'],
    PG: ['PG collegata'], CLIENTE: ['Cliente'] }
};

/**
 * Campi scritti da ciascuna fonte (decisione 24/11: eLibra principale). Su una riga che ha già ID_ELIBRA,
 * HubSpot scrive solo i campi "_SU_ELIBRA" (dominio, telefono, e-mail), mai quelli anagrafici/fiscali.
 */
var FIELDS = {
  ELIBRA_AZIENDA: ['RAGIONE_SOCIALE', 'PIVA', 'CF', 'INDIRIZZO', 'CAP', 'CITTA', 'PROVINCIA', 'PAESE', 'CLIENTE_ELIBRA'],
  ELIBRA_PERSONA: ['NOME', 'COGNOME', 'CF', 'PIVA', 'INDIRIZZO', 'CAP', 'CITTA', 'PROVINCIA', 'PAESE', 'CLIENTE_ELIBRA'],
  ELIBRA_REFERENTE: ['ID_CLIENTE', 'NOME', 'COGNOME'],
  HUBSPOT_AZIENDA: ['RAGIONE_SOCIALE', 'PIVA', 'TELEFONO', 'INDIRIZZO', 'CAP', 'CITTA', 'PROVINCIA', 'PAESE', 'DOMINIO'],
  HUBSPOT_AZIENDA_SU_ELIBRA: ['TELEFONO', 'DOMINIO'],
  HUBSPOT_PERSONA: ['NOME', 'COGNOME', 'EMAIL', 'TELEFONO', 'CF'],
  HUBSPOT_PERSONA_SU_ELIBRA: ['EMAIL', 'TELEFONO'],
  HUBSPOT_REFERENTE: ['ID_CLIENTE', 'NOME', 'COGNOME', 'EMAIL', 'TELEFONO'],
  HUBSPOT_REFERENTE_SU_ELIBRA: ['EMAIL', 'TELEFONO']
};

/** Fasi del ciclo di vita "oltre Lead": i contatti senza azienda in queste fasi diventano clienti persona (C4). */
var HUBSPOT_FASI_AVANZATE = ['Lead qualificato per il marketing', 'Lead qualificato per le vendite', 'Opportunità',
  'Cliente', 'Evangelist', 'Marketing Qualified Lead', 'Sales Qualified Lead', 'Opportunity', 'Customer'];

/** Provider di posta/PEC: un'azienda HubSpot con questo dominio e senza P.IVA è stata creata da un'e-mail privata. */
var MAIL_PROVIDER_DOMAINS = ['191.it', 'gmail.com', 'googlemail.com', 'libero.it', 'hotmail.com', 'hotmail.it',
  'yahoo.com', 'yahoo.it', 'outlook.com', 'outlook.it', 'alice.it', 'tiscali.it', 'virgilio.it', 'tin.it', 'live.com',
  'live.it', 'icloud.com', 'me.com', 'fastwebnet.it', 'email.it', 'inwind.it', 'iol.it', 'msn.com', 'aol.com',
  'gmx.com', 'gmx.de', 'teletu.it', 'katamail.com', 'pec.it', 'legalmail.it', 'postecert.it', 'arubapec.it'];

/**
 * Paesi in italiano, uguali per eLibra e HubSpot (chiave: nome in minuscolo come arriva dalle fonti).
 * I nomi non in tabella restano come sono (con iniziali maiuscole se erano tutti maiuscoli).
 */
var PAESE_ALIAS = {
  'italy': 'Italia', 'italia': 'Italia', 'it': 'Italia', 'united states': 'Stati Uniti', 'united states of america': 'Stati Uniti',
  'usa': 'Stati Uniti', 'stati uniti d\'america': 'Stati Uniti', 'united kingdom': 'Regno Unito', 'uk': 'Regno Unito',
  'england': 'Regno Unito', 'scotland': 'Regno Unito', 'wales': 'Regno Unito', 'northern ireland': 'Regno Unito',
  'great britain': 'Regno Unito', 'france': 'Francia', 'germany': 'Germania', 'canada': 'Canada', 'switzerland': 'Svizzera',
  'india': 'India', 'san marino': 'San Marino', 'rsm': 'San Marino', 'rep. san marino': 'San Marino',
  'repubblica di san marino': 'San Marino', 'netherlands': 'Paesi Bassi', 'the netherlands': 'Paesi Bassi',
  'brazil': 'Brasile', 'spain': 'Spagna', 'espana': 'Spagna', 'españa': 'Spagna', 'belgium': 'Belgio',
  'australia': 'Australia', 'japan': 'Giappone', 'mexico': 'Messico', 'sweden': 'Svezia', 'china': 'Cina',
  'cyprus': 'Cipro', 'singapore': 'Singapore', 'united arab emirates': 'Emirati Arabi Uniti', 'south africa': 'Sudafrica',
  'malta': 'Malta', 'portugal': 'Portogallo', 'poland': 'Polonia', 'hong kong': 'Hong Kong', 'nigeria': 'Nigeria',
  'turkey': 'Turchia', 'türkiye': 'Turchia', 'romania': 'Romania', 'luxembourg': 'Lussemburgo', 'israel': 'Israele',
  'finland': 'Finlandia', 'austria': 'Austria', 'hungary': 'Ungheria', 'indonesia': 'Indonesia', 'philippines': 'Filippine',
  'czech republic': 'Repubblica Ceca', 'czechia': 'Repubblica Ceca', 'ireland': 'Irlanda', 'new zealand': 'Nuova Zelanda',
  'bulgaria': 'Bulgaria', 'denmark': 'Danimarca', 'norway': 'Norvegia', 'croatia': 'Croazia',
  'russian federation': 'Russia', 'federazione russa': 'Russia', 'russia': 'Russia', 'saudi arabia': 'Arabia Saudita',
  'malaysia': 'Malesia', 'egypt': 'Egitto', 'kazakhstan': 'Kazakistan', 'argentina': 'Argentina', 'mauritius': 'Mauritius',
  'panama': 'Panama', 'lebanon': 'Libano', 'greece': 'Grecia', 'korea, republic of': 'Corea del Sud', 'south korea': 'Corea del Sud',
  'thailand': 'Thailandia', 'slovenia': 'Slovenia', 'serbia': 'Serbia', 'albania': 'Albania', 'tunisia': 'Tunisia',
  'slovakia': 'Slovacchia', 'monaco': 'Monaco', 'liechtenstein': 'Liechtenstein', 'morocco': 'Marocco', 'qatar': 'Qatar'
};

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

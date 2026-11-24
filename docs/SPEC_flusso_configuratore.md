# Specifica flusso configuratore – v0.3 (18/11/2026)

Fonte: indicazioni di Vincenzo Milanesi in chat del 18/11/2026. Architettura: handoff §7 (fase 1 Google Sheet + Apps Script, fase 2 M365).

## 1. Flusso utente

| # | Passo | Cosa vede / fa l'utente | Dati letti | Dati scritti |
|---|---|---|---|---|
| 1 | **Login** | OTP via mail, dominio dello Studio. L'utenza è associata a **un singolo professionista** | `Utenti` | sessione |
| 2 | **Pillar** | sceglie un pillar **attivo** dal foglio `PILLAR`: dipartimentale (Legal & Corporate, Tax & Cross-border, Corporate Finance) o **trasversale** creato dall'admin per offerte multi-dipartimento | `PILLAR` | – |
| 3 | **Cliente** | ricerca per **nome, cognome, ragione sociale, P.IVA, e-mail** su anagrafica importata da HubSpot | `Clienti` | – |
| 4 | **Ambito** | sceglie l'ambito (L1) tra quelli dei servizi del pillar (origine `PILLAR` o `PILLAR_AGGIUNTIVI`) | `SERVIZI.AMBITO` (solo servizi pubblicabili) | – |
| 5 | **Servizi + modalità + importo** | sceglie **uno o più servizi** del pillar. Per ciascuno: modalità **Corpo** o **T&M** (tra quelle in `MODALITA_AMMESSE`), spunta delle attività "Solo se richiesto", **importo inserito a mano** (Corpo: € a corpo; T&M: €/h + ore stimate, precompilate da ORE_MIN–MAX → budget). Per ogni servizio sono mostrati dipartimento e head | `SERVIZI`, `ATTIVITA` | – |
| 6 | **Note** | campo note max **1000 caratteri** con grassetto, corsivo, sottolineato, elenco puntato | – | – |
| 7 | **Dati Bacciardi** | intestazione con i dati dell'entità che emette (SLB o BPCF Srl, da `SERVIZI.ENTITA`) | `Entita` | – |
| 8 | **Verifica ed esporta** | riepilogo; alla conferma numero `PRV-AAAA-NNNN`, export **PDF** (A4, carta intestata) ed **Excel** | tutti | `RegistroPreventivi`, file su Drive |

Importi: **manuali** in v1 (decisione D). Il server ricontrolla i numeri (≥ 0, formato) e ricalcola i totali;
le ore mostrate vengono dal catalogo. Tariffe per ruolo e moltiplicatori restano per una versione successiva.

### Pillar trasversali (preventivi multi-dipartimento)
- I pillar non sono più una lista fissa: stanno nel foglio `PILLAR` di DB_Catalogo (PILLAR, DESCRIZIONE, TIPO
  Dipartimentale/Trasversale, ORDINE, ATTIVO, N_SERVIZI calcolato).
- Ogni servizio ha un pillar di **origine** (`SERVIZI.PILLAR`, quello del dipartimento) e può comparire in altri pillar
  tramite `SERVIZI.PILLAR_AGGIUNTIVI` (nomi separati da `;`).
- Per creare un'offerta multi-dipartimento: riga nuova in `PILLAR` con TIPO=Trasversale e ATTIVO=Sì, poi il nome
  in `PILLAR_AGGIUNTIVI` dei servizi da includere. Il validatore blocca nomi inesistenti o duplicati.
- Esempio (solo test, non nel DB): "Internazionalizzazione" = ICL-RED + TP-PRE + GM-ASS.

## 2. Dati aggiuntivi rispetto al DB_Catalogo

| Foglio | Colonne proposte | Note |
|---|---|---|
| `Utenti` | EMAIL, NOME, COGNOME, DIP, RUOLO (Head/Of Counsel/Senior/…), PROFILO (utente/admin), ATTIVO | una riga = un professionista; login = email |
| `Clienti` | ID_HUBSPOT, TIPO (azienda/persona), RAGIONE_SOCIALE, NOME, COGNOME, PIVA, CF, EMAIL, CITTA, PAESE, ID_AZIENDA_HUBSPOT, AGGIORNATO_IL | import periodico da export HubSpot; solo colonne necessarie (minimizzazione GDPR) |
| `Entita` | ENTITA, RAGIONE_SOCIALE, SEDE_LEGALE, SEDI, PIVA, CF, PEC, TEL, EMAIL, SITO, LOGO | da verificare con lo Studio prima dell'uso |
| `RegistroPreventivi` | come handoff §7.2 + PILLAR, MODALITA, NOTE_HTML | |

### Import HubSpot – stato
- File ricevuto: `tutti-gli-elementi-contatti.csv` (18 MB, 331 colonne). È un export **contatti** (persone):
  contiene nome, cognome, e-mail, telefono, azienda associata, ma **nessuna colonna P.IVA valorizzata**
  e molti campi di marketing/tracciamento non necessari.
- Il connettore Drive scarica al massimo 10 MB: dall'ambiente cloud ne sono state lette solo ~200 righe.
- Serve in aggiunta (o in sostituzione) l'export **Aziende** di HubSpot con: Record ID, Nome azienda, P.IVA /
  Codice fiscale, Città, Paese. Meglio esportare **solo le colonne necessarie**: il file resta piccolo e non porta
  dati personali superflui. Il CSV non va nel repository git se il repo verrà pubblicato su GitHub.

## 3. Note (campo rich text)
- Editor leggero (contenteditable con 4 comandi) → salvato come HTML con whitelist `b, i, u, ul, li, br, p`;
  qualsiasi altro tag rimosso lato server.
- Limite 1000 caratteri **di testo visibile** (tag esclusi), contatore in pagina, controllo ripetuto lato server.
- PDF: HTML reso così com'è. Excel: testo semplice (elenchi resi con “• ”), perché le celle Excel non gestiscono bene il rich text generato.

## 4. Decisioni (18/11/2026)

| # | Tema | Decisione |
|---|---|---|
| A | Firmatario | Head del `DIP_OWNER` di ciascun servizio |
| B | Servizi per preventivo | Più servizi; modalità T&M/Corpo scelta per servizio |
| C | Attività opzionali | Checkbox sulle attività "Solo se richiesto" (+ quantità); driver D01–D17 rinviati alla v2 |
| D | Importi | **Inseriti a mano** dal professionista |
| E | Cliente non presente | Inserimento da zero, marcato "da censire in HubSpot" (dettaglio in §5) |
| G | Multi-dipartimento | Esistono preventivi multi-dipartimento → pillar trasversali creati dall'admin (vedi §1) |
| H | Firmatario capofila | Head del dipartimento del professionista che crea il preventivo; gli altri head elencati come referenti dei propri servizi |
| F | Entità mista | Alla conferma si generano **due preventivi collegati** (es. PRV-2026-0012-SLB / -BPCF), ciascuno con la propria carta intestata, più un riepilogo unico |
| I | Nuovi clienti | Il cliente si può **inserire da zero** nel configuratore; i clienti nuovi si esportano in **CSV per l'import in HubSpot** (vedi §5) |

## 5. Clienti nuovi ed export verso HubSpot (da dettagliare – sessione del 19/11)

- Passo 3: se la ricerca non trova il cliente, form "Nuovo cliente". Campi minimi da definire su base export Aziende
  (proposta: tipo azienda/persona, ragione sociale o nome+cognome, P.IVA/CF, e-mail, telefono, indirizzo, città, paese).
  Controllo duplicati su P.IVA/CF ed e-mail prima del salvataggio.
- Il cliente nuovo va in `Clienti` con ORIGINE=configuratore, STATO_HUBSPOT=da esportare, utente e data di creazione.
- Funzione admin "Esporta clienti per HubSpot": CSV con intestazioni compatibili con l'import HubSpot (Aziende e,
  se presenti, Contatti associati), solo i record "da esportare"; dopo il download STATO_HUBSPOT=esportato + data.
- Al successivo import dell'export HubSpot i record si riconciliano (P.IVA/e-mail) e ricevono l'ID HubSpot.

## 5bis. Clienti – analisi export Aziende e decisioni (24/11/2026)

**Export Aziende HubSpot** (`tutti-gli-elementi-aziende.csv`, 12 MB, 7.759 righe × 219 colonne, 115 vuote; solo in
locale nella sessione, mai nel repo). Dati aggregati:
- 92% delle aziende creato in automatico da HubSpot dal dominio e-mail dei contatti (webinar, inviti): è la base
  marketing, non l'anagrafica clienti. `Cliente attuale` = Sì sul 96%, fase = Lead sul 99,9%: flag inutilizzabili.
- P.IVA su 781 aziende (10%), 11 cifre, 1 con checksum errato; 60 P.IVA ripetute su 137 righe. CF, PEC, SDI assenti.
- Scarti: 192 senza nome; 143 "Artidea" create da sottodomini di 191.it (provider di posta).
- 196 gruppi di nomi uguali (709 righe), in 107 con domini diversi: non si uniscono in automatico.
- `Associated Contact` = "Nome Cognome (e-mail)" dei contatti (6.964 distinti): dato personale, non si importa da qui.

| # | Tema | Decisione |
|---|---|---|
| C1 | Fonte P.IVA/CF/indirizzi | Esiste un'anagrafica nel gestionale dello Studio: **da estrarre e valutare**; per ora solo HubSpot |
| C2 | Aziende da importare | **Tutte tranne gli scarti** (senza nome, "Artidea"), ~7.420 |
| C3 | Persone | Foglio **Referenti** separato; Clienti = intestatari del preventivo (aziende e persone fisiche) |
| C4 | Contatti da importare | Quelli **associati alle aziende importate** + quelli **senza azienda con fase del ciclo di vita oltre Lead** (→ Clienti, TIPO persona) |
| C5 | Schema | Approvato (sotto) |
| C6 | Cliente nuovo, obbligatori | Ragione sociale o nome+cognome, città, **e almeno uno tra e-mail e P.IVA/CF** |
| C7 | Proprietà HubSpot "ID Preventivatore" | **Da chiedere all'admin HubSpot**; intanto riconciliazione su P.IVA/CF ed e-mail |
| C8 | P.IVA doppie | Scelta automatica della riga più completa/recente, altri ID HubSpot conservati, report per unirle in HubSpot |
| C9 | Chi fa import/export | **Comunicazione/Marketing**, a mano con CSV, quando serve |

**Schema approvato** (Registro):
- `Clienti`: ID_CLIENTE, ID_HUBSPOT, TIPO, RAGIONE_SOCIALE, NOME, COGNOME, PIVA, CF, EMAIL, TELEFONO, INDIRIZZO,
  CAP, CITTA, PROVINCIA, PAESE, DOMINIO, ORIGINE, STATO_HUBSPOT, CREATO_DA, CREATO_IL, AGGIORNATO_IL, ESPORTATO_IL,
  RICERCA (+ ID_HUBSPOT_ALTRI per i doppioni, conseguenza di C8).
- `Referenti`: ID_REFERENTE, ID_HUBSPOT, ID_CLIENTE, NOME, COGNOME, EMAIL, TELEFONO, ORIGINE, STATO_HUBSPOT,
  CREATO_DA, CREATO_IL, AGGIORNATO_IL, ESPORTATO_IL, RICERCA.
- STATO_HUBSPOT: `sincronizzato` | `da esportare` | `esportato`. ORIGINE: `hubspot` | `configuratore`.

**Export da rifare in HubSpot (solo colonne in vista):**
- Aziende: ID record, Nome azienda, Nome dominio azienda, Partita IVA, Indirizzo, Indirizzo 2, Codice postale, Città,
  Provincia, Paese/Regione, Nazione, Numero di telefono, Data ultima modifica.
- Contatti: ID record, Nome, Cognome, E-mail, Numero di telefono, Associated Company IDs, Fase del ciclo di vita,
  Data ultima modifica (+ codice fiscale se esiste la proprietà).

**Import implementato (v0.2.0, blocchi 1–2):** menu *Preventivatore › Importa da HubSpot (Aziende o Contatti)*;
il CSV va nella cartella Drive `import_hubspot` (creata da "Inizializza struttura"), un file alla volta, prima Aziende
poi Contatti. Tipo riconosciuto dalle intestazioni (italiano o inglese). Idempotente (chiave ID HubSpot + ID_HUBSPOT_ALTRI);
tocca solo righe ORIGINE=hubspot; non cancella (righe assenti nel report); file importato spostato nel cestino.
Scarti aziende: senza nome; dominio di un provider di posta/PEC **senza P.IVA** (regola generale: sul file del 24/11
153 righe = 143 "Artidea" + 10 su legalmail/pec/libero/tin/teletu/fastwebnet). Contatti: telefono fisso sì, cellulare
no (minimizzazione); nel report i contatti scartati sono solo contati, senza nomi. Prova sul file reale (solo locale):
7.337 aziende, 345 scarti, 60 gruppi P.IVA doppie (77 righe unite), reimport = 0 modifiche.

**Ricerca implementata (v0.3.0, blocco 3):** azioni `clienti.search` {q} (2–80 caratteri, max 20 risultati + totale;
tutti i termini anche parziali su ragione sociale/nome/cognome/città/dominio/P.IVA/CF/e-mail; con "@" e-mail intera;
anche tramite i referenti, mostrati come "referente: …") e `clienti.get` {id} (dati del cliente + referenti per
"Alla cortese attenzione di"). Indice compatto in CacheService a blocchi da 40k caratteri, 6 h, invalidato a ogni
import. La ricerca non va nel Log. Nella bozza del browser restano solo ID_CLIENTE e ID_REFERENTE.

**Utenti (24/11):** Martina Cangiotti DIP = OPE, profilo admin confermato. Dominio `bacciardistudiolegale.it` non ammesso.

## 6. Prossimi passi (19/11)
1. Analisi dell'export **Aziende** HubSpot caricato da Vincenzo → struttura del foglio `Clienti` e mappatura colonne.
2. Dettaglio §5 (campi nuovo cliente, formato CSV import HubSpot).
3. Task 2 – identità grafica dal sito (serve il permesso per le richieste HTTP verso i domini Bacciardi).
4. Avvio task 3 – web app (Apps Script + pagine statiche).

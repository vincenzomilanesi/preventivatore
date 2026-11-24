# HANDOFF – Configuratore preventivi Bacciardi Partners

Versione: 18/11/2026 (rev. 3, fase 1 Google Sheet + task brand) · Autore: Vincenzo Milanesi (Blue Star Advice), con supporto AI
Destinatario: Claude Code (o chi riprende il lavoro)
Stato: fase di analisi chiusa → si parte con la **normalizzazione in un DB unico**

---

## 1. Contesto in 10 righe

- **Cliente:** Bacciardi Partners (studio legale e tributario), con la società collegata **BPCF Srl** (Corporate Finance). Progetto di riorganizzazione dei processi seguito da Blue Star Advice (BSA).
- **Obiettivo:** un **configuratore di preventivi** che generi la "versione 0 standard – solo tabella" del preventivo nel **>90% dei casi**, partendo dalle poche informazioni raccolte al primo incontro con il cliente (SAL 05/08/2026).
- **Principi decisi nel SAL 05/08:**
  - **L0** = macro-area di offerta, **L1** = famiglie e prodotti, **L2** = fasi/attività.
  - Il **dipartimento è l'owner** del servizio, non il primo livello dell'albero.
  - Un processo uguale resta uno solo anche se lo svolgono owner diversi (es. parere, due diligence).
  - Prima si standardizza, poi si automatizza.
- **Fonte dei dati:** le "matrici RA / DB-Attività" compilate dai dipartimenti, più le schede di compilazione guidate inviate a ottobre. Gran parte è stata recuperata; alcune mancano ancora (vedi §5).

---

## 2. Cosa è già stato fatto

| Data | Output | Dove (G:\My Drive\Lavoro\BlueStar\Bacciardi\…) |
|---|---|---|
| 01/10 | **Catalogo v4 normalizzato** (database di lavoro BSA, 13 fogli): dipartimenti TO-BE, catalogo, varianti, libreria attività, distinta, driver, modelli prezzo, parametri, pacchetti, simulatore, fuori catalogo, domande, raccordo con la v3 | `2 - Elaborazioni\Bacciardi_Catalogo_Servizi_v4_normalizzato.xlsx` |
| 01/10 | **12 schede di compilazione a prova di errore**, una per dipartimento: fogli protetti, menu a tendina, colonna "Stato", ID nascosti per il reimport. Password **bsa2026** | `2 - Elaborazioni\Schede compilazione catalogo\` |
| 07/10 | Matrice **International Tax v.4** (Transfer Pricing + Fiscalità internazionale) ricondotta allo standard: 16 servizi, 122 attività con effort | stessa cartella, `Scheda_Catalogo_TransferPricing_FiscalitaInternazionale_FV.xlsx` |
| – | **Script Python** che generano il catalogo e le schede | allegati: `data.py`, `build.py`, `scheda_cfg.py`, `gen_scheda.py` |

Gli script sono il riferimento per i contenuti già normalizzati e per le regole di parsing:
- `data.py` contiene tutti i contenuti (dipartimenti, catalogo, varianti, libreria, distinta, driver, modelli prezzo, pacchetti, domande), compreso il blocco di parsing della matrice TP v.4;
- `build.py` genera il catalogo v4;
- `gen_scheda.py` + `scheda_cfg.py` generano le schede.

**Non vanno riusati così come sono per il nuovo DB:** servono come fonte e come esempio di regole.

### Numeri attuali del catalogo (v4, 07/10)
- 75 prodotti, 34 varianti, 269 righe di attività, libreria di 26 attività standard + 7 di processo.
- Effort completo: Transfer Pricing, Global Mobility, Real Estate (in gran parte).
- Solo durata in giorni, senza ore: Corporate Law.
- Senza effort: International Commercial Law.
- Solo elenco prodotti: Corporate Finance, Tax & Customs.
- Da censire da zero: Litigation, Diritto del lavoro, Special Situations, Compliance e Nuove Tecnologie, Organization & People.

---

## 3. Dipartimenti TO-BE (SAL / verbale 05/08/2026)

| Cod. | Dipartimento | Pillar (L0) | Head TO-BE | Entità |
|---|---|---|---|---|
| ICL | International Commercial Law | Legal & Corporate | Tommaso Mancini | Studio (SLB) |
| CL | Corporate Law | Legal & Corporate | Pier Federico Orciari | SLB |
| TAX | Tax & Customs Law (IVA, Dogane) | Tax & Cross-border | Tommaso Fonti | SLB |
| TP | Transfer Pricing e Fiscalità internazionale | Tax & Cross-border | F. Ventura (TP) – matrice v.4 indica T. Fonti HEAD: **da chiarire** | SLB |
| GM | Global Mobility | Tax & Cross-border | Valeria Zega | SLB |
| RE | Real Estate (Luxury) – ora autonomo | Tax & Cross-border | Lucia Boccarossa | SLB |
| CF | Corporate Finance | Corporate Finance | Renato Capanna | **BPCF Srl** |
| LIT | Litigation | da definire | L. Bacciardi (a.i.) / G. Bastianelli | SLB |
| LAB | Diritto del lavoro | Legal & Corporate | Michele Sacchi | SLB |
| SSI | Special Situations | da definire | Francesco Todaro | SLB |
| CNT | Compliance e Nuove Tecnologie | Legal & Corporate | Federico Alessandri | SLB |
| OPE | Organization & People | da definire | da confermare | SLB |

La Segreteria (co-responsabile del preventivo, mandato, antiriciclaggio, apertura pratica) e l'Amministrazione (acconti, fatturazione) non vendono servizi, ma sono attori del processo di preventivo.

---

## 4. Regole di normalizzazione già concordate (da rispettare)

1. **Un servizio è ciò che il cliente acquista.** Preventivo, mandato, antiriciclaggio, apertura pratica, archiviazione, pianificazione interna, marketing e formazione **non sono servizi** e le loro righe si escludono dalle attività. Le si registra però in un log di esclusione: nulla va perso.
2. **Ambito geografico, lingue, n. persone, n. incontri, n. Paesi sono DRIVER** (quantità o parametri del preventivo), non nuovi servizi. Esempio: "CGV Italia/Italia" e "CGV Italia/Estero" sono lo stesso servizio con driver diversi.
3. **Varianti:** nel DB per il configuratore si **appiattiscono**, quindi una riga = un servizio vendibile, come già fatto nelle schede. Esempi: M&A sell-side e buy-side diventano 2 servizi; Fusione, Scissione, Trasformazione e Liquidazione diventano 4 servizi; Local File e Master File 2 servizi.
4. **Effort ≠ Elapsed.**
   - Effort = ore di lavoro, con minimo e massimo.
   - Elapsed = giorni di calendario per il cliente, incluse le attese di terzi.
   - Conversioni dalle fonti: "< 1 h" → 0,5–1; "x – y h" → min x, max y; valore singolo → min = max; 10 min = 0,17 h; 15 min = 0,25; 20 min = 0,33; settimana = 7 gg; mese = 30 gg.
   - Il testo originale si conserva sempre in una colonna dedicata.
5. **"Quando si fa"** ammette solo tre valori: `Sempre` / `Solo se richiesto dal cliente` / `Solo in certi casi`. Non si deduce se la fonte non lo dice: si lascia vuoto e si segnala.
6. **Ruolo prevalente** ammette solo questi valori: `Head` / `Of Counsel` / `Senior` / `Junior` / `Trainee` (`Segreteria` solo per le attività di processo). "Manager" nelle matrici equivale a Senior, ma va confermato.
7. **Ogni attività ha un codice della libreria standard** (ATT-01…ATT-26). Serve come glossario comune e per confrontare i dipartimenti. Il testo specifico del dipartimento resta come descrizione. Per la matrice TP v.4 la "Categoria" della fonte è stata mappata sul codice (vedi `_CAT2LIB` in `data.py`).
8. **Milestone di fatturazione:** è il flag "si fattura al termine di questa attività". Va solo sulle fasi finali reali, perché le categorie della fonte a volte sono sbagliate.
9. **Prezzi non scritti a mano:** il prezzo deriva da effort × moltiplicatore di complessità × quantità × tariffa per ruolo, entro il modello di prezzo del servizio. Fanno eccezione i listini fissi, se la Direzione li decide.

### Modelli di prezzo ammessi
| Cod. | Modello | Calcolo | Fatturazione |
|---|---|---|---|
| P1 | A corpo | Σ attività incluse | SAL a milestone |
| P2 | A corpo + variabile per unità | base + prezzo unitario × driver | SAL a milestone |
| P3 | Tariffa oraria con budget stimato | ore stimate × tariffa | consuntivo mensile |
| P4 | Canone ricorrente | prezzo × periodo × quantità (+ setup) | per periodo |
| P5 | Accordo quadro annuale | tariffe concordate, **nessun preventivo puntuale** | consuntivo mensile |
| P6 | Componente su esito | % su valore o recuperato | a evento (solo se lo decide la Direzione) |

### Driver di intake (domande al cliente) – elenco v4
D01 ambito geografico · D02 n. Paesi esteri · D03 lingue · D04 punto di partenza del documento (template / bozza cliente / bozza controparte) · D05 classe di complessità S/M/L · D06 round di revisione · D07 n. incontri · D08 n. parti · D09 urgenza · D10 rapporto con il cliente (accordo quadro → niente preventivo) · D11 n. persone · D12 n. periodi · D13 professionisti esterni · D14 modello di costo esterno (incarico diretto / subappalto / incluso) · D15 valore dell'operazione · D16 perimetro 100% / <100% · D17 moduli richiesti.

---

## 5. Input da normalizzare (task 1)

Le matrici ricevute hanno di norma un foglio **`DB-Attività`** con queste colonne:
`Prodotto (flusso di processo) | Sotto prodotto | Categoria | Fasi del prodotto | Effort professionale | Lead time / elapsed time | Template | Deliverable | Strumenti utilizzati | Uffici coinvolti`

Alcune hanno anche un foglio `RA-Risorsa` con la ripartizione per persona (spesso vuota) e un foglio `FTE`.

**Anomalie già viste nelle fonti** (da gestire, non da correggere in silenzio):
- "Sotto prodotto" valorizzato solo sulla prima riga del blocco: va propagato in basso.
- Effort scritto come testo ("14 - 20h", "1,5 - 10h", virgola decimale).
- Elapsed misto: "7", "10 giorni", "7-14 giorni".
- Categorie incoerenti (es. "Mappatura transazioni" classificata come "Revisione e finalizzazione").
- Righe M&A copiate per errore dal template (vecchia matrice Tax & Customs).
- Righe "Altro" (pianificazione, fiere, trasferte…) da escludere.
- In Corporate Law, Inbound, i tempi di "creazione pratica" e "report" sembrano invertiti.

Le schede compilate tornano in un formato diverso: ogni riga porta gli ID nascosti (servizio e codice attività) e si reimportano direttamente.

**Stato delle fonti:** Vincenzo ha recuperato gran parte delle matrici, alcune mancano. L'elenco aggiornato dei file va chiesto a lui prima di iniziare, insieme alla cartella in cui li ha raccolti.

---

## 6. TARGET del task 1 – DB unico Servizi / Attività

### 6.1 Struttura (un file Excel, due fogli dati + uno tecnico)

**Foglio `SERVIZI`** – una riga = un servizio vendibile (varianti già appiattite)

| Colonna | Tipo | Regole |
|---|---|---|
| `ID_SERVIZIO` | testo, **chiave** | univoco, formato `DIP-XXX[-Vnn]` (es. `CL-MNA-V01`). Non si riusa mai, nemmeno dopo una cancellazione |
| `PILLAR` | lista | L0: Legal & Corporate / Tax & Cross-border / Corporate Finance / … |
| `AMBITO` | lista | L1 famiglia di servizio (es. "M&A Legal", "Pareri e quesiti") |
| `SERVIZIO` | testo | nome leggibile dal cliente |
| `DIP_OWNER` | lista | codice dipartimento TO-BE |
| `DIP_CONTRIBUTORI` | testo | facoltativo |
| `ENTITA` | lista | SLB / BPCF Srl |
| `DESCRIZIONE_PREVENTIVO` | testo | testo che finisce nel preventivo |
| `INCLUSO` / `ESCLUSO` | testo | perimetro da stampare |
| `VENDIBILITA` | lista | Autonomo / Add-on / Solo in pacchetto |
| `NATURA` | lista | One-off / Ricorrente / Su evento / Contenitore |
| `MODELLO_PREZZO` | lista | P1…P6 |
| `UNITA_PREZZO` | testo | documento, persona, Paese, mese… |
| `DRIVER` | testo | codici D01…D17 applicabili |
| `ROUND_INCLUSI` | numero | |
| `ESTERNI` | lista | Nessuno / Opzionale / Necessario |
| `STATO` | lista | Bozza / Da validare / Validato / Disattivo |
| `LIVELLO_COMPLETEZZA` | 0–4 | 0 nome · 1 perimetro · 2 attività · 3 attività con effort · 4 prezzo validato |
| `FONTE` · `NOTE` | testo | tracciabilità |
| `N_ATTIVITA` · `ORE_MIN_TOT` · `ORE_MAX_TOT` · `CHECK` | **formule** | calcolate dal foglio ATTIVITA |

**Foglio `ATTIVITA`** – una riga = un'attività di un servizio

| Colonna | Tipo | Regole |
|---|---|---|
| `ID_ATTIVITA` | testo, **chiave** | univoco, es. `CL-MNA-V01-030` |
| `ID_SERVIZIO` | lista, **chiave esterna** | menu a tendina che legge solo gli ID presenti in SERVIZI |
| `SEQ` | numero | ordine nel servizio (10, 20, 30…) |
| `COD_LIBRERIA` | lista | ATT-01…ATT-26 |
| `ATTIVITA` | testo | dicitura del dipartimento |
| `QUANDO` | lista | Sempre / Solo se richiesto / Solo in certi casi |
| `CONDIZIONE_DRIVER` | testo | es. "D01 ≠ Solo Italia; q.tà = D02" |
| `QTA_STD` · `UNITA` | numero / testo | |
| `ORE_MIN` · `ORE_MAX` | numero | ORE_MAX ≥ ORE_MIN |
| `RUOLO` | lista | Head / Of Counsel / Senior / Junior / Trainee |
| `GG_MIN` · `GG_MAX` | numero | elapsed |
| `MILESTONE_FATT` | Sì/No | |
| `TERZI` · `TEMPLATE` · `OUTPUT` | testo | |
| `TESTO_FONTE_EFFORT` · `TESTO_FONTE_ELAPSED` | testo | testo originale |
| `FONTE` · `NOTE` | testo | |
| `CHECK` | **formula** | stato della riga |

**Foglio `_LISTE` (tecnico, nascosto)**: valori ammessi per i menu, libreria ATT con descrizioni, dipartimenti, pillar e ambiti, controlli di integrità riepilogativi.

> Vincenzo ha chiesto 2 fogli; il terzo, tecnico e nascosto, serve solo alle liste e ai controlli. Se si preferisce, le liste possono vivere in fondo al foglio SERVIZI, ma è meno pulito.

### 6.2 Integrità "da database"

Requisiti di Vincenzo: aggiungere un servizio impone di aggiungere le sue attività; un'attività non può esistere senza essere allocata a un servizio.

| Regola | Come si applica in Excel | Bloccante? |
|---|---|---|
| R1 Ogni attività punta a un servizio esistente | convalida dati a elenco su `ID_SERVIZIO` (menu che legge `SERVIZI[ID_SERVIZIO]`) + `CHECK` | **Sì** (Excel rifiuta i valori fuori elenco) |
| R2 Ogni servizio attivo ha almeno 1 attività | `N_ATTIVITA` = conteggio delle attività del servizio; `CHECK` = "⚠ senza attività" se 0 | No in Excel → **bloccante nello script di export** |
| R3 Chiavi univoche | formula di conteggio duplicati + formattazione condizionale rossa | No in Excel → bloccante nello script |
| R4 ORE_MAX ≥ ORE_MIN, valori nei range | convalida numerica | Sì |
| R5 Valori nei domini (liste) | convalida a elenco | Sì |
| R6 Servizio disattivato | non si cancella: `STATO = Disattivo`; le attività restano storicizzate | – |

Excel da solo **non può impedire** di salvare un servizio senza attività. Per questo la regola vera sta in un **validatore**, uno script Python eseguito prima di ogni export verso il database web: se una regola R1–R5 fallisce, l'export si blocca e produce un report degli errori. Il file Excel resta l'interfaccia di manutenzione, il validatore è il guardiano.

Facoltativo: protezione dei fogli con sblocco solo delle celle dati e struttura bloccata, stesso approccio delle schede; Tabelle Excel strutturate (`tblServizi`, `tblAttivita`) così formule e menu si estendono da soli.

### 6.3 Export verso la web app

Lo script di export produce, da DB validato:
- `servizi.json`, `attivita.json`, `liste.json`, oppure uno schema SQL per Cloudflare D1. La scelta dipende dall'infrastruttura che Vincenzo condividerà.
- un report di validazione (errori e avvisi).
- versionamento: ogni export è datato, così un preventivo storicizzato resta riproducibile con la versione del DB usata.

---

## 7. Architettura del configuratore (contesto per la struttura, NON task 1)

Base: il **blueprint "portale web leggero su foglio dati"** di Vincenzo (pattern Survey ITaly – DIEMME).

**Decisione del 18/11/2026:**
- **Fase 1 – Variante A (Google):** Google Sheet + Apps Script, come la survey, per sviluppare e validare velocemente.
- **Fase 2 – Variante B1 (Microsoft 365):** migrazione a SharePoint + Graph al momento dell'installazione presso lo Studio.

Il modello dati e il frontend restano identici nelle due fasi: cambia solo il backend.

```
Pagine statiche (HTML + JS vanilla) ──POST /api/gas──► Cloudflare Pages Function (proxy) ──► Apps Script (router azioni) ──► Google Sheet / Drive
                                                                                                                            ├─ Sheet "DB_Catalogo": SERVIZI, ATTIVITA, _LISTE, Parametri, Testi
                                                                                                                            ├─ Sheet "Registro": RegistroPreventivi, Contatori, Log
                                                                                                                            └─ Cartella Drive "Preventivi" (Excel storicizzati)
```

### 7.1 Cosa si riprende tale e quale dalla survey
- Repo `public/` + `functions/api/gas.js` + `apps-script/Code.gs`, deploy con push, zero build, JS vanilla.
- Router `action → handler`, risposte `{ok, error:'CODICE'}`, helper `api()` ed `errText()`.
- Macchina a viste, bozza in `localStorage`, `submissionId` idempotente, pulsante bloccato in invio.
- Modello letto dai fogli e tenuto in cache a blocchi; `LockService` attorno alle scritture; `safeCell_()` sugli export.
- **Calcolo solo lato server.** Il client manda servizi, driver e quantità; il server ricalcola ore, importi e totale. Tariffe e moltiplicatori non vanno mai al client.
- Menu nel foglio (`onOpen`): "Verifica configurazione", "Svuota cache", "Dati di prova".
- Numero di versione visibile in pagina.

### 7.2 Adattamenti al caso Bacciardi
| Tema | Fase 1 (Google) | Fase 2 (M365) |
|---|---|---|
| **DB catalogo** | Il DB unico del task 1 diventa il Google Sheet `DB_Catalogo`, con i fogli SERVIZI, ATTIVITA e _LISTE (§6). Il menu **"Verifica e pubblica catalogo"** esegue il validatore R1–R5 in Apps Script e, solo se è pulito, incrementa `versione_catalogo` e svuota la cache. Senza pubblicazione la web app continua a usare l'ultima versione valida. | Stesso foglio in Excel su SharePoint, solo lettura; validazione e pubblicazione in KV tramite un'azione admin |
| **Integrità in tempo reale** | Convalida dei dati e `onEdit` che segnala subito le attività senza servizio e i servizi senza attività: in Google Sheet il controllo è più forte che in Excel | Validatore alla pubblicazione |
| **Utenti** | Solo interni. **OTP via mail** con dominio ammesso (dominio dello Studio), come la survey | SSO Entra ID (MSAL) |
| **Ruoli** | Foglio `Utenti`: `utente` / `admin` | Gruppi Entra |
| **Flusso** | Pillar → Ambito → Servizi (scelta multipla) → driver di intake pertinenti (D01–D17) → riepilogo con attività incluse/opzionali → conferma. Dati del cliente minimi | invariato |
| **Accordo quadro (D10)** | Nessun preventivo, solo stima dei volumi | invariato |
| **Output A4** | Pagina HTML con **CSS di stampa su carta intestata**, stile grafico preso dal sito ufficiale (§7.5) | invariato |
| **Output Excel** | Apps Script compila un foglio modello, lo esporta in `.xlsx` e lo salva nella cartella Drive **"Preventivi/AAAA/DIP"**. Link nel registro e download per l'utente | Libreria SharePoint "Preventivi" via Graph |
| **Registro** | Foglio `RegistroPreventivi`: numero, data, utente, cliente, servizi, totale, versione catalogo, link al file, `SubmissionId` | Lista SharePoint |
| **Numerazione** | `PRV-AAAA-NNNN` assegnato alla conferma, sotto `LockService` | Contatore con ETag |

### 7.3 Fuori dalla v1
Revisioni del preventivo, approvazioni, allegati, dashboard, integrazione con eLibra.

### 7.4 Rischi e decisioni
1. **Dati dello Studio su un account Google durante la fase 1.**
   - Usare un account Workspace di BSA o di Vincenzo con condivisione ristretta.
   - Per i test usare clienti fittizi (dominio `@test.invalid`).
   - Le tariffe reali vanno inserite solo con il via libera della Direzione.
2. **Quote Apps Script.** Con i volumi di uno studio non sono attesi problemi: verificare il limite delle mail OTP del piano in uso.
3. **Migrazione (fase 2).**
   - Lo **schema dei fogli deve corrispondere 1:1 alle future liste e librerie SharePoint**.
   - La logica di business va tenuta in funzioni pure, separate dalle chiamate a SpreadsheetApp, così si porta in JS sul Worker.
   - Serve il consenso dell'amministratore del tenant M365 (`Sites.Selected`): con il supporto IT in passaggio all'outsourcer, va chiarito per tempo chi lo dà.
4. **Decisioni della Direzione che bloccano gli importi:**
   - tariffe orarie per ruolo;
   - moltiplicatori di complessità S/M/L (proposta 0,7 / 1 / 1,5);
   - round inclusi (proposta 1);
   - maggiorazione per urgenza;
   - soglie di sconto (proposta: Head fino al 10%);
   - ore pre-preventivo fatturabili o no (proposta no);
   - costi esterni: incarico diretto o subappalto (proposta: incarico diretto).

   Senza tariffe la v1 calcola ore e struttura del preventivo.

### 7.5 Task 2 – Identità grafica dal sito ufficiale (prima di disegnare il frontend)
Fonti: sito istituzionale **https://www.bacciardipartners.it/** (anche `/en/`, `/en/law-firm/`, `/en/contacts/`, `/note-legali/`) e il dominio collegato **bacciardistudiolegale.it**. Il sito è stato realizzato dall'agenzia e-leva.

Da estrarre e salvare in `public/assets/brand/` + `brand.md`:
- **Logo** (SVG preferito, PNG come riserva), con varianti chiara e scura se presenti; favicon.
- **Palette:** colori primario, secondario, testo e sfondo, presi dal CSS (variabili, colori ricorrenti), come codici hex.
- **Tipografia:** font di titoli e testo (Google Fonts o self-hosted) con pesi e dimensioni.
- **Stile:** spaziature, bordi, uso delle immagini, tono dei testi, struttura di menu e piè di pagina.
- **Dati per la carta intestata:**
  - ragione sociale di SLB e di BPCF Srl, sedi (Pesaro, Milano, Bologna, Cesena…), P.IVA, contatti, presi da contatti e note legali;
  - da verificare con lo Studio prima dell'uso.
- **Pratiche e aree** dichiarate sul sito, da confrontare con i pillar e gli ambiti del catalogo per allineare i nomi mostrati al cliente.

Vincoli:
- solo pagine pubbliche;
- nessuna copia di testi o immagini fotografiche nel configuratore oltre a logo, colori e font, che sono identità dello Studio cliente;
- licenze dei font da verificare.

Nota: dall'ambiente cloud di Claude il sito non è raggiungibile (dominio non in allowlist). L'estrazione va fatta da Claude Code in locale o dal browser di Vincenzo.

## 8. Istruzioni operative per Claude Code – Task 1

**Destinazione del DB (decisione del 18/11):** il DB unico vivrà come **Google Sheet** (fase 1) e poi come Excel/SharePoint (fase 2). Il file prodotto dal task 1 deve quindi funzionare in entrambi:
- formule compatibili Excel/Sheets (COUNTIFS, SUMIFS, INDEX/MATCH; niente tabelle strutturate obbligatorie, niente funzioni solo-Excel);
- convalide a elenco basate su intervalli;
- nessuna macro.

La protezione dei fogli si rifà in Google Sheet con gli "intervalli protetti".

**Prima di scrivere codice:** proporre il piano a Vincenzo e farselo approvare. Vincenzo vuole "prima il piano, poi l'esecuzione"; niente automatismi non richiesti.

1. Chiedere l'elenco e la cartella delle matrici ricevute; fare l'inventario: file, fogli, colonne, n. righe, anomalie.
2. Partire dai contenuti già normalizzati in `data.py` (catalogo v4 + TP v.4) come base. Le matrici nuove o aggiornate prevalgono sui dati vecchi: segnalare ogni differenza.
3. Scrivere un **parser per matrice** (lettura con `openpyxl`, `python -I` sui file ricevuti) che applichi le regole del §4 e produca righe SERVIZI/ATTIVITA più un **log** di righe escluse e anomalie.
4. Generare il **file DB unico** (§6.1) con menu, formule di controllo e formattazione condizionale.
5. Scrivere il **validatore** (§6.2) e lo **script di export** (§6.3).
6. Verificare:
   - ricalcolo con LibreOffice senza errori di formula;
   - validatore pulito, oppure errori elencati;
   - quadratura righe fonte = righe DB + righe escluse, per ogni matrice;
   - test di aggiunta di un servizio senza attività e di un'attività con ID inesistente, che devono essere segnalati o bloccati.
7. Consegnare: file DB, log di normalizzazione, report di validazione, script, README.

**Criteri di accettazione:**
- zero attività orfane;
- zero servizi attivi senza attività;
- chiavi univoche;
- ogni riga con fonte tracciata;
- nessun valore fuori dominio;
- testo originale di effort ed elapsed conservato.

**Accortezze tecniche note** (da esperienze precedenti):
- Funzioni Excel post-2007 scritte con openpyxl vanno prefissate `_xlfn.` oppure evitate (usare INDEX/MATCH, COUNTIFS, SUMIFS).
- I nomi definiti usati dai menu a cascata (INDIRECT) non ammettono spazi.
- Dopo il ricalcolo con LibreOffice la protezione della struttura della cartella si perde: va riapplicata sull'XML (`workbookProtection`) per non perdere i valori calcolati.
- Celle unite: si scrive solo nella prima cella.

---

## 9. File da consegnare a Claude Code

- Questo handoff.
- `data.py`, `build.py`, `scheda_cfg.py`, `gen_scheda.py` (script e contenuti normalizzati).
- `Bacciardi_Catalogo_Servizi_v4_normalizzato.xlsx` (catalogo di lavoro v4).
- `Scheda_Catalogo_*.xlsx` (12 schede, compilate o meno).
- Le matrici dei dipartimenti recuperate (es. `Matrice_RA_International_Tax_v._4.xlsx`).
- `Bacciardi_Service_Catalogue_Review_v3_Corporate_Law.xlsx`: solo come storico, prima bozza superata.
- SAL 05/08/2026 (`1 - Avanzamenti\SAL\20260805-SAL.pptx` e verbale) per i principi L0–L3 e il TO-BE.
- Blueprint "portale web leggero su foglio dati" (modello Survey ITaly) come riferimento architetturale.

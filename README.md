# PREVENTIVATORE – Configuratore preventivi Bacciardi Partners

Repo di progetto (Blue Star Advice). Contesto completo: `docs/HANDOFF_Configuratore_Preventivi_Bacciardi.md`.
Flusso utente concordato e punti aperti: `docs/SPEC_flusso_configuratore.md`.

Messa in opera dell'infrastruttura: `docs/INFRA.md`.

## Stato al 24/11/2026

| Task | Stato |
|---|---|
| 1 – DB unico Servizi/Attività | **fatto** |
| Infrastruttura + portale "in bianco" (login OTP, 7 passi vuoti) | **fatto, collaudato in locale** – deploy da eseguire (`docs/INFRA.md`) |
| 2 – Identità grafica dal sito | in attesa (accesso al sito dall'ambiente cloud) |
| 3 – Funzioni del portale (pillar, clienti, servizi, export) | dopo il deploy, una alla volta |

## Struttura

```
public/           portale statico (HTML + JS vanilla, zero build) – pubblicato da Cloudflare Pages
functions/api/    gas.js: Pages Function proxy verso Apps Script
apps-script/      backend Apps Script (Config, Logic pura, Code=router, Auth=OTP, Setup=menu) + manifest
dev/              simulatore servizi Google, server locale, test backend ed e2e (non pubblicato)
input/            fonti (NON modificare, escluse da git): schede compilate, da finalizzare, riferimento v4
db/DB_Catalogo.xlsx   DB unico: SERVIZI, ATTIVITA, PILLAR, _LISTE (nascosto) – diventa il Google Sheet "DB_Catalogo"
output/           log_normalizzazione.xlsx, report_validazione.md, export/<versione>/*.json
scripts/          common.py (domini), normalize.py, build_db.py, validate.py, export.py, check_formulas.py
tests/            test_integrita.py (test negativi R1–R4), test_pillar.py (pillar trasversali)
docs/             handoff, specifica flusso
```

## Come si rigenera

```bash
python3 -I scripts/normalize.py .
```
```bash
python3 -I scripts/build_db.py .
```
```bash
python3 -I scripts/check_formulas.py db/DB_Catalogo.xlsx
```
```bash
python3 -I scripts/validate.py db/DB_Catalogo.xlsx output/report_validazione.md
```
```bash
python3 -I scripts/export.py db/DB_Catalogo.xlsx output/export
```
```bash
python3 -I tests/test_integrita.py .
```
```bash
python3 -I tests/test_pillar.py .
```

Requisiti: Python 3.10+, openpyxl, LibreOffice (solo per `check_formulas.py`).

**Attenzione:** `normalize.py` + `build_db.py` ricreano il DB dalle schede. Una volta che il DB viene
mantenuto a mano (Google Sheet), si usano solo `validate.py` / `export.py` sul file scaricato:
rigenerare sovrascriverebbe le modifiche.

## DB_Catalogo – regole

- **SERVIZI**: una riga = un servizio vendibile (varianti appiattite). Chiave `ID_SERVIZIO` (`DIP-XXX[-Vnn]`), mai riusata.
- **ATTIVITA**: una riga = un'attività di un servizio. `ID_SERVIZIO` è un menu che legge solo gli ID di SERVIZI.
- Colonne grigie = formule (`N_ATTIVITA`, `ORE_MIN_TOT`, `ORE_MAX_TOT`, `CHECK`): non scriverci.
- `CHECK`: ⛔ errore bloccante · ⚠ dato da completare · ✔ ok.
- Un servizio non si cancella: `STATO = Disattivo`.
- **PILLAR** (foglio visibile, gestito dall'admin): pillar dipartimentali + pillar **trasversali** per i preventivi
  multi-dipartimento. Ogni servizio ha un pillar di origine (`SERVIZI.PILLAR`, menu dal foglio PILLAR) e può
  comparire in altri pillar tramite `SERVIZI.PILLAR_AGGIUNTIVI` (nomi separati da `;`, controllati dal validatore).
- `MODALITA_AMMESSE` (Corpo / T&M / Entrambe): cosa può scegliere l'utente nel preventivo. Oggi tutto “Entrambe”.
- Formule solo COUNTIF(S)/SUMIFS/IF/ISNUMBER, convalide su intervalli, nessuna macro: funziona in Excel e Google Sheets.
  Il file non ha valori in cache: Excel/Sheets ricalcolano all'apertura.

| Regola | Foglio | Validatore |
|---|---|---|
| R1 attività → servizio esistente | menu a elenco + CHECK ⛔ | errore |
| R2 servizio attivo (Da validare/Validato) con ≥1 attività | CHECK ⛔ | errore (Bozza senza attività = avviso) |
| R3 chiavi univoche e coerenti | evidenza rossa + CHECK ⛔ | errore |
| R4 numeri nei range, ORE_MAX ≥ ORE_MIN | convalida numerica/personalizzata | errore |
| R5 valori nei domini (incl. pillar esistenti) | menu a elenco | errore |

## Numeri della normalizzazione

80 servizi (68 Da validare, 11 Bozza, 1 Disattivo) · 434 attività · 0 righe escluse · quadratura fonte = DB + escluse ✔ su tutte le 12 schede.
Validatore: 0 errori, 174 avvisi (dati da completare dai professionisti). Dettaglio in `output/`.

Valori economici e di tempo **non sono stati dedotti**: dove la scheda è vuota il campo resta vuoto
e compare tra gli avvisi, da proporre poi al professionista per conferma.

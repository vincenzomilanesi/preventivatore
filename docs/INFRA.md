# Infrastruttura fase 1 – messa in opera del portale "in bianco"

Obiettivo: portale online con login OTP funzionante e i 7 passi vuoti. Le funzioni (pillar, clienti, servizi…)
si integrano dopo, una alla volta, sulla stessa infrastruttura.

```
Browser ──POST /api/gas──► Cloudflare Pages Function (functions/api/gas.js) ──► Apps Script (doPost) ──► Google Sheet / Drive
          pagine statiche public/                  aggiunge PROXY_SECRET              router azioni        Registro + DB_Catalogo
```

| Componente | Dove | Chi lo crea |
|---|---|---|
| Google Sheet `DB_Catalogo` | Drive › PREVENTIVATORE › db | Vincenzo (conversione dell'xlsx) |
| Google Sheet `Preventivatore_Registro` + Apps Script | Drive › PREVENTIVATORE | Vincenzo (codice in `apps-script/`) |
| Cartella Drive `Preventivi` | accanto al Registro | creata dal menu "Inizializza struttura" |
| Repo GitHub **privato** `preventivatore` | account GitHub personale di Vincenzo | Vincenzo crea il repo vuoto; il push lo può fare Claude |
| Progetto Cloudflare Pages | account Cloudflare di Vincenzo | Vincenzo |

Tempo stimato: 30–40 minuti. L'ordine conta (A → B → C → D).

## A. Google (account che ospita la fase 1)

1. **DB_Catalogo**: in Drive apri `PREVENTIVATORE/db/DB_Catalogo.xlsx` › *File › Salva come Fogli Google*.
   Rinomina in `DB_Catalogo`. Copia l'ID dall'URL (`/spreadsheets/d/<ID>/edit`).
2. **Registro**: in `PREVENTIVATORE` crea un nuovo Google Sheet `Preventivatore_Registro`.
3. **Apps Script**: nel Registro › *Estensioni › Apps Script*. Nel progetto:
   - crea i file `Config`, `Logic`, `Code`, `Auth`, `Setup` e incolla il contenuto dei corrispondenti `apps-script/*.gs`
     (elimina il `Codice.gs` vuoto iniziale);
   - *Impostazioni progetto* › spunta "Mostra file manifest appsscript.json" e incolla `apps-script/appsscript.json`.
4. **Proprietà script** (*Impostazioni progetto › Proprietà script*):
   - `ALLOWED_DOMAINS` = dominio e-mail dello Studio (es. `bacciardipartners.it`). Per il collaudo puoi mettere anche il
     tuo dominio, separato da virgola: il login richiede comunque che l'e-mail sia in `Utenti` con ATTIVO = Sì.
   - `DB_CATALOGO_ID` = ID del punto 1.
5. Ricarica il foglio Registro › menu **Preventivatore › Inizializza / verifica struttura** › autorizza.
   Crea i fogli (Utenti, Clienti, Entita, RegistroPreventivi, Contatori, Parametri, Log), la cartella `Preventivi`
   e genera `PROXY_SECRET`. Copia il valore di `PROXY_SECRET` dalle Proprietà script: serve al punto C.
6. Foglio **Utenti**: aggiungi almeno il tuo utente (`EMAIL`, `NOME`, `COGNOME`, `DIP`, `RUOLO`, `PROFILO`=admin, `ATTIVO`=Sì).
7. **Deploy**: *Esegui il deployment › Nuovo deployment › Tipo: App web*.
   Esegui come: **Me** · Chi ha accesso: **Chiunque**. Copia l'URL che termina con `/exec`.
   Verifica: aprendo l'URL nel browser deve comparire `{"ok":true,"data":{"app":"preventivatore","version":"0.1.0"}}`.
   ("Chiunque" è necessario perché chiama il proxy Cloudflare; senza `PROXY_SECRET` ogni azione risponde FORBIDDEN.)
8. Menu **Preventivatore › Verifica configurazione**: tutte le righe ✔.

> **Aggiornamenti futuri del codice Apps Script**: *Gestisci deployment › matita › Versione: Nuova versione*.
> Così l'URL `/exec` resta lo stesso e Cloudflare non va toccato.

## B. GitHub (account personale)

1. Crea il repository **privato** `preventivatore`, vuoto (senza README).
2. Il caricamento del codice lo faccio io dalla sessione Claude, se mi abiliti l'accesso al repo.
   In alternativa, da un PC con git:

```bash
git clone <url-del-repo> && cd preventivatore
```
   copia dentro il contenuto della cartella repo (senza `input/` e `output/`), poi:
```bash
git add -A && git commit -m "Portale in bianco v0.1.0" && git push
```

## C. Cloudflare Pages

1. *Workers & Pages › Create › Pages › Connect to Git* › seleziona `preventivatore`.
   **Project name: `preventivi-bacciardi`** → indirizzo `https://preventivi-bacciardi.pages.dev` (gratuito, nessun dominio da acquistare).
2. Build settings: Framework preset **None** · Build command **vuoto** · Build output directory **`public`**.
   La cartella `functions/` viene riconosciuta da sola (diventa `/api/gas`).
3. *Settings › Variables and Secrets* (Production), tipo **Secret**:
   - `GAS_URL` = URL `/exec` del punto A.7
   - `PROXY_SECRET` = valore del punto A.5
4. *Deployments › Retry deployment* (le variabili valgono dal deploy successivo).
5. Il portale è su `https://preventivi-bacciardi.pages.dev`. Un dominio dello Studio (es. `preventivi.bacciardipartners.it`)
   si potrà collegare più avanti da *Custom domains*, senza modifiche al codice; va registrato/gestito a nome dello Studio.

Ogni push su `main` ripubblica il portale in automatico (zero build).

## D. Collaudo

1. Apri `https://preventivi-bacciardi.pages.dev` › inserisci la tua e-mail › arriva il codice › accedi.
2. Devono comparire: nome in alto a destra, 7 passi vuoti, in basso `web 0.1.0 · server 0.1.0`.
3. Foglio `Log` del Registro: righe "OTP inviato" e "accesso".

| Sintomo | Causa probabile |
|---|---|
| "Configurazione del server incompleta" | mancano `GAS_URL`/`PROXY_SECRET` in Cloudflare, o non hai rifatto il deploy |
| "Operazione non consentita" | `PROXY_SECRET` diverso tra Cloudflare e Apps Script |
| "Usa l'indirizzo e-mail dello Studio" | dominio non presente in `ALLOWED_DOMAINS` |
| Il codice non arriva | utente assente o ATTIVO≠Sì in `Utenti` (risposta volutamente neutra: guarda il foglio `Log`) |
| "Risposta del server non valida" | deployment Apps Script non accessibile a "Chiunque" o URL non `/exec` |

## Sviluppo locale (senza account)

```bash
node dev/test_backend.mjs
```
```bash
node dev/server.mjs 8787
```
Poi `http://localhost:8787`, utente `mario.rossi@test.invalid`, codice da `http://localhost:8787/__dev/otp?email=mario.rossi@test.invalid`.
Il simulatore (`dev/gas-mock.mjs`) esegue i file `.gs` veri e la Pages Function vera, redirect 302 di Apps Script compreso.
La cartella `dev/` non viene pubblicata (Cloudflare pubblica solo `public/` e `functions/`).

## Note di sicurezza e limiti noti (fase 1)

- Le mail OTP partono dall'account che fa il deploy (limite giornaliero MailApp: 100 per account gmail, 1.500 Workspace).
- Sessione: 4 ore, rinnovata a ogni azione; token solo in `sessionStorage` (chiusa la scheda, si rientra).
- OTP: valido 10 minuti, monouso, max 5 tentativi; max 3 richieste ogni 15 minuti per e-mail.
- I dati reali dello Studio (clienti, tariffe) vanno inseriti solo dopo il via libera; per i test usare `@test.invalid`.

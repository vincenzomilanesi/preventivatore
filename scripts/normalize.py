"""Normalizza le schede di compilazione dei dipartimenti nel modello SERVIZI / ATTIVITA.

Uso:  python -I scripts/normalize.py <repo_root>
Input:  input/compilate/*.xlsx, input/da_finalizzare/*.xlsx  (schede 1_SERVIZI / 2_ATTIVITA / 3_DOMANDE)
        input/riferimento/Bacciardi_Catalogo_Servizi_v4_normalizzato.xlsx (campi non presenti nelle schede)
Output: output/normalizzato.json      (righe per build_db)
        output/log_normalizzazione.xlsx (esclusioni, anomalie, quadratura, domande)

Regole: handoff §4. Nessun valore economico o di tempo viene dedotto: se la fonte non lo dice resta vuoto
e finisce tra le anomalie. La colonna 'Stato' delle schede non si usa (in CL è in #REF!): si ricalcola.
"""
import sys, os, re, glob, json, difflib, datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
V4 = os.path.join(ROOT, "input/riferimento/Bacciardi_Catalogo_Servizi_v4_normalizzato.xlsx")

# Decisioni approvate (chat 18/11/2026)
NEW_ID = {("TP", "NUOVO-1"): "TP-CTC", ("TP", "NUOVO-2"): "TP-CTS", ("TP", "NUOVO-3"): "TP-CTX"}
GROUP_BY_NAME = {  # gruppi creati dal dipartimento direttamente nel foglio 2 senza servizio nel foglio 1
    "Assistenza nello svolgimento delle formalità fiscali connesse alle stabili organizzazioni": "TP-FSO",
}
NEW_SERVICE_DEFAULTS = {
    "TP-CTC": dict(AMBITO="Transfer Pricing - advisory e contenzioso", VENDIBILITA="Add-on"),
    "TP-CTS": dict(AMBITO="Transfer Pricing - advisory e contenzioso", VENDIBILITA="Add-on"),
    "TP-CTX": dict(AMBITO="Transfer Pricing - advisory e contenzioso", VENDIBILITA="Add-on"),
    "TP-FSO": dict(AMBITO="Fiscalità internazionale - adempimenti"),
}
DISATTIVI = {"ICL-AQ"}

PREZZO_MAP = {"Prezzo fisso a corpo": "P1", "Prezzo fisso per fase": "P1", "A ore": "P3",
              "Fisso + compenso a successo": "P1", "A riunione": "P2"}
VEND_MAP = {"Da solo": "Autonomo", "In entrambi i modi": "Autonomo", "Solo insieme ad altri servizi": "Add-on"}

# Esclusione solo se la riga È un'attività di processo (inizia così), non se la parola compare nel testo:
# es. "notifiche preventive", "Lettera di trasferta", "... e archiviazione" restano attività vendibili.
EXCLUDE_RE = re.compile(r"^\s*((predisposizione|invio|redazione) (del |della )?)?(preventiv|mandato|antiriciclagg|"
                        r"(apertura|creazione) (della )?pratica|archiviaz|fatturazion|pianificazione interna|fiere|"
                        r"trasferte|marketing(?! package)|formazione interna)", re.I)
PLACEHOLDER_RE = re.compile(r"^(\+ Altra attività|Elencate le fasi)", re.I)

# Proposta codice libreria per attività nuove o 'DA-CODIFICARE' (sempre marcata come proposta)
LIB_RULES = [
    (r"due diligence", "ATT-20"), (r"benchmark|comparab", "ATT-26"),
    (r"signing|closing|sottoscri|rogito|firma", "ATT-16"), (r"negozia", "ATT-13"),
    (r"kick.?off|incontr|videocall|\bcall\b|riunion|gestione contatti", "ATT-12"),
    (r"corrispondent|studio estero", "ATT-10"),
    (r"coordinamento .*(legal|team|professionist|notai|consulent)", "ATT-11"),
    (r"revisione interna|check", "ATT-06"), (r"confronto con il cliente", "ATT-07"),
    (r"follow.?up", "ATT-22"), (r"trasmissione finale|consegna", "ATT-08"),
    (r"registrazione|dichiarazion|deposit|adempiment", "ATT-17"),
    (r"valutazion|business plan|financial model|simulaz|calcol|bilancio|riclassific", "ATT-19"),
    (r"target list|investor list|individuazione|ricerca (di )?(partner|investitor|controparti)", "ATT-25"),
    (r"tableau|monitoraggio|reporting", "ATT-18"),
    (r"report|parere|memorandum", "ATT-14"),
    (r"raccolta|richiesta .*(document|informazion)", "ATT-02"),
    (r"analisi .*normativ", "ATT-03"), (r"analisi|esame", "ATT-01"),
    (r"redazione|predisposizione|bozza|teaser|contratt", "ATT-04"),
    (r"coordinamento", "ATT-23"),
]


def propose_lib(text):
    t = (text or "").lower()
    for rx, code in LIB_RULES:
        if re.search(rx, t):
            return code
    return None


def first_p(s):
    m = re.search(r"\bP([1-6])\b", str(s or ""))
    return f"P{m.group(1)}" if m else None


def parent(sid):
    return re.sub(r"-V\d{2}$", "", sid)


def norm_nat(s):
    s = str(s or "")
    if "Contenitore" in s: return "Contenitore"
    if s.startswith("Su evento"): return "Su evento"
    if s.startswith("Ricorrente"): return "Ricorrente"
    return "One-off" if s else None


def norm_vend(s):
    s = str(s or "")
    if s.startswith("Solo in pacchetto"): return "Solo in pacchetto"
    if s.startswith("Add-on") or s.startswith("Solo add-on"): return "Add-on"
    return "Autonomo" if s else None


def norm_est(s):
    s = str(s or "").strip()
    for k in ESTERNI:
        if s.lower().startswith(k.lower()): return k
    if s in ("-", "No"): return "Nessuno"
    return None


# ---------------------------------------------------------------- catalogo v4
def _table(ws, first_col):
    rows = list(ws.iter_rows(values_only=True))
    h = next(i for i, r in enumerate(rows) if r and r[0] == first_col)
    hdr = rows[h]
    return [dict(zip(hdr, r)) for r in rows[h + 1:] if r and r[0]]


def load_v4():
    wb = openpyxl.load_workbook(V4, data_only=True)
    cat = {r["ID prodotto"]: r for r in _table(wb["02_CATALOGO"], "ID prodotto")}
    dist = _table(wb["05_DISTINTA"], "ID prodotto")
    lib = {r["Cod."]: r for r in _table(wb["04_LIBRERIA"], "Cod.")}
    return cat, dist, lib


def match_dist(dist, sid, cod, text):
    cands = [d for d in dist if d["Cod. attività"] == cod and
             (d["ID variante (vuoto = tutte)"] == sid or
              (not d["ID variante (vuoto = tutte)"] and d["ID prodotto"] == parent(sid)))]
    best, score = None, 0
    for d in cands:
        s = difflib.SequenceMatcher(None, str(d["Descrizione specifica (dicitura dipartimento)"] or "").lower(),
                                    (text or "").lower()).ratio()
        if s > score:
            best, score = d, s
    return best if score >= 0.75 else None


# ---------------------------------------------------------------- parsing scheda
def hdr_row(ws):
    for i, r in enumerate(ws.iter_rows(values_only=True), 1):
        if r and r[0] == "N.":
            return i
    raise ValueError(f"intestazione non trovata in {ws.title}")


def is_group_header(r):
    return r[1] and r[0] is not None and "." not in str(r[0]) and str(r[0]) != "+" \
        and all(v in (None, "") for v in r[2:8])


def parse_scheda(path, cat, dist, lib, log):
    fname = os.path.basename(path)
    folder = os.path.basename(os.path.dirname(path))
    wb = openpyxl.load_workbook(path, data_only=True)
    fonte = f"{folder}/{fname}"

    # ---- servizi
    ws = wb["1_SERVIZI"]
    h = hdr_row(ws)
    rows = [r for r in ws.iter_rows(min_row=h + 1, values_only=True)]
    ids = [r[10] for r in rows if r[10] and not str(r[10]).startswith("NUOVO")]
    dip = ids[0].split("-")[0] if ids else None
    if dip is None:  # schede vuote dei dipartimenti da censire: nome file
        dip = {"Litigation": "LIT", "DirittoLavoro": "LAB", "SpecialSituations": "SSI",
               "ComplianceNuoveTecnologie": "CNT", "OrganizationPeople": "OPE"}[
            re.search(r"Scheda_Catalogo_(\w+?)(_|\.xlsx)", fname).group(1)]
    pillar = {d[0]: d[2] for d in DIPARTIMENTI}[dip]
    entita = {d[0]: d[4] for d in DIPARTIMENTI}[dip]

    def map_id(raw):
        raw = clean(raw)
        if raw is None: return None
        return NEW_ID.get((dip, raw), raw)

    servizi, n2id, slots = {}, {}, 0
    for r in rows:
        r = [clean(v) for v in r]
        if not r[1]:
            slots += 1
            continue
        sid = map_id(r[10])
        if sid and sid.startswith("NUOVO"):
            log["anomalie"].append(dict(fonte=fonte, livello="ERRORE", oggetto=sid,
                                        msg="Servizio nuovo senza ID assegnato: aggiungere a NEW_ID"))
            continue
        n2id[str(r[0])] = sid
        v4 = cat.get(sid) or cat.get(parent(sid)) or {}
        note = []
        desc = r[2]
        if r[3] in ("Da correggere",) and r[4]:
            if r[2] and not str(r[2]).startswith("Descrizione da completare"):
                note.append(f"Descrizione originale: {r[2]}")
            desc = r[4]
        elif r[3] == "Da correggere" and not r[4]:
            log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=sid,
                                        msg="'Da correggere' senza testo di correzione: tenuta descrizione esistente"))
        elif r[4]:
            note.append(f"Integrazione dipartimento: {r[4]}")
        if r[8]:
            note.append(f"Note dipartimento: {r[8]}")
        # modello di prezzo
        mp_scheda = PREZZO_MAP.get(r[6])
        mp_v4 = first_p(v4.get("Modello di prezzo"))
        mp = mp_scheda or mp_v4
        if r[6]:
            note.append(f"Preventivazione dichiarata: {r[6]}")
        if r[6] == "Fisso + compenso a successo":
            note.append("Componente su esito (P6) da decidere con la Direzione")
        if mp_scheda and mp_v4 and mp_scheda != mp_v4:
            log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=sid,
                                        msg=f"Modello prezzo: scheda {mp_scheda} vs v4 '{v4.get('Modello di prezzo')}' - tenuto {mp}"))
        if not mp:
            log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=sid, msg="Modello di prezzo da definire"))
        vend = VEND_MAP.get(r[5]) or norm_vend(v4.get("Vendibilità"))
        rnd = v4.get("Round inclusi")
        s = dict(
            ID_SERVIZIO=sid, PILLAR=pillar, AMBITO=v4.get("L1 Famiglia di servizio"), SERVIZIO=r[1],
            DIP_OWNER=dip, DIP_CONTRIBUTORI=clean(v4.get("Dip. contributori")), ENTITA=entita,
            DESCRIZIONE_PREVENTIVO=desc, INCLUSO=clean(v4.get("Perimetro incluso")),
            ESCLUSO=clean(v4.get("Esclusioni")), VENDIBILITA=vend, NATURA=norm_nat(v4.get("Natura")) or "One-off",
            MODELLO_PREZZO=mp, MODALITA_AMMESSE="Entrambe", UNITA_PREZZO=clean(v4.get("Unità di prezzo")),
            DRIVER=clean(v4.get("Driver applicabili")),
            ROUND_INCLUSI=int(rnd) if isinstance(rnd, (int, float)) or (isinstance(rnd, str) and rnd.isdigit()) else None,
            ESTERNI=norm_est(v4.get("Esterni")), STATO=None, LIVELLO_COMPLETEZZA=None,
            PRATICHE_ANNO=r[7] if isinstance(r[7], (int, float)) else None,
            FONTE=fonte, NOTE=None, _note=note, _desc_ok=r[3])
        for k, v in NEW_SERVICE_DEFAULTS.get(sid, {}).items():
            s[k] = v
        if sid in ("TP-CTC", "TP-CTS", "TP-CTX"):
            note.append("Modulo per tipologia contrattuale: le ore si sommano alle fasi comuni di TP-CTR "
                        "(nota del dipartimento). Venduto insieme a TP-CTR.")
        if r[3] == "Non lo offriamo più" or sid in DISATTIVI:
            note.append("Il dipartimento dichiara: non lo offriamo più")
        servizi[sid] = s
    if slots:
        log["info"].append(dict(fonte=fonte, msg=f"{slots} righe servizio vuote (slot '+') ignorate"))

    # ---- attività
    ws = wb["2_ATTIVITA"]
    h = hdr_row(ws)
    acts, n_src, cur = [], 0, None
    for rown, r in enumerate(ws.iter_rows(min_row=h + 1, values_only=True), start=h + 1):
        r = [clean(v) for v in r] + [None] * (14 - len(r))
        if is_group_header(r):
            key = str(r[0])
            cur = None
            for name, gid in GROUP_BY_NAME.items():
                if str(r[1]).startswith(name):
                    cur = gid
                    if gid not in servizi:  # servizio creato solo nel foglio 2
                        servizi[gid] = dict(
                            ID_SERVIZIO=gid, PILLAR=pillar, AMBITO=None, SERVIZIO=r[1], DIP_OWNER=dip,
                            DIP_CONTRIBUTORI=None, ENTITA=entita, DESCRIZIONE_PREVENTIVO=None, INCLUSO=None,
                            ESCLUSO=None, VENDIBILITA="Autonomo", NATURA="One-off", MODELLO_PREZZO=None,
                            MODALITA_AMMESSE="Entrambe", UNITA_PREZZO=None, DRIVER=None, ROUND_INCLUSI=None,
                            ESTERNI=None, STATO=None, LIVELLO_COMPLETEZZA=None, PRATICHE_ANNO=None, FONTE=fonte,
                            NOTE=None, _note=["Servizio aggiunto dal dipartimento solo nel foglio attività "
                                              "(senza riga nel foglio servizi): descrizione e modello prezzo da completare"],
                            _desc_ok=None)
                        for k, v in NEW_SERVICE_DEFAULTS.get(gid, {}).items():
                            servizi[gid][k] = v
                        log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=gid,
                                                    msg=f"Nuovo servizio creato dal gruppo {key} del foglio attività: '{r[1]}'"))
            if cur is None:
                if key.startswith("+"):
                    cur = map_id(f"NUOVO-{key[1:]}")
                else:
                    cur = n2id.get(key)
            if r[11] and map_id(r[11]) != cur:
                log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=f"riga {rown}",
                                            msg=f"Intestazione gruppo {key} riporta ID {r[11]}, usato {cur}"))
            continue
        if not r[1]:
            continue  # slot vuoto
        n_src += 1
        sid = map_id(r[11]) or cur
        src = dict(fonte=fonte, riga=rown, servizio=sid, attivita=r[1])
        if sid is None or sid not in servizi:
            log["esclusioni"].append(dict(src, motivo=f"Servizio non identificabile ({r[11]})"))
            continue
        if EXCLUDE_RE.search(r[1]):
            log["esclusioni"].append(dict(src, motivo="Attività di processo, non vendibile (regola §4.1)"))
            continue
        note = []
        cod = r[12]
        if cod in (None, "NUOVA", "DA-CODIFICARE") or cod not in COD_LIBRERIA:
            prop = propose_lib(r[1])
            if cod not in (None, "NUOVA", "DA-CODIFICARE"):
                log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=f"{sid} riga {rown}",
                                            msg=f"Codice '{cod}' fuori libreria ATT"))
            if prop:
                note.append(f"[COD {prop} proposto da BSA, da confermare]")
            else:
                log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=f"{sid} riga {rown}",
                                            msg="Codice libreria da assegnare"))
            cod = prop
        omin, _, n1 = parse_hours(r[3])
        _, omax, n2 = parse_hours(r[4])
        for n in (n1, n2):
            if n: note.append(n)
        gmin, gmax, n3 = parse_days(r[6])
        if n3: note.append(n3)
        quando = r[2] if r[2] in QUANDO else None
        if r[2] and not quando:
            log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=f"{sid} riga {rown}",
                                        msg=f"'Quando' fuori dominio: {r[2]}"))
        ruolo = r[5]
        if ruolo == "Manager":
            ruolo = "Senior"; note.append("'Manager' convertito in Senior: da confermare")
        if ruolo and ruolo not in RUOLO:
            log["anomalie"].append(dict(fonte=fonte, livello="AVVISO", oggetto=f"{sid} riga {rown}",
                                        msg=f"Ruolo fuori dominio: {ruolo}")); ruolo = None
        if omin is not None and omax is not None and omax < omin:
            log["anomalie"].append(dict(fonte=fonte, livello="ERRORE", oggetto=f"{sid} riga {rown}",
                                        msg=f"Ore MAX {omax} < MIN {omin}"))
        miss = [k for k, v in (("quando", quando), ("ore", omin if omax is not None else None),
                               ("ruolo", ruolo)) if v is None]
        if miss:
            log["mancanti"].append(dict(fonte=fonte, servizio=sid, riga=rown, attivita=r[1], mancano=", ".join(miss)))
        if r[8]: note.append(f"Note dipartimento: {r[8]}")
        if r[9] and not PLACEHOLDER_RE.match(str(r[9])): note.append(f"Dettaglio: {r[9]}")
        d = match_dist(dist, sid, r[12], r[1]) if r[12] in COD_LIBRERIA else None
        mil = r[7] if r[7] in SINO else None
        acts.append(dict(
            ID_SERVIZIO=sid, COD_LIBRERIA=cod, ATTIVITA=r[1], QUANDO=quando,
            CONDIZIONE_DRIVER=clean(d.get("Condizione / driver")) if d else None,
            QTA_STD=d.get("Q.tà std") if d and isinstance(d.get("Q.tà std"), (int, float)) else 1,
            UNITA=(clean(d.get("Unità")) if d else None) or (lib.get(cod, {}).get("Unità di quantità tipica") if cod else None),
            ORE_MIN=omin, ORE_MAX=omax, RUOLO=ruolo, GG_MIN=gmin, GG_MAX=gmax, MILESTONE_FATT=mil,
            TERZI=clean(d.get("Dipendenza da terzi")) if d else None,
            TEMPLATE=clean(d.get("Template")) if d else None, OUTPUT=clean(d.get("Output")) if d else None,
            TESTO_FONTE_EFFORT=None if r[3] is None and r[4] is None else f"min {r[3] if r[3] is not None else '-'} / max {r[4] if r[4] is not None else '-'}",
            TESTO_FONTE_ELAPSED=None if r[6] is None else str(r[6]),
            FONTE=f"{fonte} r.{rown}", NOTE=" | ".join(note) or None))
    db_rows = len(acts)
    exc = sum(1 for e in log["esclusioni"] if e["fonte"] == fonte)
    log["quadratura"].append(dict(fonte=fonte, dip=dip, servizi=len(servizi), righe_fonte=n_src,
                                  righe_db=db_rows, righe_escluse=exc, ok="✔" if n_src == db_rows + exc else "✖"))

    # ---- domande
    ws = wb["3_DOMANDE"]
    h = hdr_row(ws)
    for r in ws.iter_rows(min_row=h + 1, values_only=True):
        if r[1]:
            log["domande"].append(dict(fonte=fonte, dip=dip, id=r[5], domanda=r[1],
                                       risposta=r[2] if r[2] and not str(r[2]).startswith("Risposta libera") else None,
                                       spiegazione=r[3]))
    return servizi, acts


def main():
    cat, dist, lib = load_v4()
    log = dict(esclusioni=[], anomalie=[], mancanti=[], quadratura=[], domande=[], info=[])
    servizi, attivita = {}, []
    files = sorted(glob.glob(os.path.join(ROOT, "input/compilate/*.xlsx"))) + \
        sorted(glob.glob(os.path.join(ROOT, "input/da_finalizzare/*.xlsx")))
    for f in files:
        s, a = parse_scheda(f, cat, dist, lib, log)
        for k in s:
            if k in servizi:
                log["anomalie"].append(dict(fonte=f, livello="ERRORE", oggetto=k, msg="ID servizio duplicato tra fonti"))
        servizi.update(s)
        attivita.extend(a)

    # servizi del v4 non presenti in nessuna scheda (es. segnaposto XXX-TBD)
    for k, v in cat.items():
        if k not in servizi and not any(s.startswith(k + "-V") for s in servizi):
            log["info"].append(dict(fonte="catalogo v4", msg=f"{k} '{v.get('Prodotto (servizio vendibile)')}' non presente "
                                                            f"nelle schede: non importato"))

    # SEQ / ID_ATTIVITA, stato e livello
    by_srv = {}
    for a in attivita:
        by_srv.setdefault(a["ID_SERVIZIO"], []).append(a)
    for sid, lst in by_srv.items():
        for i, a in enumerate(lst, 1):
            a["SEQ"] = i * 10
            a["ID_ATTIVITA"] = f"{sid}-{i * 10:03d}"
    for sid, s in servizi.items():
        lst = by_srv.get(sid, [])
        if not lst:
            s["LIVELLO_COMPLETEZZA"] = 1 if s["DESCRIZIONE_PREVENTIVO"] else 0
        elif all(a["ORE_MIN"] is not None and a["ORE_MAX"] is not None for a in lst):
            s["LIVELLO_COMPLETEZZA"] = 3
        else:
            s["LIVELLO_COMPLETEZZA"] = 2
        if sid in DISATTIVI or s["_desc_ok"] == "Non lo offriamo più":
            s["STATO"] = "Disattivo"
        elif not lst or not any(a["QUANDO"] or a["ORE_MIN"] is not None or a["RUOLO"] for a in lst):
            s["STATO"] = "Bozza"
            log["anomalie"].append(dict(fonte=s["FONTE"], livello="AVVISO", oggetto=sid,
                                        msg="Servizio senza attività o con attività prive di dati: STATO = Bozza"))
        else:
            s["STATO"] = "Da validare"
        s["NOTE"] = " | ".join(s.pop("_note")) or None
        s.pop("_desc_ok")

    order = {d: i for i, d in enumerate(DIP_CODES)}
    srv_list = sorted(servizi.values(), key=lambda s: (order[s["DIP_OWNER"]], s["FONTE"]))
    act_list = [a for s in srv_list for a in by_srv.get(s["ID_SERVIZIO"], [])]
    os.makedirs(os.path.join(ROOT, "output"), exist_ok=True)
    json.dump(dict(generato=datetime.datetime.now().isoformat(timespec="seconds"),
                   servizi=srv_list, attivita=act_list, libreria=lib, log=log),
              open(os.path.join(ROOT, "output/normalizzato.json"), "w"), ensure_ascii=False, indent=1, default=str)
    write_log(log)
    q = log["quadratura"]
    print(f"servizi={len(srv_list)} attivita={len(act_list)} escluse={len(log['esclusioni'])} "
          f"anomalie={len(log['anomalie'])} righe_con_mancanti={len(log['mancanti'])} "
          f"quadratura_ok={all(x['ok'] == '✔' for x in q)}")


def write_log(log):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    titles = dict(quadratura="QUADRATURA", esclusioni="ESCLUSIONI", anomalie="ANOMALIE",
                  mancanti="DATI_MANCANTI", domande="DOMANDE", info="INFO")
    for k, t in titles.items():
        ws = wb.create_sheet(t)
        rows = log[k]
        cols = list(rows[0].keys()) if rows else ["(nessuna riga)"]
        ws.append(cols)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1F3864")
        for r in rows:
            ws.append([r.get(c) for c in cols])
        for i, c in enumerate(cols, 1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = min(
                70, max(10, max((len(str(r.get(c) or "")) for r in rows), default=10) + 2))
        ws.freeze_panes = "A2"
        if rows: ws.auto_filter.ref = ws.dimensions
        for row in ws.iter_rows(min_row=2):
            for c in row: c.alignment = Alignment(wrap_text=False, vertical="top")
    wb.save(os.path.join(ROOT, "output/log_normalizzazione.xlsx"))


if __name__ == "__main__":
    main()

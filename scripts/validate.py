"""Validatore del DB catalogo: il "guardiano" prima di ogni pubblicazione (handoff §6.2).

Uso:  python -I scripts/validate.py <DB_Catalogo.xlsx> [report.md]
Exit: 0 = nessun errore bloccante, 1 = errori (la pubblicazione/export va bloccata).

Non usa i valori calcolati dalle formule del foglio (che possono mancare in un file non ricalcolato):
ricalcola tutto in Python. La stessa logica andrà portata in Apps Script per il menu
"Verifica e pubblica catalogo" (fase 1), quindi resta in funzioni pure senza I/O.
"""
import sys, os, re, datetime
import openpyxl
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa


FORMULA_COLS = set(SERVIZI_FORMULA_COLS + ATTIVITA_FORMULA_COLS + PILLAR_FORMULA_COLS)


def read_sheet(wb, name, cols):
    ws = wb[name]
    hdr = [c.value for c in ws[1]]
    missing = [c for c in cols if c not in hdr]
    if missing:
        raise SystemExit(f"Foglio {name}: colonne mancanti {missing}")
    idx = {c: hdr.index(c) for c in cols}
    rows = []
    for n, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        d = {c: clean(r[i]) if i < len(r) else None for c, i in idx.items()}
        if any(d[c] is not None for c in cols if c not in FORMULA_COLS):
            d["_row"] = n
            rows.append(d)
    return rows


def read_ambiti(wb):
    ws = wb["_LISTE"]
    hdr = [c.value for c in ws[1]]
    j = hdr.index("AMBITO")
    return {r[j] for r in ws.iter_rows(min_row=2, values_only=True) if r[j]}


def read_pillars(wb):
    if "PILLAR" not in wb.sheetnames:
        raise SystemExit("Foglio PILLAR mancante")
    return read_sheet(wb, "PILLAR", PILLAR_COLS)


def split_pillars(v):
    return [x.strip() for x in str(v or "").split(PILLAR_SEP) if x.strip()]


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate(servizi, attivita, ambiti, pillars):
    """Funzione pura: ritorna (errori, avvisi) come liste di (foglio, riga, id, regola, messaggio)."""
    E, W = [], []
    e = lambda *a: E.append(a)
    w = lambda *a: W.append(a)

    # ---------------- PILLAR
    pil = {}
    for p in pillars:
        n, r = p["PILLAR"], p["_row"]
        if not n:
            e("PILLAR", r, "", "R3", "Nome pillar vuoto"); continue
        if n in pil:
            e("PILLAR", r, n, "R3", f"Pillar duplicato (anche riga {pil[n]['_row']})")
        pil.setdefault(n, p)
        if PILLAR_SEP in str(n):
            e("PILLAR", r, n, "R5", f"Il nome non può contenere '{PILLAR_SEP}'")
        if p["TIPO"] not in PILLAR_TIPO:
            e("PILLAR", r, n, "R5", f"TIPO fuori dominio: '{p['TIPO']}'")
        if p["ATTIVO"] not in SINO:
            e("PILLAR", r, n, "R5", f"ATTIVO fuori dominio: '{p['ATTIVO']}'")
    uso = {n: 0 for n in pil}

    # ---------------- SERVIZI
    seen = {}
    for s in servizi:
        sid, r = s["ID_SERVIZIO"], s["_row"]
        if not sid:
            e("SERVIZI", r, "", "R3", "ID_SERVIZIO vuoto"); continue
        if sid in seen:
            e("SERVIZI", r, sid, "R3", f"ID duplicato (anche riga {seen[sid]})")
        seen.setdefault(sid, r)
        if not ID_SERVIZIO_RE.match(str(sid)):
            e("SERVIZI", r, sid, "R3", "Formato ID non valido (atteso DIP-XXX[-Vnn])")
        elif str(sid).split("-")[0] != s["DIP_OWNER"]:
            e("SERVIZI", r, sid, "R5", f"Prefisso ID diverso da DIP_OWNER ({s['DIP_OWNER']})")
        for c in ("SERVIZIO", "PILLAR", "DIP_OWNER", "ENTITA", "STATO", "FONTE"):
            if not s[c]:
                e("SERVIZI", r, sid, "R5", f"{c} obbligatorio")
        if s["PILLAR"] is not None:
            if s["PILLAR"] not in pil:
                e("SERVIZI", r, sid, "R5", f"PILLAR non presente nel foglio PILLAR: '{s['PILLAR']}'")
            else:
                uso[s["PILLAR"]] += 1
                if pil[s["PILLAR"]]["TIPO"] == "Trasversale":
                    w("SERVIZI", r, sid, "W", "Pillar di origine trasversale: di norma è quello del dipartimento")
        for x in split_pillars(s["PILLAR_AGGIUNTIVI"]):
            if x not in pil:
                e("SERVIZI", r, sid, "R5", f"PILLAR_AGGIUNTIVI: '{x}' non presente nel foglio PILLAR")
            elif x == s["PILLAR"]:
                w("SERVIZI", r, sid, "W", f"PILLAR_AGGIUNTIVI ripete il pillar di origine '{x}'")
            else:
                uso[x] += 1
        for c, dom in (("ENTITA", ENTITA), ("VENDIBILITA", VENDIBILITA), ("NATURA", NATURA),
                       ("MODELLO_PREZZO", MODELLO_PREZZO), ("MODALITA_AMMESSE", MODALITA), ("ESTERNI", ESTERNI),
                       ("STATO", STATO), ("DIP_OWNER", DIP_CODES)):
            if s[c] is not None and s[c] not in dom:
                e("SERVIZI", r, sid, "R5", f"{c} fuori dominio: '{s[c]}'")
        if s["AMBITO"] is not None and s["AMBITO"] not in ambiti:
            e("SERVIZI", r, sid, "R5", f"AMBITO non presente in _LISTE: '{s['AMBITO']}'")
        lv = s["LIVELLO_COMPLETEZZA"]
        if lv is not None and (not is_num(lv) or int(lv) != lv or lv not in LIVELLO):
            e("SERVIZI", r, sid, "R5", f"LIVELLO_COMPLETEZZA fuori dominio: {lv}")
        for c in ("ROUND_INCLUSI", "PRATICHE_ANNO"):
            if s[c] is not None and (not is_num(s[c]) or s[c] < 0):
                e("SERVIZI", r, sid, "R4", f"{c} deve essere un numero ≥ 0")
        if s["STATO"] != "Disattivo":
            if not s["AMBITO"]: w("SERVIZI", r, sid, "W", "AMBITO mancante")
            if not s["DESCRIZIONE_PREVENTIVO"]: w("SERVIZI", r, sid, "W", "Descrizione per il preventivo mancante")
            if not s["MODELLO_PREZZO"]: w("SERVIZI", r, sid, "W", "Modello di prezzo da definire")
            if not s["MODALITA_AMMESSE"]: w("SERVIZI", r, sid, "W", "Modalità di pagamento (Corpo/T&M) mancante")

    # ---------------- ATTIVITA
    n_by_srv, seen_a, seq_seen = {}, {}, {}
    for a in attivita:
        aid, sid, r = a["ID_ATTIVITA"], a["ID_SERVIZIO"], a["_row"]
        if not aid:
            e("ATTIVITA", r, "", "R3", "ID_ATTIVITA vuoto")
        elif aid in seen_a:
            e("ATTIVITA", r, aid, "R3", f"ID duplicato (anche riga {seen_a[aid]})")
        else:
            seen_a[aid] = r
        if not sid:
            e("ATTIVITA", r, aid, "R1", "Attività non allocata a un servizio"); continue
        if sid not in seen:
            e("ATTIVITA", r, aid, "R1", f"ID_SERVIZIO inesistente: '{sid}'")
        n_by_srv[sid] = n_by_srv.get(sid, 0) + 1
        if aid and not str(aid).startswith(f"{sid}-"):
            e("ATTIVITA", r, aid, "R3", f"ID_ATTIVITA non coerente con ID_SERVIZIO {sid}")
        if a["SEQ"] is not None:
            if not is_num(a["SEQ"]):
                e("ATTIVITA", r, aid, "R4", "SEQ non numerico")
            elif (sid, a["SEQ"]) in seq_seen:
                w("ATTIVITA", r, aid, "W", f"SEQ {a['SEQ']} ripetuta nel servizio (riga {seq_seen[(sid, a['SEQ'])]})")
            seq_seen.setdefault((sid, a["SEQ"]), r)
        if not a["ATTIVITA"]:
            e("ATTIVITA", r, aid, "R5", "Descrizione attività obbligatoria")
        if not a["FONTE"]:
            e("ATTIVITA", r, aid, "R5", "FONTE obbligatoria")
        for c, dom in (("COD_LIBRERIA", COD_LIBRERIA), ("QUANDO", QUANDO), ("RUOLO", RUOLO), ("MILESTONE_FATT", SINO)):
            if a[c] is not None and a[c] not in dom:
                e("ATTIVITA", r, aid, "R5", f"{c} fuori dominio: '{a[c]}'")
        for lo, hi, lim in (("ORE_MIN", "ORE_MAX", 2000), ("GG_MIN", "GG_MAX", 3650)):
            for c in (lo, hi):
                if a[c] is not None and (not is_num(a[c]) or not 0 <= a[c] <= lim):
                    e("ATTIVITA", r, aid, "R4", f"{c} deve essere un numero tra 0 e {lim}")
            if is_num(a[lo]) and is_num(a[hi]) and a[hi] < a[lo]:
                e("ATTIVITA", r, aid, "R4", f"{hi} ({a[hi]}) < {lo} ({a[lo]})")
        if a["QTA_STD"] is not None and (not is_num(a["QTA_STD"]) or a["QTA_STD"] < 0):
            e("ATTIVITA", r, aid, "R4", "QTA_STD deve essere ≥ 0")
        miss = [c for c in ("QUANDO", "RUOLO", "COD_LIBRERIA", "MILESTONE_FATT") if a[c] is None]
        if a["ORE_MIN"] is None or a["ORE_MAX"] is None: miss.insert(0, "ORE")
        if miss:
            w("ATTIVITA", r, aid, "W", "Da completare: " + ", ".join(miss))
        if (a["ORE_MIN"] is not None or a["ORE_MAX"] is not None) and not a["TESTO_FONTE_EFFORT"]:
            w("ATTIVITA", r, aid, "W", "Testo originale dell'effort non conservato")

    for n, p in pil.items():
        if p["ATTIVO"] == "Sì" and uso.get(n, 0) == 0:
            w("PILLAR", p["_row"], n, "W", "Pillar attivo senza servizi")
    for s in servizi:
        sid = s["ID_SERVIZIO"]
        if not sid: continue
        n = n_by_srv.get(sid, 0)
        if n == 0 and s["STATO"] in STATI_ATTIVI:
            e("SERVIZI", s["_row"], sid, "R2", f"Servizio '{s['STATO']}' senza attività")
        elif n == 0 and s["STATO"] == "Bozza":
            w("SERVIZI", s["_row"], sid, "W", "Bozza senza attività (non pubblicabile come attivo)")
    return E, W


def report(path, E, W, servizi, attivita, out=None):
    now = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")
    lines = [f"# Report di validazione DB catalogo", "",
             f"File: `{os.path.basename(path)}` · {now}", "",
             f"**Esito: {'✖ BLOCCATO' if E else '✔ PUBBLICABILE'}** · servizi {len(servizi)} · attività {len(attivita)} · "
             f"errori {len(E)} · avvisi {len(W)}", ""]
    by_state = {}
    for s in servizi:
        by_state[s["STATO"]] = by_state.get(s["STATO"], 0) + 1
    lines += ["Servizi per stato: " + ", ".join(f"{k} {v}" for k, v in sorted(by_state.items(), key=lambda x: str(x[0]))), ""]
    for title, items in (("Errori bloccanti", E), ("Avvisi", W)):
        lines += [f"## {title} ({len(items)})", ""]
        if not items:
            lines += ["Nessuno.", ""]; continue
        if title == "Avvisi":   # sintesi per tipo, poi dettaglio
            agg = {}
            for it in items:
                k = (it[0], it[4].split(":")[0])
                agg[k] = agg.get(k, 0) + 1
            lines += ["| Foglio | Tipo | N. |", "|---|---|---|"] + [f"| {k[0]} | {k[1]} | {v} |" for k, v in sorted(agg.items())] + [""]
        lines += ["| Foglio | Riga | ID | Regola | Messaggio |", "|---|---|---|---|---|"]
        lines += [f"| {a} | {b} | {c} | {d} | {str(m).replace('|', '/')} |" for a, b, c, d, m in items] + [""]
    txt = "\n".join(lines)
    if out:
        open(out, "w").write(txt)
    return txt


def load(path):
    wb = openpyxl.load_workbook(path)   # valori grezzi; le colonne formula si ignorano
    return (read_sheet(wb, "SERVIZI", SERVIZI_COLS), read_sheet(wb, "ATTIVITA", ATTIVITA_COLS), read_ambiti(wb),
            read_pillars(wb))


def main():
    path = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    s, a, amb, pil = load(path)
    E, W = validate(s, a, amb, pil)
    report(path, E, W, s, a, out)
    print(f"{'BLOCCATO' if E else 'OK'}: errori={len(E)} avvisi={len(W)} servizi={len(s)} attivita={len(a)}")
    for x in E[:20]:
        print("  ⛔", x)
    return 1 if E else 0


if __name__ == "__main__":
    sys.exit(main())

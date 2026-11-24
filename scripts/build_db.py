"""Genera db/DB_Catalogo.xlsx (SERVIZI, ATTIVITA, _LISTE) da output/normalizzato.json.

Uso:  python -I scripts/build_db.py <repo_root>

Vincoli (handoff §8): formule compatibili Excel / Google Sheets (COUNTIF(S), SUMIFS, IF, ISNUMBER),
convalide a elenco su intervalli, nessuna macro, nessuna tabella strutturata obbligatoria.
Il file non contiene valori calcolati in cache: Excel e Google Sheets ricalcolano all'apertura
(fullCalcOnLoad). Per la verifica si usa una copia ricalcolata con LibreOffice (scripts/check_formulas.py).
"""
import sys, os, json, datetime
import openpyxl
from openpyxl.utils import get_column_letter as L
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.comments import Comment
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
MAX_S, MAX_A = 1000, 5000          # righe coperte da formule di controllo / convalide
HDR_FILL = PatternFill("solid", fgColor="1F3864")
FORM_FILL = PatternFill("solid", fgColor="E7E6E6")
KEY_FILL = PatternFill("solid", fgColor="D9E1F2")
WRAP = {"DESCRIZIONE_PREVENTIVO", "INCLUSO", "ESCLUSO", "NOTE", "ATTIVITA"}
WIDTH = dict(ID_SERVIZIO=14, ID_ATTIVITA=17, SERVIZIO=45, ATTIVITA=55, DESCRIZIONE_PREVENTIVO=60, INCLUSO=40,
             ESCLUSO=40, NOTE=60, AMBITO=32, PILLAR=18, PILLAR_AGGIUNTIVI=28, FONTE=40, CHECK=24, QUANDO=26, DRIVER=22)

HELP = {
    "ID_SERVIZIO": "Chiave. Formato DIP-XXX[-Vnn]. Mai riusare un ID, nemmeno dopo la disattivazione.",
    "STATO": "Bozza / Da validare / Validato / Disattivo. Non cancellare: usare Disattivo.",
    "MODALITA_AMMESSE": "Modalità di pagamento selezionabili nel preventivo: Corpo, T&M o Entrambe.",
    "MODELLO_PREZZO": "Modello di riferimento P1-P6 (vedi _LISTE). Proposta: da confermare col professionista.",
    "LIVELLO_COMPLETEZZA": "0 nome · 1 perimetro · 2 attività · 3 attività con effort · 4 prezzo validato",
    "N_ATTIVITA": "Formula: n. attività in ATTIVITA con questo ID.",
    "ORE_MIN_TOT": "Formula: somma ORE_MIN delle attività 'Sempre'.",
    "ORE_MAX_TOT": "Formula: somma ORE_MAX delle attività 'Sempre'.",
    "PILLAR": "Pillar di origine del servizio (menu dal foglio PILLAR).",
    "PILLAR_AGGIUNTIVI": "Altri pillar (es. trasversali multi-dipartimento) in cui il servizio compare. "
                         "Nomi esatti dal foglio PILLAR separati da ';'. Controllati dal validatore.",
    "PILLAR@P": "Nome del pillar: chiave, univoca. Per un preventivo multi-dipartimento creare un pillar TIPO=Trasversale "
                "e indicarlo in SERVIZI.PILLAR_AGGIUNTIVI dei servizi che deve contenere.",
    "ATTIVO@P": "Sì = selezionabile nel configuratore.",
    "N_SERVIZI@P": "Formula: servizi con questo pillar come origine o tra i pillar aggiuntivi.",
    "ID_SERVIZIO@A": "Chiave esterna: scegliere dal menu (legge SERVIZI!A).",
    "CHECK": "Formula di controllo. ⛔ = errore bloccante per la pubblicazione, ⚠ = dato mancante/da completare.",
}


def col(cols, name):
    return L(cols.index(name) + 1)


def style_header(ws, cols, formula_cols, key_cols, sheet_tag):
    for i, c in enumerate(cols, 1):
        cell = ws.cell(1, i, c)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = HDR_FILL
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        h = HELP.get(f"{c}@{sheet_tag}") or HELP.get(c)
        if h:
            cell.comment = Comment(h, "BSA")
        ws.column_dimensions[L(i)].width = WIDTH.get(c, 13)
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "B2"


def add_list_dv(ws, rng, src, allow_blank=True, msg=None):
    dv = DataValidation(type="list", formula1=src, allow_blank=allow_blank, showErrorMessage=True,
                        errorTitle="Valore non ammesso", error=msg or "Scegliere un valore dal menu.")
    dv.add(rng)
    ws.add_data_validation(dv)


def add_num_dv(ws, rng, kind, lo, hi, msg):
    dv = DataValidation(type=kind, operator="between", formula1=str(lo), formula2=str(hi), allow_blank=True,
                        showErrorMessage=True, errorTitle="Valore non ammesso", error=msg)
    dv.add(rng)
    ws.add_data_validation(dv)


def check_cf(ws, letter, maxr):
    rng = f"{letter}2:{letter}{maxr}"
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'LEFT(${letter}2,1)="⛔"'],
                                                   fill=PatternFill("solid", fgColor="F4B6B6"), font=Font(color="9C0006", bold=True)))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'LEFT(${letter}2,1)="⚠"'],
                                                   fill=PatternFill("solid", fgColor="FFE699")))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'LEFT(${letter}2,1)="✔"'],
                                                   fill=PatternFill("solid", fgColor="C6EFCE")))


def dup_cf(ws, maxr):
    ws.conditional_formatting.add(f"A2:A{maxr}", FormulaRule(formula=[f"COUNTIF($A$2:$A${maxr},$A2)>1"],
                                                             fill=PatternFill("solid", fgColor="FF7C80")))


def main():
    data = json.load(open(os.path.join(ROOT, "output/normalizzato.json")))
    srv, act, lib = data["servizi"], data["attivita"], data["libreria"]
    wb = openpyxl.Workbook()
    wb.calculation.fullCalcOnLoad = True

    # ------------------------------------------------------------ _LISTE
    wl = wb.active
    wl.title = "_LISTE"
    ambiti = sorted({s["AMBITO"] for s in srv if s["AMBITO"]})
    lists = [("TIPO_PILLAR", PILLAR_TIPO), ("ENTITA", ENTITA), ("VENDIBILITA", VENDIBILITA), ("NATURA", NATURA),
             ("MODELLO_PREZZO", MODELLO_PREZZO), ("MODALITA", MODALITA), ("ESTERNI", ESTERNI), ("STATO", STATO),
             ("QUANDO", QUANDO), ("RUOLO", RUOLO), ("SINO", SINO), ("DIP", DIP_CODES),
             ("COD_LIBRERIA", COD_LIBRERIA), ("AMBITO", ambiti)]
    ref = {}
    for j, (name, vals) in enumerate(lists, 1):
        wl.cell(1, j, name).font = Font(bold=True, color="FFFFFF")
        wl.cell(1, j).fill = HDR_FILL
        for i, v in enumerate(vals, 2):
            wl.cell(i, j, v)
        last = 200 if name == "AMBITO" else len(vals) + 1   # AMBITO: spazio per nuovi valori
        ref[name] = f"'_LISTE'!${L(j)}$2:${L(j)}${last}"
        wl.column_dimensions[L(j)].width = max(12, max(len(str(v)) for v in vals + [name]) + 2)

    c0 = len(lists) + 2   # tabelle descrittive
    def table(c, title, hdr, rows):
        wl.cell(1, c, title).font = Font(bold=True, color="FFFFFF")
        wl.cell(1, c).fill = HDR_FILL
        for k, h in enumerate(hdr):
            wl.cell(2, c + k, h).font = Font(bold=True)
        for i, r in enumerate(rows, 3):
            for k, v in enumerate(r):
                wl.cell(i, c + k, v)
        for k in range(len(hdr)):
            wl.column_dimensions[L(c + k)].width = 28
        return c + len(hdr) + 1

    c = table(c0, "LIBRERIA ATTIVITÀ", ["COD", "ATTIVITA_STANDARD", "DEFINIZIONE", "RUOLO_TIPICO", "UNITA_TIPICA"],
              [(k, v.get("Attività standard"), v.get("Definizione (glossario)"), v.get("Ruolo tipico"),
                v.get("Unità di quantità tipica")) for k, v in lib.items() if k in COD_LIBRERIA])
    c = table(c, "DIPARTIMENTI", ["COD", "DIPARTIMENTO", "PILLAR", "HEAD_TO_BE", "ENTITA"], DIPARTIMENTI)
    c = table(c, "MODELLI PREZZO", ["COD", "MODELLO", "CALCOLO", "FATTURAZIONE"], [
        ("P1", "A corpo", "Σ attività incluse", "SAL a milestone"),
        ("P2", "A corpo + variabile per unità", "base + prezzo unitario × driver", "SAL a milestone"),
        ("P3", "Tariffa oraria con budget stimato", "ore stimate × tariffa", "consuntivo mensile"),
        ("P4", "Canone ricorrente", "prezzo × periodo × quantità (+ setup)", "per periodo"),
        ("P5", "Accordo quadro annuale", "tariffe concordate, nessun preventivo puntuale", "consuntivo mensile"),
        ("P6", "Componente su esito", "% su valore o recuperato", "a evento (solo se decide la Direzione)")])

    sc, ac = SERVIZI_COLS, ATTIVITA_COLS
    s_chk, a_chk = col(sc, "CHECK"), col(ac, "CHECK")
    table(c, "CONTROLLI DI INTEGRITÀ", ["CONTROLLO", "VALORE"], [
        ("Servizi", f"=COUNTA(SERVIZI!$A$2:$A${MAX_S})"),
        ("Attività", f"=COUNTA(ATTIVITA!$A$2:$A${MAX_A})"),
        ("Servizi con errore ⛔", f'=COUNTIF(SERVIZI!${s_chk}$2:${s_chk}${MAX_S},"⛔*")'),
        ("Servizi con avviso ⚠", f'=COUNTIF(SERVIZI!${s_chk}$2:${s_chk}${MAX_S},"⚠*")'),
        ("Attività con errore ⛔", f'=COUNTIF(ATTIVITA!${a_chk}$2:${a_chk}${MAX_A},"⛔*")'),
        ("Attività con avviso ⚠", f'=COUNTIF(ATTIVITA!${a_chk}$2:${a_chk}${MAX_A},"⚠*")'),
        ("Generato", datetime.datetime.now().strftime("%d/%m/%Y %H:%M")),
        ("Schema", DB_VERSION_SCHEMA)])
    wl.sheet_state = "hidden"
    ref["PILLAR"] = "PILLAR!$A$2:$A$200"

    # ------------------------------------------------------------ SERVIZI
    ws = wb.create_sheet("SERVIZI", 0)
    style_header(ws, sc, SERVIZI_FORMULA_COLS, ["ID_SERVIZIO"], "S")
    A_B, A_F, A_J, A_K = (col(ac, "ID_SERVIZIO"), col(ac, "QUANDO"), col(ac, "ORE_MIN"), col(ac, "ORE_MAX"))
    sN, sS, sSt, sP = col(sc, "N_ATTIVITA"), col(sc, "SERVIZIO"), col(sc, "STATO"), col(sc, "PILLAR")
    sD, sMP = col(sc, "DIP_OWNER"), col(sc, "MODALITA_AMMESSE")
    for i, s in enumerate(srv, 2):
        for j, cname in enumerate(sc, 1):
            if cname in SERVIZI_FORMULA_COLS:
                continue
            cell = ws.cell(i, j, s.get(cname))
            if cname in WRAP:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
    for i in range(2, len(srv) + 2):
        ws[f"{sN}{i}"] = f'=IF($A{i}="","",COUNTIF(ATTIVITA!${A_B}$2:${A_B}${MAX_A},$A{i}))'
        ws[f"{col(sc,'ORE_MIN_TOT')}{i}"] = (f'=IF($A{i}="","",SUMIFS(ATTIVITA!${A_J}$2:${A_J}${MAX_A},'
                                              f'ATTIVITA!${A_B}$2:${A_B}${MAX_A},$A{i},ATTIVITA!${A_F}$2:${A_F}${MAX_A},"Sempre"))')
        ws[f"{col(sc,'ORE_MAX_TOT')}{i}"] = (f'=IF($A{i}="","",SUMIFS(ATTIVITA!${A_K}$2:${A_K}${MAX_A},'
                                              f'ATTIVITA!${A_B}$2:${A_B}${MAX_A},$A{i},ATTIVITA!${A_F}$2:${A_F}${MAX_A},"Sempre"))')
        ws[f"{s_chk}{i}"] = (
            f'=IF($A{i}="","",IF(COUNTIF($A$2:$A${MAX_S},$A{i})>1,"⛔ ID duplicato",'
            f'IF(OR(${sS}{i}="",${sP}{i}="",${sD}{i}="",${sSt}{i}=""),"⛔ campi obbligatori mancanti",'
            f'IF(AND(OR(${sSt}{i}="Da validare",${sSt}{i}="Validato"),${sN}{i}=0),"⛔ servizio attivo senza attività",'
            f'IF(${sN}{i}=0,"⚠ senza attività ("&${sSt}{i}&")",'
            f'IF(${sMP}{i}="","⚠ modalità pagamento mancante","✔"))))))')
        for cname in SERVIZI_FORMULA_COLS:
            ws[f"{col(sc, cname)}{i}"].fill = FORM_FILL
        ws[f"A{i}"].fill = KEY_FILL
    # convalide
    for cname, key in [("PILLAR", "PILLAR"), ("ENTITA", "ENTITA"), ("VENDIBILITA", "VENDIBILITA"),
                       ("NATURA", "NATURA"), ("MODELLO_PREZZO", "MODELLO_PREZZO"), ("MODALITA_AMMESSE", "MODALITA"),
                       ("ESTERNI", "ESTERNI"), ("STATO", "STATO"), ("DIP_OWNER", "DIP"), ("AMBITO", "AMBITO")]:
        x = col(sc, cname)
        add_list_dv(ws, f"{x}2:{x}{MAX_S}", ref[key],
                    msg="Valore non in elenco. Per un nuovo AMBITO aggiungerlo prima in _LISTE." if key == "AMBITO" else None)
    x = col(sc, "LIVELLO_COMPLETEZZA"); add_num_dv(ws, f"{x}2:{x}{MAX_S}", "whole", 0, 4, "Intero da 0 a 4.")
    x = col(sc, "ROUND_INCLUSI"); add_num_dv(ws, f"{x}2:{x}{MAX_S}", "whole", 0, 20, "Intero da 0 a 20.")
    x = col(sc, "PRATICHE_ANNO"); add_num_dv(ws, f"{x}2:{x}{MAX_S}", "decimal", 0, 10000, "Numero ≥ 0.")
    check_cf(ws, s_chk, MAX_S)
    dup_cf(ws, MAX_S)
    ws.auto_filter.ref = f"A1:{L(len(sc))}{len(srv) + 1}"

    # ------------------------------------------------------------ ATTIVITA
    wa = wb.create_sheet("ATTIVITA", 1)
    style_header(wa, ac, ATTIVITA_FORMULA_COLS, ["ID_ATTIVITA"], "A")
    for i, a in enumerate(act, 2):
        for j, cname in enumerate(ac, 1):
            if cname in ATTIVITA_FORMULA_COLS:
                continue
            cell = wa.cell(i, j, a.get(cname))
            if cname in WRAP:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
    aL, aD, aE = col(ac, "RUOLO"), col(ac, "COD_LIBRERIA"), col(ac, "ATTIVITA")
    for i in range(2, len(act) + 2):
        wa[f"{a_chk}{i}"] = (
            f'=IF($A{i}="","",IF(COUNTIF($A$2:$A${MAX_A},$A{i})>1,"⛔ ID duplicato",'
            f'IF(COUNTIF(SERVIZI!$A$2:$A${MAX_S},${A_B}{i})=0,"⛔ servizio inesistente",'
            f'IF(${aE}{i}="","⛔ descrizione mancante",'
            f'IF(AND(ISNUMBER(${A_J}{i}),ISNUMBER(${A_K}{i}),${A_K}{i}<${A_J}{i}),"⛔ ore MAX < MIN",'
            f'IF(OR(${A_J}{i}="",${A_K}{i}=""),"⚠ mancano le ore",'
            f'IF(${A_F}{i}="","⚠ manca quando",'
            f'IF(${aL}{i}="","⚠ manca ruolo",'
            f'IF(${aD}{i}="","⚠ manca cod. libreria","✔")))))))))')
        wa[f"{a_chk}{i}"].fill = FORM_FILL
        wa[f"A{i}"].fill = KEY_FILL
    add_list_dv(wa, f"{A_B}2:{A_B}{MAX_A}", f"SERVIZI!$A$2:$A${MAX_S}", allow_blank=False,
                msg="L'attività deve appartenere a un servizio esistente in SERVIZI (colonna A).")
    for cname, key in [("COD_LIBRERIA", "COD_LIBRERIA"), ("QUANDO", "QUANDO"), ("RUOLO", "RUOLO"),
                       ("MILESTONE_FATT", "SINO")]:
        x = col(ac, cname); add_list_dv(wa, f"{x}2:{x}{MAX_A}", ref[key])
    for cname in ("ORE_MIN", "ORE_MAX"):
        x = col(ac, cname); add_num_dv(wa, f"{x}2:{x}{MAX_A}", "decimal", 0, 2000, "Ore: numero tra 0 e 2000.")
    for cname in ("GG_MIN", "GG_MAX"):
        x = col(ac, cname); add_num_dv(wa, f"{x}2:{x}{MAX_A}", "decimal", 0, 3650, "Giorni: numero tra 0 e 3650.")
    x = col(ac, "SEQ"); add_num_dv(wa, f"{x}2:{x}{MAX_A}", "whole", 1, 9990, "Intero 1-9990.")
    x = col(ac, "QTA_STD"); add_num_dv(wa, f"{x}2:{x}{MAX_A}", "decimal", 0, 10000, "Quantità ≥ 0.")
    # R4: ORE_MAX >= ORE_MIN (convalida personalizzata, riga per riga)
    dv = DataValidation(type="custom", formula1=f'OR({A_K}2="",{A_J}2="",{A_K}2>={A_J}2)', allow_blank=True,
                        showErrorMessage=True, errorTitle="Ore non coerenti", error="ORE_MAX deve essere ≥ ORE_MIN.")
    dv.add(f"{A_K}2:{A_K}{MAX_A}"); wa.add_data_validation(dv)
    check_cf(wa, a_chk, MAX_A)
    dup_cf(wa, MAX_A)
    wa.auto_filter.ref = f"A1:{L(len(ac))}{len(act) + 1}"

    # ------------------------------------------------------------ PILLAR (gestibile dall'admin)
    wp = wb.create_sheet("PILLAR", 2)
    pc = PILLAR_COLS
    style_header(wp, pc, PILLAR_FORMULA_COLS, ["PILLAR"], "P")
    wp.column_dimensions["A"].width = 30
    wp.column_dimensions["B"].width = 60
    sB, sC = col(sc, "PILLAR"), col(sc, "PILLAR_AGGIUNTIVI")
    for i, row in enumerate(PILLAR_SEED, 2):
        for j, v in enumerate(row, 1):
            wp.cell(i, j, v)
    for i in range(2, 51):   # formule pronte anche per i pillar che l'admin aggiungerà
        x = col(pc, "N_SERVIZI")
        wp[f"{x}{i}"] = (f'=IF($A{i}="","",COUNTIF(SERVIZI!${sB}$2:${sB}${MAX_S},$A{i})'
                         f'+COUNTIF(SERVIZI!${sC}$2:${sC}${MAX_S},"*"&$A{i}&"*"))')
        wp[f"{x}{i}"].fill = FORM_FILL
    add_list_dv(wp, f"{col(pc,'TIPO')}2:{col(pc,'TIPO')}200", ref["TIPO_PILLAR"], allow_blank=False)
    add_list_dv(wp, f"{col(pc,'ATTIVO')}2:{col(pc,'ATTIVO')}200", ref["SINO"], allow_blank=False)
    add_num_dv(wp, f"{col(pc,'ORDINE')}2:{col(pc,'ORDINE')}200", "whole", 0, 999, "Intero 0-999 (ordine nel menu).")
    dup_cf(wp, 200)
    wp.freeze_panes = "B2"

    out = os.path.join(ROOT, "db/DB_Catalogo.xlsx")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wb.save(out)
    print(f"scritto {out}: servizi={len(srv)} attivita={len(act)}")


if __name__ == "__main__":
    main()

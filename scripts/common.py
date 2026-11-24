"""Domini, costanti e helper condivisi da normalize / build_db / validate / export.

Unico punto in cui si definiscono i valori ammessi: build_db li scrive in _LISTE,
validate li usa per i controlli R5.
"""
import re

DB_VERSION_SCHEMA = "1.1"

# ---------------------------------------------------------------- colonne
SERVIZI_COLS = [
    "ID_SERVIZIO", "PILLAR", "PILLAR_AGGIUNTIVI", "AMBITO", "SERVIZIO", "DIP_OWNER", "DIP_CONTRIBUTORI", "ENTITA",
    "DESCRIZIONE_PREVENTIVO", "INCLUSO", "ESCLUSO", "VENDIBILITA", "NATURA", "MODELLO_PREZZO",
    "MODALITA_AMMESSE", "UNITA_PREZZO", "DRIVER", "ROUND_INCLUSI", "ESTERNI", "STATO",
    "LIVELLO_COMPLETEZZA", "PRATICHE_ANNO", "FONTE", "NOTE",
    # formule
    "N_ATTIVITA", "ORE_MIN_TOT", "ORE_MAX_TOT", "CHECK",
]
SERVIZI_FORMULA_COLS = ["N_ATTIVITA", "ORE_MIN_TOT", "ORE_MAX_TOT", "CHECK"]

ATTIVITA_COLS = [
    "ID_ATTIVITA", "ID_SERVIZIO", "SEQ", "COD_LIBRERIA", "ATTIVITA", "QUANDO", "CONDIZIONE_DRIVER",
    "QTA_STD", "UNITA", "ORE_MIN", "ORE_MAX", "RUOLO", "GG_MIN", "GG_MAX", "MILESTONE_FATT",
    "TERZI", "TEMPLATE", "OUTPUT", "TESTO_FONTE_EFFORT", "TESTO_FONTE_ELAPSED", "FONTE", "NOTE",
    # formula
    "CHECK",
]
ATTIVITA_FORMULA_COLS = ["CHECK"]

# ---------------------------------------------------------------- domini
# PILLAR: lista iniziale. In DB_Catalogo i pillar vivono nel foglio PILLAR e l'admin può crearne di nuovi
# (es. pillar trasversali per preventivi multi-dipartimento). Il validatore legge il foglio, non questa lista.
PILLAR = ["Legal & Corporate", "Tax & Cross-border", "Corporate Finance", "Da definire"]
PILLAR_COLS = ["PILLAR", "DESCRIZIONE", "TIPO", "ORDINE", "ATTIVO", "N_SERVIZI"]
PILLAR_FORMULA_COLS = ["N_SERVIZI"]
PILLAR_TIPO = ["Dipartimentale", "Trasversale"]
PILLAR_SEED = [
    ("Legal & Corporate", "Diritto commerciale internazionale, societario, lavoro, compliance", "Dipartimentale", 10, "Sì"),
    ("Tax & Cross-border", "Fiscalità, transfer pricing, global mobility, real estate", "Dipartimentale", 20, "Sì"),
    ("Corporate Finance", "Servizi BPCF Srl", "Dipartimentale", 30, "Sì"),
    ("Da definire", "Dipartimenti in attesa di collocazione (LIT, SSI, OPE)", "Dipartimentale", 90, "No"),
]
PILLAR_SEP = ";"
ENTITA = ["SLB", "BPCF Srl"]
VENDIBILITA = ["Autonomo", "Add-on", "Solo in pacchetto"]
NATURA = ["One-off", "Ricorrente", "Su evento", "Contenitore"]
MODELLO_PREZZO = ["P1", "P2", "P3", "P4", "P5", "P6"]
MODALITA = ["Corpo", "T&M", "Entrambe"]
ESTERNI = ["Nessuno", "Opzionale", "Necessario"]
STATO = ["Bozza", "Da validare", "Validato", "Disattivo"]
STATI_ATTIVI = ["Da validare", "Validato"]          # R2 bloccante solo per questi
LIVELLO = [0, 1, 2, 3, 4]
QUANDO = ["Sempre", "Solo se richiesto dal cliente", "Solo in certi casi"]
RUOLO = ["Head", "Of Counsel", "Senior", "Junior", "Trainee"]
SINO = ["Sì", "No"]
COD_LIBRERIA = [f"ATT-{i:02d}" for i in range(1, 27)]

DIPARTIMENTI = [
    # cod, nome, pillar, head TO-BE, entità
    ("ICL", "International Commercial Law", "Legal & Corporate", "Tommaso Mancini", "SLB"),
    ("CL", "Corporate Law", "Legal & Corporate", "Pier Federico Orciari", "SLB"),
    ("TAX", "Tax & Customs Law (IVA, Dogane)", "Tax & Cross-border", "Tommaso Fonti", "SLB"),
    ("TP", "Transfer Pricing e Fiscalità internazionale", "Tax & Cross-border",
     "Federico Ventura (da chiarire: matrice v.4 indica T. Fonti)", "SLB"),
    ("GM", "Global Mobility", "Tax & Cross-border", "Valeria Zega", "SLB"),
    ("RE", "Real Estate (Luxury)", "Tax & Cross-border", "Lucia Boccarossa", "SLB"),
    ("CF", "Corporate Finance", "Corporate Finance", "Renato Capanna", "BPCF Srl"),
    ("LIT", "Litigation", "Da definire", "Lorenzo Bacciardi (a.i.) / G. Bastianelli", "SLB"),
    ("LAB", "Diritto del lavoro", "Legal & Corporate", "Michele Sacchi", "SLB"),
    ("SSI", "Special Situations", "Da definire", "Francesco Todaro", "SLB"),
    ("CNT", "Compliance e Nuove Tecnologie", "Legal & Corporate", "Federico Alessandri", "SLB"),
    ("OPE", "Organization & People", "Da definire", "Da confermare", "SLB"),
]
DIP_CODES = [d[0] for d in DIPARTIMENTI]

ID_SERVIZIO_RE = re.compile(r"^(%s)-[A-Z0-9]{2,4}(-V\d{2})?$" % "|".join(DIP_CODES))
ID_ATTIVITA_RE = re.compile(r"^(?P<srv>.+)-(?P<seq>\d{3})$")


# ---------------------------------------------------------------- parsing numeri
def _num(s):
    return float(str(s).strip().replace(",", "."))


def parse_hours(v):
    """Ritorna (min, max, nota) da un valore di effort. Regole §4 handoff."""
    if v is None or str(v).strip() == "":
        return None, None, None
    if isinstance(v, (int, float)):
        return float(v), float(v), None
    s = str(v).strip().lower().replace("ore", "h")
    m = re.match(r"^<\s*1\s*h?$", s)
    if m:
        return 0.5, 1.0, "'<1h' convertito in 0,5-1"
    mins = {"10": 0.17, "15": 0.25, "20": 0.33, "30": 0.5}
    m = re.match(r"^(\d+)\s*min", s)
    if m:
        return mins.get(m.group(1), round(int(m.group(1)) / 60, 2)), mins.get(m.group(1), round(int(m.group(1)) / 60, 2)), "minuti convertiti in ore"
    m = re.match(r"^([\d.,]+)\s*h?\s*[-–/]\s*([\d.,]+)\s*h?$", s)
    if m:
        return _num(m.group(1)), _num(m.group(2)), None
    m = re.match(r"^([\d.,]+)\s*h?$", s)
    if m:
        return _num(m.group(1)), _num(m.group(1)), None
    return None, None, f"effort non interpretabile: '{v}'"


def parse_days(v):
    """Ritorna (min, max, nota) da un valore di elapsed in giorni di calendario."""
    if v is None or str(v).strip() == "":
        return None, None, None
    if isinstance(v, (int, float)):
        return float(v), float(v), None
    s = str(v).strip().lower()
    mult = 1
    if "settiman" in s:
        mult = 7
    elif "mes" in s:
        mult = 30
    s2 = re.sub(r"[a-zà-ù]+", "", s).strip()
    m = re.match(r"^([\d.,]+)\s*[-–/]\s*([\d.,]+)$", s2)
    if m:
        return _num(m.group(1)) * mult, _num(m.group(2)) * mult, None if mult == 1 else "convertito in giorni"
    m = re.match(r"^([\d.,]+)$", s2)
    if m:
        return _num(m.group(1)) * mult, _num(m.group(1)) * mult, None if mult == 1 else "convertito in giorni"
    return None, None, f"elapsed non interpretabile: '{v}'"


def clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v

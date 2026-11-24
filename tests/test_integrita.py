"""Test negativi di integrità (handoff §8.6): servizio attivo senza attività, attività con ID servizio
inesistente, ID duplicato, ore MAX<MIN. Devono essere bloccati dal validatore e dall'export, e segnalati
dalle formule CHECK del foglio. Uso: python -I tests/test_integrita.py <repo_root>"""
import sys, os, shutil, tempfile, subprocess
import openpyxl
from openpyxl.formula.translate import Translator
ROOT = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import validate as V
from common import SERVIZI_COLS, ATTIVITA_COLS

tmp = tempfile.mkdtemp()
db = os.path.join(tmp, "DB_test.xlsx")
shutil.copy(os.path.join(ROOT, "db/DB_Catalogo.xlsx"), db)
wb = openpyxl.load_workbook(db)
ws, wa = wb["SERVIZI"], wb["ATTIVITA"]
# 1) servizio 'Da validare' senza attività (copia della riga 2 con nuovo ID, formule incluse)
r = ws.max_row + 1
for c in range(1, ws.max_column + 1):
    v = ws.cell(2, c).value
    ws.cell(r, c, Translator(v, origin=ws.cell(2, c).coordinate).translate_formula(ws.cell(r, c).coordinate) if isinstance(v, str) and v.startswith("=") else v)
ws.cell(r, SERVIZI_COLS.index("ID_SERVIZIO") + 1, "CL-TST")
ws.cell(r, SERVIZI_COLS.index("DIP_OWNER") + 1, "CL")
ws.cell(r, SERVIZI_COLS.index("STATO") + 1, "Da validare")
# 2) attività orfana, 3) ID duplicato, 4) ore incoerenti
r2 = wa.max_row + 1
vals = {c: wa.cell(2, i + 1).value for i, c in enumerate(ATTIVITA_COLS)}
for i, c in enumerate(ATTIVITA_COLS):
    v = vals[c]
    wa.cell(r2, i + 1, Translator(v, origin=wa.cell(2, i + 1).coordinate).translate_formula(wa.cell(r2, i + 1).coordinate) if isinstance(v, str) and v.startswith("=") else v)
wa.cell(r2, 1, "CL-NONE-010"); wa.cell(r2, 2, "CL-NONE")
wa.cell(r2 + 1, 1, wa.cell(2, 1).value); wa.cell(r2 + 1, 2, wa.cell(2, 2).value); wa.cell(r2 + 1, 5, "duplicato")
wa.cell(r2 + 1, 21, "test")
wa.cell(3, ATTIVITA_COLS.index("ORE_MIN") + 1, 10); wa.cell(3, ATTIVITA_COLS.index("ORE_MAX") + 1, 2)
wb.save(db)

s, a, amb, pil = V.load(db)
E, W = V.validate(s, a, amb, pil)
regole = {(x[3], x[4].split(":")[0].split("(")[0].strip()) for x in E}
attesi = {"R2": "servizio attivo senza attività", "R1": "attività orfana", "R3": "ID duplicato", "R4": "ore MAX<MIN"}
ok = True
for k, desc in attesi.items():
    hit = any(x[3] == k for x in E)
    ok &= hit
    print(f"{'✔' if hit else '✖'} {k} {desc}: {[x[4] for x in E if x[3] == k][:2]}")
rc = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts/export.py"), db, os.path.join(tmp, "exp")],
                    capture_output=True, text=True)
print(("✔" if rc.returncode == 1 else "✖") + " export bloccato:", rc.stdout.strip())
ok &= rc.returncode == 1
# convalida a elenco su ATTIVITA.ID_SERVIZIO presente (Excel/Sheets rifiutano valori fuori elenco)
dv = [d for d in openpyxl.load_workbook(db)["ATTIVITA"].data_validations.dataValidation if "SERVIZI!$A$2" in (d.formula1 or "")]
print(("✔" if dv else "✖") + f" convalida elenco ID_SERVIZIO -> {dv[0].formula1 if dv else '-'} (errore se fuori elenco: {dv[0].showErrorMessage if dv else '-'})")
ok &= bool(dv)
# formule CHECK nel foglio
out = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts/check_formulas.py"), db], capture_output=True, text=True).stdout
print("CHECK nel foglio (LibreOffice):"); print("\n".join("   " + l for l in out.splitlines() if "⛔" in l or "formule" in l))
ok &= all(k in out for k in ("⛔ servizio inesistente", "⛔ servizio attivo senza attività", "⛔ ore MAX < MIN", "⛔ ID duplicato"))
shutil.rmtree(tmp, ignore_errors=True)
print("ESITO:", "TUTTI I TEST PASSATI" if ok else "FALLITO")
sys.exit(0 if ok else 1)

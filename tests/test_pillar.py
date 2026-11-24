"""Test pillar trasversali (preventivi multi-dipartimento).
1) l'admin crea un pillar Trasversale e lo assegna a servizi di dipartimenti diversi -> validatore OK,
   N_SERVIZI nel foglio PILLAR lo conta, export lo elenca con i servizi;
2) un pillar aggiuntivo inesistente -> errore bloccante.
Uso: python -I tests/test_pillar.py <repo_root>"""
import sys, os, shutil, tempfile, subprocess, json, glob
import openpyxl
ROOT = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import validate as V
from common import SERVIZI_COLS

tmp = tempfile.mkdtemp()
db = os.path.join(tmp, "DB_test.xlsx")
shutil.copy(os.path.join(ROOT, "db/DB_Catalogo.xlsx"), db)
wb = openpyxl.load_workbook(db)
wp, ws = wb["PILLAR"], wb["SERVIZI"]
r = next(i for i in range(2, 200) if not wp.cell(i, 1).value)
for j, v in enumerate(["Internazionalizzazione", "Offerta multi-dipartimento (test)", "Trasversale", 40, "Sì"], 1):
    wp.cell(r, j, v)
cA, cP = 1, SERVIZI_COLS.index("PILLAR_AGGIUNTIVI") + 1
targets = {"ICL-RED", "TP-PRE", "GM-ASS"}
for i in range(2, ws.max_row + 1):
    if ws.cell(i, cA).value in targets:
        ws.cell(i, cP, "Internazionalizzazione")
wb.save(db)
ok = True
s, a, amb, pil = V.load(db)
E, W = V.validate(s, a, amb, pil)
print(("✔" if not E else "✖") + f" pillar trasversale valido: errori={len(E)}")
ok &= not E
exp = os.path.join(tmp, "exp")
subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts/export.py"), db, exp], check=True, capture_output=True)
liste = json.load(open(glob.glob(os.path.join(exp, "*/liste.json"))[0]))
p = next(x for x in liste["PILLAR"] if x["PILLAR"] == "Internazionalizzazione")
print(("✔" if set(p["SERVIZI"]) == targets else "✖") + f" export: {p['PILLAR']} -> {p['SERVIZI']}")
ok &= set(p["SERVIZI"]) == targets
# conteggio nel foglio (LibreOffice)
out = os.path.join(tmp, "lo")
subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", out, db], check=True, capture_output=True, timeout=180)
wc = openpyxl.load_workbook(os.path.join(out, "DB_test.xlsx"), data_only=True)["PILLAR"]
n = wc.cell(r, 6).value
print(("✔" if n == 3 else "✖") + f" N_SERVIZI nel foglio PILLAR = {n}")
ok &= n == 3
# negativo
wb = openpyxl.load_workbook(db)
ws = wb["SERVIZI"]
ws.cell(2, cP, "Internazionalizzazione; Pillar Inesistente")
wb.save(db)
s, a, amb, pil = V.load(db)
E, W = V.validate(s, a, amb, pil)
hit = [x for x in E if "Pillar Inesistente" in x[4]]
print(("✔" if hit else "✖") + f" pillar inesistente bloccato: {hit[0][4] if hit else '-'}")
ok &= bool(hit)
shutil.rmtree(tmp, ignore_errors=True)
print("ESITO:", "TUTTI I TEST PASSATI" if ok else "FALLITO")
sys.exit(0 if ok else 1)

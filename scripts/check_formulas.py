"""Ricalcola una copia del DB con LibreOffice headless e verifica che nessuna formula dia errore.

Uso:  python -I scripts/check_formulas.py <file.xlsx>
Stampa: n. formule, n. errori, conteggi CHECK. Exit 1 se ci sono errori di formula.
Il file originale non viene toccato (LibreOffice altera convalide e formattazioni al salvataggio).
"""
import sys, os, subprocess, tempfile, shutil, collections
import openpyxl

ERR = ("#REF!", "#NAME?", "#VALUE!", "#DIV/0!", "#N/A", "#NUM!", "#NULL!", "Err:")


def main(path):
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "in.xlsx")
    shutil.copy(path, src)
    out = os.path.join(tmp, "out")
    subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", out, src],
                   check=True, capture_output=True, timeout=180)
    calc = openpyxl.load_workbook(os.path.join(out, "in.xlsx"), data_only=True)
    orig = openpyxl.load_workbook(path)
    n_form, errs, checks = 0, [], collections.Counter()
    for ws in orig.worksheets:
        wc = calc[ws.title]
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith("="):
                    n_form += 1
                    v = wc[c.coordinate].value
                    if v is None and ws.title != "_LISTE":
                        pass
                    if isinstance(v, str) and v.startswith(ERR):
                        errs.append(f"{ws.title}!{c.coordinate} = {v}  [{c.value[:80]}]")
                    if ws.title in ("SERVIZI", "ATTIVITA") and ws.cell(1, c.column).value == "CHECK":
                        checks[(ws.title, str(v).split(" (")[0])] += 1
    print(f"formule={n_form} errori={len(errs)}")
    for e in errs[:30]:
        print("  ", e)
    for k, v in sorted(checks.items()):
        print(f"  {k[0]:9s} {k[1]:40s} {v}")
    wl = calc["_LISTE"]
    for row in wl.iter_rows(values_only=True):
        pass
    shutil.rmtree(tmp, ignore_errors=True)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))

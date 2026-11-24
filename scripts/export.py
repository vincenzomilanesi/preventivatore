"""Export versionato del catalogo per la web app (handoff §6.3).

Uso:  python -I scripts/export.py <DB_Catalogo.xlsx> <cartella_export>
Esegue il validatore: se ci sono errori bloccanti NON esporta (exit 1) e scrive solo il report.
Se pulito crea <cartella_export>/<AAAAMMGG-HHMMSS>/ con servizi.json, attivita.json, liste.json,
manifest.json (versione, hash del file sorgente, conteggi) e report_validazione.md.

In fase 1 la web app legge il Google Sheet tramite Apps Script: questo export serve come snapshot
riproducibile (un preventivo storicizzato riporta la versione catalogo usata) e per la fase 2.
"""
import sys, os, json, hashlib, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa
import validate as V


def main():
    src, outdir = sys.argv[1], sys.argv[2]
    s, a, amb, pil = V.load(src)
    E, W = V.validate(s, a, amb, pil)
    ver = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    os.makedirs(outdir, exist_ok=True)
    if E:
        V.report(src, E, W, s, a, os.path.join(outdir, f"report_validazione_{ver}_BLOCCATO.md"))
        print(f"EXPORT BLOCCATO: {len(E)} errori. Report in {outdir}")
        return 1
    d = os.path.join(outdir, ver)
    os.makedirs(d)
    tot = {}
    for x in a:
        t = tot.setdefault(x["ID_SERVIZIO"], [0, 0.0, 0.0])
        t[0] += 1
        if x["QUANDO"] == "Sempre":
            t[1] += x["ORE_MIN"] or 0
            t[2] += x["ORE_MAX"] or 0
    strip = lambda r, cols: {c: r.get(c) for c in cols}
    s_cols = [c for c in SERVIZI_COLS if c not in SERVIZI_FORMULA_COLS]
    a_cols = [c for c in ATTIVITA_COLS if c not in ATTIVITA_FORMULA_COLS]
    servizi = []
    for r in s:
        o = strip(r, s_cols)
        n, omin, omax = tot.get(r["ID_SERVIZIO"], [0, 0, 0])
        o["PILLAR_AGGIUNTIVI"] = V.split_pillars(r["PILLAR_AGGIUNTIVI"])
        o.update(N_ATTIVITA=n, ORE_MIN_TOT=round(omin, 2), ORE_MAX_TOT=round(omax, 2))
        servizi.append(o)
    attivita = [strip(r, a_cols) for r in a]
    pillar = []
    for p in sorted(pil, key=lambda x: (x["ORDINE"] if isinstance(x["ORDINE"], (int, float)) else 999, str(x["PILLAR"]))):
        ids = [x["ID_SERVIZIO"] for x in servizi if x["PILLAR"] == p["PILLAR"] or p["PILLAR"] in x["PILLAR_AGGIUNTIVI"]]
        pillar.append(dict(PILLAR=p["PILLAR"], DESCRIZIONE=p["DESCRIZIONE"], TIPO=p["TIPO"], ORDINE=p["ORDINE"],
                           ATTIVO=p["ATTIVO"], SERVIZI=ids))
    liste = dict(PILLAR=pillar, ENTITA=ENTITA, VENDIBILITA=VENDIBILITA, NATURA=NATURA, MODELLO_PREZZO=MODELLO_PREZZO,
                 MODALITA=MODALITA, ESTERNI=ESTERNI, STATO=STATO, QUANDO=QUANDO, RUOLO=RUOLO, COD_LIBRERIA=COD_LIBRERIA,
                 AMBITO=sorted(amb), DIPARTIMENTI=[dict(zip(["COD", "NOME", "PILLAR", "HEAD", "ENTITA"], x)) for x in DIPARTIMENTI])
    sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
    manifest = dict(versione_catalogo=ver, schema=DB_VERSION_SCHEMA, sorgente=os.path.basename(src), sha256=sha,
                    servizi=len(servizi), attivita=len(attivita), avvisi=len(W),
                    servizi_pubblicabili=sum(1 for x in servizi if x["STATO"] in STATI_ATTIVI))
    for name, obj in (("servizi", servizi), ("attivita", attivita), ("liste", liste), ("manifest", manifest)):
        json.dump(obj, open(os.path.join(d, f"{name}.json"), "w"), ensure_ascii=False, indent=1, default=str)
    V.report(src, E, W, s, a, os.path.join(d, "report_validazione.md"))
    print(f"EXPORT OK: versione {ver} -> {d} ({len(servizi)} servizi, {len(attivita)} attività, {len(W)} avvisi)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

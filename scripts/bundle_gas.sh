#!/usr/bin/env bash
# Concatena apps-script/*.gs in un unico file da incollare nell'editor Apps Script (Codice.gs).
# Apps Script carica tutti i file nello stesso spazio globale: un file unico è equivalente ai 5 separati.
# Uso: bash scripts/bundle_gas.sh [file_di_uscita]   (default: dist/Code_unico.gs, escluso da git)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist/Code_unico.gs}"
mkdir -p "$(dirname "$OUT")"
VER=$(grep -oP "APP_VERSION = '\K[^']+" apps-script/Config.gs)
{
  echo "// Preventivatore Bacciardi Partners – backend Apps Script v$VER (file unico: Config + Logic + Code + Auth + Setup + Import + Clienti)"
  echo "// Generato da scripts/bundle_gas.sh – non modificare qui: modificare apps-script/*.gs"
  for f in Config Logic Code Auth Setup Import Clienti; do
    echo
    echo "// ===================================================================== $f.gs"
    cat "apps-script/$f.gs"
  done
} > "$OUT"
cp "$OUT" "$OUT.check.js" && node --check "$OUT.check.js" && rm "$OUT.check.js"
echo "scritto $OUT ($(wc -l < "$OUT") righe) – sintassi OK"

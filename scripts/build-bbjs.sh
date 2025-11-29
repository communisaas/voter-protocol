#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$ROOT/tools/bin:$PATH"
DIST="$ROOT/dist/bbjs"
NOIR_PKG="$ROOT/packages/crypto/noir/district_membership"
DEPTHS=(14 20 22)

mkdir -p "$DIST"

command -v nargo >/dev/null 2>&1 || { echo "nargo not found; install noir toolchain" >&2; exit 1; }
node -e "require('@aztec/bb.js');" >/dev/null 2>&1 || { echo "@aztec/bb.js not installed" >&2; exit 1; }
NOIR_STD_LIB_DIR="${NOIR_STD_LIB_DIR:-$ROOT/tools/noir}"

# Helper to set DEPTH const via env replacement (simple and avoids templating)
set_depth() {
  local depth=$1
  local file="$NOIR_PKG/src/main.nr"
  perl -0777 -i -pe "s/const DEPTH: u32 = \d+;/const DEPTH: u32 = ${depth};/" "$file"
}

for D in "${DEPTHS[@]}"; do
  OUT="$DIST/$D"
  mkdir -p "$OUT"
  echo "[build-bbjs] depth=$D"

  set_depth "$D"
  node "$ROOT/scripts/internal/compile-acir.js" --root "$NOIR_PKG" --out "$OUT/acir.bin"

  node "$ROOT/scripts/internal/gen-bbjs-artifacts.js" --acir "$OUT/acir.bin" --out "$OUT" --threaded || true

  # gzip any artifacts that exist
  for f in "$OUT/acir.bin" "$OUT/proving_key" "$OUT/wasm"; do
    [ -f "$f" ] && gzip -f "$f"
  done

  node "$ROOT/scripts/internal/gen-sri.js" --dir "$OUT" --out "$OUT/sri.json"

  echo "[build-bbjs] depth=$D done"
done

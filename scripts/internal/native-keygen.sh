#!/usr/bin/env bash
set -euo pipefail

# Native keygen using barretenberg CLI `bb`.
# Preconditions: `bb` binary available on PATH or at $BB_BIN.
# Inputs:
#   DIST/depth/acir.bin (gzipped ACIR produced by compile-acir.js)
# Outputs:
#   DIST/depth/vk, pk (if supported), Verifier.sol (if supported)

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DIST="$ROOT/dist/bbjs"
DEPTHS=(14 20 22)
BB_BIN=${BB_BIN:-bb}

command -v "$BB_BIN" >/dev/null 2>&1 || { echo "bb binary not found (set BB_BIN)" >&2; exit 1; }

for D in "${DEPTHS[@]}"; do
  OUT="$DIST/$D"
  ACIR_GZ="$OUT/acir.bin"
  if [ ! -f "$ACIR_GZ" ]; then
    echo "[native-keygen] missing $ACIR_GZ" >&2; exit 1; fi

  ACIR_JSON="$OUT/acir.json"
  echo "[native-keygen] depth=$D: gunzip acir -> json"
  gzip -cd "$ACIR_GZ" > "$ACIR_JSON"

  echo "[native-keygen] write vk"
  "$BB_BIN" write_vk -b "$ACIR_JSON" -o "$OUT/vk" || true

  echo "[native-keygen] write pk (if supported)"
  "$BB_BIN" write_pk -b "$ACIR_JSON" -o "$OUT/pk" || true

  echo "[native-keygen] write solidity verifier (if supported)"
  "$BB_BIN" write_solidity_verifier -k "$OUT/vk" -o "$OUT/Verifier.sol" || true

  gzip -f "$ACIR_JSON"

  echo "[native-keygen] depth=$D done"
done

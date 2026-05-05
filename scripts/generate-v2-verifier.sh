#!/usr/bin/env bash
# Stage 5 — generate v2 HonkVerifier contracts for the three-tree circuit.
#
# The v2 circuit adds two public inputs (revocation_nullifier at index 31 and
# revocation_registry_root at index 32), bringing the total public-input count
# from 31 to 33. A new HonkVerifier per depth variant (18/20/22/24) is needed
# for DistrictGate.verifyThreeTreeProofV2 to route against.
#
# This script:
#   1. Compiles the circuit at each depth variant via nargo.
#   2. Generates the matching Solidity HonkVerifier via bb (Barretenberg CLI).
#   3. Renames the contract so all four variants can co-exist in
#      contracts/src/verifiers/.
#
# WHAT THIS SCRIPT DOES NOT DO:
#   - Deploy to any network.
#   - Update the VerifierRegistry routing.
#   - Touch the v1 verifier contracts (they remain at
#     contracts/src/verifiers/HonkVerifier_{18,20,22,24}.sol).
#
# See DEPLOYMENT-V2.md for the operator-run sequence that follows after this
# script emits the HonkVerifierV2_{depth}.sol files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CIRCUIT_DIR="${REPO_ROOT}/packages/crypto/noir/three_tree_membership"
VERIFIER_OUT_DIR="${REPO_ROOT}/contracts/src/verifiers"
DEPTHS=(18 20 22 24)

command -v nargo >/dev/null 2>&1 || { echo "ERROR: nargo not installed" >&2; exit 1; }
command -v bb >/dev/null 2>&1 || { echo "ERROR: bb (Barretenberg CLI) not installed" >&2; exit 1; }

mkdir -p "${VERIFIER_OUT_DIR}"

echo "=== Stage 5 v2 HonkVerifier Generation ==="
echo "Circuit: ${CIRCUIT_DIR}"
echo "Output:  ${VERIFIER_OUT_DIR}"
echo ""

# Preserve any existing TREE_DEPTH line so we can restore after the loop.
MAIN_NR="${CIRCUIT_DIR}/src/main.nr"
if [ ! -f "${MAIN_NR}" ]; then
  echo "ERROR: ${MAIN_NR} not found" >&2
  exit 1
fi
ORIGINAL_DEPTH_LINE="$(grep -E '^global TREE_DEPTH: u32' "${MAIN_NR}" || true)"

restore_depth() {
  if [ -n "${ORIGINAL_DEPTH_LINE}" ]; then
    # Use a portable sed invocation (GNU/BSD differ on -i semantics).
    tmpfile="$(mktemp)"
    awk -v replacement="${ORIGINAL_DEPTH_LINE}" \
      '/^global TREE_DEPTH: u32/ { print replacement; next } { print }' \
      "${MAIN_NR}" > "${tmpfile}"
    mv "${tmpfile}" "${MAIN_NR}"
  fi
}
trap restore_depth EXIT

for DEPTH in "${DEPTHS[@]}"; do
  echo "--- Depth ${DEPTH} ---"
  # Rewrite TREE_DEPTH for this variant.
  tmpfile="$(mktemp)"
  awk -v depth="${DEPTH}" \
    '/^global TREE_DEPTH: u32/ { printf "global TREE_DEPTH: u32 = %d;\n", depth; next } { print }' \
    "${MAIN_NR}" > "${tmpfile}"
  mv "${tmpfile}" "${MAIN_NR}"

  echo "[${DEPTH}] Compiling circuit with nargo..."
  (cd "${CIRCUIT_DIR}" && nargo compile)

  ACIR_JSON="${CIRCUIT_DIR}/target/three_tree_membership.json"
  if [ ! -f "${ACIR_JSON}" ]; then
    echo "ERROR: expected ACIR ${ACIR_JSON} not produced" >&2
    exit 1
  fi

  echo "[${DEPTH}] Generating Solidity verifier via bb write_solidity_verifier..."
  VERIFIER_OUT="${VERIFIER_OUT_DIR}/HonkVerifierV2_${DEPTH}.sol"

  # bb write_solidity_verifier emits a standalone HonkVerifier contract. We
  # rename to HonkVerifierV2_{depth} so multiple depth variants can coexist
  # alongside the v1 verifiers already in the verifiers/ directory.
  TMP_VERIFIER="$(mktemp)"
  bb write_solidity_verifier -k "${ACIR_JSON}" -o "${TMP_VERIFIER}"

  # Rename the contract declaration.
  sed -e "s/contract HonkVerifier /contract HonkVerifierV2_${DEPTH} /g" \
      -e "s/contract HonkVerifier\$/contract HonkVerifierV2_${DEPTH}/g" \
      -e "s/contract HonkVerifier{/contract HonkVerifierV2_${DEPTH} {/g" \
      "${TMP_VERIFIER}" > "${VERIFIER_OUT}"
  rm -f "${TMP_VERIFIER}"

  echo "[${DEPTH}] Written to ${VERIFIER_OUT}"
  wc -c "${VERIFIER_OUT}" | awk '{ printf "[%d] Bytecode size: %d bytes\n", '"${DEPTH}"', $1 }'
done

echo ""
echo "=== Done ==="
echo "Next: see contracts/DEPLOYMENT-V2.md for the operator-run deployment sequence."

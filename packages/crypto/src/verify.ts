import * as snarkjs from "snarkjs";
import { withTempDir, writeTempFile } from "./util.js";

/**
 * Verify a single contribution by checking the full zkey against
 * the original circuit (r1cs) and Powers of Tau.
 *
 * Note: this confirms `zkey` is a valid contribution chain extending the
 * genesis derivable from `(r1cs, ptau)`. It does NOT confirm that `zkey` is
 * the next contribution in any specific chain — for that, see `verifyChain`.
 *
 * @param r1cs - R1CS circuit definition
 * @param ptau - Powers of Tau ceremony output
 * @param zkey - The zkey to verify
 * @returns true if valid
 */
export async function verify(
  r1cs: Uint8Array,
  ptau: Uint8Array,
  zkey: Uint8Array,
): Promise<boolean> {
  return withTempDir(async (dir) => {
    const r1csPath = await writeTempFile(dir, "circuit.r1cs", r1cs);
    const ptauPath = await writeTempFile(dir, "pot.ptau", ptau);
    const zkeyPath = await writeTempFile(dir, "circuit.zkey", zkey);

    return snarkjs.zKey.verifyFromR1cs(r1csPath, ptauPath, zkeyPath);
  });
}

/**
 * Verify the full contribution chain embedded inside `latestZkey`, rooted at
 * `initialZkey`.
 *
 * snarkjs records the entire contribution transcript inside every zkey file,
 * so verifying the latest zkey against the genesis is equivalent to verifying
 * every intermediate contribution. Intermediate zkeys do not need to be
 * supplied.
 *
 * `initialZkey` is taken as trusted: this function does NOT confirm
 * `initialZkey` is the canonical genesis for any particular `r1cs`. Callers
 * that need to bind the chain to a specific circuit should additionally call
 * `verify(r1cs, ptau, initialZkey)` (or hash-pin `initialZkey` against a
 * known-good value).
 *
 * If `latestZkey` is byte-equal to `initialZkey` (no contributions yet) the
 * function returns `true` without invoking snarkjs.
 *
 * @param ptau - Powers of Tau ceremony output
 * @param initialZkey - The genesis zkey, taken as trusted
 * @param latestZkey - The most recently contributed zkey
 * @returns true if every contribution embedded in `latestZkey` is valid and
 *          the chain reaches `initialZkey` at its base
 */
export async function verifyChain(
  ptau: Uint8Array,
  initialZkey: Uint8Array,
  latestZkey: Uint8Array,
): Promise<boolean> {
  if (bytesEqual(latestZkey, initialZkey)) {
    return true;
  }

  return withTempDir(async (dir) => {
    const ptauPath = await writeTempFile(dir, "pot.ptau", ptau);
    const initPath = await writeTempFile(dir, "genesis.zkey", initialZkey);
    const zkeyPath = await writeTempFile(dir, "latest.zkey", latestZkey);

    return snarkjs.zKey.verifyFromInit(initPath, ptauPath, zkeyPath);
  });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

import * as snarkjs from "snarkjs";
import { withTempDir, writeTempFile } from "./util.js";

/**
 * Verify a single contribution by checking the full zkey against
 * the original circuit (r1cs) and Powers of Tau.
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
 * Verify a full contribution chain from the genesis zkey.
 *
 * snarkjs embeds the entire contribution history inside each zkey file.
 * `verifyFromInit` checks the full chain from genesis to the given zkey,
 * so verifying the last contribution in the array is sufficient to validate
 * every contribution that came before it.
 *
 * @param r1cs - R1CS circuit definition
 * @param ptau - Powers of Tau ceremony output
 * @param initialZkey - The genesis zkey
 * @param contributions - Array of contributed zkeys in order
 * @returns true if the entire chain is valid
 */
export async function verifyChain(
  r1cs: Uint8Array,
  ptau: Uint8Array,
  initialZkey: Uint8Array,
  contributions: Uint8Array[],
): Promise<boolean> {
  if (contributions.length === 0) return true;

  // The last zkey contains the full contribution chain, so verifying it
  // against genesis is equivalent to verifying every intermediate step.
  const lastContribution = contributions[contributions.length - 1];

  return withTempDir(async (dir) => {
    const r1csPath = await writeTempFile(dir, "circuit.r1cs", r1cs);
    const ptauPath = await writeTempFile(dir, "pot.ptau", ptau);
    const initPath = await writeTempFile(dir, "genesis.zkey", initialZkey);
    const zkeyPath = await writeTempFile(dir, "latest.zkey", lastContribution);

    return snarkjs.zKey.verifyFromInit(initPath, ptauPath, zkeyPath);
  });
}

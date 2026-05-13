import * as snarkjs from "snarkjs";
import { withTempDir, writeTempFile } from "./util.js";

/**
 * Verify a single contribution by checking the full zkey against
 * the original circuit (r1cs) and Powers of Tau.
 *
 * Note: this confirms `zkey` is a valid contribution chain extending the
 * genesis derivable from `(r1cs, ptau)`. It does NOT confirm that `zkey` is
 * the next contribution in any specific chain; see `verifyChain` for that.
 *
 * Total function: returns `false` for any malformed or invalid zkey. snarkjs
 * itself throws on parse errors and on several structural checks; callers
 * that expected a boolean would otherwise have to wrap every call in
 * try/catch to be safe (and the generated coordinator did not). Funneling
 * every failure mode into `false` keeps the `Promise<boolean>` contract
 * honest.
 *
 * @param r1cs - R1CS circuit definition.
 * @param ptau - Powers of Tau ceremony output.
 * @param zkey - The zkey to verify.
 * @returns `true` if valid, `false` otherwise (including malformed input).
 */
export async function verify(
  r1cs: Uint8Array,
  ptau: Uint8Array,
  zkey: Uint8Array,
): Promise<boolean> {
  try {
    return await withTempDir(async (dir) => {
      const r1csPath = await writeTempFile(dir, "circuit.r1cs", r1cs);
      const ptauPath = await writeTempFile(dir, "pot.ptau", ptau);
      const zkeyPath = await writeTempFile(dir, "circuit.zkey", zkey);

      return await snarkjs.zKey.verifyFromR1cs(r1csPath, ptauPath, zkeyPath);
    });
  } catch {
    return false;
  }
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
 * that need to bind the chain to a specific circuit should use
 * `verifyChainForCircuit` instead (or hash-pin `initialZkey` against a
 * known-good value before calling this).
 *
 * If `latestZkey` is byte-equal to `initialZkey` (no contributions yet) the
 * function returns `true` without invoking snarkjs.
 *
 * @param ptau - Powers of Tau ceremony output.
 * @param initialZkey - The genesis zkey, taken as trusted.
 * @param latestZkey - The most recently contributed zkey.
 * @returns true if every contribution embedded in `latestZkey` is valid and
 *          the chain reaches `initialZkey` at its base.
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

/**
 * Verify the full contribution chain AND bind it to a specific circuit.
 *
 * Composition of `verify(r1cs, ptau, initialZkey)` followed by
 * `verifyChain(ptau, initialZkey, latestZkey)`. Use this when you need the
 * safer (and usually correct) verification path: confirm the genesis matches
 * the circuit you expect, then confirm the chain extends that genesis.
 *
 * In particular, this closes the only path through `verifyChain` that does
 * not invoke snarkjs: the empty-chain shortcut returns `true` when
 * `latestZkey === initialZkey`. Without circuit binding, that shortcut would
 * accept any two byte-equal inputs (including garbage). With binding, the
 * shortcut only fires after `initialZkey` is confirmed as a valid genesis
 * for `(r1cs, ptau)`.
 *
 * The ceremony coordinator should prefer this function over `verifyChain`
 * for per-contribution validation: it both confirms the new zkey extends
 * the current state AND prevents accidental acceptance of a fork from a
 * substituted genesis.
 *
 * @param r1cs - R1CS circuit definition.
 * @param ptau - Powers of Tau ceremony output.
 * @param initialZkey - The genesis zkey (validated against `r1cs` here).
 * @param latestZkey - The most recently contributed zkey.
 * @returns true if `initialZkey` is a valid genesis for `(r1cs, ptau)` and
 *          the chain in `latestZkey` reaches `initialZkey` at its base.
 */
export async function verifyChainForCircuit(
  r1cs: Uint8Array,
  ptau: Uint8Array,
  initialZkey: Uint8Array,
  latestZkey: Uint8Array,
): Promise<boolean> {
  const initialValid = await verify(r1cs, ptau, initialZkey);
  if (!initialValid) return false;

  if (bytesEqual(initialZkey, latestZkey)) return true;

  return verifyChain(ptau, initialZkey, latestZkey);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

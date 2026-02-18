import * as snarkjs from "snarkjs";
import { withTempDir, writeTempFile } from "./util.js";

/**
 * Extract the verification key from a finalized zkey.
 *
 * @param zkey - The finalized zkey
 * @returns Verification key object (Groth16 format)
 */
export async function exportVerificationKey(
  zkey: Uint8Array,
): Promise<object> {
  return withTempDir(async (dir) => {
    const zkeyPath = await writeTempFile(dir, "final.zkey", zkey);
    return snarkjs.zKey.exportVerificationKey(zkeyPath);
  });
}

import * as snarkjs from "snarkjs";
import type { ContributionResult } from "./types.js";
import { withTempDir, writeTempFile, readFileAsBytes, toHex } from "./util.js";

/**
 * Apply a contribution to a zkey using the provided entropy.
 *
 * @param prevZkey - The current zkey to contribute to
 * @param entropy - Random entropy bytes
 * @param name - Optional contributor name (max 64 chars)
 * @returns New zkey and contribution hash
 */
export async function contribute(
  prevZkey: Uint8Array,
  entropy: Uint8Array,
  name: string = "contributor",
): Promise<ContributionResult> {
  // snarkjs expects entropy as a string (passes it through TextEncoder).
  // Convert Uint8Array to hex so the full entropy is preserved.
  const entropyHex = toHex(entropy);

  try {
    return await withTempDir(async (dir) => {
      const prevPath = await writeTempFile(dir, "prev.zkey", prevZkey);
      const newPath = `${dir}/new.zkey`;

      const hash: Uint8Array = await snarkjs.zKey.contribute(
        prevPath,
        newPath,
        name,
        entropyHex,
      );

      const zkey = await readFileAsBytes(newPath);
      return { zkey, hash: toHex(hash) };
    });
  } finally {
    // Zero toxic waste
    entropy.fill(0);
  }
}

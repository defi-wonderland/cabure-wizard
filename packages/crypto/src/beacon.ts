import * as snarkjs from "snarkjs";
import { withTempDir, writeTempFile, readFileAsBytes } from "./util.js";

const DEFAULT_NUM_ITERATIONS_EXP = 10;

/**
 * Apply a drand beacon to finalize the ceremony.
 * Uses 2^10 rounds of SHA-256 hashing by default.
 *
 * @param zkey - The last contributed zkey
 * @param beaconHash - The beacon value as hex string
 * @param numIterationsExp - Exponent for 2^N SHA-256 iterations (default: 10)
 * @returns Finalized zkey
 */
export async function applyBeacon(
  zkey: Uint8Array,
  beaconHash: string,
  numIterationsExp: number = DEFAULT_NUM_ITERATIONS_EXP,
): Promise<Uint8Array> {
  return withTempDir(async (dir) => {
    const zkeyPath = await writeTempFile(dir, "last.zkey", zkey);
    const finalPath = `${dir}/final.zkey`;

    const result = await snarkjs.zKey.beacon(
      zkeyPath,
      finalPath,
      "beacon",
      beaconHash,
      numIterationsExp,
    );

    if (result === false) {
      throw new Error("Failed to apply beacon — invalid parameters");
    }

    return readFileAsBytes(finalPath);
  });
}

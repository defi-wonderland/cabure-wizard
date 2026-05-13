import * as snarkjs from "snarkjs";
import { withTempDir, writeTempFile, readFileAsBytes } from "./util.js";

const DEFAULT_NUM_ITERATIONS_EXP = 10;
const MIN_BEACON_BYTES = 32;
const MAX_BEACON_BYTES = 255;
const MIN_NUM_ITERATIONS_EXP = 10;
const MAX_NUM_ITERATIONS_EXP = 32;

/**
 * Apply a public randomness beacon to finalize the ceremony.
 *
 * The beacon should be a value that no participant could have predicted or
 * influenced before the ceremony's contribution window closed (e.g. a future
 * Ethereum RANDAO reveal, drand round, or a hash of a public event).
 * Self-generated random bytes are NOT a valid beacon: the whole point of the
 * beacon is independent public verifiability.
 *
 * Input validation is intentionally a strict subset of snarkjs's bounds:
 *
 * - `beaconHash` must be 32 to 255 bytes. snarkjs rejects everything below 32
 *   and everything 256 or above; we enforce the same window before any I/O.
 * - `numIterationsExp` must be in `[10, 32]`. snarkjs accepts up to 63, but
 *   2^32 SHA-256 iterations already pushes finalization into hours of CPU.
 *   The default of 10 (1024 iterations) is what most ceremonies use.
 *
 * @param zkey - The last contributed zkey.
 * @param beaconHash - Hex-encoded beacon value, with or without `0x` prefix.
 *                    Must be 32 to 255 bytes (64 to 510 hex digits).
 * @param numIterationsExp - Exponent for 2^N SHA-256 iterations
 *                           (default: 10, yields 1024 iterations).
 *                           Must be an integer in `[10, 32]`.
 * @returns Finalized zkey bytes.
 */
export async function applyBeacon(
  zkey: Uint8Array,
  beaconHash: string,
  numIterationsExp: number = DEFAULT_NUM_ITERATIONS_EXP,
): Promise<Uint8Array> {
  const validatedHex = validateBeaconHash(beaconHash);
  validateNumIterationsExp(numIterationsExp);

  return withTempDir(async (dir) => {
    const zkeyPath = await writeTempFile(dir, "last.zkey", zkey);
    const finalPath = `${dir}/final.zkey`;

    const result = await snarkjs.zKey.beacon(
      zkeyPath,
      finalPath,
      "beacon",
      validatedHex,
      numIterationsExp,
    );

    // snarkjs returns false on validation failures it catches itself.
    if (result === false) {
      throw new Error("applyBeacon: snarkjs rejected the beacon parameters");
    }

    return readFileAsBytes(finalPath);
  });
}

function validateBeaconHash(beaconHash: string): string {
  if (typeof beaconHash !== "string") {
    throw new TypeError("applyBeacon: beaconHash must be a string");
  }

  const hex = beaconHash.startsWith("0x") ? beaconHash.slice(2) : beaconHash;

  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("applyBeacon: beaconHash must be a hex string");
  }
  if (hex.length % 2 !== 0) {
    throw new Error(
      "applyBeacon: beaconHash must have an even number of hex digits",
    );
  }
  if (hex.length < MIN_BEACON_BYTES * 2) {
    throw new Error(
      `applyBeacon: beaconHash must be at least ${MIN_BEACON_BYTES} bytes ` +
        `(${MIN_BEACON_BYTES * 2} hex digits); received ${hex.length / 2} bytes`,
    );
  }
  if (hex.length > MAX_BEACON_BYTES * 2) {
    throw new Error(
      `applyBeacon: beaconHash must be at most ${MAX_BEACON_BYTES} bytes ` +
        `(${MAX_BEACON_BYTES * 2} hex digits); received ${hex.length / 2} bytes`,
    );
  }

  return hex;
}

function validateNumIterationsExp(numIterationsExp: number): void {
  if (
    !Number.isInteger(numIterationsExp) ||
    numIterationsExp < MIN_NUM_ITERATIONS_EXP ||
    numIterationsExp > MAX_NUM_ITERATIONS_EXP
  ) {
    throw new RangeError(
      `applyBeacon: numIterationsExp must be an integer in ` +
        `[${MIN_NUM_ITERATIONS_EXP}, ${MAX_NUM_ITERATIONS_EXP}]; ` +
        `received ${numIterationsExp}`,
    );
  }
}

import { webcrypto } from "node:crypto";
import type { EntropySource } from "./types.js";

const ENTROPY_LENGTH = 64; // 512 bits

/**
 * Generate entropy by combining CSPRNG output with optional additional sources.
 *
 * In browser contexts, mouse/click entropy should be collected and passed
 * as additional sources. In CLI contexts, system CSPRNG is the primary source.
 *
 * @param sources - Optional additional entropy sources to mix in
 * @returns Combined entropy as Uint8Array
 */
export async function generateEntropy(
  sources?: EntropySource[],
): Promise<Uint8Array> {
  // Start with CSPRNG
  const csprng = new Uint8Array(ENTROPY_LENGTH);
  (webcrypto as typeof globalThis.crypto).getRandomValues(csprng);

  if (!sources || sources.length === 0) {
    return csprng;
  }

  // Mix additional entropy sources using SHA-256
  const combined = await mixEntropy(csprng, sources);
  return combined;
}

async function mixEntropy(
  base: Uint8Array,
  sources: EntropySource[],
): Promise<Uint8Array> {
  // Concatenate all entropy sources
  const totalLen =
    base.length + sources.reduce((acc, s) => acc + s.data.length, 0);
  const buf = new Uint8Array(totalLen);
  let offset = 0;

  buf.set(base, offset);
  offset += base.length;

  for (const source of sources) {
    buf.set(source.data, offset);
    offset += source.data.length;
  }

  // Hash the combined data to fixed-length output
  const hash = await webcrypto.subtle.digest("SHA-256", buf);
  const hashBytes = new Uint8Array(hash);

  // Expand to ENTROPY_LENGTH by hashing again with a counter
  const result = new Uint8Array(ENTROPY_LENGTH);
  result.set(hashBytes, 0);

  const second = await webcrypto.subtle.digest(
    "SHA-256",
    new Uint8Array([...hashBytes, 0x01]),
  );
  result.set(new Uint8Array(second), 32);

  return result;
}

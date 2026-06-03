import type { EntropySource } from "./types.js";
import { deriveSeed } from "./kdf.js";

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
  crypto.getRandomValues(csprng);

  if (!sources || sources.length === 0) {
    return csprng;
  }

  // Mix additional entropy sources via the shared HKDF helper
  return deriveSeed(csprng, ...sources.map((source) => source.data));
}

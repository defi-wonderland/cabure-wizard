/**
 * Entropy key-derivation helpers shared by the Node and browser-worker entry
 * points.
 *
 * Kept in its own module (rather than entropy.ts, which imports node:crypto)
 * so the browser template can import it via the `@wonderland/cabure-crypto/entropy`
 * subpath without pulling in node:fs/path/os.
 *
 * Both helpers use HKDF-SHA256 from Web Crypto via `globalThis.crypto.subtle`,
 * which is available in Node 20+ and in browser Web Workers, so they are safe
 * to call from both code paths the package supports.
 */

const SEED_LENGTH = 64; // 512 bits

const SEED_INFO = new TextEncoder().encode("cabure/entropy-seed");

/**
 * HKDF-SHA256 expand `ikm` into a fixed 64-byte output, domain-separated by
 * `info`. An empty salt is treated as all-zeros per RFC 5869.
 *
 * Web Crypto's HKDF requires non-empty input keying material; every caller
 * here supplies at least the 64-byte CSPRNG or the 64-byte master seed.
 */
async function hkdf(ikm: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  // TS 5.9 typed Web Crypto's byte inputs as `ArrayBufferView<ArrayBuffer>`,
  // i.e. it disallows views backed by a SharedArrayBuffer. All callers pass
  // non-shared buffers, so we cast through unknown to bypass the narrowing
  // (same pattern as sha256.ts).
  const key = await crypto.subtle.importKey(
    "raw",
    ikm as unknown as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: info as unknown as BufferSource,
    },
    key,
    SEED_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Stretch CSPRNG output plus any collected randomness into a 64-byte master
 * seed via HKDF-SHA256.
 *
 * Pass the CSPRNG bytes first, followed by any user-interaction entropy. At
 * least one non-empty part is required (HKDF rejects empty keying material).
 */
export async function deriveSeed(...parts: Uint8Array[]): Promise<Uint8Array> {
  return hkdf(concat(parts), SEED_INFO);
}

/**
 * Derive distinct 64-byte entropy for a given circuit from the master seed,
 * domain-separated by `circuitId` via HKDF's `info` parameter. The same seed
 * yields independent entropy for each circuit.
 */
export async function deriveCircuitEntropy(
  seed: Uint8Array,
  circuitId: string,
): Promise<Uint8Array> {
  return hkdf(seed, new TextEncoder().encode(`cabure/circuit:${circuitId}`));
}

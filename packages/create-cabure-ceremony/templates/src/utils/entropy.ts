import { deriveSeed } from "@wonderland/cabure-crypto/entropy";

export function clamp16(value: number): number {
  return Math.max(0, Math.min(0xffff, Math.floor(value)));
}

export function clamp16Signed(value: number): number {
  return Math.max(-0x8000, Math.min(0x7fff, Math.floor(value)));
}

/**
 * Mix collected user-interaction bytes with fresh CSPRNG output into a 64-byte
 * master seed via the shared HKDF helper. User interaction is required —
 * passive CSPRNG alone is insufficient.
 */
export async function buildEntropySeed(extraBytes: number[]): Promise<Uint8Array> {
  if (extraBytes.length === 0) {
    throw new Error("User interaction entropy required");
  }

  const csprng = new Uint8Array(64);
  crypto.getRandomValues(csprng);

  return deriveSeed(csprng, new Uint8Array(extraBytes));
}

export async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return new Uint8Array(digest);
}

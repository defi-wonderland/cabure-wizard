export function clamp16(value: number): number {
  return Math.max(0, Math.min(0xffff, Math.floor(value)));
}

export function clamp16Signed(value: number): number {
  return Math.max(-0x8000, Math.min(0x7fff, Math.floor(value)));
}

export async function buildEntropySeed(extraBytes: number[]): Promise<Uint8Array> {
  const csprng = new Uint8Array(64);
  crypto.getRandomValues(csprng);

  if (extraBytes.length === 0) {
    throw new Error("User interaction entropy required");
  }

  const extra = new Uint8Array(extraBytes);
  const combined = concatBytes(csprng, extra);
  const hash1 = await sha256(combined);
  const hash2 = await sha256(concatBytes(hash1, extra, new Uint8Array([1])));

  const output = new Uint8Array(64);
  output.set(hash1, 0);
  output.set(hash2, 32);
  return output;
}

export async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return new Uint8Array(digest);
}

export async function deriveEntropy(
  base: Uint8Array,
  circuitId: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(circuitId);
  const input = concatBytes(base, idBytes);

  const hash1 = await sha256(input);
  const input2 = concatBytes(hash1, base);
  const hash2 = await sha256(input2);

  const entropy = new Uint8Array(hash1.length + hash2.length);
  entropy.set(hash1);
  entropy.set(hash2, hash1.length);
  return entropy;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

import { describe, it, expect } from "vitest";
import { deriveSeed, deriveCircuitEntropy } from "../src/kdf.js";

const csprng = new Uint8Array(64).fill(0x11);
const extra = new Uint8Array([1, 2, 3, 4]);

describe("deriveSeed", () => {
  it("returns 64 bytes", async () => {
    const seed = await deriveSeed(csprng, extra);
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
  });

  it("is deterministic for identical inputs", async () => {
    const a = await deriveSeed(csprng, extra);
    const b = await deriveSeed(csprng, extra);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("changes when any input part changes", async () => {
    const base = await deriveSeed(csprng, extra);
    const diffExtra = await deriveSeed(csprng, new Uint8Array([1, 2, 3, 5]));
    const diffCsprng = await deriveSeed(new Uint8Array(64).fill(0x22), extra);
    expect(Buffer.from(base).equals(Buffer.from(diffExtra))).toBe(false);
    expect(Buffer.from(base).equals(Buffer.from(diffCsprng))).toBe(false);
  });

  it("works with a single part", async () => {
    const seed = await deriveSeed(csprng);
    expect(seed.length).toBe(64);
  });
});

describe("deriveCircuitEntropy", () => {
  const seed = new Uint8Array(64).fill(0x33);

  it("returns 64 bytes", async () => {
    const entropy = await deriveCircuitEntropy(seed, "circuit-a");
    expect(entropy).toBeInstanceOf(Uint8Array);
    expect(entropy.length).toBe(64);
  });

  it("is deterministic for the same seed and circuitId", async () => {
    const a = await deriveCircuitEntropy(seed, "circuit-a");
    const b = await deriveCircuitEntropy(seed, "circuit-a");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("yields independent entropy per circuitId from the same seed", async () => {
    const a = await deriveCircuitEntropy(seed, "circuit-a");
    const b = await deriveCircuitEntropy(seed, "circuit-b");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("changes when the seed changes", async () => {
    const a = await deriveCircuitEntropy(seed, "circuit-a");
    const b = await deriveCircuitEntropy(new Uint8Array(64).fill(0x44), "circuit-a");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

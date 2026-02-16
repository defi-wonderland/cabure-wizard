import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  generateInitialZkey,
  contribute,
  verify,
  verifyChain,
  generateEntropy,
  applyBeacon,
  exportVerificationKey,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(join(FIXTURES, name));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const r1cs = loadFixture("multiplier.r1cs");
const ptau = loadFixture("pot_final.ptau");

describe("generateInitialZkey", () => {
  it("generates a valid genesis zkey from ptau + r1cs", async () => {
    const zkey = await generateInitialZkey(ptau, r1cs);
    expect(zkey).toBeInstanceOf(Uint8Array);
    expect(zkey.length).toBeGreaterThan(0);
  });
});

describe("contribute", () => {
  it("produces a new zkey and contribution hash", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const entropy = new Uint8Array(32);
    crypto.getRandomValues(entropy);

    const result = await contribute(genesis, entropy, "test-contributor");
    expect(result.zkey).toBeInstanceOf(Uint8Array);
    expect(result.zkey.length).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^0x[0-9a-f]+$/);
  });

  it("produces different zkeys for different entropy", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);

    const entropy1 = new Uint8Array(32).fill(1);
    const entropy2 = new Uint8Array(32).fill(2);

    const result1 = await contribute(genesis, entropy1);
    const result2 = await contribute(genesis, entropy2);

    expect(result1.hash).not.toBe(result2.hash);
  });
});

describe("verify", () => {
  it("accepts a valid contributed zkey", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const entropy = new Uint8Array(32).fill(42);
    const { zkey } = await contribute(genesis, entropy);

    const valid = await verify(r1cs, ptau, zkey);
    expect(valid).toBe(true);
  });

  it("rejects a tampered zkey", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const entropy = new Uint8Array(32).fill(42);
    const { zkey } = await contribute(genesis, entropy);

    // Tamper with the zkey data (corrupt bytes in the middle)
    const tampered = new Uint8Array(zkey);
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] ^= 0xff;
    tampered[mid + 1] ^= 0xff;

    // Tampered zkey should either fail verification or throw
    try {
      const valid = await verify(r1cs, ptau, tampered);
      expect(valid).toBe(false);
    } catch {
      // Throwing is also acceptable for corrupted data
      expect(true).toBe(true);
    }
  });
});

describe("verifyChain", () => {
  it("validates a chain of 3 contributions", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);

    const { zkey: zkey1 } = await contribute(
      genesis,
      new Uint8Array(32).fill(1),
    );
    const { zkey: zkey2 } = await contribute(
      zkey1,
      new Uint8Array(32).fill(2),
    );
    const { zkey: zkey3 } = await contribute(
      zkey2,
      new Uint8Array(32).fill(3),
    );

    const valid = await verifyChain(r1cs, ptau, genesis, [zkey1, zkey2, zkey3]);
    expect(valid).toBe(true);
  });

  it("returns true for empty contributions array", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const valid = await verifyChain(r1cs, ptau, genesis, []);
    expect(valid).toBe(true);
  });
});

describe("generateEntropy", () => {
  it("returns 64 bytes of entropy", async () => {
    const entropy = await generateEntropy();
    expect(entropy).toBeInstanceOf(Uint8Array);
    expect(entropy.length).toBe(64);
  });

  it("produces different values on each call", async () => {
    const e1 = await generateEntropy();
    const e2 = await generateEntropy();
    expect(Buffer.from(e1).equals(Buffer.from(e2))).toBe(false);
  });

  it("mixes additional entropy sources", async () => {
    const mouseData = new Uint8Array(16).fill(0xaa);
    const result = await generateEntropy([
      { type: "mouse", data: mouseData },
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(64);
  });
});

describe("applyBeacon", () => {
  it("produces a finalized zkey with a beacon", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    const beaconHash =
      "0102030405060708091011121314151617181920212223242526272829303132";
    const finalized = await applyBeacon(zkey, beaconHash);

    expect(finalized).toBeInstanceOf(Uint8Array);
    expect(finalized.length).toBeGreaterThan(0);
  });

  it("produces deterministic output for the same beacon", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    const beaconHash =
      "0102030405060708091011121314151617181920212223242526272829303132";
    const finalized1 = await applyBeacon(zkey, beaconHash);
    const finalized2 = await applyBeacon(zkey, beaconHash);

    expect(Buffer.from(finalized1).equals(Buffer.from(finalized2))).toBe(true);
  });
});

describe("exportVerificationKey", () => {
  it("extracts vkey from a finalized zkey", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    const beaconHash =
      "0102030405060708091011121314151617181920212223242526272829303132";
    const finalized = await applyBeacon(zkey, beaconHash);

    const vkey = await exportVerificationKey(finalized);

    expect(vkey).toHaveProperty("protocol", "groth16");
    expect(vkey).toHaveProperty("curve");
    expect(vkey).toHaveProperty("nPublic");
    expect(vkey).toHaveProperty("vk_alpha_1");
    expect(vkey).toHaveProperty("vk_beta_2");
    expect(vkey).toHaveProperty("vk_gamma_2");
    expect(vkey).toHaveProperty("vk_delta_2");
    expect(vkey).toHaveProperty("IC");
  });
});

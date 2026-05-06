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
import { bytesToHexRaw, toHex } from "../src/hex.js";

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

  it("returns false for a tampered zkey", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const entropy = new Uint8Array(32).fill(42);
    const { zkey } = await contribute(genesis, entropy);

    // Tamper with the zkey data (corrupt bytes in the middle)
    const tampered = new Uint8Array(zkey);
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] ^= 0xff;
    tampered[mid + 1] ^= 0xff;

    const valid = await verify(r1cs, ptau, tampered);
    expect(valid).toBe(false);
  });

  it("throws on a completely invalid zkey", async () => {
    const garbage = new Uint8Array(64).fill(0xde);
    await expect(verify(r1cs, ptau, garbage)).rejects.toThrow(
      /invalid/i,
    );
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

    const valid = await verifyChain(r1cs, ptau, genesis, zkey3);
    expect(valid).toBe(true);
  });

  it("returns true when latestZkey equals initialZkey", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const valid = await verifyChain(r1cs, ptau, genesis, genesis);
    expect(valid).toBe(true);
  });

  it("returns false when the latest zkey is tampered", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(7));

    const tampered = new Uint8Array(zkey);
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] ^= 0xff;
    tampered[mid + 1] ^= 0xff;

    const valid = await verifyChain(r1cs, ptau, genesis, tampered);
    expect(valid).toBe(false);
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
  const VALID_BEACON =
    "0102030405060708091011121314151617181920212223242526272829303132";

  it("produces a finalized zkey with a beacon", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    const finalized = await applyBeacon(zkey, VALID_BEACON);

    expect(finalized).toBeInstanceOf(Uint8Array);
    expect(finalized.length).toBeGreaterThan(0);
  });

  it("produces deterministic output for the same beacon", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    const finalized1 = await applyBeacon(zkey, VALID_BEACON);
    const finalized2 = await applyBeacon(zkey, VALID_BEACON);

    expect(Buffer.from(finalized1).equals(Buffer.from(finalized2))).toBe(true);
  });

  it("accepts a beacon with the 0x prefix", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    const finalized = await applyBeacon(zkey, `0x${VALID_BEACON}`);
    expect(finalized.length).toBeGreaterThan(0);
  });

  it("rejects non-hex beacon", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    await expect(applyBeacon(zkey, "xyz")).rejects.toThrow(/hex/i);
  });

  it("rejects odd-length beacon", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    await expect(applyBeacon(zkey, "abc")).rejects.toThrow(/even/i);
  });

  it("rejects a beacon shorter than 32 bytes", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    await expect(applyBeacon(zkey, "00".repeat(31))).rejects.toThrow(
      /at least 32 bytes/i,
    );
  });

  it("rejects an empty beacon", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    await expect(applyBeacon(zkey, "")).rejects.toThrow(/at least 32 bytes/i);
  });

  it("rejects out-of-range numIterationsExp", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(1));

    await expect(applyBeacon(zkey, VALID_BEACON, 0)).rejects.toThrow(
      /numIterationsExp/,
    );
    await expect(applyBeacon(zkey, VALID_BEACON, 33)).rejects.toThrow(
      /numIterationsExp/,
    );
    await expect(applyBeacon(zkey, VALID_BEACON, 1.5)).rejects.toThrow(
      /numIterationsExp/,
    );
  });
});

describe("hex helpers", () => {
  it("bytesToHexRaw produces lowercase hex without prefix", () => {
    expect(bytesToHexRaw(new Uint8Array([0xab, 0xcd, 0xef]))).toBe("abcdef");
  });

  it("bytesToHexRaw left-pads single-digit nibbles", () => {
    expect(bytesToHexRaw(new Uint8Array([0x00, 0x0a, 0xff]))).toBe("000aff");
  });

  it("bytesToHexRaw on empty input returns empty string", () => {
    expect(bytesToHexRaw(new Uint8Array(0))).toBe("");
  });

  it("toHex prefixes the same encoding with 0x", () => {
    const bytes = new Uint8Array([0x12, 0x34]);
    expect(toHex(bytes)).toBe(`0x${bytesToHexRaw(bytes)}`);
  });

  it("Node and browser-worker entropy encodings agree", () => {
    // Regression guard: if the Node and worker hex paths drift apart,
    // identical entropy bytes will produce different snarkjs contributions.
    const entropy = new Uint8Array(64);
    for (let i = 0; i < entropy.length; i++) entropy[i] = i;

    const nodePath = bytesToHexRaw(entropy);
    const inlineFallback = Array.from(entropy)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    expect(nodePath).toBe(inlineFallback);
    expect(nodePath.startsWith("0x")).toBe(false);
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

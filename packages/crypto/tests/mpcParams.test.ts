import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  generateInitialZkey,
  contribute,
  parseMpcParams,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(join(FIXTURES, name));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const r1cs = loadFixture("multiplier.r1cs");
const ptau = loadFixture("pot_final.ptau");

describe("parseMpcParams conformance", () => {
  it("reads a genesis as an empty contribution list", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const mpc = await parseMpcParams(genesis, { maxContributions: 0 });
    expect(mpc.contributions).toHaveLength(0);
    expect(mpc.csHash).toMatch(/^0x[0-9a-f]{128}$/);
  });

  it("recomputes the same hash snarkjs returns for each contribution", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);

    const first = await contribute(
      genesis,
      new Uint8Array(32).fill(1),
      "alice",
    );
    const second = await contribute(
      first.zkey,
      new Uint8Array(32).fill(2),
      "bob",
    );

    const afterFirst = await parseMpcParams(first.zkey, {
      maxContributions: 1,
    });
    expect(afterFirst.contributions).toHaveLength(1);
    expect(afterFirst.contributions[0].hash()).toBe(first.contributionHash);
    expect(afterFirst.contributions[0].type).toBe(0);

    const afterSecond = await parseMpcParams(second.zkey, {
      maxContributions: 2,
    });
    expect(afterSecond.contributions).toHaveLength(2);
    // The prefix entry is byte-stable: the first contribution's recomputed hash
    // is unchanged after a second contribution is layered on top. This is the
    // property the continuity link check relies on.
    expect(afterSecond.contributions[0].hash()).toBe(first.contributionHash);
    expect(afterSecond.contributions[1].hash()).toBe(second.contributionHash);
  });

  it("keeps csHash stable across the whole chain", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(7));

    const genesisMpc = await parseMpcParams(genesis, { maxContributions: 0 });
    const contributedMpc = await parseMpcParams(zkey, { maxContributions: 1 });
    expect(contributedMpc.csHash).toBe(genesisMpc.csHash);
  });
});

describe("parseMpcParams fails closed", () => {
  it("rejects a count above the allowed maximum", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const { zkey } = await contribute(genesis, new Uint8Array(32).fill(3));
    // The chain holds one contribution; a head of 0 would only permit one, so
    // this stands in for a rebase that carries too many contributions.
    await expect(parseMpcParams(zkey, { maxContributions: 0 })).rejects.toThrow(
      /exceeds the allowed maximum/,
    );
  });

  it("rejects bytes that are not a zkey", async () => {
    const garbage = new Uint8Array(128).fill(0xab);
    await expect(
      parseMpcParams(garbage, { maxContributions: 10 }),
    ).rejects.toThrow(/not a zkey file/);
  });

  it("rejects a truncated zkey", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const truncated = genesis.subarray(0, Math.floor(genesis.length / 2));
    await expect(
      parseMpcParams(truncated, { maxContributions: 10 }),
    ).rejects.toThrow(/mpcParams:/);
  });

  it("rejects a negative maximum", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    await expect(
      parseMpcParams(genesis, { maxContributions: -1 }),
    ).rejects.toThrow(/non-negative integer/);
  });
});

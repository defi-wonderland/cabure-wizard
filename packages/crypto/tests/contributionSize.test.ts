import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  generateInitialZkey,
  contribute,
  CONTRIBUTION_RECORD_FIXED_BYTES,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(join(FIXTURES, name));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const r1cs = loadFixture("multiplier.r1cs");
const ptau = loadFixture("pot_final.ptau");

function randomEntropy(): Uint8Array {
  const e = new Uint8Array(32);
  crypto.getRandomValues(e);
  return e;
}

// Guards the size cap used by the ceremony upload route. If a snarkjs upgrade
// changes the per-contribution record layout, these assertions fail here
// instead of silently rejecting valid uploads late in a real ceremony.
describe("contribution record size", () => {
  it("grows the zkey by a constant amount per contribution", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const name = "x".repeat(10);

    const c1 = await contribute(genesis, randomEntropy(), name);
    const c2 = await contribute(c1.zkey, randomEntropy(), name);
    const c3 = await contribute(c2.zkey, randomEntropy(), name);

    const delta1 = c1.zkey.length - genesis.length;
    const delta2 = c2.zkey.length - c1.zkey.length;
    const delta3 = c3.zkey.length - c2.zkey.length;

    // Every step adds the same bytes, including the first. Equal first and
    // steady-state deltas mean genesis already carries the (empty) contribution
    // section, so there is no one-time framing the cap must account for.
    expect(delta2).toBe(delta1);
    expect(delta3).toBe(delta1);

    // Record minus the name length is the name-independent fixed cost.
    expect(delta1 - name.length).toBe(CONTRIBUTION_RECORD_FIXED_BYTES);
  }, 120_000);

  it("grows by exactly one byte per extra name character", async () => {
    const genesis = await generateInitialZkey(ptau, r1cs);
    const shortName = "x".repeat(10);
    const longName = "x".repeat(30);

    const cShort = await contribute(genesis, randomEntropy(), shortName);
    const cLong = await contribute(genesis, randomEntropy(), longName);

    const recordShort = cShort.zkey.length - genesis.length;
    const recordLong = cLong.zkey.length - genesis.length;

    expect(recordLong - recordShort).toBe(longName.length - shortName.length);
  }, 120_000);
});

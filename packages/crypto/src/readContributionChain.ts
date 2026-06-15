import {
  readBinFile,
  startReadUniqueSection,
  endReadSection,
} from "@iden3/binfileutils";
import { toHex } from "./hex.js";

/**
 * The contribution chain embedded in a Groth16 Phase 2 zkey.
 *
 * `csHash` is the circuit (constraint system) hash. It is fixed by the r1cs
 * and stays the same for every zkey in one ceremony, so it ties a submission
 * to the right circuit. `transcripts[i]` is the running Blake2b hash that
 * snarkjs writes for contribution `i`. Each transcript folds in every earlier
 * contribution, so `transcripts[k]` commits to the whole chain up to and
 * including contribution `k`.
 *
 * Use this to check, cheaply and without pairings, that a submitted zkey
 * extends the recorded chain: same `csHash`, `transcripts.length` is the
 * recorded count plus one, and the recorded latest transcript still sits at
 * its old index. See the contribute API route for that continuity check.
 */
export interface ContributionChain {
  csHash: string;
  transcripts: string[];
}

// snarkjs zkey section numbers.
const PROTOCOL_HEADER_SECTION = 1;
const GROTH16_HEADER_SECTION = 2;
const CONTRIBUTIONS_SECTION = 10;
const GROTH16_PROTOCOL_ID = 1;
const ZKEY_MAX_VERSION = 2;
// Both the csHash and each contribution's transcript are 64-byte Blake2b hashes.
const HASH_SIZE = 64;

/**
 * Read the embedded contribution chain from a Phase 2 zkey.
 *
 * The zkey container (magic, version, section table, section sizes) is parsed
 * by `@iden3/binfileutils`, the same library snarkjs uses, so this code does
 * not re-implement the file format. Curve point sizes are read from the zkey's
 * own header, so the reader is not pinned to one curve. Only the contribution
 * count and each transcript are read; no elliptic curve points are
 * deserialized, so it stays cheap enough for the request path.
 *
 * The per-contribution field order below mirrors snarkjs `readContribution`
 * (snarkjs 0.7.5 `build/main.cjs`): deltaAfter (G1), delta.g1_s (G1),
 * delta.g1_sx (G1), delta.g2_spx (G2), the 64-byte transcript, a uint32 type
 * tag, then a uint32 param length and that many param bytes. `endReadSection`
 * throws unless the cursor lands exactly on the section end, so a layout
 * mismatch or a corrupt file fails closed instead of returning a wrong answer.
 *
 * @param zkey - The zkey binary.
 * @returns The circuit hash and the per-contribution transcript hashes, in
 *          order. A genesis zkey with no contributions returns an empty
 *          `transcripts` array.
 * @throws If the file is not a Groth16 zkey or its layout does not match.
 */
export async function readContributionChain(
  zkey: Uint8Array,
): Promise<ContributionChain> {
  // binfileutils reads the in-memory buffer directly (no temp file) and only
  // touches the pages it is asked for, so the large coefficient sections are
  // never read.
  const { fd, sections } = await readBinFile(zkey, "zkey", ZKEY_MAX_VERSION);

  try {
    await startReadUniqueSection(fd, sections, PROTOCOL_HEADER_SECTION);
    const protocolId = await fd.readULE32();
    await endReadSection(fd, true);
    if (protocolId !== GROTH16_PROTOCOL_ID) {
      throw new Error("Not a Groth16 zkey.");
    }

    // First field of the Groth16 header is n8q, the field element byte size.
    // A G1 point is two field elements, a G2 point is four.
    await startReadUniqueSection(fd, sections, GROTH16_HEADER_SECTION);
    const n8q = await fd.readULE32();
    await endReadSection(fd, true);
    const g1Size = n8q * 2;
    const g2Size = n8q * 4;

    await startReadUniqueSection(fd, sections, CONTRIBUTIONS_SECTION);
    const csHash = toHex(await fd.read(HASH_SIZE));
    const count = await fd.readULE32();

    const transcripts: string[] = [];
    for (let i = 0; i < count; i++) {
      fd.pos += g1Size * 3 + g2Size;
      transcripts.push(toHex(await fd.read(HASH_SIZE)));
      await fd.readULE32(); // contribution type tag
      const paramLength = await fd.readULE32();
      fd.pos += paramLength;
    }
    await endReadSection(fd);

    return { csHash, transcripts };
  } finally {
    await fd.close();
  }
}

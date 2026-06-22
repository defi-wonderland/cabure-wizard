import { createHash } from "node:crypto";
import { buildBn128, type Bn128Curve } from "ffjavascript";

import { toHex } from "./hex.js";

/**
 * Reads the MPC (multi-party computation) parameters that snarkjs stores in
 * section 10 of a Groth16 zkey, and recomputes each contribution's hash the
 * same way snarkjs does. This is the server-side ground truth the C-1
 * continuity gate needs: snarkjs cannot tell the coordinator which zkey is the
 * recorded head, so the coordinator must read the embedded contribution list
 * itself.
 *
 * Why reimplemented instead of called from snarkjs: snarkjs does not export
 * `readMPCParams` or `hashPubKey`. They live in `src/zkey_utils.js` and the
 * package "exports" map only exposes the top-level dot path, so a deep import
 * is blocked. This module reproduces just those two operations, pinned to the
 * snarkjs version this package depends on. The conformance test asserts the
 * recomputed hash equals the value `snarkjs.zKey.contribute` returns.
 *
 * Threat model: the input bytes come from an untrusted contributor and are
 * parsed before any curve or pairing check. Every read is bounds-checked
 * against the real buffer length, the contribution count is bounded before any
 * allocation, and the TLV parameter list is validated. Parsing is pairing-free
 * — only field-element conversion runs — so it is cheap to run on every
 * submission.
 */

// snarkjs zkey magic, version, and section ids. See zkey_utils.js.
const ZKEY_MAGIC = "zkey";
const HEADER_SECTION = 2;
const CONTRIBUTIONS_SECTION = 10;

// Phase 2 setups here are BN254 only. n8q is the byte length of a base field
// element; the parser rejects any other curve rather than guess point sizes.
const BN254_N8Q = 32;

const CS_HASH_LEN = 64;
const TRANSCRIPT_LEN = 64;

// A zkey has ten sections. A header claiming far more is malformed; cap it so a
// forged section count cannot drive a large loop before any real read.
const MAX_SECTIONS = 64;

export interface ContributionDigest {
  // 0 = a normal contribution, 1 = a beacon. Matches snarkjs's `type` field.
  type: number;
  /**
   * Recompute the 0x-prefixed Blake2b-512 over this contribution's public key
   * (snarkjs `hashPubKey`). Identical to the value `contribute()` returns for
   * that step. Lazy on purpose: the continuity gate hashes only the two entries
   * it checks (the link and the new head), not the whole chain, so a long head
   * is not re-hashed under the per-circuit lock. finalize maps over all of them.
   */
  hash(): string;
}

export interface MpcParams {
  // 0x-prefixed hex of the 64-byte circuit-identity hash snarkjs writes at the
  // start of section 10. The same for every zkey in one circuit's chain.
  csHash: string;
  contributions: ContributionDigest[];
}

export interface ParseMpcParamsOptions {
  /**
   * Upper bound on the contribution count, checked before the per-contribution
   * loop allocates. The continuity gate passes `headCount + 1`: a valid next
   * submission has exactly that many contributions, and anything larger is
   * rejected without walking a forged list.
   */
  maxContributions: number;
}

// Cursor over a Uint8Array that fails closed: every read is checked against the
// real buffer length, so a truncated or lying input throws here instead of
// returning short or trusting an upstream EOF error.
class ByteReader {
  pos = 0;
  private readonly view: DataView;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private require(n: number): void {
    if (n < 0 || this.pos + n > this.buf.length) {
      throw new Error("mpcParams: read past end of buffer");
    }
  }

  readBytes(n: number): Uint8Array {
    this.require(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  readU32(): number {
    this.require(4);
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  readU64(): number {
    this.require(8);
    const lo = this.view.getUint32(this.pos, true);
    const hi = this.view.getUint32(this.pos + 4, true);
    this.pos += 8;
    // Section sizes fit far below 2^53. A larger value is malformed and would
    // also lose precision as a JS number, so reject it.
    if (hi > 0x1fffff) {
      throw new Error("mpcParams: section size too large");
    }
    return hi * 0x1_0000_0000 + lo;
  }

  seek(p: number): void {
    if (p < 0 || p > this.buf.length) {
      throw new Error("mpcParams: seek out of range");
    }
    this.pos = p;
  }
}

interface Section {
  start: number;
  size: number;
}

// Walk the section table once. Returns the unique header and contributions
// sections; throws if either is missing or duplicated (snarkjs treats both as
// unique, and a duplicate is a sign of a hand-crafted file).
function readSectionTable(reader: ByteReader): {
  header: Section;
  contributions: Section;
} {
  const magic = reader.readBytes(4);
  for (let i = 0; i < 4; i++) {
    if (magic[i] !== ZKEY_MAGIC.charCodeAt(i)) {
      throw new Error("mpcParams: not a zkey file");
    }
  }
  // Version. snarkjs writes 1; accept any value it could read, the section
  // walk below is what actually constrains the layout.
  reader.readU32();

  const nSections = reader.readU32();
  if (nSections > MAX_SECTIONS) {
    throw new Error("mpcParams: too many sections");
  }

  const found = new Map<number, Section>();
  const duplicated = new Set<number>();
  for (let i = 0; i < nSections; i++) {
    const type = reader.readU32();
    const size = reader.readU64();
    const start = reader.pos;
    // Confirm the section body is inside the buffer before skipping it.
    reader.seek(start + size);
    if (found.has(type)) {
      duplicated.add(type);
    } else {
      found.set(type, { start, size });
    }
  }

  const header = found.get(HEADER_SECTION);
  const contributions = found.get(CONTRIBUTIONS_SECTION);
  if (!header || duplicated.has(HEADER_SECTION)) {
    throw new Error("mpcParams: missing or duplicated header section");
  }
  if (!contributions || duplicated.has(CONTRIBUTIONS_SECTION)) {
    throw new Error("mpcParams: missing or duplicated contributions section");
  }
  return { header, contributions };
}

// Confirm the zkey is a BN254 Groth16 file and return the point byte sizes. The
// header begins with n8q (base field element length); G1 is two coordinates,
// G2 is two coordinates over the quadratic extension, hence four base elements.
function readPointSizes(
  reader: ByteReader,
  header: Section,
): {
  g1Size: number;
  g2Size: number;
} {
  reader.seek(header.start);
  const n8q = reader.readU32();
  if (n8q !== BN254_N8Q) {
    throw new Error("mpcParams: unsupported curve (expected BN254)");
  }
  return { g1Size: n8q * 2, g2Size: n8q * 4 };
}

// Validate the trailing TLV parameter block of one contribution. snarkjs sorts
// the entries by type and rejects unknown types; we mirror that and keep every
// read inside the block so a lying paramLength cannot escape the section.
function consumeParams(reader: ByteReader, paramLength: number): void {
  const start = reader.pos;
  let lastType = 0;
  while (reader.pos - start < paramLength) {
    const type = reader.readBytes(1)[0];
    if (type <= lastType) {
      throw new Error("mpcParams: contribution parameters not sorted");
    }
    lastType = type;
    if (type === 1) {
      // Contributor name.
      const len = reader.readBytes(1)[0];
      reader.readBytes(len);
    } else if (type === 2) {
      // Beacon iteration exponent (one byte).
      reader.readBytes(1);
    } else if (type === 3) {
      // Beacon hash.
      const len = reader.readBytes(1)[0];
      reader.readBytes(len);
    } else {
      throw new Error("mpcParams: unknown contribution parameter");
    }
  }
  if (reader.pos - start !== paramLength) {
    throw new Error("mpcParams: contribution parameters overran their length");
  }
}

// Lazily built once and reused. `buildBn128(true)` runs single-threaded, so it
// spawns no worker pool to leak across serverless invocations.
let curvePromise: Promise<Bn128Curve> | null = null;
function getCurve(): Promise<Bn128Curve> {
  if (!curvePromise) {
    curvePromise = buildBn128(true);
  }
  return curvePromise;
}

// Recompute snarkjs `hashPubKey`: Blake2b-512 over the three G1 points, the G2
// point, and the transcript — each point in uncompressed form. On disk the
// points are little-endian Montgomery, so they are converted before hashing,
// which is why the curve is needed at all.
function hashContribution(
  curve: Bn128Curve,
  deltaAfter: Uint8Array,
  g1s: Uint8Array,
  g1sx: Uint8Array,
  g2spx: Uint8Array,
  transcript: Uint8Array,
): string {
  const hasher = createHash("blake2b512");
  const g1Uncompressed = new Uint8Array(curve.G1.F.n8 * 2);
  for (const point of [deltaAfter, g1s, g1sx]) {
    curve.G1.toRprUncompressed(
      g1Uncompressed,
      0,
      curve.G1.fromRprLEM(point, 0),
    );
    hasher.update(g1Uncompressed);
  }
  const g2Uncompressed = new Uint8Array(curve.G2.F.n8 * 2);
  curve.G2.toRprUncompressed(g2Uncompressed, 0, curve.G2.fromRprLEM(g2spx, 0));
  hasher.update(g2Uncompressed);
  hasher.update(transcript);
  return `0x${hasher.digest("hex")}`;
}

/**
 * Parse a zkey's MPC parameters and recompute each contribution's hash.
 *
 * @param zkey - Raw zkey bytes from an untrusted source.
 * @param options.maxContributions - Reject any file claiming more contributions
 *   than this before allocating; the continuity gate passes `headCount + 1`.
 * @returns The circuit-identity hash and the ordered list of contribution
 *   hashes. Throws on any malformed input (it never returns a partial result).
 */
export async function parseMpcParams(
  zkey: Uint8Array,
  options: ParseMpcParamsOptions,
): Promise<MpcParams> {
  const maxContributions = options.maxContributions;
  if (!Number.isInteger(maxContributions) || maxContributions < 0) {
    throw new Error(
      "mpcParams: maxContributions must be a non-negative integer",
    );
  }

  const reader = new ByteReader(zkey);
  const { header, contributions } = readSectionTable(reader);
  const { g1Size, g2Size } = readPointSizes(reader, header);

  reader.seek(contributions.start);
  const sectionEnd = contributions.start + contributions.size;

  const csHash = reader.readBytes(CS_HASH_LEN);
  const count = reader.readU32();
  if (count > maxContributions) {
    throw new Error(
      "mpcParams: contribution count exceeds the allowed maximum",
    );
  }

  const curve = await getCurve();
  const result: ContributionDigest[] = [];
  for (let i = 0; i < count; i++) {
    const deltaAfter = reader.readBytes(g1Size);
    const g1s = reader.readBytes(g1Size);
    const g1sx = reader.readBytes(g1Size);
    const g2spx = reader.readBytes(g2Size);
    const transcript = reader.readBytes(TRANSCRIPT_LEN);
    const type = reader.readU32();
    const paramLength = reader.readU32();
    // Keep the variable-length parameter block inside this section. Without
    // this a forged paramLength could read into later bytes.
    if (reader.pos + paramLength > sectionEnd) {
      throw new Error("mpcParams: contribution parameters exceed the section");
    }
    consumeParams(reader, paramLength);

    // Capture the slices now; hash only when the caller asks. The slices are
    // views into `zkey`, so this keeps no extra copies.
    result.push({
      type,
      hash: () =>
        hashContribution(curve, deltaAfter, g1s, g1sx, g2spx, transcript),
    });
  }

  // The section must end exactly where the declared contributions end. Trailing
  // bytes mean the count and the body disagree.
  if (reader.pos !== sectionEnd) {
    throw new Error("mpcParams: trailing bytes after the contribution list");
  }

  return { csHash: toHex(csHash), contributions: result };
}

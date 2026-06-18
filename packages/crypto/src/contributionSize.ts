/**
 * Bytes a single Groth16 phase-2 contribution appends to a zkey, NOT counting
 * the contributor name.
 *
 * The appended record (snarkjs zkey section 10) is fixed-size: three G1 points
 * and one G2 point, a 64-byte transcript, and a few framing integers. Only the
 * optional name is variable, and the total grows by exactly one name byte per
 * character. So a full record is `CONTRIBUTION_RECORD_FIXED_BYTES + nameBytes`.
 * The value does not depend on circuit size — the points are single curve
 * elements, not per-constraint vectors.
 *
 * A consumer that caps an upload sizes it as
 * `genesisSize + n * (CONTRIBUTION_RECORD_FIXED_BYTES + maxNameBytes)`.
 *
 * Measured on BN254 by `contributionSize.test.ts`. That test re-derives the
 * number from snarkjs and asserts it equals this constant, so a snarkjs upgrade
 * that changes the record layout fails the build instead of silently breaking
 * a size cap mid-ceremony.
 */
export const CONTRIBUTION_RECORD_FIXED_BYTES = 394;

/** A source of entropy for contribution randomness */
export interface EntropySource {
  /** Type of entropy source */
  type: "csprng" | "mouse" | "click" | "keyboard" | "custom";
  /** Raw entropy data */
  data: Uint8Array;
}

/** Result of a contribution */
export interface ContributionResult {
  /** The new zkey after applying the contribution */
  zkey: Uint8Array;
  /** SHA-256 hash of the contribution as 0x-prefixed hex string */
  hash: string;
}

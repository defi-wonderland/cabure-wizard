// Contributor attestation: a public, self-published record that a contribution
// happened. It is opt-in and not load-bearing. Soundness comes from the genuine
// hash chain and the open verifier; an attestation only lets a contributor who
// chooses to publish detect censorship of their own contribution (if dropped,
// their h_k does not appear in the final parameters).
//
// This is a record of hashes, NOT a signature: anyone can publish a valid-looking
// attestation for a public h_k, so a third party must not read "N attestations"
// as proof of honesty or diversity. See docs/h4-verifiability.md (§6.3).

export interface AttestationPayload {
  ceremony: string;
  circuit: string;
  // 1-based position of this contribution in the circuit's chain.
  index: number;
  // h_k: this contribution's genuine Blake2b hash (snarkjs hashPubKey).
  h_k: string;
  // h_{k-1}: the predecessor's hash; null when this is the first contribution.
  h_kMinus1: string | null;
  // Chain-of-custody hash after this contribution.
  chainHash: string;
  // GitHub login the contribution was made under.
  login: string;
}

export function buildAttestation(input: AttestationPayload): {
  payload: AttestationPayload;
  filename: string;
  json: string;
} {
  return {
    payload: input,
    filename: `cabure-attestation-${input.ceremony}-${input.circuit}-${input.index}.json`,
    json: JSON.stringify(input, null, 2),
  };
}

// Publish the attestation as a public Gist on the contributor's own GitHub
// account, using the gist-scoped token from their session. One click, no copy
// and paste. Returns the Gist's web URL.
//
// The token is a GitHub OAuth bearer token, so this is attributable+timestamped
// evidence, not a signature (see the header note). Requires the session to
// carry the `gist` scope; a session signed in before that scope was granted
// fails here and the contributor must sign in again.
export async function publishGist(
  input: AttestationPayload,
  accessToken: string,
): Promise<string> {
  const { filename, json } = buildAttestation(input);
  const response = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: `Caburé attestation — ${input.ceremony} / ${input.circuit} #${input.index}`,
      public: true,
      files: { [filename]: { content: json } },
    }),
  });
  if (!response.ok) {
    throw new Error(`Gist creation failed (${response.status}).`);
  }
  const data = (await response.json()) as { html_url?: string };
  if (!data.html_url) {
    throw new Error("Gist was created but GitHub returned no URL.");
  }
  return data.html_url;
}

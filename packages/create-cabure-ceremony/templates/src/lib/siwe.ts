import { SiweMessage, generateNonce } from "siwe";

import { deleteKey, setJson } from "./kv-store";

const NONCE_TTL_SECONDS = 5 * 60;

function nonceKey(nonce: string): string {
  return `siwe-nonce:${nonce}`;
}

interface NonceRecord {
  createdAt: number;
}

export async function issueNonce(): Promise<string> {
  const nonce = generateNonce();
  await setJson<NonceRecord>(
    nonceKey(nonce),
    { createdAt: Date.now() },
    NONCE_TTL_SECONDS,
  );
  return nonce;
}

export interface VerifiedSiwe {
  address: string;
  participantName: string;
}

export async function verifySiwe(
  message: string,
  signature: string,
): Promise<VerifiedSiwe> {
  const expectedDomain = getExpectedDomain();

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    throw new Error("Invalid SIWE message format");
  }

  const consumedNonceCount = await deleteKey(nonceKey(siwe.nonce));
  if (consumedNonceCount !== 1) {
    throw new Error("Unknown or expired nonce");
  }

  let verification;
  try {
    verification = await siwe.verify({
      signature,
      domain: expectedDomain,
      nonce: siwe.nonce,
    });
  } catch {
    throw new Error("SIWE signature verification failed");
  }

  if (!verification.success) {
    throw new Error(verification.error?.type ?? "SIWE verification failed");
  }
  const address = verification.data.address.toLowerCase();
  return {
    address,
    participantName: shortenAddress(address),
  };
}

function getExpectedDomain(): string {
  const rawUrl = process.env.NEXTAUTH_URL?.trim();
  if (!rawUrl) {
    throw new Error("NEXTAUTH_URL is required for SIWE verification");
  }
  try {
    return new URL(rawUrl).host;
  } catch {
    throw new Error("NEXTAUTH_URL is not a valid URL");
  }
}

function shortenAddress(address: string): string {
  const lowered = address.toLowerCase();
  return `${lowered.slice(0, 6)}...${lowered.slice(-4)}`;
}

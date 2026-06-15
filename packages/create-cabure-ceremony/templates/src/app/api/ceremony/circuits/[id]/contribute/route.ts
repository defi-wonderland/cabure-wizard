import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import {
  readContributionChain,
  verify,
  type ContributionChain,
} from "@wonderland/cabure-crypto";

import { getCeremonyConfig } from "@/lib/ceremony-config";
import { getParticipant } from "@/lib/participant-auth";
import {
  computeChainHash,
  getAllCircuitStates,
  getCircuitState,
  getManifest,
  hasParticipantContributedToCircuit,
  isCeremonyActive,
  kvKey,
  pruneExpiredEntries,
  readCircuitBytes,
  type ContributionReceipt,
} from "@/lib/ceremony-state";
import { deleteBinary } from "@/lib/blob-store";
import { acquireLock, releaseLock, writeContribution } from "@/lib/kv-store";

const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

function isValidPendingBlobUrl(url: string, circuitId: string): boolean {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(BLOB_HOST_SUFFIX)
    ) {
      return false;
    }
    const expectedPrefix = `/contributions/${circuitId}/`;
    return parsed.pathname.startsWith(expectedPrefix);
  } catch {
    return false;
  }
}

function blobPathname(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const participant = await getParticipant(request);

  if (!participant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { participantId } = participant;

  const { blobUrl, contributionHash: rawClientHash } =
    (await request.json()) as {
      blobUrl: string;
      contributionHash?: unknown;
    };

  const clientHash =
    typeof rawClientHash === "string" &&
    rawClientHash.length <= 256 &&
    /^0x[0-9a-fA-F]+$/.test(rawClientHash)
      ? rawClientHash
      : null;

  if (!blobUrl || !isValidPendingBlobUrl(blobUrl, id)) {
    return NextResponse.json(
      { error: "Missing or invalid blobUrl" },
      { status: 400 },
    );
  }

  const blobResponse = await fetch(blobUrl);
  if (!blobResponse.ok) {
    return NextResponse.json(
      { error: "Failed to fetch uploaded zkey from blob storage" },
      { status: 400 },
    );
  }
  const body = new Uint8Array(await blobResponse.arrayBuffer());

  if (body.length === 0) {
    await deleteBinary(blobUrl).catch(() => {});
    return NextResponse.json(
      { error: "Contribution payload is empty" },
      { status: 400 },
    );
  }

  // Read the contribution chain embedded in the uploaded zkey. This is a cheap
  // parse (no pairings, no curve point deserialization). A malformed file
  // throws here and is rejected before it can touch ceremony state.
  let chain: ContributionChain;
  try {
    chain = await readContributionChain(body);
  } catch {
    await deleteBinary(blobUrl).catch(() => {});
    return NextResponse.json(
      { error: "Uploaded file is not a readable zkey" },
      { status: 400 },
    );
  }

  const config = getCeremonyConfig();
  const manifest = await getManifest();
  const lockKey = `${config.storage.manifestPath}:lock:${id}`;
  const lockToken = crypto.randomUUID();
  const locked = await acquireLock(lockKey, lockToken);
  if (!locked) {
    return NextResponse.json(
      { error: "Circuit busy. Please retry." },
      { status: 409 },
    );
  }

  try {
    let circuit = await getCircuitState(id);
    const allCircuits = await getAllCircuitStates();

    if (!isCeremonyActive(manifest, allCircuits)) {
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: "Ceremony is not active" },
        { status: 403 },
      );
    }

    circuit.queue = pruneExpiredEntries(
      circuit.queue,
      config.queueTimeoutSeconds,
    );

    if (circuit.queue[0]?.participantId !== participantId) {
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: "Not at front of the queue" },
        { status: 409 },
      );
    }

    if (await hasParticipantContributedToCircuit(participantId, id)) {
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: "You have already contributed to this circuit" },
        { status: 403 },
      );
    }

    const circuitConfig = config.circuits.find((c) => c.id === id);
    if (!circuitConfig) {
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: `Unknown circuit: ${id}` },
        { status: 404 },
      );
    }

    // Continuity (cheap, no pairings): the submission must be for this circuit,
    // be exactly one contribution longer than the recorded chain, and still
    // carry the recorded latest transcript at its old position. Because each
    // transcript folds in every earlier one, matching the latest transcript
    // commits to the entire prefix — a chain that drops or replaces an earlier
    // contribution cannot pass.
    if (chain.csHash !== circuit.csHash) {
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: "Contribution is for a different circuit" },
        { status: 400 },
      );
    }
    if (chain.transcripts.length !== circuit.totalContributions + 1) {
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: "Contribution does not extend the current chain" },
        { status: 409 },
      );
    }
    if (
      circuit.totalContributions > 0 &&
      chain.transcripts[circuit.totalContributions - 1] !==
        circuit.latestTranscript
    ) {
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: "Contribution does not extend the current chain" },
        { status: 409 },
      );
    }

    // Per-contribution verification is opt-in: loading r1cs + ptau and running
    // pairing checks can easily exceed serverless timeouts for large circuits.
    // The finalize script verifies the full contribution chain before applying
    // the beacon, so integrity is guaranteed before finalization.
    if (config.verifyContributions) {
      const [r1cs, ptau] = await Promise.all([
        readCircuitBytes(circuitConfig.artifacts.r1csPath),
        readCircuitBytes(circuitConfig.artifacts.ptauPath),
      ]);

      const isValid = await verify(r1cs, ptau, body);
      if (!isValid) {
        await deleteBinary(blobUrl).catch(() => {});
        return NextResponse.json(
          { error: "Invalid contribution: verification failed" },
          { status: 400 },
        );
      }
    }

    const computedHash = `0x${createHash("sha256").update(body).digest("hex")}`;

    const contributionIndex = circuit.totalContributions + 1;
    const timestamp = Date.now();
    const chainHash = computeChainHash({
      previousChainHash: circuit.chainHash,
      contributionHash: computedHash,
      participantId,
      timestamp,
    });

    // The uploaded blob already sits at its own immutable, random-suffixed
    // path. Promote it in place instead of overwriting a shared current.zkey:
    // Vercel Blob serves public blobs as immutable, so overwriting the same
    // path leaves the CDN returning stale bytes — a later contributor then
    // downloads the wrong zkey and fails the integrity check.
    const previousZkeyUrl = circuit.currentZkeyUrl;

    circuit.totalContributions += 1;
    circuit.latestContributionHash = computedHash;
    circuit.chainHash = chainHash;
    circuit.latestTranscript = chain.transcripts[contributionIndex - 1];
    circuit.queue.shift();
    circuit.currentZkeyPath = blobPathname(blobUrl);
    circuit.currentZkeyUrl = blobUrl;

    const receipt: ContributionReceipt = {
      circuitId: id,
      participantId,
      contributionIndex,
      contributionHash: computedHash,
      clientContributionHash: clientHash,
      chainHash,
      timestamp,
    };

    await writeContribution({
      circuitStateKey: kvKey(config.storage.circuitStatePrefix, id),
      circuitState: circuit,
      receiptsKey: config.storage.receiptsPath,
      receipt,
      participantContributionsKey: kvKey(
        config.storage.participantContributionsPrefix,
        participantId,
      ),
      circuitId: id,
      participantsIndexKey: config.storage.participantsIndexPath,
      participantId,
    });

    // Drop the superseded zkey now that the pointer has moved — never the
    // genesis, which finalize and download integrity both depend on.
    if (previousZkeyUrl && previousZkeyUrl !== circuit.initialZkeyUrl) {
      await deleteBinary(previousZkeyUrl).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      ...receipt,
    });
  } finally {
    await releaseLock(lockKey, lockToken);
  }
}

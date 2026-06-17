import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { verify } from "@wonderland/cabure-crypto";

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
import { deleteBinary, putBinary } from "@/lib/blob-store";
import { writeContribution } from "@/lib/kv-store";

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

  const config = getCeremonyConfig();
  const circuitConfig = config.circuits.find((c) => c.id === id);
  if (!circuitConfig) {
    await deleteBinary(blobUrl).catch(() => {});
    return NextResponse.json(
      { error: `Unknown circuit: ${id}` },
      { status: 404 },
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

  // Heavy work runs BEFORE the lock. Verifying and copying the zkey can take
  // longer than the lock's TTL; under the lock that would let the lock expire
  // mid-work and admit a second writer, dropping a contribution. Out here, the
  // lock below is held only for the fast state update, so it cannot expire in
  // flight and the plain write is safe.

  // Per-contribution verification is opt-in: pairing checks can exceed
  // serverless timeouts for large circuits.
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

  // Store under a per-participant path, never the shared `current.zkey`: the
  // committed `currentZkeyUrl` pointer is the source of truth, so a
  // contribution that fails a check below is discarded without touching the
  // live zkey. We upload before the commit decision, so a crash or a failed
  // cleanup delete between here and the commit leaks this blob. Keying it by
  // participant (with allowOverwrite) bounds that leak: a retry from the same
  // participant overwrites their own blob instead of orphaning a new one.
  const zkeyPath = `${config.storage.zkeyPrefix}/${id}/pending-${participantId}.zkey`;
  const stored = await putBinary(zkeyPath, body);

  // The client's pending upload has been copied to our path.
  await deleteBinary(blobUrl).catch(() => {});

  const manifest = await getManifest();
  const circuit = await getCircuitState(id);
  const allCircuits = await getAllCircuitStates();

  if (!isCeremonyActive(manifest, allCircuits)) {
    await deleteBinary(stored.url).catch(() => {});
    return NextResponse.json(
      { error: "Ceremony is not active" },
      { status: 403 },
    );
  }

  circuit.queue = pruneExpiredEntries(circuit.queue, config.queueTimeoutSeconds);

  if (circuit.queue[0]?.participantId !== participantId) {
    await deleteBinary(stored.url).catch(() => {});
    return NextResponse.json(
      { error: "Not at front of the queue" },
      { status: 409 },
    );
  }

  if (await hasParticipantContributedToCircuit(participantId, id)) {
    await deleteBinary(stored.url).catch(() => {});
    return NextResponse.json(
      { error: "You have already contributed to this circuit" },
      { status: 403 },
    );
  }

  // finalize:ceremony verifies the chain from the pinned genesis before the
  // beacon. A circuit without that pin can never be finalized, so accepting
  // contributions here would waste participant work. Reject before advancing.
  if (!circuit.initialZkeyUrl || !circuit.initialZkeyHash) {
    await deleteBinary(stored.url).catch(() => {});
    return NextResponse.json(
      {
        error:
          "Ceremony has no pinned genesis and cannot be finalized. " +
          "The operator must re-run init:ceremony.",
      },
      { status: 409 },
    );
  }

  const hadPriorContribution = circuit.totalContributions > 0;
  // The head this contribution extends. The commit below is rejected if another
  // contribution moves the head first, so the chain never advances twice from
  // the same point. No lock needed for that guarantee.
  const previousZkeyUrl = circuit.currentZkeyUrl;
  const contributionIndex = circuit.totalContributions + 1;
  const timestamp = Date.now();
  const chainHash = computeChainHash({
    previousChainHash: circuit.chainHash,
    contributionHash: computedHash,
    participantId,
    timestamp,
  });

  circuit.totalContributions += 1;
  circuit.latestContributionHash = computedHash;
  circuit.chainHash = chainHash;
  circuit.queue.shift();
  circuit.currentZkeyPath = stored.pathname;
  circuit.currentZkeyUrl = stored.url;

  const receipt: ContributionReceipt = {
    circuitId: id,
    participantId,
    contributionIndex,
    contributionHash: computedHash,
    clientContributionHash: clientHash,
    chainHash,
    timestamp,
  };

  const committed = await writeContribution({
    expectedHeadUrl: previousZkeyUrl,
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

  // Rejected when another contribution advanced the chain head between our read
  // and this commit. Our snapshot is then stale, so we must not claim success
  // or delete the previous zkey (the other writer now owns it). Drop our blob
  // and let the client retry against fresh state.
  if (!committed) {
    await deleteBinary(stored.url).catch(() => {});
    return NextResponse.json(
      { error: "Contribution conflict. Please retry." },
      { status: 409 },
    );
  }

  // The new zkey embeds the whole contribution chain, so the previous
  // contribution's blob is redundant — delete it to bound storage. Never
  // delete the genesis (kept when there is no prior contribution).
  if (hadPriorContribution) {
    await deleteBinary(previousZkeyUrl).catch(() => {});
  }

  return NextResponse.json({
    success: true,
    ...receipt,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { verifyChain } from "@wonderland/cabure-crypto";

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

    const computedHash = `0x${createHash("sha256").update(body).digest("hex")}`;

    // Verify the contribution extends the CURRENT chain, not merely that it is
    // a valid chain from genesis. A takeover rebuild (re-run every contribution
    // from genesis with the attacker's own randomness) is a valid chain from
    // genesis, so checking against genesis alone would accept it and silently
    // drop every honest contribution. verifyChain(ptau, currentZkey, body)
    // proves `body` continues the exact zkey we are currently serving.
    //
    // On by default. It is the only request-path defense against the takeover,
    // so disabling it (development only) leaves the chain unprotected until the
    // finalize script runs its full chain verify. The pairing verify is
    // O(circuit size); for a large circuit on a short serverless timeout this
    // can be slow — size the deployment's function timeout accordingly.
    if (config.verifyContributions) {
      const ptau = await readCircuitBytes(circuitConfig.artifacts.ptauPath);

      const currentResponse = await fetch(circuit.currentZkeyUrl);
      if (!currentResponse.ok) {
        await deleteBinary(blobUrl).catch(() => {});
        return NextResponse.json(
          { error: "Could not load the current zkey to verify against" },
          { status: 502 },
        );
      }
      const currentZkey = new Uint8Array(await currentResponse.arrayBuffer());

      // verifyChain treats byte-equal inputs as a valid empty chain, so a
      // resubmission of the current zkey would pass. A contribution must change
      // the parameters; reject one that does not.
      if (computedHash === circuit.latestContributionHash) {
        await deleteBinary(blobUrl).catch(() => {});
        return NextResponse.json(
          { error: "Contribution does not add anything to the current zkey" },
          { status: 400 },
        );
      }

      const extendsChain = await verifyChain(ptau, currentZkey, body);
      if (!extendsChain) {
        await deleteBinary(blobUrl).catch(() => {});
        return NextResponse.json(
          { error: "Contribution does not extend the current chain" },
          { status: 400 },
        );
      }
    }

    const contributionIndex = circuit.totalContributions + 1;
    const timestamp = Date.now();
    const chainHash = computeChainHash({
      previousChainHash: circuit.chainHash,
      contributionHash: computedHash,
      participantId,
      timestamp,
    });

    const zkeyPath = `${config.storage.zkeyPrefix}/${id}/current.zkey`;
    const stored = await putBinary(zkeyPath, body);

    await deleteBinary(blobUrl).catch(() => {});

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

    return NextResponse.json({
      success: true,
      ...receipt,
    });
  } finally {
    await releaseLock(lockKey, lockToken);
  }
}

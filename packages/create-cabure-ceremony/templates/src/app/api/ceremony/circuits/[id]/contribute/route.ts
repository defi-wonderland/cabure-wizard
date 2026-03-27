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
  isCeremonyActive,
  pruneExpiredEntries,
  readCircuitBytes,
  type ContributionReceipt,
  circuitStatePath,
} from "@/lib/ceremony-state";
import { deleteBinary, putBinary } from "@/lib/blob-store";
import { acquireLock, listPush, releaseLock, setJson } from "@/lib/kv-store";

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

    const circuitConfig = config.circuits.find((c) => c.id === id);
    if (!circuitConfig) {
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: `Unknown circuit: ${id}` },
        { status: 404 },
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

    await Promise.all([
      setJson(circuitStatePath(config.storage.circuitStatePrefix, id), circuit),
      listPush(config.storage.receiptsPath, receipt),
    ]);

    return NextResponse.json({
      success: true,
      ...receipt,
    });
  } finally {
    await releaseLock(lockKey, lockToken);
  }
}

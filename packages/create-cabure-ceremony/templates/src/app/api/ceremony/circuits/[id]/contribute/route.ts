import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { verifyChain } from "@wonderland/cabure-crypto";

import "@/lib/snarkjs-gc-guard";
import { getCeremonyConfig } from "@/lib/ceremony-config";
import { loadPtau } from "@/lib/ptau-loader";
import { getParticipant } from "@/lib/participant-auth";
import {
  computeChainHash,
  getCircuitState,
  getManifest,
  hasParticipantContributedToCircuit,
  isCircuitActive,
  kvKey,
  pruneExpiredEntries,
  type CircuitState,
  type ContributionReceipt,
  type ManifestState,
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

type EligibilityResult =
  | { ok: true; circuit: CircuitState }
  | { ok: false; error: string; status: number };

// Shared eligibility gate. Run once cheaply before the heavy verify/upload (so
// a clearly ineligible request never pays for them) and again under the lock,
// where it is authoritative: state can change between the pre-check and
// acquiring the lock. One circuit-state read per call (no global read of every
// circuit); prunes `circuit.queue` in place; the returned circuit is the one to
// mutate and commit.
async function checkEligibility(
  id: string,
  participantId: string,
  manifest: ManifestState,
  targetContributions: number,
  queueTimeoutSeconds: number,
): Promise<EligibilityResult> {
  const circuit = await getCircuitState(id);

  if (!isCircuitActive(manifest, circuit, targetContributions)) {
    return { ok: false, error: "Ceremony is not active", status: 403 };
  }

  circuit.queue = pruneExpiredEntries(circuit.queue, queueTimeoutSeconds);

  if (circuit.queue[0]?.participantId !== participantId) {
    return { ok: false, error: "Not at front of the queue", status: 409 };
  }

  if (await hasParticipantContributedToCircuit(participantId, id)) {
    return {
      ok: false,
      error: "You have already contributed to this circuit",
      status: 403,
    };
  }

  // finalize:ceremony verifies the chain from the pinned genesis before the
  // beacon. A circuit without that pin can never be finalized, so accepting
  // contributions here would waste participant work.
  if (!circuit.initialZkeyUrl || !circuit.initialZkeyHash) {
    return {
      ok: false,
      error:
        "Ceremony has no pinned genesis and cannot be finalized. " +
        "The operator must re-run init:ceremony.",
      status: 409,
    };
  }

  return { ok: true, circuit };
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

  const manifest = await getManifest();

  // Cheap eligibility check before the expensive verify/upload, so a clearly
  // ineligible request never pays for them. The authoritative check runs again
  // under the lock below. Nothing is stored yet, so on rejection we only clean
  // up the client's pending upload.
  const precheck = await checkEligibility(
    id,
    participantId,
    manifest,
    circuitConfig.targetContributions,
    config.queueTimeoutSeconds,
  );
  if (!precheck.ok) {
    await deleteBinary(blobUrl).catch(() => {});
    return NextResponse.json(
      { error: precheck.error },
      { status: precheck.status },
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

  // Heavy work (verify + upload) runs before the lock, so the locked commit
  // section below stays brief and cannot outlive the lock TTL.

  // Per-contribution verify: re-walk the chain from the pinned genesis.
  // verifyChain runs the sameRatio test over L and H at every step, catching a
  // poisoned contribution (header advanced to the new delta while L/H stay on
  // the old one) at submit time. Mandatory in production: deferring to finalize
  // would accept a poisoned contribution live and reject it only at finalize, a
  // late denial of service with no rollback. The flag may disable it only
  // outside production (dev / CI). Circuits too large for the serverless time
  // limit should verify on an external worker, not skip it.
  //
  // This checks per-contribution validity, not continuity: a chain rebuilt from
  // genesis is valid here. The rebase/continuity gate is tracked separately.
  // NODE_ENV is "production" for any deployed build (prod, staging, preview) and
  // only "development"/"test" under `next dev` or CI. So every deployment always
  // verifies; the flag can only ADD verification in dev / CI, never remove it
  // from a deployment. Fail-safe: a deploy cannot silently skip the check.
  const mustVerify =
    process.env.NODE_ENV === "production" || config.verifyContributions;
  if (mustVerify) {
    try {
      const ptau = await loadPtau({
        url: manifest.ptauUrl,
        localPath: circuitConfig.artifacts.ptauPath,
      });

      // Verify against the pinned genesis: download it and confirm it still
      // matches the hash from init, so the chain roots in the real genesis, not
      // a swapped blob.
      const genesisResponse = await fetch(precheck.circuit.initialZkeyUrl, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!genesisResponse.ok) {
        await deleteBinary(blobUrl).catch(() => {});
        return NextResponse.json(
          { error: "Could not load the pinned genesis to verify against" },
          { status: 502 },
        );
      }
      const genesis = new Uint8Array(await genesisResponse.arrayBuffer());
      const genesisHash = `0x${createHash("sha256").update(genesis).digest("hex")}`;
      if (genesisHash !== precheck.circuit.initialZkeyHash) {
        await deleteBinary(blobUrl).catch(() => {});
        return NextResponse.json(
          { error: "Pinned genesis does not match its recorded hash" },
          { status: 500 },
        );
      }

      const isValid = await verifyChain(ptau, genesis, body);
      if (!isValid) {
        await deleteBinary(blobUrl).catch(() => {});
        return NextResponse.json(
          { error: "Invalid contribution: verification failed" },
          { status: 400 },
        );
      }
    } catch (error) {
      // A throw here means the verifier could not run (ptau download, genesis
      // fetch, hashing, or a snarkjs crash) — NOT that the contribution is bad.
      // Without this catch the pending blob leaks and the client gets an opaque
      // 500. Clean up and return 503 so the contributor retries: 503 ("could not
      // verify, try again") must stay distinct from the 400 above ("contribution
      // is invalid"), or a transient server fault brands valid work as poisoned.
      console.error(`Verification failed to run for circuit ${id}:`, error);
      await deleteBinary(blobUrl).catch(() => {});
      return NextResponse.json(
        { error: "Verification temporarily unavailable. Please retry." },
        { status: 503 },
      );
    }
  }

  const computedHash = `0x${createHash("sha256").update(body).digest("hex")}`;

  // Unique path per attempt, never a shared or per-participant fixed path. Once
  // a contribution commits, `currentZkeyUrl` points at this blob. Two concurrent
  // attempts from the same participant must NOT share a path: otherwise the
  // loser's cleanup delete below would remove the winner's just-committed head.
  // Rejected attempts delete their own blob; only a crash leaks one, which the
  // orphan-GC follow-up reclaims.
  const zkeyPath = `${config.storage.zkeyPrefix}/${id}/pending-${participantId}-${crypto.randomUUID()}.zkey`;
  const stored = await putBinary(zkeyPath, body);

  // The client's pending upload has been copied to our path.
  await deleteBinary(blobUrl).catch(() => {});

  // Critical section: the per-circuit lock serializes this fast read+commit
  // with the queue POST route, which writes the same circuit-state key. Heavy
  // work already ran above, so the lock is held only for the brief commit and
  // cannot expire mid-write.
  const lockKey = `${config.storage.manifestPath}:lock:${id}`;
  const lockToken = crypto.randomUUID();
  const locked = await acquireLock(lockKey, lockToken);
  if (!locked) {
    await deleteBinary(stored.url).catch(() => {});
    return NextResponse.json(
      { error: "Circuit busy. Please retry." },
      { status: 409 },
    );
  }

  try {
    // Authoritative re-check: state may have changed since the pre-check.
    const eligible = await checkEligibility(
      id,
      participantId,
      manifest,
      circuitConfig.targetContributions,
      config.queueTimeoutSeconds,
    );
    if (!eligible.ok) {
      await deleteBinary(stored.url).catch(() => {});
      return NextResponse.json(
        { error: eligible.error },
        { status: eligible.status },
      );
    }
    const circuit = eligible.circuit;

    const hadPriorContribution = circuit.totalContributions > 0;
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
      lockKey,
      lockToken,
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

    // The write lands only if we still hold the lock. If our lock expired and
    // another writer took it (a stall past the TTL), the commit is rejected:
    // our snapshot is stale, so drop our blob and let the client retry. Do not
    // delete the previous zkey — the other writer now owns it.
    if (!committed) {
      await deleteBinary(stored.url).catch(() => {});
      return NextResponse.json(
        { error: "Circuit busy. Please retry." },
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
  } finally {
    // Best-effort: a release can fail on a transient KV error, but the lock's
    // TTL expires it anyway. Letting it throw would replace an already-committed
    // success with a 500 and make the client retry a contribution that landed.
    await releaseLock(lockKey, lockToken).catch((error) => {
      console.error("Failed to release contribution lock for circuit:", id, error);
    });
  }
}

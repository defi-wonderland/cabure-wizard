import { NextResponse } from "next/server";

import { getCeremonyConfig } from "@/lib/ceremony-config";
import {
  getAllCircuitStates,
  getCircuitState,
  getManifest,
  hasParticipantContributedToCircuit,
  isCeremonyActive,
  pruneExpiredEntries,
} from "@/lib/ceremony-state";
import { getParticipant } from "@/lib/participant-auth";
import { presignPut } from "@/lib/blob-store";

// Gate eligibility, then hand back a presigned S3 PUT URL the client uploads to
// directly. This replaces Vercel Blob's handleUpload token flow. The eligibility
// checks here mirror the contribute route's pre-check; the contribute route is
// still authoritative (it re-checks under the per-circuit lock), so a stale
// allow here only wastes an upload, it cannot commit an ineligible contribution.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const participant = await getParticipant(request);
    if (!participant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = getCeremonyConfig();
    const manifest = await getManifest();
    const allCircuits = await getAllCircuitStates();

    if (!isCeremonyActive(manifest, allCircuits)) {
      return NextResponse.json(
        { error: "Ceremony is not active" },
        { status: 403 },
      );
    }

    if (
      await hasParticipantContributedToCircuit(participant.participantId, id)
    ) {
      return NextResponse.json(
        { error: "You have already contributed to this circuit" },
        { status: 403 },
      );
    }

    const circuit = await getCircuitState(id);
    const pruned = pruneExpiredEntries(
      circuit.queue,
      config.queueTimeoutSeconds,
    );
    if (pruned[0]?.participantId !== participant.participantId) {
      return NextResponse.json(
        { error: "Not at front of the queue" },
        { status: 409 },
      );
    }

    // Per-attempt key. The contribute route validates this prefix and reads the
    // object back by key. A UUID keeps two uploads from the same participant from
    // clobbering each other.
    const key = `contributions/${id}/pending-${participant.participantId}-${crypto.randomUUID()}.zkey`;
    const uploadUrl = await presignPut(key);

    return NextResponse.json({ uploadUrl, key });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

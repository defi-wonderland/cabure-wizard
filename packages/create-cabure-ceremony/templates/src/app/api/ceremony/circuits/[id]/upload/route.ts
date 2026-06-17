import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { CONTRIBUTION_RECORD_FIXED_BYTES } from "@wonderland/cabure-crypto";

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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const participant = await getParticipant(request);
        if (!participant) {
          throw new Error("Unauthorized");
        }

        const config = getCeremonyConfig();
        const manifest = await getManifest();
        const allCircuits = await getAllCircuitStates();

        if (!isCeremonyActive(manifest, allCircuits)) {
          throw new Error("Ceremony is not active");
        }

        if (
          await hasParticipantContributedToCircuit(
            participant.participantId,
            id,
          )
        ) {
          throw new Error("You have already contributed to this circuit");
        }

        const circuit = await getCircuitState(id);
        const pruned = pruneExpiredEntries(
          circuit.queue,
          config.queueTimeoutSeconds,
        );

        if (pruned[0]?.participantId !== participant.participantId) {
          throw new Error("Not at front of the queue");
        }

        // Cap the upload size (M-3). A valid contribution is the genesis zkey
        // plus one fixed-size record per contribution (the one being uploaded
        // included), so the exact ceiling is genesis + n * (record + name).
        // This rejects oversized junk before it is stored or loaded into
        // memory. Skip the cap only if the size was not recorded (a ceremony
        // initialized before this field existed).
        //
        // CONTRIBUTION_RECORD_FIXED_BYTES is measured against snarkjs and
        // verified by a test in @wonderland/cabure-crypto. MAX_NAME_BYTES is
        // the longest contributor name we size for; the web flow uses a fixed
        // short name and the CLI uses a GitHub login (max 39 chars), so 64
        // leaves margin while still rejecting padded uploads.
        const MAX_NAME_BYTES = 64;
        const perContribution =
          CONTRIBUTION_RECORD_FIXED_BYTES + MAX_NAME_BYTES;
        const maximumSizeInBytes =
          circuit.genesisZkeySize > 0
            ? circuit.genesisZkeySize +
              (circuit.totalContributions + 1) * perContribution
            : undefined;

        return {
          allowedContentTypes: ["application/octet-stream"],
          addRandomSuffix: true,
          ...(maximumSizeInBytes !== undefined && { maximumSizeInBytes }),
          tokenPayload: JSON.stringify({
            participantId: participant.participantId,
            circuitId: id,
          }),
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

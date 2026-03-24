import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { authOptions } from "@/lib/auth";
import { getCeremonyConfig } from "@/lib/ceremony-config";
import {
  getAllCircuitStates,
  getCircuitState,
  getManifest,
  isCeremonyActive,
  pruneExpiredEntries,
} from "@/lib/ceremony-state";

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
        const session = await getServerSession(authOptions);
        if (!session?.participantId) {
          throw new Error("Unauthorized");
        }

        const config = getCeremonyConfig();
        const manifest = await getManifest();
        const allCircuits = await getAllCircuitStates();

        if (!isCeremonyActive(manifest, allCircuits)) {
          throw new Error("Ceremony is not active");
        }

        const circuit = await getCircuitState(id);
        const pruned = pruneExpiredEntries(
          circuit.queue,
          config.queueTimeoutSeconds,
        );

        if (pruned[0]?.participantId !== session.participantId) {
          throw new Error("Not at front of the queue");
        }

        return {
          allowedContentTypes: ["application/octet-stream"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            participantId: session.participantId,
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

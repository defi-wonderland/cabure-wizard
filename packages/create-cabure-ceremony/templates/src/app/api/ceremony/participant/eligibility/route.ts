import { NextRequest, NextResponse } from "next/server";

import {
  getAllCircuitStates,
  getParticipantContributedCircuitIds,
} from "@/lib/ceremony-state";
import { getCeremonyConfig } from "@/lib/ceremony-config";
import { getParticipant } from "@/lib/participant-auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const participant = await getParticipant(request);
  if (!participant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getCeremonyConfig();
  const [circuits, contributedCircuitIds] = await Promise.all([
    getAllCircuitStates(),
    getParticipantContributedCircuitIds(participant.participantId),
  ]);

  const eligibleCircuitIds = config.circuits
    .filter((circuitConfig) => {
      if (contributedCircuitIds.has(circuitConfig.id)) {
        return false;
      }

      const circuit = circuits.find((state) => state.id === circuitConfig.id);
      return (
        !circuit ||
        circuit.totalContributions < circuitConfig.targetContributions
      );
    })
    .map((circuit) => circuit.id);

  return NextResponse.json({
    participantId: participant.participantId,
    contributedCircuitIds: Array.from(contributedCircuitIds),
    eligibleCircuitIds,
    hasEligibleCircuits: eligibleCircuitIds.length > 0,
  });
}

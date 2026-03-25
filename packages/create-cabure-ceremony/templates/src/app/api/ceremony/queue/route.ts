import { NextRequest, NextResponse } from "next/server";

import {
  getAllCircuitStates,
  getCircuitState,
  getManifest,
  isCeremonyActive,
  pruneExpiredEntries,
  circuitStatePath,
  selectCircuitsForTier,
} from "@/lib/ceremony-state";
import { getCeremonyConfig, type TierId } from "@/lib/ceremony-config";
import { getParticipant } from "@/lib/participant-auth";
import { acquireLock, releaseLock, setJson } from "@/lib/kv-store";

type QueuePosition = {
  participantId: string;
  circuitId: string;
  position: number;
  estimatedWaitSeconds: number;
};

export async function POST(request: NextRequest) {
  const participant = await getParticipant(request);
  if (!participant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { participantId } = participant;

  const payload = (await request.json()) as {
    tierId?: TierId;
    circuitIds?: string[];
  };

  const config = getCeremonyConfig();
  const manifest = await getManifest();
  const allCircuits = await getAllCircuitStates();

  if (!isCeremonyActive(manifest, allCircuits)) {
    return NextResponse.json(
      { error: "Ceremony is not active" },
      { status: 403 },
    );
  }

  let resolvedIds: string[];
  if (payload.tierId && config.tiersEnabled && config.tiers) {
    resolvedIds = selectCircuitsForTier(
      payload.tierId,
      config.tiers,
      config.circuits,
      allCircuits,
    );
  } else if (Array.isArray(payload.circuitIds)) {
    resolvedIds = payload.circuitIds;
  } else {
    return NextResponse.json(
      { error: "Invalid queue payload" },
      { status: 400 },
    );
  }

  if (resolvedIds.length === 0) {
    return NextResponse.json(
      { error: "All circuits in this tier have reached their target" },
      { status: 403 },
    );
  }

  const missingCircuit = resolvedIds.find(
    (circuitId) => !allCircuits.some((circuit) => circuit.id === circuitId),
  );
  if (missingCircuit) {
    return NextResponse.json(
      { error: `Circuit not found: ${missingCircuit}` },
      { status: 404 },
    );
  }

  const now = Date.now();
  const positions: QueuePosition[] = [];
  for (const circuitId of resolvedIds) {
    const lockKey = `${config.storage.manifestPath}:lock:${circuitId}`;
    const lockToken = crypto.randomUUID();
    const locked = await acquireLock(lockKey, lockToken);
    if (!locked) {
      return NextResponse.json(
        { error: "Circuit queue busy. Please retry." },
        { status: 409 },
      );
    }

    try {
      const circuit = await getCircuitState(circuitId);
      const key = circuitStatePath(config.storage.circuitStatePrefix, circuitId);

      const pruned = pruneExpiredEntries(
        circuit.queue,
        config.queueTimeoutSeconds,
        now,
      );
      const prunedCount = circuit.queue.length - pruned.length;
      circuit.queue = pruned;

      let index = circuit.queue.findIndex(
        (entry) => entry.participantId === participantId,
      );

      if (index === -1) {
        circuit.queue.push({
          participantId,
          joinedAt: now,
        });
        index = circuit.queue.length - 1;
        await setJson(key, circuit);
      } else if (prunedCount > 0) {
        await setJson(key, circuit);
      }

      positions.push({
        participantId,
        circuitId,
        position: index + 1,
        estimatedWaitSeconds: (index + 1) * 60,
      });
    } finally {
      await releaseLock(lockKey, lockToken);
    }
  }

  return NextResponse.json({ positions });
}

export async function GET(request: NextRequest) {
  const participant = await getParticipant(request);
  if (!participant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { participantId } = participant;

  const circuitId = request.nextUrl.searchParams.get("circuitId");

  if (!circuitId) {
    return NextResponse.json(
      { error: "circuitId is required" },
      { status: 400 },
    );
  }

  const config = getCeremonyConfig();
  const knownCircuit = config.circuits.find((c) => c.id === circuitId);
  if (!knownCircuit) {
    return NextResponse.json(
      { error: `Circuit not found: ${circuitId}` },
      { status: 404 },
    );
  }
  const circuit = await getCircuitState(circuitId);

  const now = Date.now();
  const pruned = pruneExpiredEntries(
    circuit.queue,
    config.queueTimeoutSeconds,
    now,
  );
  if (pruned.length < circuit.queue.length) {
    circuit.queue = pruned;
    await setJson(
      circuitStatePath(config.storage.circuitStatePrefix, circuitId),
      circuit,
    );
  }

  const index = circuit.queue.findIndex(
    (entry) => entry.participantId === participantId,
  );

  if (index === -1) {
    return NextResponse.json({ error: "Not in queue" }, { status: 404 });
  }

  return NextResponse.json({
    participantId,
    circuitId,
    position: index + 1,
    estimatedWaitSeconds: (index + 1) * 60,
  });
}

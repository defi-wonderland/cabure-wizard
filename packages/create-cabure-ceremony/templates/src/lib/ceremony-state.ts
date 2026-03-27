import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateInitialZkey } from "@wonderland/cabure-crypto";
import {
  getCeremonyConfig,
  type CeremonyCircuitConfig,
  type CeremonyTierConfig,
  type TierId,
} from "./ceremony-config";
import { getJson, listRange } from "./kv-store";

const GENESIS_CHAIN_HASH = `0x${"0".repeat(64)}`;

export interface ContributionReceipt {
  circuitId: string;
  participantId: string;
  contributionIndex: number;
  contributionHash: string;
  clientContributionHash: string | null;
  chainHash: string;
  timestamp: number;
}

export interface QueueEntry {
  participantId: string;
  joinedAt: number;
}

export interface CircuitState {
  id: string;
  totalContributions: number;
  latestContributionHash: string | null;
  chainHash: string;
  queue: QueueEntry[];
  currentZkeyPath: string;
  currentZkeyUrl: string;
}

export interface ManifestState {
  ceremonyName: string;
  targetContributions: number;
  endDate: string | null;
  startedAt: number;
  circuits: Array<{ id: string }>;
  beaconHash?: string;
  beaconApplied?: boolean;
  finalizedAt?: number;
}

export async function getManifest(): Promise<ManifestState> {
  const config = getCeremonyConfig();
  const manifest = await getJson<ManifestState>(config.storage.manifestPath);
  if (!manifest) {
    throw new Error("Ceremony not initialized. Run init:ceremony.");
  }
  return manifest;
}

export async function getCircuitState(
  circuitId: string,
): Promise<CircuitState> {
  const config = getCeremonyConfig();
  const state = await getJson<CircuitState>(
    circuitStatePath(config.storage.circuitStatePrefix, circuitId),
  );
  if (!state) {
    throw new Error(
      `Missing circuit state for ${circuitId}. Run init:ceremony.`,
    );
  }
  return state;
}

export async function getAllCircuitStates(): Promise<CircuitState[]> {
  const config = getCeremonyConfig();
  return await Promise.all(
    config.circuits.map((circuit) => getCircuitState(circuit.id)),
  );
}

export async function getReceipts(): Promise<ContributionReceipt[]> {
  const config = getCeremonyConfig();
  return await listRange<ContributionReceipt>(config.storage.receiptsPath);
}

export function isCeremonyActive(
  manifest: ManifestState,
  allCircuits: CircuitState[],
): boolean {
  const config = getCeremonyConfig();
  const now = Date.now();
  const endDateMs = manifest.endDate
    ? Date.parse(`${manifest.endDate}T23:59:59Z`)
    : null;
  if (endDateMs !== null && now > endDateMs) return false;
  return config.circuits.some((c) => {
    const state = allCircuits.find((s) => s.id === c.id);
    return !state || state.totalContributions < c.targetContributions;
  });
}

/**
 * Resolves which circuits a participant should queue for given their selected
 * tier. Drops circuits that have already reached their per-circuit target and
 * backfills with the most underserved circuits from the full config, up to the
 * original tier's circuit count.
 */
export function selectCircuitsForTier(
  tierId: TierId,
  tiers: CeremonyTierConfig[],
  circuitConfigs: CeremonyCircuitConfig[],
  allCircuits: CircuitState[],
): string[] {
  const tier = tiers.find((t) => t.id === tierId);
  if (!tier) return [];
  const maxCount = tier.circuitIds.length;

  const needed = tier.circuitIds.filter((id) => {
    const conf = circuitConfigs.find((c) => c.id === id);
    const state = allCircuits.find((s) => s.id === id);
    if (!conf || !state) return true;
    return state.totalContributions < conf.targetContributions;
  });

  if (needed.length >= maxCount) return needed;

  const alreadyIncluded = new Set(needed);
  const candidates = circuitConfigs
    .filter((c) => !alreadyIncluded.has(c.id))
    .map((c) => {
      const state = allCircuits.find((s) => s.id === c.id);
      const remaining =
        c.targetContributions - (state?.totalContributions ?? 0);
      return { id: c.id, remaining };
    })
    .filter((c) => c.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  const backfill = candidates
    .slice(0, maxCount - needed.length)
    .map((c) => c.id);

  return [...needed, ...backfill];
}

export function computeChainHash(options: {
  previousChainHash: string;
  contributionHash: string;
  participantId: string;
  timestamp: number;
}): string {
  const input = `${options.previousChainHash}:${options.contributionHash}:${options.participantId}:${options.timestamp}`;
  const digest = createHash("sha256").update(input).digest("hex");
  return `0x${digest}`;
}

export async function generateGenesisZkey(artifacts: {
  r1csPath: string;
  ptauPath: string;
}): Promise<Uint8Array> {
  const r1cs = await readCircuitBytes(artifacts.r1csPath);
  const ptau = await readCircuitBytes(artifacts.ptauPath);
  return await generateInitialZkey(ptau, r1cs);
}

export function createCircuitState(options: {
  id: string;
  zkeyPath: string;
  zkeyUrl: string;
}): CircuitState {
  return {
    id: options.id,
    totalContributions: 0,
    latestContributionHash: null,
    chainHash: GENESIS_CHAIN_HASH,
    queue: [],
    currentZkeyPath: options.zkeyPath,
    currentZkeyUrl: options.zkeyUrl,
  };
}

export function pruneExpiredEntries(
  queue: QueueEntry[],
  timeoutSeconds: number,
  now: number = Date.now(),
): QueueEntry[] {
  const timeoutMs = timeoutSeconds * 1000;
  return queue.filter((entry) => now - entry.joinedAt < timeoutMs);
}

export function circuitStatePath(prefix: string, circuitId: string): string {
  return `${prefix}:${circuitId}`;
}

export async function readCircuitBytes(
  relativePath: string,
): Promise<Uint8Array> {
  const fullPath = path.resolve(process.cwd(), relativePath);
  try {
    const data = await readFile(fullPath);
    return new Uint8Array(data);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `Missing circuit artifact: ${relativePath}. Add it to the circuits/ folder.`,
      );
    }
    throw error;
  }
}

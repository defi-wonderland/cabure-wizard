import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadEnvConfig } from "@next/env";
import {
  applyBeacon,
  exportVerificationKey,
  verify,
} from "@wonderland/cabure-crypto";

import { getJson, listRange } from "@/lib/kv-store";
import { ceremonyConfig } from "../ceremony.config";

// snarkjs/fastfile writes circuit data to temp files and does not always close
// file handles explicitly. Node 25+ treats GC-collected handles as a hard
// error instead of a deprecation warning. Suppress it here since the data has
// already been read and processed by the time GC fires.
process.on("uncaughtException", (error: NodeJS.ErrnoException) => {
  if (
    error.code === "ERR_INVALID_STATE" &&
    error.message.includes("FileHandle")
  ) {
    return;
  }
  console.error(error);
  process.exit(1);
});

const DEFAULT_BEACON_API_URL = "https://ethereum-beacon-api.publicnode.com";

interface CircuitState {
  id: string;
  totalContributions: number;
  latestContributionHash: string | null;
  chainHash: string;
  queue: Array<{ participantId: string; joinedAt: number }>;
  currentZkeyPath: string;
  currentZkeyUrl: string;
}

interface ManifestState {
  ceremonyName: string;
  targetContributions: number;
  endDate: string | null;
  startedAt: number;
  circuits: Array<{ id: string }>;
  beaconHash?: string;
  beaconApplied?: boolean;
  finalizedAt?: number;
}

interface ContributionReceipt {
  circuitId: string;
  participantId: string;
  contributionIndex: number;
  contributionHash: string;
  clientContributionHash: string | null;
  chainHash: string;
  timestamp: number;
}

const OUTPUT_DIR = path.resolve(process.cwd(), "public", "finalize");

interface BeaconResult {
  hex: string;
  source: string;
  slot?: number;
}

function parseBeaconFlag(): string | null {
  const idx = process.argv.indexOf("--beacon");
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(
      "--beacon requires a hex value (e.g. --beacon 0xabc123...)",
    );
  }
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 16) {
    throw new Error(
      "Invalid beacon: provide at least 8 bytes of hex (e.g. --beacon 0xabc123...)",
    );
  }
  return hex;
}

function parseBeaconSlotFlag(): number | null {
  const idx = process.argv.indexOf("--beacon-slot");
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(
      "--beacon-slot requires a slot number (e.g. --beacon-slot 7325000)",
    );
  }
  const slot = parseInt(value, 10);
  if (isNaN(slot) || slot <= 0) {
    throw new Error("Invalid beacon slot: provide a positive integer.");
  }
  return slot;
}

async function fetchRandaoReveal(
  slotOrTag: string,
): Promise<{ hex: string; slot: number }> {
  const beaconApiUrl =
    process.env.BEACON_API_URL?.trim() || DEFAULT_BEACON_API_URL;
  const url = `${beaconApiUrl}/eth/v2/beacon/blocks/${slotOrTag}`;

  console.log(`  Fetching RANDAO reveal from ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch beacon block (${slotOrTag}): ${response.status} ${response.statusText}. ` +
        "Set BEACON_API_URL to use a different beacon node.",
    );
  }

  const json = (await response.json()) as {
    data: {
      message: {
        slot: string;
        body: { randao_reveal: string };
      };
    };
  };

  const randaoReveal = json.data?.message?.body?.randao_reveal;
  const resolvedSlot = Number(json.data?.message?.slot);

  if (!randaoReveal) {
    throw new Error(`No RANDAO reveal found in beacon block at ${slotOrTag}.`);
  }

  const hex = randaoReveal.startsWith("0x")
    ? randaoReveal.slice(2)
    : randaoReveal;

  return { hex, slot: resolvedSlot };
}

async function resolveBeacon(): Promise<BeaconResult> {
  const explicitHex = parseBeaconFlag();
  if (explicitHex) {
    return { hex: explicitHex, source: "user-supplied (--beacon)" };
  }

  if (process.argv.includes("--random-beacon")) {
    return {
      hex: randomBytes(32).toString("hex"),
      source: "random (crypto.randomBytes) -- not publicly verifiable",
    };
  }

  const explicitSlot = parseBeaconSlotFlag();
  const slotOrTag = explicitSlot ? String(explicitSlot) : "finalized";
  const label = explicitSlot
    ? `Ethereum beacon chain slot ${explicitSlot}`
    : "Ethereum beacon chain (latest finalized slot)";

  console.log(`Resolving beacon from ${label}...`);
  const { hex, slot } = await fetchRandaoReveal(slotOrTag);
  return {
    hex,
    source: `RANDAO reveal from Ethereum beacon chain slot ${slot}`,
    slot,
  };
}

async function readArtifact(relativePath: string): Promise<Uint8Array> {
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

async function downloadZkey(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download zkey from ${url}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  loadEnvConfig(process.cwd(), true);

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error(
      "KV_REST_API_URL and KV_REST_API_TOKEN are required. Pull env vars from Vercel or set them in .env/.env.local.",
    );
  }

  const { storage, circuits: circuitConfigs } = ceremonyConfig;

  const manifest = await getJson<ManifestState>(storage.manifestPath);
  if (!manifest) {
    throw new Error("Ceremony not initialized. Run init:ceremony first.");
  }

  if (manifest.beaconApplied) {
    throw new Error(
      "Ceremony already finalized. Beacon was applied on " +
        new Date(manifest.finalizedAt ?? 0).toISOString(),
    );
  }

  const circuitStates: CircuitState[] = await Promise.all(
    circuitConfigs.map(async (c) => {
      const state = await getJson<CircuitState>(
        `${storage.circuitStatePrefix}:${c.id}`,
      );
      if (!state) {
        throw new Error(
          `Missing circuit state for ${c.id}. Run init:ceremony.`,
        );
      }
      return state;
    }),
  );

  const totalContributions = circuitStates.reduce(
    (sum, c) => sum + c.totalContributions,
    0,
  );

  const endDateMs = manifest.endDate
    ? Date.parse(`${manifest.endDate}T23:59:59Z`)
    : null;
  const now = Date.now();
  const isActive =
    (endDateMs === null || now <= endDateMs) &&
    totalContributions < manifest.targetContributions;

  const force = process.argv.includes("--force");
  if (isActive && !force) {
    throw new Error(
      `Ceremony is still active (${totalContributions}/${manifest.targetContributions} contributions). ` +
        "Wait for completion or use --force to finalize early.",
    );
  }

  if (totalContributions === 0) {
    throw new Error(
      "No contributions have been made. Cannot finalize an empty ceremony.",
    );
  }

  const beacon = await resolveBeacon();

  console.log(`Beacon source: ${beacon.source}`);
  if (beacon.slot !== undefined) {
    console.log(`Beacon slot:   ${beacon.slot}`);
  }
  console.log(`Beacon value:  0x${beacon.hex}`);
  console.log();

  const beaconHex = beacon.hex;

  await mkdir(OUTPUT_DIR, { recursive: true });

  const circuitSummaries: Array<{
    circuitId: string;
    totalContributions: number;
    finalChainHash: string;
    finalZkeyPath: string;
    verificationKey: object;
  }> = [];

  for (const circuitConfig of circuitConfigs) {
    const state = circuitStates.find((s) => s.id === circuitConfig.id)!;

    if (state.totalContributions === 0) {
      console.log(`Skipping ${circuitConfig.id} — no contributions received.`);
      continue;
    }

    console.log(
      `[${circuitConfig.id}] Finalizing (${state.totalContributions} contributions)...`,
    );

    console.log(`  Downloading current zkey...`);
    const currentZkey = await downloadZkey(state.currentZkeyUrl);

    console.log(`  Applying beacon...`);
    const finalZkey = await applyBeacon(currentZkey, beaconHex);

    console.log(`  Loading circuit artifacts for verification...`);
    const r1cs = await readArtifact(circuitConfig.artifacts.r1csPath);
    const ptau = await readArtifact(circuitConfig.artifacts.ptauPath);

    console.log(`  Verifying finalized zkey...`);
    const isValid = await verify(r1cs, ptau, finalZkey);
    if (!isValid) {
      throw new Error(
        `Verification failed for ${circuitConfig.id}. The finalized zkey is invalid.`,
      );
    }
    console.log(`  Verification passed.`);

    console.log(`  Exporting verification key...`);
    const vkey = await exportVerificationKey(finalZkey);

    const vkeyFile = `${circuitConfig.id}.vkey.json`;
    const vkeyPath = path.join(OUTPUT_DIR, vkeyFile);
    await writeFile(vkeyPath, JSON.stringify(vkey, null, 2));
    console.log(`  Saved verification key to public/finalize/${vkeyFile}`);

    const finalZkeyFile = `${circuitConfig.id}.final.zkey`;
    const finalZkeyPath = path.join(OUTPUT_DIR, finalZkeyFile);
    await writeFile(finalZkeyPath, Buffer.from(finalZkey));
    console.log(`  Saved finalized zkey to public/finalize/${finalZkeyFile}`);

    circuitSummaries.push({
      circuitId: circuitConfig.id,
      totalContributions: state.totalContributions,
      finalChainHash: state.chainHash,
      finalZkeyPath: `public/finalize/${finalZkeyFile}`,
      verificationKey: vkey,
    });

    console.log();
  }

  console.log("Generating transcript...");
  const finalizedAt = Date.now();
  const receipts = await listRange<ContributionReceipt>(storage.receiptsPath);

  const transcript = {
    ceremony: {
      name: manifest.ceremonyName,
      targetContributions: manifest.targetContributions,
      startedAt: manifest.startedAt,
      endDate: manifest.endDate,
      beaconHash: `0x${beaconHex}`,
      beaconSource: beacon.source,
      ...(beacon.slot !== undefined && { beaconSlot: beacon.slot }),
      finalizedAt,
    },
    circuits: circuitSummaries,
    receipts,
  };

  const transcriptPath = path.join(OUTPUT_DIR, "transcript.json");
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2));
  console.log(`Transcript saved to public/finalize/transcript.json`);

  console.log();
  console.log("=== Ceremony finalized ===");
  console.log(`  Beacon:  0x${beaconHex}`);
  console.log(`  Circuits finalized: ${circuitSummaries.length}`);
  console.log(`  Total contributions: ${totalContributions}`);
  console.log(`  Transcript: public/finalize/transcript.json`);
  console.log(`  Verification keys: public/finalize/*.vkey.json`);
  console.log(`  Finalized zkeys:   public/finalize/*.final.zkey`);

  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

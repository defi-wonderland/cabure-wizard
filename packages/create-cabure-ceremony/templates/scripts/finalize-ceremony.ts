import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadEnvConfig } from "@next/env";
import {
  applyBeacon,
  exportVerificationKey,
  type Groth16VerificationKey,
  verify,
  verifyChainForCircuit,
} from "@wonderland/cabure-crypto";

import { FINALIZE_LEASE_MS, getEndDateDeadlineMs } from "@/lib/ceremony-state";
import { getJson, listRange, setJson } from "@/lib/kv-store";
import { ceremonyConfig } from "../ceremony.config";

// snarkjs/fastfile writes circuit data to temp files and does not always close
// file handles explicitly. Node 25+ treats GC-collected handles as a hard
// error instead of a deprecation warning. Suppress it here since the data has
// already been read and processed by the time GC fires.
//
// This handler does not touch the manifest. Earlier versions cleared the
// finalization seal from here and from SIGINT/SIGTERM, but that made the signal
// handler a second writer racing the main thread around the beaconApplied write:
// a signal could either revert a just-committed seal, or be suppressed and leave
// the ceremony frozen. The seal is now cleared only from the main catch path
// (in-process failures); any abrupt termination is recovered by the lease in
// isCeremonyActive, which reopens the ceremony once finalizingAt goes stale.
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
  initialZkeyHash: string;
  initialZkeyUrl: string;
}

interface ManifestState {
  ceremonyName: string;
  targetContributions: number;
  endDate: string | null;
  startedAt: number;
  circuits: Array<{ id: string }>;
  beaconHash?: string;
  beaconApplied?: boolean;
  finalizingAt?: number;
  finalizeId?: string;
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

interface ResolvedBeacon {
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
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 64) {
    throw new Error(
      "Invalid beacon: provide at least 32 bytes of hex (e.g. --beacon 0x<64 hex chars>)",
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

async function resolveBeacon(): Promise<ResolvedBeacon> {
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

// Must match how init-ceremony records the genesis hash, so the integrity
// check below compares like for like.
function sha256hex(data: Uint8Array): string {
  return `0x${createHash("sha256").update(data).digest("hex")}`;
}

// Read every circuit's state from KV. Called for the readiness check, then
// again after sealing to pick up contributions that landed just before it.
async function loadCircuitStates(
  circuitConfigs: Array<{ id: string }>,
  circuitStatePrefix: string,
): Promise<CircuitState[]> {
  return await Promise.all(
    circuitConfigs.map(async (c) => {
      const state = await getJson<CircuitState>(`${circuitStatePrefix}:${c.id}`);
      if (!state) {
        throw new Error(`Missing circuit state for ${c.id}. Run init:ceremony.`);
      }
      return state;
    }),
  );
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

  const initialStates = await loadCircuitStates(
    circuitConfigs,
    storage.circuitStatePrefix,
  );

  const initialTotal = initialStates.reduce(
    (sum, c) => sum + c.totalContributions,
    0,
  );
  const totalTarget = circuitConfigs.reduce(
    (sum, c) => sum + c.targetContributions,
    0,
  );

  if (initialTotal === 0) {
    throw new Error(
      "No contributions have been made. Cannot finalize an empty ceremony.",
    );
  }

  const incompleteCircuits = circuitConfigs
    .map((config) => {
      const state = initialStates.find((s) => s.id === config.id);
      return {
        id: config.id,
        total: state?.totalContributions ?? 0,
        target: config.targetContributions,
      };
    })
    .filter((c) => c.total < c.target);

  const endDateMs = getEndDateDeadlineMs(manifest.endDate);
  const deadlinePassed = endDateMs !== null && Date.now() > endDateMs;
  const ceremonyActive =
    incompleteCircuits.length > 0 && (endDateMs === null || !deadlinePassed);

  const force = process.argv.includes("--force");
  if (ceremonyActive) {
    const deadlineLine =
      endDateMs === null
        ? "Deadline: not configured"
        : `Deadline: ${deadlinePassed ? "passed" : "not passed"} (${manifest.endDate})`;
    const incompleteLine =
      incompleteCircuits.length > 0
        ? `Incomplete circuits: ${incompleteCircuits
            .map((c) => `${c.id}: ${c.total}/${c.target}`)
            .join(", ")}`
        : null;
    const statusLines = [
      `Progress: ${initialTotal}/${totalTarget} contributions`,
      deadlineLine,
      ...(incompleteLine ? [incompleteLine] : []),
    ];

    if (!force) {
      throw new Error(
        [
          "Ceremony is not ready to finalize.",
          ...statusLines,
          "Use --force to finalize before these conditions are met.",
        ].join("\n"),
      );
    }

    console.warn(
      [
        "Warning: finalizing early because --force was provided.",
        ...statusLines,
        "",
      ].join("\n"),
    );
  }

  // Refuse to start if another finalizer is already running (finalizingAt set,
  // still within the lease). Best-effort, not atomic with the write below.
  // --force overrides, e.g. to retry after a hard crash left finalizingAt set.
  if (
    !force &&
    manifest.finalizingAt !== undefined &&
    Date.now() - manifest.finalizingAt < FINALIZE_LEASE_MS
  ) {
    throw new Error(
      "Another finalization is already in progress (started " +
        new Date(manifest.finalizingAt).toISOString() +
        "). Wait for it to finish, or pass --force to override.",
    );
  }

  // Seal before snapshotting: isCeremonyActive returns false once finalizingAt
  // is set, so the API stops accepting work. The re-read inside the try then
  // catches any contribution that landed just before the seal; otherwise it
  // would update the live zkey but be dropped from the final artifacts.
  // finalizeId tags the seal so only this run can clear it (see reopenCeremony).
  const finalizingAt = Date.now();
  const finalizeId = randomUUID();
  await setJson(storage.manifestPath, { ...manifest, finalizingAt, finalizeId });

  // Reopen the ceremony if this run fails before finalizing. Re-read so fields
  // another process set survive, and clear the seal only when it is still ours
  // and not yet permanent: bail if beaconApplied is set, or if finalizeId has
  // changed (a concurrent --force run took over the seal — clearing it would
  // reopen while that run is still producing artifacts).
  const reopenCeremony = async () => {
    const latest =
      (await getJson<ManifestState>(storage.manifestPath)) ?? manifest;
    if (latest.beaconApplied || latest.finalizeId !== finalizeId) return;
    const reopened = { ...latest };
    delete reopened.finalizingAt;
    delete reopened.finalizeId;
    await setJson(storage.manifestPath, reopened);
  };

  try {
    const circuitStates = await loadCircuitStates(
      circuitConfigs,
      storage.circuitStatePrefix,
    );
    const totalContributions = circuitStates.reduce(
      (sum, c) => sum + c.totalContributions,
      0,
    );

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
      finalContributionHash: string;
      finalZkeyHash: string;
      finalZkeyPath: string;
      verificationKey: Groth16VerificationKey;
    }> = [];

    for (const circuitConfig of circuitConfigs) {
      const state = circuitStates.find((s) => s.id === circuitConfig.id)!;

      if (state.totalContributions === 0) {
        console.log(
          `Skipping ${circuitConfig.id} — no contributions received.`,
        );
        continue;
      }

      console.log(
        `[${circuitConfig.id}] Finalizing (${state.totalContributions} contributions)...`,
      );

      console.log(`  Downloading current zkey...`);
      const currentZkey = await downloadZkey(state.currentZkeyUrl);

      console.log(`  Loading circuit artifacts for verification...`);
      const r1cs = await readArtifact(circuitConfig.artifacts.r1csPath);
      const ptau = await readArtifact(circuitConfig.artifacts.ptauPath);

      // H-1: verify the whole chain from the pinned genesis to the latest zkey
      // BEFORE applying the beacon. The beacon is irreversible, so an invalid
      // chain has to be caught first — verifying only the post-beacon zkey (the
      // old order) cannot tell whether the chain that fed it was honest.
      if (!state.initialZkeyUrl || !state.initialZkeyHash) {
        throw new Error(
          `Circuit ${circuitConfig.id} has no pinned genesis (initialZkeyUrl/Hash). ` +
            "It was initialized before genesis pinning; re-run init:ceremony.",
        );
      }

      console.log(`  Downloading pinned genesis zkey...`);
      const genesisZkey = await downloadZkey(state.initialZkeyUrl);

      // The chain is only as trustworthy as the genesis we root it in. Confirm
      // the downloaded genesis still matches the hash pinned at init, so a
      // swapped blob cannot pass the chain check.
      const genesisHash = sha256hex(genesisZkey);
      if (genesisHash !== state.initialZkeyHash) {
        throw new Error(
          `Genesis zkey for ${circuitConfig.id} does not match the hash pinned at ` +
            `init. Expected ${state.initialZkeyHash}, got ${genesisHash}.`,
        );
      }

      console.log(`  Verifying contribution chain (genesis → latest)...`);
      const chainValid = await verifyChainForCircuit(
        r1cs,
        ptau,
        genesisZkey,
        currentZkey,
      );
      if (!chainValid) {
        throw new Error(
          `Contribution chain for ${circuitConfig.id} failed verification. ` +
            "Refusing to apply the beacon to an invalid chain.",
        );
      }
      console.log(`  Chain verification passed.`);

      // TODO(C-1): the chain verify above only proves current.zkey is SOME valid
      // descendant of the pinned genesis, not that it is the chain we recorded.
      // An attacker with blob write access but no KV access (a leaked
      // BLOB_READ_WRITE_TOKEN) can overwrite current.zkey with a self-generated
      // chain rooted at the real genesis and pass here. Close this by comparing
      // the embedded transcript (snarkjs zKey.exportJson -> contributions)
      // against the contribution count and per-contribution hashes recorded in
      // KV before applying the beacon. Needs the contribute route to record the
      // server-computed Blake2b contribution hash per step first.

      console.log(`  Applying beacon...`);
      const beaconResult = await applyBeacon(currentZkey, beaconHex);
      const finalZkey = beaconResult.zkey;
      console.log(
        `  Beacon contribution hash: ${beaconResult.contributionHash}`,
      );
      console.log(`  Final zkey hash: ${beaconResult.zkeyHash}`);

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
        finalContributionHash: beaconResult.contributionHash,
        finalZkeyHash: beaconResult.zkeyHash,
        finalZkeyPath: `public/finalize/${finalZkeyFile}`,
        verificationKey: vkey,
      });

      console.log();
    }

    console.log("Generating transcript...");
    const finalizedAt = Date.now();
    const receipts = await listRange<ContributionReceipt>(
      storage.receiptsPath,
    );

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

    // Permanent seal. Written last, after every artifact, so a mid-run failure
    // leaves the ceremony unsealed for the catch to reopen. The start-of-run
    // snapshot has no finalizingAt/finalizeId, so this write drops them too.
    await setJson(storage.manifestPath, {
      ...manifest,
      beaconApplied: true,
      beaconHash: `0x${beaconHex}`,
      finalizedAt,
    });

    console.log();
    console.log("=== Ceremony finalized ===");
    console.log(`  Beacon:  0x${beaconHex}`);
    console.log(`  Circuits finalized: ${circuitSummaries.length}`);
    console.log(`  Total contributions: ${totalContributions}`);
    console.log(`  Transcript: public/finalize/transcript.json`);
    console.log(`  Verification keys: public/finalize/*.vkey.json`);
    console.log(`  Finalized zkeys:   public/finalize/*.final.zkey`);
  } catch (error) {
    // Finalization failed before the permanent seal. Reopen the ceremony so it
    // does not freeze on a transient error, then rethrow. reopenCeremony clears
    // only our own seal, so this is safe even if a concurrent --force run is in
    // progress.
    await reopenCeremony();
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

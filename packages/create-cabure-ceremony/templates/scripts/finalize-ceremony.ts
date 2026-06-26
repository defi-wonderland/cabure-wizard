import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadEnvConfig } from "@next/env";
import {
  applyBeacon,
  exportVerificationKey,
  type Groth16VerificationKey,
  parseMpcParams,
  verify,
  verifyChainForCircuit,
} from "@wonderland/cabure-crypto";

import {
  type BeaconCommitment,
  getEndDateDeadlineMs,
} from "@/lib/ceremony-state";
import { getJson, listRange, setJson } from "@/lib/kv-store";
import { ceremonyConfig } from "../ceremony.config";

// snarkjs/fastfile writes circuit data to temp files and does not always close
// file handles explicitly. Node 25+ treats GC-collected handles as a hard
// error instead of a deprecation warning. Suppress it here since the data has
// already been read and processed by the time GC fires.
//
// This handler does not touch the manifest. Earlier versions cleared the
// finalization seal from here and from SIGINT/SIGTERM, but that made the signal
// handler a second writer racing the main thread around the beaconApplied write.
// The seal is now cleared only from the main catch path (in-process failures).
// An abrupt stop leaves the ceremony sealed on purpose; the operator recovers
// with finalize --force or reset:ceremony (see isCeremonyActive).
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
  beaconCommitment: BeaconCommitment;
  // Resolved beacon, persisted at seal time (beaconHash is 0x-prefixed). A
  // recovery run reuses it so the beacon is locked once finalization starts and
  // cannot be re-rolled. Cleared only by reset:ceremony.
  beaconHash?: string;
  beaconSource?: string;
  beaconSlot?: number;
  beaconVerifiable?: boolean;
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
  // Server-recomputed Blake2b hash (snarkjs hashPubKey) of the contribution.
  // The finalize re-walk matches the final zkey's embedded hashes against this.
  serverContributionHash: string;
  chainHash: string;
  timestamp: number;
}

const OUTPUT_DIR = path.resolve(process.cwd(), "public", "finalize");

// All current Ethereum networks use 12-second slots.
const SECONDS_PER_SLOT = 12;

interface ResolvedBeacon {
  hex: string;
  source: string;
  slot?: number;
  // false only for a forced manual --beacon override; recorded so the
  // transcript flags a finalization that outsiders cannot reproduce.
  verifiable: boolean;
}

function beaconApiBase(): string {
  return process.env.BEACON_API_URL?.trim() || DEFAULT_BEACON_API_URL;
}

// A stalled beacon node must not hang finalize:ceremony forever. The timeout is
// per request, not global: fetchRandaoRevealFrom can make one request per
// missed slot, and each gets its own budget. Re-running after a timeout is safe
// because a sealed run reuses the persisted beacon (see resolveBeacon).
const BEACON_FETCH_TIMEOUT_MS = 30_000;

async function beaconFetch(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(BEACON_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `Beacon API request timed out after ` +
          `${BEACON_FETCH_TIMEOUT_MS / 1000}s (${url}). Retry, or set ` +
          "BEACON_API_URL to a different node.",
      );
    }
    throw error;
  }
}

async function beaconGet<T>(apiPath: string): Promise<T> {
  const url = `${beaconApiBase()}${apiPath}`;
  const response = await beaconFetch(url);
  if (!response.ok) {
    throw new Error(
      `Beacon API request failed (${apiPath}): ${response.status} ` +
        `${response.statusText}. Set BEACON_API_URL to use a different node.`,
    );
  }
  return (await response.json()) as T;
}

// The committed beacon target is a wall-clock time. Convert it to a slot using
// the network's own genesis time, so this works on any network the configured
// beacon node serves (not just mainnet).
async function fetchGenesisTimeSec(): Promise<number> {
  const json = await beaconGet<{ data: { genesis_time: string } }>(
    "/eth/v1/beacon/genesis",
  );
  // Validate at the source: an unvalidated Number() of a bad response gives NaN,
  // which flows into the targetSlot math and only surfaces as a confusing "No
  // block found" error far downstream. Fail clearly here instead.
  const genesisTimeSec = Number(json.data?.genesis_time);
  if (!Number.isFinite(genesisTimeSec) || genesisTimeSec < 0) {
    throw new Error("Beacon API returned an invalid genesis_time.");
  }
  return genesisTimeSec;
}

async function fetchFinalizedSlot(): Promise<number> {
  const json = await beaconGet<{
    data: { header: { message: { slot: string } } };
  }>("/eth/v1/beacon/headers/finalized");
  const slot = Number(json.data?.header?.message?.slot);
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error("Beacon API returned an invalid finalized slot.");
  }
  return slot;
}

// The RANDAO reveal of the first block at or after `fromSlot`.
//
// We read the reveal from the block (not the accumulated mix from beacon
// state) because public beacon nodes prune historical state within ~a day,
// while blocks stay available. Finalization can run days after the committed
// cutoff, so the committed slot's state may be long gone — its block is not.
//
// A slot can be missed (no block proposed); the API then 404s for that slot,
// so we walk forward to the next slot that has a block. This stays
// deterministic: a verifier recomputes "first block at/after the committed
// slot" and gets the same value.
async function fetchRandaoRevealFrom(
  fromSlot: number,
  finalizedSlot: number,
): Promise<{ hex: string; slot: number }> {
  for (let slot = fromSlot; slot <= finalizedSlot; slot++) {
    const url = `${beaconApiBase()}/eth/v2/beacon/blocks/${slot}`;
    const response = await beaconFetch(url);
    if (response.status === 404) continue; // missed slot, try the next one
    if (!response.ok) {
      throw new Error(
        `Beacon API request failed (blocks/${slot}): ${response.status} ` +
          `${response.statusText}. Set BEACON_API_URL to use a different node.`,
      );
    }
    const json = (await response.json()) as {
      data: { message: { body: { randao_reveal: string } } };
    };
    const reveal = json.data?.message?.body?.randao_reveal;
    if (!reveal) {
      throw new Error(`No randao_reveal in beacon block at slot ${slot}.`);
    }
    const hex = reveal.startsWith("0x") ? reveal.slice(2) : reveal;
    return { hex, slot };
  }
  throw new Error(
    `No block found between committed slot ${fromSlot} and the finalized slot ` +
      `${finalizedSlot}. Wait for more slots to finalize, then retry.`,
  );
}

function parseManualBeacon(): string | null {
  const idx = process.argv.indexOf("--beacon");
  if (idx === -1) return null;
  // A hand-picked beacon bypasses the committed target, so the operator could
  // grind it. Only allow it behind both --force and an explicit acknowledgement,
  // for a forced early close where no committed slot exists yet. Requiring
  // --force keeps a manual beacon out of normal finalization runs, where the
  // committed target must win.
  if (!process.argv.includes("--force")) {
    throw new Error(
      "--beacon requires --force. A hand-picked beacon overrides the committed " +
        "target and is only for a forced early close.",
    );
  }
  if (!process.argv.includes("--unverifiable")) {
    throw new Error(
      "--beacon overrides the committed beacon target and is NOT publicly " +
        "verifiable. Pass --unverifiable to acknowledge this (intended only " +
        "for a forced early close).",
    );
  }
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--beacon requires a hex value (e.g. --beacon 0xabc...)");
  }
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 64) {
    throw new Error(
      "Invalid beacon: provide at least 32 bytes of hex (64 hex chars).",
    );
  }
  return hex;
}

// Precedence: a manual --beacon override wins (forced early close, marked
// unverifiable), then a beacon persisted by an interrupted run (reuse so
// recovery is reproducible and never re-rolls), then the committed target from
// init. The persisted beacon sits below --beacon so an operator can still force
// a value on recovery, but above the fetch so a normal recovery never re-rolls.
async function resolveBeacon(
  manifest: ManifestState,
  persisted: ResolvedBeacon | null,
): Promise<ResolvedBeacon> {
  const manualHex = parseManualBeacon();
  if (manualHex) {
    return {
      hex: manualHex,
      source: "user-supplied (--beacon, UNVERIFIABLE)",
      verifiable: false,
    };
  }

  if (persisted) {
    console.log(
      "Reusing the beacon committed by the interrupted finalize run.",
    );
    return persisted;
  }

  // init:ceremony always commits beaconCommitment, so a manifest without it is
  // corrupt, not a supported older ceremony. Do NOT advise re-running
  // init:ceremony here: it overwrites circuit state and clears receipts, which
  // would wipe an in-progress ceremony. The only non-destructive way forward is
  // a forced manual beacon.
  const commitment = manifest.beaconCommitment;
  if (!commitment) {
    throw new Error(
      "Manifest has no beaconCommitment (corrupt or hand-edited manifest). " +
        "Finalize manually with --force --beacon <hex> --unverifiable, or run " +
        "reset:ceremony to start over. Do not re-run init:ceremony on a live " +
        "ceremony; it wipes contributions.",
    );
  }

  console.log("Resolving committed beacon from the Ethereum beacon chain...");
  const cutoffSec = Math.floor(commitment.cutoffTimeMs / 1000);
  const genesisTimeSec = await fetchGenesisTimeSec();

  // First slot whose start time is at or after the committed cutoff.
  const targetSlot = Math.max(
    0,
    Math.ceil((cutoffSec - genesisTimeSec) / SECONDS_PER_SLOT),
  );

  // Only use a finalized slot: a non-finalized slot could still be reorged,
  // which would change the beacon value after the fact.
  const finalizedSlot = await fetchFinalizedSlot();
  if (targetSlot > finalizedSlot) {
    throw new Error(
      `Committed beacon slot ${targetSlot} ` +
        `(at/after ${new Date(commitment.cutoffTimeMs).toISOString()}) is not ` +
        `finalized yet (finalized slot is ${finalizedSlot}). Wait until it is ` +
        "finalized, then re-run finalize:ceremony.",
    );
  }

  const { hex, slot } = await fetchRandaoRevealFrom(targetSlot, finalizedSlot);
  const missedNote =
    slot !== targetSlot ? ` (committed slot ${targetSlot} was missed)` : "";
  return {
    hex,
    source: `committed RANDAO reveal at finalized block slot ${slot}${missedNote}`,
    slot,
    verifiable: true,
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

// Format a manifest timestamp for an operator message. The manifest comes from
// KV JSON with no runtime validation, so a corrupted or hand-edited value must
// not throw here and hide the message it is part of. A finite number can still
// be out of Date's range, which makes an Invalid Date whose toISOString raises,
// so check the constructed date before formatting.
function formatSealTime(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return "an unknown time";
}

// Read every circuit's state from KV. Called for the readiness check, then
// again after sealing to pick up contributions that landed just before it.
async function loadCircuitStates(
  circuitConfigs: Array<{ id: string }>,
  circuitStatePrefix: string,
): Promise<CircuitState[]> {
  return await Promise.all(
    circuitConfigs.map(async (c) => {
      const state = await getJson<CircuitState>(
        `${circuitStatePrefix}:${c.id}`,
      );
      if (!state) {
        throw new Error(
          `Missing circuit state for ${c.id}. Run init:ceremony.`,
        );
      }
      return state;
    }),
  );
}

// Seal the ceremony and commit the beacon in one manifest write.
// isCeremonyActive returns false once finalizingAt is set, so the API stops
// accepting work. finalizeId tags the seal so only this run can clear it (see
// reopenCeremony). The beacon is committed in the same write, which locks it: a
// recovery run reuses it instead of re-rolling. The local `manifest` is updated
// to match, because the ownership re-reads later fall back to it on a transient
// null read and would otherwise misreport a --force takeover.
async function sealCeremony(
  manifestPath: string,
  manifest: ManifestState,
  beacon: ResolvedBeacon,
): Promise<{ finalizeId: string }> {
  const finalizingAt = Date.now();
  const finalizeId = randomUUID();
  const sealed: ManifestState = {
    ...manifest,
    finalizingAt,
    finalizeId,
    beaconHash: `0x${beacon.hex}`,
    beaconSource: beacon.source,
    // Write the slot unconditionally (setJson drops an undefined value): a
    // recovery run that switches to a slotless beacon must clear a slot left
    // over from the prior seal, not inherit it via the ...manifest spread.
    beaconSlot: beacon.slot,
    // Persist verifiability so a recovery run that reuses the beacon keeps a
    // forced --unverifiable beacon flagged, instead of silently marking it
    // verifiable.
    beaconVerifiable: beacon.verifiable,
  };
  await setJson(manifestPath, sealed);
  Object.assign(manifest, sealed);
  return { finalizeId };
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

  // Concurrent finalization is not supported. --force is a single-operator
  // recovery override (take over a crashed run's seal), not a way to run two
  // finalizers at once. The guard below blocks the accidental case; the
  // finalizeId ownership checks elsewhere are best-effort hygiene, not atomic
  // guarantees. If two finalizers are forced to run together they can race on
  // manifest writes (non-atomic read-modify-write over KV) — recover with
  // reset:ceremony.
  //
  // Refuse to start if the ceremony is already sealed by a finalize run
  // (finalizingAt set). The seal never expires, so this also catches a run that
  // crashed earlier. --force takes over the seal (writes a fresh finalizeId
  // below) and resumes; reset:ceremony is the other recovery path.
  if (!force && manifest.finalizingAt !== undefined) {
    throw new Error(
      "Finalization is already in progress or was interrupted (sealed " +
        formatSealTime(manifest.finalizingAt) +
        "). Pass --force to take over and resume, or run reset:ceremony.",
    );
  }

  // Resolve the beacon before sealing. A prior interrupted run that already
  // sealed has its beacon in the manifest; reuse it so recovery reproduces the
  // same value and cannot re-roll. A fresh run resolves now and persists it with
  // the seal below. Resolving first also means a beacon-fetch failure leaves the
  // ceremony unsealed, with nothing to recover.
  const persistedBeacon: ResolvedBeacon | null = manifest.beaconHash
    ? {
        hex: manifest.beaconHash.replace(/^0x/, ""),
        source: manifest.beaconSource ?? "persisted beacon",
        slot: manifest.beaconSlot,
        // Fail safe: if the seal did not record verifiability (a corrupt or
        // pre-field manifest), treat the beacon as unverifiable. Defaulting to
        // true would suppress the operator warning and write a transcript that
        // claims verifiability the beacon may not have. Under-claiming is safe;
        // over-claiming is misleading.
        verifiable: manifest.beaconVerifiable ?? false,
      }
    : null;
  const beacon = await resolveBeacon(manifest, persistedBeacon);

  console.log(`Beacon source: ${beacon.source}`);
  if (beacon.slot !== undefined) {
    console.log(`Beacon slot:   ${beacon.slot}`);
  }
  console.log(`Beacon value:  0x${beacon.hex}`);
  if (!beacon.verifiable) {
    console.warn(
      "  WARNING: this beacon is operator-supplied and cannot be " +
        "independently verified.",
    );
  }
  console.log();

  // Seal before snapshotting the circuit states inside the try: the re-read
  // there then catches any contribution that landed just before the seal.
  const { finalizeId } = await sealCeremony(
    storage.manifestPath,
    manifest,
    beacon,
  );

  // Reopen if this run fails before finalizing. Clear the seal only while it is
  // still ours and not yet permanent: bail if beaconApplied is set or finalizeId
  // changed (a --force run took over). The persisted beacon is left in place so
  // a later finalize reuses it — the beacon stays locked across reopens and is
  // cleared only by reset:ceremony.
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
      // init:ceremony always pins the genesis, so missing initialZkeyUrl/Hash
      // means corrupt circuit state, not a supported older ceremony. Without the
      // pinned genesis the chain cannot be verified, so finalization cannot
      // proceed. Do NOT advise re-running init:ceremony: it overwrites circuit
      // state and clears receipts, wiping a live ceremony. reset:ceremony is the
      // only recovery, and it is the operator's explicit choice to start over.
      if (!state.initialZkeyUrl || !state.initialZkeyHash) {
        throw new Error(
          `Circuit ${circuitConfig.id} has no pinned genesis (initialZkeyUrl/Hash). ` +
            "The circuit state is corrupt and cannot be finalized. Run " +
            "reset:ceremony to start over; do not re-run init:ceremony on a " +
            "live ceremony, it wipes contributions.",
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

      // C-1: the chain verify above proves current.zkey is SOME valid chain from
      // the genesis, not that it is the one we recorded. An attacker with blob
      // write but no KV access (a leaked BLOB_READ_WRITE_TOKEN) could overwrite
      // current.zkey with a self-generated chain and pass it. Close that by
      // re-walking the embedded list and matching each step's hash against the
      // receipts in KV, which that attacker cannot reach. Forging a chain that
      // still reproduces every recorded hash is a Blake2b second preimage.
      console.log(`  Re-walking the recorded contribution chain...`);
      const recordedReceipts = (
        await listRange<ContributionReceipt>(storage.receiptsPath)
      )
        .filter((r) => r.circuitId === circuitConfig.id)
        .sort((a, b) => a.contributionIndex - b.contributionIndex);

      if (recordedReceipts.length !== state.totalContributions) {
        throw new Error(
          `Recorded receipts for ${circuitConfig.id} (${recordedReceipts.length}) ` +
            `do not match the circuit's contribution count (${state.totalContributions}).`,
        );
      }

      const embedded = await parseMpcParams(currentZkey, {
        maxContributions: state.totalContributions,
      });
      if (embedded.contributions.length !== state.totalContributions) {
        throw new Error(
          `Final zkey for ${circuitConfig.id} embeds ` +
            `${embedded.contributions.length} contributions, but ` +
            `${state.totalContributions} were recorded.`,
        );
      }

      for (let i = 0; i < embedded.contributions.length; i++) {
        const recomputed = embedded.contributions[i].hash();
        const recorded = recordedReceipts[i].serverContributionHash;
        if (recomputed !== recorded) {
          throw new Error(
            `Contribution ${i + 1} of ${circuitConfig.id} does not match the ` +
              "recorded chain. The current zkey is not the chain that was " +
              "contributed. Refusing to finalize.",
          );
        }
      }
      console.log(`  Recorded chain re-walk passed.`);

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
    const receipts = await listRange<ContributionReceipt>(storage.receiptsPath);

    const transcript = {
      ceremony: {
        name: manifest.ceremonyName,
        targetContributions: manifest.targetContributions,
        startedAt: manifest.startedAt,
        endDate: manifest.endDate,
        beaconHash: `0x${beaconHex}`,
        beaconSource: beacon.source,
        beaconVerifiable: beacon.verifiable,
        ...(beacon.slot !== undefined && { beaconSlot: beacon.slot }),
        ...(manifest.beaconCommitment && {
          beaconCommitment: manifest.beaconCommitment,
        }),
        finalizedAt,
      },
      circuits: circuitSummaries,
      receipts,
    };

    const transcriptPath = path.join(OUTPUT_DIR, "transcript.json");
    await writeFile(transcriptPath, JSON.stringify(transcript, null, 2));
    console.log(`Transcript saved to public/finalize/transcript.json`);

    // Permanent seal. Written last, after every artifact, so a mid-run failure
    // leaves the ceremony unsealed for the catch to reopen. Re-read and confirm
    // the seal is still ours: if a --force run took over (different finalizeId),
    // abort instead of stamping our beacon over theirs. This is best-effort, not
    // atomic — a takeover landing between this check and the write below can
    // still be clobbered. Acceptable under the no-concurrent-finalization rule
    // documented at the start guard; recover with reset:ceremony.
    const latestManifest =
      (await getJson<ManifestState>(storage.manifestPath)) ?? manifest;
    if (latestManifest.finalizeId !== finalizeId) {
      throw new Error(
        "Finalization seal was taken over by another run (--force). " +
          "Aborting this run without publishing its results.",
      );
    }
    const finalized = {
      ...latestManifest,
      beaconApplied: true,
      finalizedAt,
    };
    delete finalized.finalizingAt;
    delete finalized.finalizeId;
    await setJson(storage.manifestPath, finalized);

    console.log();
    console.log("=== Ceremony finalized ===");
    console.log(`  Beacon:  0x${beaconHex}`);
    console.log(`  Circuits finalized: ${circuitSummaries.length}`);
    console.log(`  Total contributions: ${totalContributions}`);
    console.log(`  Transcript: public/finalize/transcript.json`);
    console.log(`  Verification keys: public/finalize/*.vkey.json`);
    console.log(`  Finalized zkeys:   public/finalize/*.final.zkey`);
  } catch (error) {
    // Reopen on transient failure so the ceremony does not freeze, then rethrow.
    // reopenCeremony no-ops once the seal is permanent or owned by another run.
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

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { put } from "@vercel/blob";
import { loadEnvConfig } from "@next/env";
import { generateInitialZkey } from "@wonderland/cabure-crypto";

import { getJson, listClear, setJson } from "@/lib/kv-store";
import { ceremonyConfig } from "../ceremony.config";

// snarkjs/fastfile does not always close file handles explicitly. Node 25+
// treats GC-collected handles as a hard error. Safe to suppress.
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

const GENESIS_CHAIN_HASH = `0x${"0".repeat(64)}`;
const OUTPUT_DIR = path.resolve(process.cwd(), "public", "genesis");

type QueueEntry = {
  participantId: string;
  joinedAt: number;
};

type CircuitState = {
  id: string;
  totalContributions: number;
  latestContributionHash: string | null;
  chainHash: string;
  queue: QueueEntry[];
  currentZkeyPath: string;
  currentZkeyUrl: string;
};

type ManifestState = {
  ceremonyName: string;
  targetContributions: number;
  endDate: string | null;
  startedAt: number;
  circuits: Array<{ id: string }>;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function sha256hex(data: Uint8Array): string {
  return `0x${createHash("sha256").update(data).digest("hex")}`;
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

async function main() {
  loadEnvConfig(process.cwd(), true);

  console.log("=== Initialize Ceremony ===\n");

  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is required. Ensure it is set in your shell or loaded via .env/.env.local.",
    );
  }
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error(
      "KV_REST_API_URL and KV_REST_API_TOKEN are required. Pull env vars from Vercel or set them in .env/.env.local.",
    );
  }

  const force = process.argv.includes("--force");

  if (!force) {
    const existing = await getJson<ManifestState>(
      ceremonyConfig.storage.manifestPath,
    );
    if (existing) {
      console.log(
        "Manifest already exists. Re-run with --force to overwrite it.",
      );
      return;
    }
  }

  console.log(`Ceremony:    ${ceremonyConfig.name}`);
  console.log(`Circuits:    ${ceremonyConfig.circuits.length}`);
  console.log(
    `Target:      ${ceremonyConfig.targetContributions} contributions`,
  );
  console.log(`End date:    ${ceremonyConfig.endDate ?? "(none)"}`);
  console.log();

  await mkdir(OUTPUT_DIR, { recursive: true });

  const circuitSummaries: Array<{
    circuitId: string;
    label: string;
    genesisZkeyHash: string;
    genesisZkeySize: number;
    genesisZkeyUrl: string;
    genesisZkeyPath: string;
    localZkeyPath: string;
    r1csPath: string;
    ptauPath: string;
  }> = [];

  for (const circuit of ceremonyConfig.circuits) {
    console.log(`[${circuit.id}] Generating genesis zkey...`);

    console.log(`  Loading r1cs: ${circuit.artifacts.r1csPath}`);
    const r1cs = await readArtifact(circuit.artifacts.r1csPath);

    console.log(`  Loading ptau: ${circuit.artifacts.ptauPath}`);
    const ptau = await readArtifact(circuit.artifacts.ptauPath);

    console.log(`  Running Phase 2 setup...`);
    const zkey = await generateInitialZkey(ptau, r1cs);
    const genesisHash = sha256hex(zkey);

    console.log(`  Genesis zkey size: ${formatBytes(zkey.length)}`);
    console.log(`  Genesis zkey hash: ${genesisHash}`);

    console.log(`  Uploading genesis zkey to Vercel Blob...`);
    const blobPath = `${ceremonyConfig.storage.zkeyPrefix}/${circuit.id}/current.zkey`;
    const zkeyUpload = await put(blobPath, Buffer.from(zkey), {
      access: "public",
      token,
      contentType: "application/octet-stream",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    console.log(`  Uploaded to: ${zkeyUpload.url}`);

    const localZkeyFile = `${circuit.id}.genesis.zkey`;
    const localZkeyPath = path.join(OUTPUT_DIR, localZkeyFile);
    await writeFile(localZkeyPath, Buffer.from(zkey));
    console.log(`  Saved locally to: public/genesis/${localZkeyFile}`);

    const circuitState: CircuitState = {
      id: circuit.id,
      totalContributions: 0,
      latestContributionHash: genesisHash,
      chainHash: GENESIS_CHAIN_HASH,
      queue: [],
      currentZkeyPath: zkeyUpload.pathname,
      currentZkeyUrl: zkeyUpload.url,
    };

    const kvKey = `${ceremonyConfig.storage.circuitStatePrefix}:${circuit.id}`;
    await setJson(kvKey, circuitState);
    console.log(`  Circuit state saved to KV: ${kvKey}`);

    circuitSummaries.push({
      circuitId: circuit.id,
      label: circuit.label,
      genesisZkeyHash: genesisHash,
      genesisZkeySize: zkey.length,
      genesisZkeyUrl: zkeyUpload.url,
      genesisZkeyPath: zkeyUpload.pathname,
      localZkeyPath: `public/genesis/${localZkeyFile}`,
      r1csPath: circuit.artifacts.r1csPath,
      ptauPath: circuit.artifacts.ptauPath,
    });

    console.log();
  }

  const startedAt = Date.now();
  const manifest: ManifestState = {
    ceremonyName: ceremonyConfig.name,
    targetContributions: ceremonyConfig.targetContributions,
    endDate: ceremonyConfig.endDate,
    startedAt,
    circuits: circuitSummaries.map((c) => ({ id: c.circuitId })),
  };

  await setJson(ceremonyConfig.storage.manifestPath, manifest);
  console.log(`Manifest saved to KV: ${ceremonyConfig.storage.manifestPath}`);

  await listClear(ceremonyConfig.storage.receiptsPath);
  console.log(`Receipts list cleared: ${ceremonyConfig.storage.receiptsPath}`);
  console.log();

  console.log("Generating initialization transcript...");
  const transcript = {
    ceremony: {
      name: ceremonyConfig.name,
      slug: ceremonyConfig.slug,
      targetContributions: ceremonyConfig.targetContributions,
      endDate: ceremonyConfig.endDate,
      startedAt,
      initializedAt: new Date(startedAt).toISOString(),
      genesisChainHash: GENESIS_CHAIN_HASH,
    },
    circuits: circuitSummaries,
    storage: {
      manifestPath: ceremonyConfig.storage.manifestPath,
      circuitStatePrefix: ceremonyConfig.storage.circuitStatePrefix,
      receiptsPath: ceremonyConfig.storage.receiptsPath,
      zkeyPrefix: ceremonyConfig.storage.zkeyPrefix,
    },
  };

  const transcriptPath = path.join(OUTPUT_DIR, "init-transcript.json");
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2));
  console.log(`Transcript saved to public/genesis/init-transcript.json`);

  console.log();
  console.log("=== Ceremony initialized ===");
  console.log(`  Name:          ${ceremonyConfig.name}`);
  console.log(`  Started at:    ${new Date(startedAt).toISOString()}`);
  console.log(`  Circuits:      ${circuitSummaries.length}`);
  console.log(
    `  Target:        ${ceremonyConfig.targetContributions} contributions`,
  );
  console.log(`  End date:      ${ceremonyConfig.endDate ?? "(none)"}`);
  console.log(`  Genesis zkeys: public/genesis/*.genesis.zkey`);
  console.log(`  Transcript:    public/genesis/init-transcript.json`);

  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

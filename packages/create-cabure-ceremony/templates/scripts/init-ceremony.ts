import { put } from "@vercel/blob";
import { loadEnvConfig } from "@next/env";
import { generateInitialZkey } from "@defi-wonderland/cabure-crypto";
import { getJson, listClear, setJson } from "@/lib/kv-store";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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

async function main() {
  loadEnvConfig(process.cwd(), true);

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
    const existing = await getManifestValue(ceremonyConfig.storage.manifestPath);
    if (existing) {
      console.log(
        "Manifest already exists. Re-run with --force to overwrite it.",
      );
      return;
    }
  }

  const circuits: CircuitState[] = [];

  for (const circuit of ceremonyConfig.circuits) {
    console.log(`Generating genesis zkey for ${circuit.id}...`);
    const r1cs = await readArtifact(circuit.artifacts.r1csPath);
    const ptau = await readArtifact(circuit.artifacts.ptauPath);
    const zkey = await generateInitialZkey(ptau, r1cs);
    const zkeyUpload = await put(
      `${ceremonyConfig.storage.zkeyPrefix}/${circuit.id}/current.zkey`,
      Buffer.from(zkey),
      {
        access: "public",
        token,
        contentType: "application/octet-stream",
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );

    const circuitState: CircuitState = {
      id: circuit.id,
      totalContributions: 0,
      latestContributionHash: null,
      chainHash: GENESIS_CHAIN_HASH,
      queue: [],
      currentZkeyPath: zkeyUpload.pathname,
      currentZkeyUrl: zkeyUpload.url,
    };

    await setJson(
      `${ceremonyConfig.storage.circuitStatePrefix}:${circuit.id}`,
      circuitState,
    );

    circuits.push(circuitState);
  }

  const state: ManifestState = {
    ceremonyName: ceremonyConfig.name,
    targetContributions: ceremonyConfig.targetContributions,
    endDate: ceremonyConfig.endDate,
    startedAt: Date.now(),
    circuits: circuits.map((circuit) => ({ id: circuit.id })),
  };

  await setJson(ceremonyConfig.storage.manifestPath, state);
  await listClear(ceremonyConfig.storage.receiptsPath);

  console.log("Ceremony initialized and manifest uploaded.");
  process.exit(0);
}

async function getManifestValue(key: string): Promise<ManifestState | null> {
  return await getJson<ManifestState>(key);
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

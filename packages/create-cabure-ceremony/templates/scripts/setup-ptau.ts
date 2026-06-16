import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import * as snarkjs from "snarkjs";

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

const PPOT_BASE_URL =
  "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080";

const CIRCUITS_DIR = "circuits";
const PTAU_DEST = path.resolve(process.cwd(), CIRCUITS_DIR, "pot_final.ptau");

interface CircuitInfo {
  id: string;
  r1csPath: string;
  nConstraints: number;
}

const MAX_PTAU_DEGREE = 28;

function requiredDegree(maxConstraints: number): number {
  if (maxConstraints <= 0) return 1;
  const k = Math.ceil(Math.log2(maxConstraints + 1));
  if (k > MAX_PTAU_DEGREE) {
    throw new Error(
      `Circuit constraints (${maxConstraints.toLocaleString("en-US")}) require ptau degree ${k}, ` +
        `but the maximum available PPoT file is degree ${MAX_PTAU_DEGREE} (2^${MAX_PTAU_DEGREE} = ` +
        `${Math.pow(2, MAX_PTAU_DEGREE).toLocaleString("en-US")} points). ` +
        "Use a circuit with fewer constraints or provide a custom ptau file.",
    );
  }
  return Math.max(1, k);
}

function ptauUrl(degree: number): string {
  const dd = String(degree).padStart(2, "0");
  return `${PPOT_BASE_URL}/ppot_0080_${dd}.ptau`;
}

// BLAKE2b-512 of each downloaded `ppot_0080_NN.ptau`, keyed by degree (NN).
// Pinning the hash here catches a tampered or corrupted download: the file is
// fetched over the network from a third party, so without a pin we would trust
// whatever bytes arrive.
//
// These hashes are NOT published by PSE — the only hash PSE publishes is for the
// bellman *response* file, a different artifact with a different byte layout. So
// they must be sourced trust-on-first-use, by the team, NOT generated here:
//   1. Download each `ppot_0080_NN.ptau` you will use.
//   2. Verify it with `npm run setup:ptau -- --verify` (snarkjs pairing check),
//      relying also on PPoT round 0080's long public track record.
//   3. Hash it (this script prints the computed BLAKE2b when a pin is missing).
//   4. Have at least two people do 1–3 independently and confirm the hashes
//      match, then commit them here. A hash produced on a single unwitnessed
//      machine pins nothing meaningful.
//
// Until a degree has an entry, `setup:ptau` refuses it unless run with
// `--allow-unpinned-ptau`.
const PPOT_BLAKE2B: Record<number, string> = {
  // 12: "<blake2b-512 hex, 128 chars, of ppot_0080_12.ptau>",
  // 13: "...",
};

async function blake2b512File(filePath: string): Promise<string> {
  const hash = createHash("blake2b512");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

// Default-on authenticity check. A pin mismatch always aborts. A missing pin
// aborts too (fail-safe) unless `--allow-unpinned-ptau` is passed, so an empty
// table cannot silently accept an unverified download.
async function checkPtauHash(
  filePath: string,
  degree: number,
  allowUnpinned: boolean,
): Promise<void> {
  const dd = String(degree).padStart(2, "0");
  const pinned = PPOT_BLAKE2B[degree];
  const actual = await blake2b512File(filePath);

  if (!pinned) {
    const message =
      `No pinned BLAKE2b hash for ppot_0080_${dd}.ptau.\n` +
      `  Computed: ${actual}\n` +
      "  Source and commit this hash (see PPOT_BLAKE2B in scripts/setup-ptau.ts), " +
      "or re-run with --allow-unpinned-ptau to proceed without the check.";
    if (allowUnpinned) {
      console.warn(`  WARNING: ${message}`);
      return;
    }
    throw new Error(message);
  }

  if (actual.toLowerCase() !== pinned.toLowerCase()) {
    throw new Error(
      `BLAKE2b mismatch for ppot_0080_${dd}.ptau.\n` +
        `  Pinned:   ${pinned}\n` +
        `  Computed: ${actual}\n` +
        "  The downloaded file does not match the trusted hash — do not use it.",
    );
  }
  console.log(`  BLAKE2b matches the pinned value.`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function readCircuitConstraints(): Promise<CircuitInfo[]> {
  const results: CircuitInfo[] = [];

  for (const circuit of ceremonyConfig.circuits) {
    const r1csPath = path.resolve(process.cwd(), circuit.artifacts.r1csPath);

    try {
      await stat(r1csPath);
    } catch {
      throw new Error(
        `Missing r1cs file: ${circuit.artifacts.r1csPath}. ` +
          "Place your compiled .r1cs files in the circuits/ folder.",
      );
    }

    const info = await snarkjs.r1cs.info(r1csPath);
    results.push({
      id: circuit.id,
      r1csPath: circuit.artifacts.r1csPath,
      nConstraints: info.nConstraints,
    });
  }

  return results;
}

async function downloadPtau(url: string, dest: string): Promise<number> {
  console.log(`  URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 0) {
    console.log(`  Size: ${formatBytes(contentLength)}`);
  }

  if (!response.body) {
    throw new Error("Response body is empty");
  }

  await mkdir(path.dirname(dest), { recursive: true });

  const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  const fileStream = createWriteStream(dest);
  await pipeline(nodeStream, fileStream);

  const fileStat = await stat(dest);
  return fileStat.size;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function updateConfigConstraints(
  circuits: CircuitInfo[],
): Promise<void> {
  const configPath = path.resolve(process.cwd(), "ceremony.config.ts");
  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch {
    console.log("  Could not read ceremony.config.ts — skipping constraint update.");
    return;
  }

  let updated = content;
  for (const circuit of circuits) {
    const pattern = new RegExp(
      `(id:\\s*"${escapeRegExp(circuit.id)}"[\\s\\S]*?constraints:\\s*)"[^"]*"`,
    );
    updated = updated.replace(
      pattern,
      `$1"${circuit.nConstraints.toLocaleString("en-US")}"`,
    );
  }

  if (updated !== content) {
    await writeFile(configPath, updated);
    console.log("  Updated ceremony.config.ts with actual constraint counts.");
  } else {
    console.log("  ceremony.config.ts already has correct constraint values.");
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const verify = process.argv.includes("--verify");
  const allowUnpinned = process.argv.includes("--allow-unpinned-ptau");

  console.log("=== Setup PPoT Phase 2 file ===\n");

  console.log("Reading circuit constraints...");
  const circuits = await readCircuitConstraints();

  let maxConstraints = 0;
  for (const c of circuits) {
    console.log(`  ${c.id}: ${c.nConstraints.toLocaleString("en-US")} constraints`);
    maxConstraints = Math.max(maxConstraints, c.nConstraints);
  }
  console.log();

  const degree = requiredDegree(maxConstraints);
  const points = Math.pow(2, degree);
  console.log(
    `Required ptau degree: ${degree} (2^${degree} = ${points.toLocaleString("en-US")} points > ${maxConstraints.toLocaleString("en-US")} constraints)`,
  );
  console.log();

  let needsDownload = force;
  if (!force) {
    try {
      await stat(PTAU_DEST);
      console.log(`Ptau file already exists at ${PTAU_DEST}`);
      console.log("Use --force to re-download.\n");
    } catch {
      needsDownload = true;
    }
  }

  if (needsDownload) {
    console.log("Downloading ptau file...");
    const url = ptauUrl(degree);
    const size = await downloadPtau(url, PTAU_DEST);
    console.log(`  Saved to ${PTAU_DEST} (${formatBytes(size)})\n`);
  }

  // Always check the pinned BLAKE2b, even when the file already existed, so a
  // file tampered with on disk between runs is also caught.
  console.log("Checking ptau authenticity (pinned BLAKE2b)...");
  await checkPtauHash(PTAU_DEST, degree, allowUnpinned);
  console.log();

  if (verify) {
    console.log("Verifying ptau file (this may take a while for large files)...");
    // @ts-expect-error snarkjs types are wrong: actual signature is verify(filename, logger)
    const valid = await snarkjs.powersOfTau.verify(PTAU_DEST);
    if (!valid) {
      throw new Error(
        "Ptau verification failed. The file may be corrupted. " +
          "Delete it and re-run with --force.",
      );
    }
    console.log("  Verification passed.\n");
  } else {
    console.log("Skipping ptau verification by default. Use --verify to enable it.\n");
  }

  console.log("Updating ceremony config...");
  await updateConfigConstraints(circuits);
  console.log();

  console.log("=== Done ===");
  console.log(`  Circuits:    ${circuits.length}`);
  console.log(`  Max constraints: ${maxConstraints.toLocaleString("en-US")}`);
  console.log(`  Ptau degree: ${degree}`);
  console.log(`  Ptau file:   ${PTAU_DEST}`);
  console.log(`  Verified:    ${verify}`);

  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

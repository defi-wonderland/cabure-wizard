import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import * as snarkjs from "snarkjs";

// Reviewer-reproducible helper for pinning the PPoT ptau hashes (H-3).
//
// Run it, then have a colleague run the EXACT same command on a different
// machine/network and compare the printed BLAKE2b values. The download URL is
// a static file and BLAKE2b is deterministic, so two honest runs must agree;
// matching hashes across independent machines is the trust signal. Only then
// paste the values into PPOT_BLAKE2B in scripts/setup-ptau.ts and commit.
//
// The pairing check (snarkjs powersOfTau verify) runs on every file here so a
// witness confirms the file is a valid powers-of-tau, not just hashes whatever
// bytes arrived.

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

// Keep in sync with scripts/setup-ptau.ts — both must fetch the same files.
const PPOT_BASE_URL =
  "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080";
const MAX_PTAU_DEGREE = 28;

function ptauUrl(degree: number): string {
  const dd = String(degree).padStart(2, "0");
  return `${PPOT_BASE_URL}/ppot_0080_${dd}.ptau`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function parseDegrees(): number[] {
  const degrees = new Set<number>();
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--degree") continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(
        "--degree requires a value, e.g. --degree 14 or --degree 12,14,16",
      );
    }
    for (const part of value.split(",")) {
      const n = Number.parseInt(part.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > MAX_PTAU_DEGREE) {
        throw new Error(
          `Invalid degree "${part}": must be an integer in [1, ${MAX_PTAU_DEGREE}].`,
        );
      }
      degrees.add(n);
    }
  }
  return [...degrees].sort((a, b) => a - b);
}

async function downloadTo(url: string, dest: string): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText} (${url})`,
    );
  }
  if (!response.body) {
    throw new Error("Response body is empty");
  }
  const nodeStream = Readable.fromWeb(
    response.body as import("node:stream/web").ReadableStream,
  );
  await pipeline(nodeStream, createWriteStream(dest));
  return (await stat(dest)).size;
}

async function blake2b512File(filePath: string): Promise<string> {
  const hash = createHash("blake2b512");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function main() {
  const degrees = parseDegrees();
  if (degrees.length === 0) {
    throw new Error(
      "No degree given. Run `npm run setup:ptau` to see the required degree, then:\n" +
        "  npm run pin:ptau -- --degree 14         (one degree)\n" +
        "  npm run pin:ptau -- --degree 12,14,16   (several)",
    );
  }

  console.log("=== Pin PPoT ptau hashes ===\n");
  console.log(
    "Download + pairing-check + BLAKE2b each ptau, so a second person can",
  );
  console.log("reproduce the result and compare.\n");

  const cacheDir = await mkdtemp(path.join(tmpdir(), "cabure-pin-"));
  const results: Array<{ degree: number; hash: string; size: number }> = [];

  try {
    for (const degree of degrees) {
      const dd = String(degree).padStart(2, "0");
      const url = ptauUrl(degree);
      const dest = path.join(cacheDir, `ppot_0080_${dd}.ptau`);

      console.log(`[degree ${degree}] ppot_0080_${dd}.ptau`);
      console.log(`  Downloading ${url}`);
      const size = await downloadTo(url, dest);
      console.log(`  Size: ${formatBytes(size)}`);

      console.log(
        "  Verifying (snarkjs powers-of-tau pairing check; may take a while)...",
      );
      // @ts-expect-error snarkjs types are wrong: actual signature is verify(filename, logger)
      const valid = await snarkjs.powersOfTau.verify(dest);
      if (!valid) {
        throw new Error(
          `Pairing check FAILED for degree ${degree}. This is not a valid ` +
            "powers-of-tau file — do not pin it.",
        );
      }
      console.log("  Pairing check passed.");

      const hash = await blake2b512File(dest);
      console.log(`  BLAKE2b-512: ${hash}`);
      console.log();

      results.push({ degree, hash, size });
    }
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }

  console.log("=== Paste into PPOT_BLAKE2B in scripts/setup-ptau.ts ===\n");
  for (const r of results) {
    console.log(`  ${r.degree}: "${r.hash}",`);
  }
  console.log();
  console.log(
    "Next: have a colleague run the EXACT same command on a different machine /",
  );
  console.log(
    "network and compare the BLAKE2b values line by line. Commit only once at",
  );
  console.log("least two independent runs agree.");

  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

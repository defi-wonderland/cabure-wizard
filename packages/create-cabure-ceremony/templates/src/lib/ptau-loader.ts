import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The Powers of Tau file is too large to bundle into a serverless function and
// is not on the deployed function's filesystem, but the contribute route needs
// it for verifyChain. Load it from a URL, caching the bytes in memory and on
// /tmp (which survives warm invocations on the same instance) so repeated
// contributions do not re-download it.
//
// A local file is preferred when present, so `next dev` and the operator
// scripts keep reading the on-disk copy with no download.
let cached: { key: string; bytes: Uint8Array } | null = null;

export async function loadPtau(options: {
  url?: string;
  localPath?: string;
}): Promise<Uint8Array> {
  if (options.localPath) {
    try {
      const data = await readFile(
        path.resolve(process.cwd(), options.localPath),
      );
      return new Uint8Array(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Not on disk (e.g. a deployed function): fall through to the URL.
    }
  }

  if (!options.url) {
    throw new Error(
      "ptau is unavailable: no local file and no ptauUrl on the manifest. " +
        "Re-run init:ceremony to publish the ptau, or set verifyContributions to false.",
    );
  }

  if (cached?.key === options.url) {
    return cached.bytes;
  }

  const cacheFile = path.join(
    tmpdir(),
    `cabure-ptau-${createHash("sha256")
      .update(options.url)
      .digest("hex")
      .slice(0, 16)}.ptau`,
  );

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(cacheFile));
  } catch {
    const response = await fetch(options.url);
    if (!response.ok) {
      throw new Error(
        `Failed to download ptau from ${options.url}: ${response.status}`,
      );
    }
    bytes = new Uint8Array(await response.arrayBuffer());
    // Best-effort disk cache; a failure here just means the next cold start
    // re-downloads.
    await writeFile(cacheFile, bytes).catch(() => {});
  }

  cached = { key: options.url, bytes };
  return bytes;
}

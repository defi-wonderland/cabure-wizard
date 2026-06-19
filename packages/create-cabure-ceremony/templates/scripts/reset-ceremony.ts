import process from "node:process";

import { del, list } from "@vercel/blob";
import { loadEnvConfig } from "@next/env";

import {
  clearParticipantContributions,
  getJson,
  listClear,
} from "@/lib/kv-store";
import type { ManifestState } from "@/lib/ceremony-state";
import { ceremonyConfig } from "../ceremony.config";

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

  const { storage, circuits } = ceremonyConfig;

  // Guard a finalized ceremony. reset wipes the live manifest, receipts, circuit
  // states and zkey blobs; the published transcript and final zkeys under
  // public/finalize/ are on disk and survive, but the running app loses its
  // status/receipt/download state for good. Only beaconApplied is guarded, not
  // finalizingAt: reset is the documented recovery path for an interrupted
  // finalize seal.
  const force = process.argv.includes("--force");
  const manifest = await getJson<ManifestState>(storage.manifestPath);
  if (manifest?.beaconApplied && !force) {
    const when = manifest.finalizedAt
      ? ` on ${new Date(manifest.finalizedAt).toISOString()}`
      : "";
    throw new Error(
      `Ceremony is finalized (beacon applied${when}). Resetting erases the live ` +
        "manifest, receipts, circuit states and all zkey blobs. Pass --force to wipe anyway.",
    );
  }

  console.log("Deleting Redis keys...");

  const redisKeys = [
    storage.manifestPath,
    storage.receiptsPath,
    ...circuits.map((c) => `${storage.circuitStatePrefix}:${c.id}`),
    ...circuits.map((c) => `${storage.manifestPath}:lock:${c.id}`),
  ];

  const deletedCounts = await Promise.all(
    redisKeys.map((key) => listClear(key)),
  );
  const clearedParticipants = await clearParticipantContributions({
    participantsIndexKey: storage.participantsIndexPath,
    participantContributionsPrefix: storage.participantContributionsPrefix,
  });
  const deletedKeys = deletedCounts.reduce((sum, n) => sum + n, 0);
  console.log(
    `  Deleted ${deletedKeys} keys and ${clearedParticipants} participant index entries.`,
  );

  console.log("Deleting Vercel Blob zkeys...");

  let deletedBlobs = 0;
  let cursor: string | undefined;
  do {
    const result = await list({
      prefix: `${storage.zkeyPrefix}/`,
      token,
      cursor,
    });
    if (result.blobs.length > 0) {
      await del(
        result.blobs.map((b) => b.url),
        { token },
      );
      deletedBlobs += result.blobs.length;
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  console.log(`  Deleted ${deletedBlobs} blob(s).`);
  console.log("Ceremony data reset complete.");
  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

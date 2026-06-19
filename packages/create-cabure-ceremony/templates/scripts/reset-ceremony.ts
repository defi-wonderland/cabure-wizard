import process from "node:process";

import { loadEnvConfig } from "@next/env";

import { deletePrefix } from "@/lib/blob-store";
import { clearParticipantContributions, listClear } from "@/lib/kv-store";
import { ceremonyConfig } from "../ceremony.config";

async function main() {
  loadEnvConfig(process.cwd(), true);

  if (!process.env.CEREMONY_BUCKET) {
    throw new Error(
      "CEREMONY_BUCKET is required. Take it from the `sst deploy` outputs and " +
        "set it in .env/.env.local. AWS credentials come from your AWS CLI " +
        "profile or environment.",
    );
  }
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error(
      "KV_REST_API_URL and KV_REST_API_TOKEN are required. Set them in .env/.env.local.",
    );
  }

  const { storage, circuits } = ceremonyConfig;

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

  console.log("Deleting S3 zkeys...");

  // Committed zkeys/ptau live under zkeyPrefix; client pending uploads under
  // contributions/. Sweep both so a crashed contribution cannot leave orphans
  // behind a reset.
  const deletedBlobs =
    (await deletePrefix(`${storage.zkeyPrefix}/`)) +
    (await deletePrefix("contributions/"));

  console.log(`  Deleted ${deletedBlobs} object(s).`);
  console.log("Ceremony data reset complete.");
  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

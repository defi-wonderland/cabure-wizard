import { createHash } from "node:crypto";

import { contribute, generateEntropy } from "@wonderland/cabure-crypto";
import { upload } from "@vercel/blob/client";

import { authenticate } from "../auth.js";
import { CeremonyClient } from "../client.js";
import type { ReceiptResponse } from "../types.js";
import { formatBytes, sleep } from "../utils.js";

const QUEUE_POLL_INTERVAL_MS = 3_000;

interface ContributeOptions {
  tier?: string;
  circuit?: string;
  token?: string;
}

export async function contributeCommand(
  ceremonyUrl: string,
  options: ContributeOptions,
): Promise<void> {
  console.log(`\nCeremony: ${ceremonyUrl}`);

  let token: string;
  let participantName: string;

  if (options.token) {
    token = options.token;
    participantName = "cli-user";
    console.log("Using provided token.");
  } else {
    console.log("Authenticating...");
    const auth = await authenticate(ceremonyUrl);
    token = auth.token;
    participantName = auth.participantName;
    console.log(`Authenticated as ${auth.participantName} (${auth.participantId})`);
  }

  const client = new CeremonyClient(ceremonyUrl, token);
  const status = await client.getStatus();

  if (!status.isActive) {
    throw new Error("Ceremony is not active.");
  }

  if (options.tier && options.circuit) {
    throw new Error("Cannot use --tier and --circuit together. Pick one.");
  }

  let joinOptions: { tierId?: string; circuitIds?: string[] };

  if (options.circuit) {
    const found = status.circuits.find((c) => c.circuitId === options.circuit);
    if (!found) {
      throw new Error(`Circuit not found: ${options.circuit}`);
    }
    if (found.isComplete) {
      throw new Error(`Circuit ${options.circuit} has already reached its target.`);
    }
    joinOptions = { circuitIds: [options.circuit] };
  } else if (options.tier) {
    joinOptions = { tierId: options.tier };
  } else {
    const incompleteIds = status.circuits
      .filter((c) => !c.isComplete)
      .map((c) => c.circuitId);

    if (incompleteIds.length === 0) {
      console.log("\nAll circuits have reached their contribution targets.");
      return;
    }
    joinOptions = { circuitIds: incompleteIds };
  }

  console.log("\nJoining queue...");
  const { positions } = await client.joinQueue(joinOptions);

  const circuitIds = positions.map((p) => p.circuitId);

  if (circuitIds.length === 0) {
    console.log("\nNo circuits to contribute to.");
    return;
  }

  console.log(`Contributing to ${circuitIds.length} circuit(s): ${circuitIds.join(", ")}`);

  for (const pos of positions) {
    console.log(`  ${pos.circuitId}: queue position ${pos.position}`);
  }

  const receipts: ReceiptResponse[] = [];

  // Headless entropy comes only from the OS CSPRNG (generateEntropy with no
  // extra sources — there is no mouse/UI entropy in a CLI run). Modern
  // kernels block getrandom until the pool is seeded, so a normal host is
  // fine. The real risk is a CLONED VM/container image: a snapshot taken
  // after boot can carry RNG state, so contributors started from the same
  // image could draw correlated entropy. Run on a freshly, independently
  // seeded host. Warn once per invocation, before the per-circuit loop.
  console.warn(
    "Note: entropy is drawn from the OS RNG only. Run on a properly seeded " +
      "host — not a cloned VM/container snapshot that may share RNG state.",
  );

  for (let i = 0; i < circuitIds.length; i++) {
    const circuitId = circuitIds[i];
    const label = `[${i + 1}/${circuitIds.length}] ${circuitId}`;

    console.log(`\n${label}`);

    await waitForQueueFront(client, circuitId);

    console.log("  Downloading zkey...");
    const zkeyInfo = await client.getZkeyInfo(circuitId);
    const prevZkey = await client.downloadZkey(zkeyInfo.url);
    console.log(`  Downloaded ${formatBytes(prevZkey.length)}`);

    if (zkeyInfo.hash) {
      console.log("  Verifying integrity...");
      const downloadHash = `0x${createHash("sha256").update(prevZkey).digest("hex")}`;
      if (downloadHash !== zkeyInfo.hash) {
        throw new Error(
          `Integrity check failed for ${circuitId}: expected ${zkeyInfo.hash}, got ${downloadHash}`,
        );
      }
      console.log("  Integrity OK");
    }

    console.log("  Generating entropy...");
    const entropy = await generateEntropy();

    console.log("  Computing contribution...");
    const result = await contribute(prevZkey, entropy, participantName);
    console.log(`  Contribution hash: ${result.contributionHash}`);
    console.log(`  Zkey hash: ${result.zkeyHash}`);

    console.log("  Uploading...");
    const blob = await upload(
      `contributions/${circuitId}/pending.zkey`,
        new Blob([result.zkey as BlobPart]),
      {
        access: "public",
        handleUploadUrl: `${ceremonyUrl}/api/ceremony/circuits/${circuitId}/upload`,
        headers: client.uploadHeaders,
      },
    );
    console.log("  Upload complete");

    console.log("  Submitting...");
    const receipt = await client.submitContribution(
      circuitId,
      blob.url,
      result.contributionHash,
    );
    if (receipt.contributionHash.toLowerCase() !== result.zkeyHash.toLowerCase()) {
      throw new Error(
        `Receipt hash mismatch for ${circuitId}: expected ${result.zkeyHash}, got ${receipt.contributionHash}`,
      );
    }

    receipts.push(receipt);
    console.log(`  Contribution #${receipt.contributionIndex} accepted`);
    console.log(`  Chain hash: ${receipt.chainHash}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`All done! ${receipts.length} contribution(s) submitted.\n`);

  for (const r of receipts) {
    console.log(`  ${r.circuitId}: #${r.contributionIndex} — ${r.contributionHash}`);
  }

  console.log();
}

async function waitForQueueFront(
  client: CeremonyClient,
  circuitId: string,
): Promise<void> {
  for (;;) {
    const pos = await client.getQueuePosition(circuitId);
    if (pos.position === 1) {
      console.log("  At front of queue");
      return;
    }
    process.stdout.write(
      `\r  Queue position: ${pos.position} (est. ~${Math.ceil(pos.estimatedWaitSeconds / 60)} min)  `,
    );
    await sleep(QUEUE_POLL_INTERVAL_MS);
  }
}


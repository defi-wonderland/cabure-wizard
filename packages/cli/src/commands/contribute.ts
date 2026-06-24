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

  // Server receipt plus the contributor's own client-computed h_k
  // (result.contributionHash). The attestation publishes that, not the
  // server-reported value, so it is the contributor's own statement.
  const records: Array<{ receipt: ReceiptResponse; clientHk: string }> = [];

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

    // Refresh our queue entry now that the long compute is done, BEFORE upload and
    // submit. Both prune the queue and reject anyone not at the front, and a
    // compute longer than the queue timeout would otherwise have aged us out.
    // Bumping joinedAt (see queue POST) keeps the entry alive. Best-effort.
    try {
      await client.joinQueue({ circuitIds: [circuitId] });
    } catch {
      // Submit may still pass; otherwise the run can be retried.
    }

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

    records.push({ receipt, clientHk: result.contributionHash });
    console.log(`  Contribution #${receipt.contributionIndex} accepted`);
    console.log(`  Chain hash: ${receipt.chainHash}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`All done! ${records.length} contribution(s) submitted.\n`);

  for (const { receipt: r } of records) {
    console.log(`  ${r.circuitId}: #${r.contributionIndex} — ${r.contributionHash}`);
  }

  // Optional attestation. Publishing is voluntary and proves inclusion, not
  // honesty (see docs/h4-verifiability.md). h_k is the contributor's own
  // client-computed value — the only thing they vouch for. Server-reported
  // values are left out (the server controls them; a verifier re-derives them
  // from the final zkey).
  console.log(
    "\nOptional: publish any of these as a public GitHub Gist to leave a",
  );
  console.log("timestamped record that your contribution happened.\n");
  for (const { receipt: r, clientHk } of records) {
    const attestation = {
      ceremony: ceremonyUrl,
      circuit: r.circuitId,
      index: r.contributionIndex,
      h_k: clientHk,
    };
    console.log(`  ${r.circuitId} #${r.contributionIndex}:`);
    console.log(JSON.stringify(attestation, null, 2));
    console.log();
  }
  console.log("  Create one at https://gist.github.com/ (optional).");

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
    // ETA omitted: estimatedWaitSeconds is a flat position*60s placeholder, not a
    // real per-circuit estimate. Show the position only until estimates exist.
    process.stdout.write(`\r  Queue position: ${pos.position}  `);
    await sleep(QUEUE_POLL_INTERVAL_MS);
  }
}


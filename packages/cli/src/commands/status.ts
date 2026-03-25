import { CeremonyClient } from "../client.js";

export async function statusCommand(ceremonyUrl: string): Promise<void> {
  const client = new CeremonyClient(ceremonyUrl);
  const status = await client.getStatus();

  console.log(`\nCeremony: ${ceremonyUrl}`);
  console.log(`Active:   ${status.isActive ? "yes" : "no"}`);
  console.log(
    `Progress: ${status.totalContributions} / ${status.targetContributions} contributions`,
  );
  if (status.endDate) {
    console.log(`End date: ${status.endDate}`);
  }
  if (status.beaconApplied) {
    console.log(`Beacon:   applied (${status.beaconHash})`);
  }

  console.log(`\nCircuits (${status.circuits.length}):\n`);

  const maxIdLen = Math.max(
    ...status.circuits.map((c) => c.circuitId.length),
    9,
  );

  console.log(
    `  ${"Circuit".padEnd(maxIdLen)}  ${"Progress".padEnd(12)}  ${"Queue".padEnd(6)}  Status`,
  );
  console.log(`  ${"─".repeat(maxIdLen)}  ${"─".repeat(12)}  ${"─".repeat(6)}  ${"─".repeat(10)}`);

  for (const c of status.circuits) {
    const progress = `${c.totalContributions}/${c.targetContributions}`;
    const queue = String(c.queueLength);
    const statusLabel = c.isComplete
      ? "complete"
      : c.currentParticipant
        ? "active"
        : "waiting";
    console.log(
      `  ${c.circuitId.padEnd(maxIdLen)}  ${progress.padEnd(12)}  ${queue.padEnd(6)}  ${statusLabel}`,
    );
  }

  console.log();
}

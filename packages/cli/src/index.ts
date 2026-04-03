import process from "node:process";

import { Command } from "commander";

import { statusCommand } from "./commands/status.js";
import { contributeCommand } from "./commands/contribute.js";

const program = new Command();

program
  .name("cabure")
  .description("CLI contributor tool for Groth16 Phase 2 trusted setup ceremonies")
  .version("0.1.0");

program
  .command("status")
  .description("Show ceremony status and circuit information")
  .argument("<url>", "Ceremony URL (e.g. https://ceremony.example.com)")
  .action(async (url: string) => {
    try {
      await statusCommand(normalizeUrl(url));
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });

program
  .command("contribute")
  .description("Contribute to a ceremony")
  .argument("<url>", "Ceremony URL (e.g. https://ceremony.example.com)")
  .option("--tier <id>", "Contribute to a specific tier")
  .option("--circuit <id>", "Contribute to a single circuit")
  .option("--token <jwt>", "Use a pre-existing CLI auth token")
  .action(
    async (
      url: string,
      opts: { tier?: string; circuit?: string; token?: string },
    ) => {
      try {
        await contributeCommand(normalizeUrl(url), opts);
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    },
  );

program.parseAsync().then(() => {
  process.exit(process.exitCode ?? 0);
});

function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, "");
}

function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nError: ${message}`);
}

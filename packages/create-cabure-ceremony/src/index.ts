#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { askWizardQuestions } from "./prompts.js";
import { copyR1csCircuitsFromPath } from "./circuits.js";
import { scaffoldProject } from "./scaffold.js";
import { toProjectDirectoryName } from "./validate.js";

async function main(): Promise<void> {
  printHeader();
  const answers = await askWizardQuestions();

  const projectSlug = toProjectDirectoryName(answers.projectName);
  if (!projectSlug) {
    throw new Error(
      "Project name must include at least one alphanumeric character.",
    );
  }

  const outputDirectory = path.resolve(process.cwd(), projectSlug);
  const tiers = {
    core: [],
    popular: [],
    all: [],
  };

  await scaffoldProject({
    outputDirectory,
    projectName: answers.projectName,
    projectSlug,
    targetContributions: answers.targetContributions,
    endDate: answers.endDate,
    circuits: [],
    tiers,
    stateManifestBlobUrl: "",
  });
  const circuitsDirectory = path.join(outputDirectory, "circuits");
  await mkdir(circuitsDirectory, { recursive: true });

  let copiedR1csFiles: string[] = [];
  if (answers.circuitArtifactsPath) {
    copiedR1csFiles = await copyR1csCircuitsFromPath(
      answers.circuitArtifactsPath,
      circuitsDirectory,
    );
  }

  printSummary({
    projectName: answers.projectName,
    outputDirectory,
    copiedR1csCount: copiedR1csFiles.length,
  });
}

function printHeader(): void {
  process.stdout.write("\ncreate-cabure-ceremony\n");
  process.stdout.write(
    "Generate a deploy-ready ceremony project with one command.\n\n",
  );
}

function printSummary(options: {
  projectName: string;
  outputDirectory: string;
  copiedR1csCount: number;
}): void {
  process.stdout.write("\nCeremony project created successfully.\n");
  process.stdout.write(`Project: ${options.projectName}\n`);
  process.stdout.write(`Output: ${options.outputDirectory}\n`);
  if (options.copiedR1csCount > 0) {
    process.stdout.write(
      `Copied circuits: ${options.copiedR1csCount} .r1cs files\n\n`,
    );
  } else {
    process.stdout.write("Copied circuits: none\n");
    process.stdout.write(
      "Add your .r1cs files into ./circuits (inside the generated project).\n\n",
    );
  }
  process.stdout.write("Next steps:\n");
  process.stdout.write(`1. cd ${options.outputDirectory}\n`);
  process.stdout.write("2. Ensure your .r1cs files are in ./circuits\n");
  process.stdout.write("3. Update ceremony.config.ts with circuit metadata\n");
  process.stdout.write("4. npm install\n");
  process.stdout.write("5. npm run dev\n");
  process.stdout.write("6. Import the repo into Vercel and deploy.\n\n");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nError: ${message}\n`);
  process.exitCode = 1;
});

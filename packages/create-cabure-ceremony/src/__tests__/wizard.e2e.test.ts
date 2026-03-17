import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { copyR1csCircuitsFromPath } from "../circuits.js";
import { scaffoldProject } from "../scaffold.js";

const TEMPLATES_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates",
);

const createdDirectories: string[] = [];

afterEach(async () => {
  for (const directory of createdDirectories.splice(
    0,
    createdDirectories.length,
  )) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function templatesExist(): Promise<boolean> {
  try {
    const stats = await stat(TEMPLATES_DIRECTORY);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

describe("circuit copy e2e", () => {
  test("copies circuit artifacts into target directory", async () => {
    const outputDirectory = await mkFixtureDirectory("cabure-generated-");
    const sourceDirectory = await mkFixtureDirectory("cabure-source-");

    await createCircuit(sourceDirectory, "deposit");
    await createCircuit(sourceDirectory, "withdraw");

    const circuitsDirectory = path.join(outputDirectory, "circuits");
    await mkdir(circuitsDirectory, { recursive: true });

    const copiedFilenames = await copyR1csCircuitsFromPath(
      sourceDirectory,
      circuitsDirectory,
    );

    expect(copiedFilenames).toEqual(["deposit.r1cs", "withdraw.r1cs"]);

    const copiedDeposit = await readFile(
      path.join(circuitsDirectory, "deposit.r1cs"),
      "utf8",
    );
    const copiedWithdraw = await readFile(
      path.join(circuitsDirectory, "withdraw.r1cs"),
      "utf8",
    );

    expect(copiedDeposit).toBe("deposit-r1cs");
    expect(copiedWithdraw).toBe("withdraw-r1cs");
  });
});

describe("wizard scaffold e2e", async () => {
  const hasTemplates = await templatesExist();

  test.skipIf(!hasTemplates)(
    "scaffolds a Next.js ceremony project with config and copied circuits",
    async () => {
      const outputDirectory = await mkFixtureDirectory("cabure-generated-");
      const sourceDirectory = await mkFixtureDirectory("cabure-source-");

      await createCircuit(sourceDirectory, "deposit");
      await createCircuit(sourceDirectory, "withdraw");

      await scaffoldProject({
        outputDirectory,
        projectName: "Privacy Pools v2",
        projectSlug: "privacy-pools-v2",
        targetContributions: 500,
        endDate: "2026-03-27",
        tiers: {
          core: [],
          popular: [],
          all: [],
        },
        stateManifestBlobUrl: "",
        circuits: [],
      });

      await copyR1csCircuitsFromPath(
        sourceDirectory,
        path.join(outputDirectory, "circuits"),
      );

      const generatedConfig = await readFile(
        path.join(outputDirectory, "ceremony.config.ts"),
        "utf8",
      );
      const copiedR1cs = await readFile(
        path.join(outputDirectory, "circuits", "deposit.r1cs"),
        "utf8",
      );

      expect(generatedConfig).toContain("Privacy Pools v2");
      expect(generatedConfig).toContain("circuits: []");
      expect(copiedR1cs).toBe("deposit-r1cs");
    },
  );
});

async function mkFixtureDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}

async function createCircuit(directory: string, id: string): Promise<void> {
  const r1csPath = path.join(directory, `${id}.r1cs`);

  await writeFile(r1csPath, `${id}-r1cs`);
}

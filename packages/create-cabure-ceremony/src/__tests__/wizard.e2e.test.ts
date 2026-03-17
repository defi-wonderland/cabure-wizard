import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { copyR1csCircuitsFromPath } from "../circuits.js";
import { scaffoldProject } from "../scaffold.js";

const createdDirectories: string[] = [];

afterEach(async () => {
  for (const directory of createdDirectories.splice(
    0,
    createdDirectories.length,
  )) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("wizard scaffold e2e", () => {
  test("creates a Next.js ceremony project with config and copied circuits", async () => {
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

    const generatedPackageJson = await readFile(
      path.join(outputDirectory, "package.json"),
      "utf8",
    );
    const generatedConfig = await readFile(
      path.join(outputDirectory, "ceremony.config.ts"),
      "utf8",
    );
    const copiedR1cs = await readFile(
      path.join(outputDirectory, "circuits", "deposit.r1cs"),
      "utf8",
    );

    expect(generatedPackageJson).toContain('"next": "16.1.6"');
    expect(generatedConfig).toContain("Privacy Pools v2");
    expect(generatedConfig).toContain("circuits: []");
    expect(copiedR1cs).toBe("deposit-r1cs");
  });
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

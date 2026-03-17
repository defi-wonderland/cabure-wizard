import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { copyR1csCircuitsFromPath } from "../circuits.js";

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
  test("copies circuit artifacts into generated project directory", async () => {
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

async function mkFixtureDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}

async function createCircuit(directory: string, id: string): Promise<void> {
  const r1csPath = path.join(directory, `${id}.r1cs`);

  await writeFile(r1csPath, `${id}-r1cs`);
}

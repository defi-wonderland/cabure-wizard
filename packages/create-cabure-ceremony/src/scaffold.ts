import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScaffoldContext } from "./types.js";

const TEMPLATES_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../templates",
);

export async function scaffoldProject(context: ScaffoldContext): Promise<void> {
  await assertTemplatesDirectoryAvailable(TEMPLATES_DIRECTORY);
  await assertOutputDirectoryIsWritable(context.outputDirectory);
  await mkdir(context.outputDirectory, { recursive: true });

  const replacements = {
    __PROJECT_NAME__: context.projectName,
    __PROJECT_SLUG__: context.projectSlug,
    __TARGET_CONTRIBUTIONS__: String(context.targetContributions),
    __END_DATE_LITERAL__: context.endDate ? `"${context.endDate}"` : "null",
    __STATE_MANIFEST_BLOB_URL__: context.stateManifestBlobUrl,
  };

  await copyTemplateTree(
    TEMPLATES_DIRECTORY,
    context.outputDirectory,
    replacements,
  );

  const ceremonyConfigPath = path.join(
    context.outputDirectory,
    "ceremony.config.ts",
  );
  await writeFile(ceremonyConfigPath, renderCeremonyConfig(context), "utf8");
}

async function assertTemplatesDirectoryAvailable(
  templatesDirectory: string,
): Promise<void> {
  try {
    const templateStats = await stat(templatesDirectory);
    if (!templateStats.isDirectory()) {
      throw new Error(
        `Template path is not a directory: ${templatesDirectory}`,
      );
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        `Templates directory is missing: ${templatesDirectory}. Ensure templates are committed and available before running the wizard.`,
      );
    }

    throw error;
  }
}

async function copyTemplateTree(
  templateDirectory: string,
  outputDirectory: string,
  replacements: Record<string, string>,
): Promise<void> {
  const entries = await readdir(templateDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(templateDirectory, entry.name);
    const outputName = entry.name.endsWith(".tpl")
      ? entry.name.slice(0, -4)
      : entry.name;
    const targetPath = path.join(outputDirectory, outputName);

    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyTemplateTree(sourcePath, targetPath, replacements);
      continue;
    }

    if (entry.isFile()) {
      const templateContent = await readFile(sourcePath, "utf8");
      const renderedContent = applyReplacements(templateContent, replacements);
      await writeFile(targetPath, renderedContent, "utf8");
    }
  }
}

function applyReplacements(
  template: string,
  replacements: Record<string, string>,
): string {
  return Object.entries(replacements).reduce((accumulator, [token, value]) => {
    return accumulator.replaceAll(token, value);
  }, template);
}

async function assertOutputDirectoryIsWritable(
  outputDirectory: string,
): Promise<void> {
  try {
    const outputStats = await stat(outputDirectory);
    if (!outputStats.isDirectory()) {
      throw new Error(
        `Output path exists and is not a directory: ${outputDirectory}`,
      );
    }

    const entries = await readdir(outputDirectory);
    if (entries.length > 0) {
      throw new Error(
        `Output directory already exists and is not empty: ${outputDirectory}`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function renderCeremonyConfig(context: ScaffoldContext): string {
  const circuitsJson = JSON.stringify(context.circuits, null, 2);
  const tiersJson = JSON.stringify(context.tiers, null, 2);

  return `export interface CeremonyCircuitConfig {
  id: string;
  r1csFilename: string;
  initialZkeyBlobPath: string;
  initialZkeyBlobUrl: string;
}

export interface CeremonyConfig {
  name: string;
  targetContributions: number;
  endDate: string | null;
  stateManifestBlobUrl: string;
  circuits: CeremonyCircuitConfig[];
  tiers: {
    core: string[];
    popular: string[];
    all: string[];
  };
}

export const ceremonyConfig: CeremonyConfig = {
  name: ${JSON.stringify(context.projectName)},
  targetContributions: ${context.targetContributions},
  endDate: ${context.endDate ? JSON.stringify(context.endDate) : "null"},
  stateManifestBlobUrl: ${JSON.stringify(context.stateManifestBlobUrl)},
  circuits: ${circuitsJson},
  tiers: ${tiersJson}
};
`;
}

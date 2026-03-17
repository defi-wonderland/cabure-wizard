import { mkdir, readdir, copyFile } from "node:fs/promises";
import path from "node:path";

export async function copyR1csCircuitsFromPath(
  sourceDirectory: string,
  targetDirectory: string,
): Promise<string[]> {
  const discoveredFiles = await listFilesRecursively(sourceDirectory);
  const r1csFiles = discoveredFiles
    .filter((filePath) => filePath.endsWith(".r1cs"))
    .sort((a, b) => a.localeCompare(b));

  await mkdir(targetDirectory, { recursive: true });

  const copiedFilenames: string[] = [];
  const usedFilenames = new Set<string>();

  for (const filePath of r1csFiles) {
    const basename = path.basename(filePath);
    const uniqueFilename = getUniqueFilename(basename, usedFilenames);
    await copyFile(filePath, path.join(targetDirectory, uniqueFilename));
    copiedFilenames.push(uniqueFilename);
  }

  return copiedFilenames;
}

async function listFilesRecursively(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursively(entryPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function getUniqueFilename(
  initialFilename: string,
  usedFilenames: Set<string>,
): string {
  if (!usedFilenames.has(initialFilename)) {
    usedFilenames.add(initialFilename);
    return initialFilename;
  }

  const ext = path.extname(initialFilename);
  const stem = path.basename(initialFilename, ext);

  let attempt = 2;
  while (usedFilenames.has(`${stem}_${attempt}${ext}`)) {
    attempt += 1;
  }

  const finalName = `${stem}_${attempt}${ext}`;
  usedFilenames.add(finalName);
  return finalName;
}

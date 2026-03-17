import { access } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { stat } from "node:fs/promises";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validateProjectName(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Project name is required.");
  }

  if (trimmed.length > 80) {
    throw new Error("Project name must be 80 characters or fewer.");
  }

  return trimmed;
}

export function toProjectDirectoryName(projectName: string): string {
  return projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function validateTargetContributions(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Target contributions must be a positive integer.");
  }

  return value;
}

export function validateEndDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!DATE_REGEX.test(trimmed)) {
    throw new Error("End date must use YYYY-MM-DD format.");
  }

  const [year, month, day] = trimmed.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("End date is not a valid calendar date.");
  }

  return trimmed;
}

export async function validateExistingPath(
  inputPath: string,
  label: string,
): Promise<string> {
  const resolvedPath = path.resolve(inputPath.trim());
  if (!resolvedPath) {
    throw new Error(`${label} path is required.`);
  }

  try {
    await access(resolvedPath, constants.R_OK);

    const stats = await stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`${label} path must be a directory: ${resolvedPath}`);
    }

    return resolvedPath;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(`${label} path must be a directory`)
    ) {
      throw error;
    }

    throw new Error(
      `${label} path does not exist or is not readable: ${resolvedPath}`,
    );
  }
}

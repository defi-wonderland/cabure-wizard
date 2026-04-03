import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a temp directory and return helpers for file I/O within it */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cabure-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Write a Uint8Array to a temp file and return the path */
export async function writeTempFile(
  dir: string,
  name: string,
  data: Uint8Array,
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, data);
  return path;
}

/** Read a file into a Uint8Array (copied, not a view over the Buffer pool) */
export async function readFileAsBytes(path: string): Promise<Uint8Array> {
  const buf = await readFile(path);
  return new Uint8Array(buf);
}

/** Convert a Uint8Array to a 0x-prefixed hex string */
export function toHex(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

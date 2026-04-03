import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

import type {
  CliAuthInitResponse,
  CliAuthTokenResponse,
  StoredAuth,
} from "./types.js";
import { sleep } from "./utils.js";

const AUTH_DIR = join(homedir(), ".cabure");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

/**
 * Load a stored token for the given ceremony URL. Returns null if missing,
 * expired, or unreadable.
 */
export async function loadStoredAuth(
  ceremonyUrl: string,
): Promise<StoredAuth | null> {
  try {
    const raw = await readFile(AUTH_FILE, "utf-8");
    const entries = JSON.parse(raw) as StoredAuth[];
    const match = entries.find((e) => e.ceremonyUrl === ceremonyUrl);
    if (!match) return null;

    const now = Math.floor(Date.now() / 1000);
    if (match.expiresAt <= now) return null;
    return match;
  } catch {
    return null;
  }
}

async function saveAuth(auth: StoredAuth): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });

  let entries: StoredAuth[] = [];
  try {
    const raw = await readFile(AUTH_FILE, "utf-8");
    entries = JSON.parse(raw) as StoredAuth[];
  } catch {
    /* first write */
  }

  const filtered = entries.filter((e) => e.ceremonyUrl !== auth.ceremonyUrl);
  filtered.push(auth);
  await writeFile(AUTH_FILE, JSON.stringify(filtered, null, 2), { mode: 0o600 });
}

/**
 * Run the GitHub OAuth device flow (RFC 8628):
 * 1. Ask the ceremony server to initiate the device flow
 * 2. Display the user code and verification URI
 * 3. Poll the ceremony server until the user authorizes
 * 4. Store and return the CLI JWT
 */
export async function authenticate(ceremonyUrl: string): Promise<StoredAuth> {
  const existing = await loadStoredAuth(ceremonyUrl);
  if (existing) return existing;

  const initUrl = new URL("/api/ceremony/auth/cli", ceremonyUrl);
  const initResponse = await fetch(initUrl, { method: "POST" });
  if (!initResponse.ok) {
    const body = (await initResponse.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      body.error ?? `Failed to initiate auth (${initResponse.status})`,
    );
  }

  const { userCode, verificationUri, loginCode, interval, expiresIn } =
    (await initResponse.json()) as CliAuthInitResponse;

  console.log(
    `\n  Visit ${verificationUri} and enter code: ${userCode}\n`,
  );
  openBrowser(verificationUri);

  const pollUrl = new URL("/api/ceremony/auth/cli", ceremonyUrl);
  pollUrl.searchParams.set("code", loginCode);

  let pollInterval = interval * 1000;
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    const pollResponse = await fetch(pollUrl);

    if (pollResponse.status === 202) {
      const body = (await pollResponse.json()) as {
        interval?: number;
      };
      if (body.interval) {
        pollInterval = body.interval * 1000;
      }
      continue;
    }

    if (!pollResponse.ok) {
      const body = (await pollResponse.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        body.error ?? `Auth poll failed (${pollResponse.status})`,
      );
    }

    const data = (await pollResponse.json()) as CliAuthTokenResponse;
    const auth: StoredAuth = {
      ceremonyUrl,
      token: data.token,
      participantId: data.participantId,
      participantName: data.participantName,
      expiresAt: data.expiresAt,
    };

    await saveAuth(auth);
    console.log(`  Authenticated as ${data.participantName}\n`);
    return auth;
  }

  throw new Error(
    "Device code expired. Please run the command again to retry.",
  );
}

function openBrowser(url: string): void {
  try {
    new URL(url);
  } catch {
    return;
  }

  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execFileSync("open", [url], { stdio: "ignore" });
    } else if (platform === "win32") {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Process", url], { stdio: "ignore" });
    } else {
      execFileSync("xdg-open", [url], { stdio: "ignore" });
    }
  } catch {
    /* browser open is best-effort; URL is printed to console */
  }
}

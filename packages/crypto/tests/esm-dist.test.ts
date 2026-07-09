import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

// `import.meta.dirname` only exists on Node >= 20.11; the package engine is
// `node >=20`, so derive the dir from the module URL for full-range support.
const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(testDir, "..");
const DIST_ESM = resolve(packageDir, "dist", "esm", "index.js");

// Regression: the published ESM bundle must load in a pure-ESM Node context.
// A transitive dep (web-worker, via ffjavascript) calls require() for node
// built-ins; if esbuild bundles those without a createRequire banner the
// module throws `Dynamic require of "..." is not supported` on import, before
// any user code runs. See build.mjs. The `pretest` script builds dist first,
// so this validates the real shipped artifact and is never silently skipped.
describe("ESM dist bundle", () => {
  it("imports cleanly in a pure-ESM context", () => {
    const url = pathToFileURL(DIST_ESM).href;
    const script = `import(${JSON.stringify(url)}).then((m) => {
      if (typeof m.contribute !== "function") {
        console.error("missing exports");
        process.exit(2);
      }
      process.exit(0);
    }).catch((e) => {
      console.error(e.message);
      process.exit(1);
    });`;

    // Run in a fresh node process so we exercise the real ESM loader,
    // not vitest's transform pipeline.
    expect(() =>
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: packageDir,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});

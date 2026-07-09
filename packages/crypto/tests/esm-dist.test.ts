import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

const DIST_ESM = resolve(import.meta.dirname, "..", "dist", "esm", "index.js");

// Regression: the published ESM bundle must load in a pure-ESM Node context.
// A transitive dep (web-worker, via ffjavascript) calls require() for node
// built-ins; if esbuild bundles those without a createRequire banner the
// module throws `Dynamic require of "..." is not supported` on import, before
// any user code runs. See build.mjs.
describe("ESM dist bundle", () => {
  it.skipIf(!existsSync(DIST_ESM))(
    "imports cleanly in a pure-ESM context",
    () => {
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
          cwd: join(import.meta.dirname, ".."),
          stdio: "pipe",
        }),
      ).not.toThrow();
    },
  );
});

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { copyFileSync } from "node:fs";

// Emit declarations
execSync("npx tsc --emitDeclarationOnly", { stdio: "inherit" });

const shared = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  external: ["snarkjs"],
  platform: "node",
  target: "es2022",
  sourcemap: true,
};

// ESM
await build({
  ...shared,
  format: "esm",
  outfile: "dist/esm/index.js",
});

// CJS
await build({
  ...shared,
  format: "cjs",
  outfile: "dist/cjs/index.cjs",
});

// Worker bundle (browser target)
// snarkjs is externalized — the consumer's bundler (Vite/webpack)
// resolves it to the browser build at bundle time.
await build({
  entryPoints: ["src/worker/contribute.worker.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "dist/worker/contribute.worker.js",
  sourcemap: true,
  external: ["snarkjs"],
});

// Protocol bundle (browser target)
await build({
  entryPoints: ["src/worker/protocol.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "dist/worker/protocol.js",
  sourcemap: true,
});

// Copy .d.ts → .d.cts for CJS consumers
copyFileSync("dist/esm/index.d.ts", "dist/cjs/index.d.cts");

console.log("Build complete: ESM + CJS + Worker");

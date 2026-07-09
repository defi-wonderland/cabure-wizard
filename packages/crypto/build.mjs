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
// A transitive dep (web-worker, via ffjavascript) uses require() for node
// built-ins (url, vm, worker_threads). Bundled into ESM, esbuild rewrites
// these to a __require shim that throws in a pure-ESM context. Recreate a
// real require() via createRequire so those calls resolve at runtime.
await build({
  ...shared,
  format: "esm",
  outfile: "dist/esm/index.js",
  banner: {
    js: 'import { createRequire as __cr } from "module";\nconst require = __cr(import.meta.url);',
  },
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

// Protocol bundle – ESM (browser target)
await build({
  entryPoints: ["src/worker/protocol.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "dist/worker/protocol.js",
  sourcemap: true,
});

// Protocol bundle – CJS
await build({
  entryPoints: ["src/worker/protocol.ts"],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2022",
  outfile: "dist/worker/protocol.cjs",
  sourcemap: true,
});

// Entropy bundle – ESM (browser-safe, neutral platform)
// The shared HKDF primitive consumed by generated projects' browser hooks.
await build({
  entryPoints: ["src/entropy.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "dist/entropy/index.js",
  sourcemap: true,
});

// Entropy bundle – CJS
await build({
  entryPoints: ["src/entropy.ts"],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2022",
  outfile: "dist/entropy/index.cjs",
  sourcemap: true,
});

// Copy .d.ts → .d.cts for CJS consumers
copyFileSync("dist/esm/index.d.ts", "dist/cjs/index.d.cts");
copyFileSync("dist/esm/worker/protocol.d.ts", "dist/worker/protocol.d.cts");
copyFileSync("dist/esm/entropy.d.ts", "dist/entropy/index.d.cts");

console.log("Build complete: ESM + CJS + Worker");

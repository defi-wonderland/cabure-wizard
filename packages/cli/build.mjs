import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  outfile: "dist/index.js",
  sourcemap: true,
  external: ["@wonderland/cabure-crypto", "snarkjs"],
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire } from "node:module";',
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log("Build complete: dist/index.js");

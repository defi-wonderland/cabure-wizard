import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // snarkjs spins up worker threads (via ffjavascript + web-worker) for the
  // curve math that the contribute route's verifyChain runs (C-1b). These
  // packages must NOT be bundled: bundling rewrites the worker source so the
  // workers never start and the verify hangs forever. Required from
  // node_modules at runtime, the workers spawn normally.
  serverExternalPackages: ["snarkjs", "ffjavascript", "@wonderland/cabure-crypto"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    } else {
      // serverExternalPackages does not always catch snarkjs here, because
      // cabure-crypto is a transpiled local package and its snarkjs import gets
      // followed into the bundle. Force it at the webpack layer so
      // `require("snarkjs")` stays a runtime require resolved from node_modules.
      const externals = ["snarkjs", "ffjavascript", "web-worker"];
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, ...externals]
        : [config.externals, ...externals].filter(Boolean);
    }

    // ffjavascript's threadman uses a dynamic require() in web-worker that
    // webpack cannot statically analyze. The code works at runtime; suppress
    // the "Critical dependency" warning to reduce noise.
    config.module.exprContextCritical = false;

    return config;
  },
};

export default nextConfig;

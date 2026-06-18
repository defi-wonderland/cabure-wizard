import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // snarkjs spawns worker threads (ffjavascript + web-worker) for verifyChain's
  // curve math. Bundling rewrites the worker source, so workers never start and
  // verify hangs forever. Keep them external = runtime require from node_modules.
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
      // serverExternalPackages misses snarkjs when it is followed in through the
      // local cabure-crypto package. Force it here so require("snarkjs") stays a
      // runtime require from node_modules.
      const externals = ["snarkjs", "ffjavascript", "web-worker"];
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, ...externals]
        : [config.externals, ...externals].filter(Boolean);
    }

    // ffjavascript's threadman uses a dynamic require() webpack can't analyze.
    // Works at runtime; silence the "Critical dependency" warning.
    config.module.exprContextCritical = false;

    return config;
  },
};

export default nextConfig;

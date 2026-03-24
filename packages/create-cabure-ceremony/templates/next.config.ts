import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    // ffjavascript's threadman uses a dynamic require() in web-worker that
    // webpack cannot statically analyze. The code works at runtime; suppress
    // the "Critical dependency" warning to reduce noise.
    config.module.exprContextCritical = false;

    return config;
  },
};

export default nextConfig;

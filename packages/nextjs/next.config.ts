import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_HEDERA_NETWORK: process.env.NEXT_PUBLIC_HEDERA_NETWORK || process.env.HEDERA_NETWORK || "testnet",
  },
  /**
   * `@hmp/ledger` is consumed as TypeScript source and its internal imports use the
   * NodeNext style ("./money.js") so the same files run under tsx in the worker.
   * Webpack needs to be told that a ".js" specifier may actually be a ".ts" file.
   */
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;

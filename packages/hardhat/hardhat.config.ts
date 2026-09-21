import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
dotenv.config();

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-gas-reporter";

// Hedera JSON-RPC (Hashio). Override with HEDERA_RPC_URL for a private endpoint.
const hederaRpcUrl = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";

// Deployer/operator key. Resolution order:
//   1. __RUNTIME_DEPLOYER_PRIVATE_KEY (CI / harness)
//   2. HEDERA_OPERATOR_KEY (your .env)
//   3. the public Hardhat development key below.
//
// #3 is Hardhat's documented account #0 (`0xac09...ff80`), published in every
// Hardhat tutorial and funded only on the in-process `hardhat` network. It is NOT
// a secret and is deliberately present so that `yarn test` and a judge's fresh
// clone work with no .env at all. Never put a real key here.
const HARDHAT_DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const deployerPrivateKey =
  process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY ?? process.env.HEDERA_OPERATOR_KEY ?? HARDHAT_DEV_KEY;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    ],
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {},
    hederaTestnet: { url: hederaRpcUrl, accounts: [deployerPrivateKey], chainId: 296 },
    hederaMainnet: {
      url: process.env.HEDERA_MAINNET_RPC_URL || "https://mainnet.hashio.io/api",
      accounts: [deployerPrivateKey],
      chainId: 295,
    },
  },
  // Hedera is supported by the main Sourcify instance — no custom verifier needed.
  sourcify: { enabled: true },
  typechain: { outDir: "typechain-types", target: "ethers-v6" },
  gasReporter: { enabled: process.env.REPORT_GAS === "true", currency: "USD" },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};

export default config;

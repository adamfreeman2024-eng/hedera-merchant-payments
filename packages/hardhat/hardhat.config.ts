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

// Deployer/operator key: `yarn hardhat:account:generate` writes ./.account,
// or pass __RUNTIME_DEPLOYER_PRIVATE_KEY for CI.
const deployerPrivateKey =
  process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY ??
  process.env.HEDERA_OPERATOR_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

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

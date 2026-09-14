import { ethers, network } from "hardhat";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the deployment back from the chain and prints it — the "prove it exists"
 * command a reviewer runs after `yarn hardhat:deploy`.
 *
 *   yarn hardhat:verify:testnet
 */
async function main() {
  const file = join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `No deployment record at ${file}. Run \`yarn hardhat:deploy --network ${network.name}\` first.`
    );
  }
  const record = JSON.parse(readFileSync(file, "utf8")) as {
    address: string;
    txHash?: string;
    owner: string;
    operator: string;
    deployer: string;
  };

  const [signer] = await ethers.getSigners();
  const code = await ethers.provider.getCode(record.address);
  if (code === "0x") {
    throw new Error(`${record.address} has no bytecode on ${network.name} — not deployed (or wrong network).`);
  }

  const registry = await ethers.getContractAt("InvoiceRegistry", record.address);
  const owner = await registry.owner();
  const operator = await registry.operator();

  console.log(`network        : ${network.name}`);
  console.log(`registry       : ${record.address}`);
  console.log(`bytecode       : ${(code.length - 2) / 2} bytes`);
  console.log(`deploy tx      : ${record.txHash ?? "(not recorded)"}`);
  console.log(`owner          : ${owner}`);
  console.log(`gatewayOperator: ${operator}`);
  console.log(`deployer       : ${record.deployer}`);
  console.log(`caller balance : ${ethers.formatEther(await ethers.provider.getBalance(signer.address))} HBAR`);
  console.log(`\nVerify on HashScan: https://hashscan.io/${network.name === "hederaMainnet" ? "mainnet" : "testnet"}/contract/${record.address}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

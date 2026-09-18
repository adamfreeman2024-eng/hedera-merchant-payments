import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Deploys the InvoiceRegistry invoice ledger.
 *
 *   owner    — the merchant (can rotate the gateway key)
 *   operator — the gateway signer (creates invoices, attests HBAR settlements)
 *
 * Both default to the deployer for a quick testnet run; set INVOICE_OWNER and
 * GATEWAY_OPERATOR_ADDRESS in .env for the real two-party setup.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = ethers.getAddress(process.env.INVOICE_OWNER || deployer.address);
  const operator = ethers.getAddress(process.env.GATEWAY_OPERATOR_ADDRESS || deployer.address);

  console.log(`network : ${network.name}`);
  console.log(`deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`balance : ${ethers.formatEther(balance)} HBAR`);
  if (balance === 0n) {
    throw new Error("Deployer has no HBAR — fund it at https://portal.hedera.com/faucet");
  }

  const factory = await ethers.getContractFactory("InvoiceRegistry");
  const registry = await factory.deploy(operator, owner);
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  const deployment = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    address,
    owner,
    operator,
    deployedAt: new Date().toISOString(),
    deployTxHash: registry.deploymentTransaction()?.hash ?? null,
  };
  mkdirSync(join(__dirname, "..", "deployments"), { recursive: true });
  writeFileSync(
    join(__dirname, "..", "deployments", `${network.name}.json`),
    JSON.stringify(deployment, null, 2)
  );

  console.log(`\nInvoiceRegistry: ${address}`);
  console.log(`  owner (merchant) : ${owner}`);
  console.log(`  operator (gateway): ${operator}`);
  console.log(`  tx: ${deployment.deployTxHash}`);
  const router = process.env.SAUCERSWAP_ROUTER_EVM;
  if (router) {
    const tx = await registry.setSaucerRouter(ethers.getAddress(router));
    await tx.wait();
    console.log(`  saucerRouter: ${router}`);
  }
  console.log(`\nAdd to .env:\n  INVOICE_REGISTRY_ADDRESS=${address}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

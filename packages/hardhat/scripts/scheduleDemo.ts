import { ethers } from "hardhat";

/**
 * Live testnet: create a short HBAR invoice and HIP-1215-schedule its expiry.
 * Reads INVOICE_REGISTRY_ADDRESS from env. Never logs keys.
 */
async function main() {
  const address = process.env.INVOICE_REGISTRY_ADDRESS;
  if (!address) throw new Error("INVOICE_REGISTRY_ADDRESS is not set");
  const [signer] = await ethers.getSigners();
  const registry = await ethers.getContractAt("InvoiceRegistry", address);

  const id = ethers.keccak256(ethers.toUtf8Bytes(`hss-demo-${Date.now()}`));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 600);
  const memo = "HMP-HSSDEMO";

  const create = await registry.createInvoice(id, signer.address, ethers.ZeroAddress, 1_000_000n, expiresAt, memo);
  const createRec = await create.wait();
  console.log("createInvoice", create.hash, "status", createRec?.status);

  const sched = await registry.scheduleExpire(id);
  const schedRec = await sched.wait();
  console.log("scheduleExpire", sched.hash, "status", schedRec?.status);
  console.log("expireSchedule", await registry.expireSchedule(id));
  console.log("invoiceId", id);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

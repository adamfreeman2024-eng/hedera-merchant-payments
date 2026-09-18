import { ethers } from "hardhat";
import {
  AccountId,
  Client,
  PrivateKey,
  TokenAssociateTransaction,
  TokenId,
} from "@hashgraph/sdk";

/**
 * Live testnet: HBAR → SAUCE via SaucerSwap V1 router (router wraps WHBAR
 * internally — we never approve the WHBAR contract), then pay an invoice
 * denominated in WHBAR with SAUCE through InvoiceRegistry.payInvoiceWithSwap.
 *
 * Does not log keys.
 */

const ROUTER = "0x0000000000000000000000000000000000004b40";
const WHBAR = "0x0000000000000000000000000000000000003ad2";
const SAUCE = "0x0000000000000000000000000000000000120f46";
const SAUCE_ID = "0.0.1183558";
const WHBAR_ID = "0.0.15058";

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

async function associateIfNeeded() {
  const id = process.env.HEDERA_OPERATOR_ID;
  const key = process.env.HEDERA_OPERATOR_KEY;
  if (!id || !key) throw new Error("HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY missing");
  const client = Client.forTestnet().setOperator(AccountId.fromString(id), PrivateKey.fromStringECDSA(key));
  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(id)
      .setTokenIds([TokenId.fromString(SAUCE_ID), TokenId.fromString(WHBAR_ID)])
      .freezeWith(client);
    const signed = await tx.sign(PrivateKey.fromStringECDSA(key));
    const rec = await (await signed.execute(client)).getReceipt(client);
    console.log("associate status", rec.status.toString());
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (/TOKEN_ALREADY_ASSOCIATED|already associated/i.test(msg)) {
      console.log("associate already done");
    } else {
      console.log("associate:", msg.split("\n")[0]);
    }
  } finally {
    client.close();
  }
}

async function main() {
  const registryAddr = process.env.INVOICE_REGISTRY_ADDRESS;
  if (!registryAddr) throw new Error("INVOICE_REGISTRY_ADDRESS missing");
  await associateIfNeeded();

  const [signer] = await ethers.getSigners();
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, signer);
  const sauce = new ethers.Contract(SAUCE, ERC20_ABI, signer);
  const registry = await ethers.getContractAt("InvoiceRegistry", registryAddr);

  const hbarIn = ethers.parseEther("0.05");
  // WHBAR is 8 decimals; Hashio native HBAR is 18. Quote via 0.05 * 1e8 tinybar-equivalent WHBAR.
  const whbarIn = 5_000_000n; // 0.05 WHBAR
  const quoted = await router.getAmountsOut(whbarIn, [WHBAR, SAUCE]);
  const minSauce = quoted[1] - quoted[1] / 20n; // 5% slippage
  console.log("quote_0.05_WHBAR_to_SAUCE", quoted[1].toString(), "min", minSauce.toString());

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const swap = await router.swapExactETHForTokens(minSauce, [WHBAR, SAUCE], signer.address, deadline, {
    value: hbarIn,
  });
  const swapRec = await swap.wait();
  console.log("swapExactETHForTokens", swap.hash, "status", swapRec?.status);

  const sauceBal = await sauce.balanceOf(signer.address);
  console.log("sauceBalance", sauceBal.toString());
  if (sauceBal === 0n) throw new Error("swap left 0 SAUCE — cannot payInvoiceWithSwap");

  const payIn = sauceBal / 2n;
  const outQuoted = await router.getAmountsOut(payIn, [SAUCE, WHBAR]);
  const invoiceWhbar = outQuoted[1] - outQuoted[1] / 20n;
  console.log("swap_pay_in_SAUCE", payIn.toString(), "invoice_WHBAR_min", invoiceWhbar.toString());

  const id = ethers.keccak256(ethers.toUtf8Bytes(`swap-pay-${Date.now()}`));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const create = await registry.createInvoice(id, signer.address, WHBAR, invoiceWhbar, expiresAt, "HMP-SWAPDEMO");
  await create.wait();
  console.log("createInvoice", create.hash);

  const approve = await sauce.approve(registryAddr, payIn);
  await approve.wait();
  console.log("approve", approve.hash);

  const pay = await registry.payInvoiceWithSwap(id, payIn, [SAUCE, WHBAR], BigInt(Math.floor(Date.now() / 1000) + 600));
  const payRec = await pay.wait();
  console.log("payInvoiceWithSwap", pay.hash, "status", payRec?.status);
  const inv = await registry.getInvoice(id);
  console.log("invoiceStatus", inv.status.toString(), "payer", inv.payer);
}

main().catch((e) => {
  console.error((e as Error).message || e);
  process.exitCode = 1;
});

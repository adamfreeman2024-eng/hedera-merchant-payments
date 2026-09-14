import { ethers } from "hardhat";
import {
  AccountBalanceQuery,
  AccountId,
  Client,
  PrivateKey,
} from "@hashgraph/sdk";

/**
 * Shows which operator account the Hardhat side will use and what it can spend.
 *
 *   yarn hardhat:account
 */
async function main() {
  const id = process.env.HEDERA_OPERATOR_ID;
  const keyRaw = process.env.HEDERA_OPERATOR_KEY;
  if (!id || !keyRaw) {
    console.log("HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY are not set (see .env.example).");
    return;
  }

  const network = process.env.HEDERA_NETWORK || "testnet";
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  const key = PrivateKey.fromStringECDSA(keyRaw);
  client.setOperator(AccountId.fromString(id), key);

  const balance = await new AccountBalanceQuery().setAccountId(AccountId.fromString(id)).execute(client);
  const evmAlias = ethers.computeAddress("0x" + key.publicKey.toStringRaw());

  console.log(`network    : ${network}`);
  console.log(`account    : ${id}`);
  console.log(`key type   : ${key.type?.toString?.() ?? "ECDSA"}`);
  console.log(`EVM alias  : ${evmAlias}`);
  console.log(`balance    : ${balance.hbars.toString()}`);
  console.log(
    `\nHashScan   : https://hashscan.io/${network}/account/${id}`
  );
  client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

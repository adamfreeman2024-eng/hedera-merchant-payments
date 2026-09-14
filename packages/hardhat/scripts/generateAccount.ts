import { ethers, network } from "hardhat";
import {
  AccountBalanceQuery,
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
} from "@hashgraph/sdk";

/**
 * Creates (or prints) a gateway operator account.
 *
 *   yarn hardhat:account:generate              # fresh ECDSA key, no account created
 *   yarn hardhat:account:generate --create      # also creates the account on HEDERA_NETWORK
 *
 * A dedicated operator account is recommended over reusing your personal account:
 * the gateway needs it for HCS receipts, expiry and attestation — never for holding
 * customer funds.
 */
async function main() {
  const create = process.argv.includes("--create");
  const networkName = process.env.HEDERA_NETWORK || (network.name.includes("Mainnet") ? "mainnet" : "testnet");

  // ECDSA keys are the ones that carry an EVM alias, which the registry needs.
  const key = PrivateKey.generateECDSA();
  const evmAddress = ethers.computeAddress("0x" + key.publicKey.toStringRaw());

  console.log("new ECDSA operator key (store it in .env as HEDERA_OPERATOR_KEY):");
  console.log("  key (DER) :", key.toStringDer());
  console.log("  EVM alias :", evmAddress);

  if (!create) {
    console.log("\nRe-run with --create to also create the account on", networkName);
    return;
  }

  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKeyRaw = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKeyRaw) {
    throw new Error(
      "Creating an account needs a funded payer: set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY (see RUNBOOK step 1)."
    );
  }

  const client =
    networkName === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromStringECDSA(operatorKeyRaw)
  );

  const tx = await new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey)
    .setInitialBalance(new Hbar(Number(process.env.NEW_ACCOUNT_HBAR || 20)))
    .setAccountMemo("merchant-payments-operator")
    .execute(client);

  const receipt = await tx.getReceipt(client);
  const newId = receipt.accountId!.toString();
  const balance = await new AccountBalanceQuery().setAccountId(AccountId.fromString(newId)).execute(client);

  console.log("\naccount created:", newId, "| balance:", balance.hbars.toString());
  console.log("put these in .env:");
  console.log("  HEDERA_OPERATOR_ID=" + newId);
  console.log("  HEDERA_OPERATOR_KEY=<the DER key printed above>");
  client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

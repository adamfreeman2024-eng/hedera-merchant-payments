import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";

/**
 * HCS settlement receipts.
 *
 * Every settlement (or expiry/cancel) is appended to a single HCS topic, which
 * turns the gateway's invoice ledger into a tamper-evident, publicly auditable
 * trail: sequence number + consensus timestamp for each event. The ledger row
 * stores the sequence number, so anyone can cross-check the DB against HCS.
 */
export type ReceiptKind = "invoice.created" | "invoice.paid" | "invoice.expired" | "invoice.cancelled";

export type Receipt = {
  kind: ReceiptKind;
  invoiceId: string;
  merchantAccount: string;
  amount: string; // base units as string (JSON-safe)
  token: string;
  memo: string;
  paymentTxId?: string;
  paidBy?: string;
  settlementRef?: string;
  at: string; // ISO timestamp
};

export function hederaClient(network: string, operatorId: string, operatorKey: string): Client {
  const key = PrivateKey.fromStringECDSA(operatorKey);
  if (network === "mainnet") return Client.forMainnet().setOperator(operatorId, key);
  if (network === "local") return Client.forNetwork({ "127.0.0.1:50211": "0.0.3" }).setOperator(operatorId, key);
  return Client.forTestnet().setOperator(operatorId, key);
}

/** Creates the receipt topic (run once per environment; see `reconciler --init-topic`). */
export async function createReceiptTopic(client: Client, memo = "hmp-settlement-receipts"): Promise<string> {
  const tx = await new TopicCreateTransaction().setTopicMemo(memo).execute(client);
  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId;
  if (!topicId) throw new Error("HCS topic creation returned no topic id");
  return topicId.toString();
}

/**
 * Appends one receipt and returns its HCS sequence number.
 * @param client open Hedera client (operator pays the ~$0.0001 message fee)
 */
export async function submitReceipt(client: Client, topicId: string, receipt: Receipt): Promise<number> {
  const submit = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(JSON.stringify(receipt))
    .execute(client);
  const record = await submit.getRecord(client);
  const sequence = record.receipt.topicSequenceNumber;
  if (sequence == null) throw new Error("HCS submit returned no sequence number");
  return Number(sequence);
}

/** Mirror Node URL for an environment (used by the reconciler). */
export function mirrorNodeUrl(network: string): string {
  if (network === "mainnet") return "https://mainnet-public.mirrornode.hedera.com";
  return "https://testnet.mirrornode.hedera.com";
}

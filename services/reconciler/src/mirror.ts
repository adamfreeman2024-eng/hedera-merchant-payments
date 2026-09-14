import { parseMemo } from "@hmp/ledger";
import { mirrorNodeUrl } from "@hmp/ledger";

/**
 * Mirror Node client.
 *
 * Field names below are the ones the live Mirror Node actually returns
 * (verified against testnet.mirrornode.hedera.com):
 *   transaction_id      "0.0.10068225-1789313329-528782333"
 *   consensus_timestamp "1789313335.750275036"
 *   memo_base64         base64 of the memo string
 *   transfers[]         { account, amount, is_approval }  (tinybar, negative = sent)
 *   token_transfers[]   { token_id, account, amount }
 */

export type MirrorTransfer = { account: string; amount: number; is_approval?: boolean };
export type MirrorTokenTransfer = { token_id: string; account: string; amount: number };

export type MirrorTransaction = {
  transaction_id: string;
  consensus_timestamp: string;
  transaction_hash: string;
  name: string;
  result: string;
  memo_base64?: string;
  transfers?: MirrorTransfer[];
  token_transfers?: MirrorTokenTransfer[];
};

type MirrorPage = { transactions?: MirrorTransaction[]; links?: { next?: string | null } };

export function decodeMemo(memoBase64: string | undefined): string {
  if (!memoBase64) return "";
  try {
    return Buffer.from(memoBase64, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

export function consensusMillis(consensusTimestamp: string): number {
  const [seconds, nanos = "0"] = consensusTimestamp.split(".");
  return Number(seconds) * 1000 + Math.floor(Number(nanos.padEnd(9, "0").slice(0, 6)) / 1000);
}

/** Net amount (tinybar) an account received in this transaction (fees excluded). */
export function hbarReceivedBy(tx: MirrorTransaction, accountId: string): bigint {
  const entries = (tx.transfers ?? []).filter((t) => t.account === accountId);
  const net = entries.reduce((sum, t) => sum + BigInt(t.amount), 0n);
  return net > 0n ? net : 0n;
}

/** Net amount of an HTS token an account received in this transaction. */
export function tokenReceivedBy(tx: MirrorTransaction, accountId: string, tokenId: string): bigint {
  const entries = (tx.token_transfers ?? []).filter(
    (t) => t.account === accountId && (!tokenId || t.token_id === tokenId)
  );
  const net = entries.reduce((sum, t) => sum + BigInt(t.amount), 0n);
  return net > 0n ? net : 0n;
}

/** Extracts the invoice id referenced by a transfer memo (`HMP-<ID>`), or null. */
export function invoiceIdFromTransaction(tx: MirrorTransaction): string | null {
  return parseMemo(decodeMemo(tx.memo_base64));
}

export class MirrorNodeClient {
  constructor(private readonly network: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private get base() {
    return mirrorNodeUrl(this.network);
  }

  /**
   * Transactions involving an account since a timestamp, oldest first.
   *
   * Uses the ROOT endpoint with an `account.id` filter on purpose:
   * `/api/v1/accounts/{id}/transactions` answers 404 on Hedera testnet even when the
   * account exists and has activity, while `/api/v1/transactions?account.id=…` works.
   * A 404 from the mirror simply means "nothing in this range", not an error.
   */
  async transactionsForAccount(
    accountId: string,
    opts: { since?: number; limit?: number } = {}
  ): Promise<MirrorTransaction[]> {
    const limit = opts.limit ?? 100;
    const params = new URLSearchParams({ "account.id": accountId, limit: String(limit), order: "asc" });
    if (opts.since) params.set("timestamp", `gte:${(opts.since / 1000).toFixed(9)}`);
    const url = `${this.base}/api/v1/transactions?${params.toString()}`;

    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) return []; // empty result set
    if (!res.ok) throw new Error(`Mirror Node ${res.status} for ${url}`);
    const page = (await res.json()) as MirrorPage;
    return page.transactions ?? [];
  }

  /** Accounts that sent value to our merchant in a single transaction. */
  static sendersTo(tx: MirrorTransaction, accountId: string): string[] {
    const senders = (tx.transfers ?? [])
      .filter((t) => t.amount < 0 && t.account !== accountId && !t.account.startsWith("0.0.80"))
      .map((t) => t.account);
    return [...new Set(senders)];
  }

  /**
   * EVM address of a Hedera account (needed to register invoices on-chain).
   * ECDSA accounts always have an alias-derived EVM address; returns null otherwise.
   */
  async evmAddressOf(accountId: string): Promise<string | null> {
    const res = await this.fetchImpl(`${this.base}/api/v1/accounts/${accountId}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { evm_address?: string | null };
    return data.evm_address ?? null;
  }
}

import { PrismaClient } from "@hmp/ledger";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import {
  buildEnvelope,
  createInvoiceRecord,
  deliverWithRetry,
  hederaClient,
  invoiceChainId,
  InvoiceStatus,
  signPayload,
  submitReceipt,
  type Receipt,
} from "@hmp/ledger";
import type { Env } from "./env.js";
import {
  MirrorNodeClient,
  consensusMillis,
  hbarReceivedBy,
  invoiceIdFromTransaction,
  tokenReceivedBy,
  type MirrorTransaction,
} from "./mirror.js";

const REGISTRY_ABI = [
  "function createInvoice(bytes32 id, address merchant, address token, uint256 amount, uint64 expiresAt, string memo) external",
  "function attestHbarSettlement(bytes32 id, bytes32 hederaTxRef) external",
  "function expireInvoice(bytes32 id) external",
  "function getInvoice(bytes32 id) view returns (tuple(bytes32 id, address merchant, address token, uint256 amount, uint64 expiresAt, uint8 status, address payer, bytes32 settlementRef, string memo))",
];

export type ReconcileSummary = {
  scannedTransactions: number;
  matched: string[];
  settled: string[];
  expired: string[];
  receipts: number;
  webhooksSent: number;
  webhooksFailed: number;
  onChainAttested: string[];
  onChainRegistered: string[];
  errors: string[];
};

export type ReconcileOptions = {
  /** Settle on-chain through InvoiceRegistry (needs INVOICE_REGISTRY_ADDRESS + operator key). */
  attestOnChain?: boolean;
  /** Dry run: match and report, change nothing. */
  dryRun?: boolean;
  now?: Date;
};

/** On-chain invoice key — single source of truth lives in @hmp/ledger. */
export function chainIdOf(invoiceId: string): string {
  return invoiceChainId(invoiceId);
}

function registryContract(env: Env) {
  if (!env.registryAddress) return null;
  const rpc = env.network === "mainnet" ? "https://mainnet.hashio.io/api" : "https://testnet.hashio.io/api";
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(env.operatorKey, provider);
  return new Contract(env.registryAddress, REGISTRY_ABI, wallet);
}

/** Prisma returns Decimal for the amount column — normalise without losing precision. */
export function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  return BigInt(String(value));
}

export type SettleableInvoice = {
  id: string;
  merchantAccount: string;
  token: string;
  amount: unknown; // Prisma Decimal | bigint | number | string
  memo: string;
};

export class Reconciler {
  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaClient,
    private readonly mirror = new MirrorNodeClient(env.network),
    private readonly hcs = () => hederaClient(env.network, env.operatorId, env.operatorKey)
  ) {}

  /** One pass: match transfers → settle → receipt → notify → sweep expiries → retry webhooks. */
  async once(opts: ReconcileOptions = {}): Promise<ReconcileSummary> {
    const now = opts.now ?? new Date();
    const summary: ReconcileSummary = {
      scannedTransactions: 0,
      matched: [],
      settled: [],
      expired: [],
      receipts: 0,
      webhooksSent: 0,
      webhooksFailed: 0,
      onChainAttested: [],
      onChainRegistered: [],
      errors: [],
    };

    const open = await this.prisma.invoice.findMany({ where: { status: "OPEN" } });

    // 0. publish invoice terms on-chain so they are publicly verifiable before payment.
    if (opts.attestOnChain && !opts.dryRun && this.env.registryAddress) {
      for (const invoice of open) {
        try {
          const result = await this.ensureOnChainInvoice(invoice);
          if (result.registered) summary.onChainRegistered.push(invoice.id);
          else if (result.skipped && result.skipped !== "already on-chain") {
            summary.errors.push(`register ${invoice.id}: ${result.skipped}`);
          }
        } catch (error) {
          summary.errors.push(`register ${invoice.id}: ${(error as Error).message}`);
        }
      }
    }

    if (!open.length && !(await this.prisma.webhookDelivery.count({ where: { delivered: false } }))) {
      return summary;
    }

    // 1. pull recent activity for the merchant account (oldest first)
    const since = Math.min(
      ...open.map((i) => i.createdAt.getTime() - this.env.lookbackSeconds * 1000),
      now.getTime() - this.env.lookbackSeconds * 1000
    );
    let transactions: MirrorTransaction[] = [];
    try {
      transactions = await this.mirror.transactionsForAccount(this.env.merchantAccountId, { since, limit: 100 });
      summary.scannedTransactions = transactions.length;
    } catch (error) {
      summary.errors.push(`mirror: ${(error as Error).message}`);
      return summary;
    }

    const byMemo = new Map<string, typeof open>();
    for (const invoice of open) {
      const parsed = /^HMP-(.+)$/.exec(invoice.memo);
      if (!parsed) continue;
      const key = parsed[1];
      byMemo.set(key, [...(byMemo.get(key) ?? []), invoice]);
    }

    for (const tx of transactions) {
      if (tx.result !== "SUCCESS") continue;
      const invoiceId = invoiceIdFromTransaction(tx);
      if (!invoiceId) continue;

      const candidates = byMemo.get(invoiceId.toUpperCase()) ?? byMemo.get(invoiceId) ?? [];
      for (const invoice of candidates) {
        if (invoice.status !== "OPEN") continue;
        summary.matched.push(invoice.id);

        const expected = asBigInt(invoice.amount);
        const received =
          invoice.token === "HBAR"
            ? hbarReceivedBy(tx, this.env.merchantAccountId)
            : tokenReceivedBy(tx, this.env.merchantAccountId, invoice.token);

        if (received < expected || received === 0n) {
          summary.errors.push(
            `underpaid ${invoice.id}: expected ${expected} got ${received} (tx ${tx.transaction_id})`
          );
          continue;
        }

        if (opts.dryRun) {
          summary.settled.push(`${invoice.id} [dry-run]`);
          continue;
        }

        const payer = MirrorNodeClient.sendersTo(tx, this.env.merchantAccountId)[0] ?? null;
        await this.settle(invoice, { payer, txId: tx.transaction_id, consensusAt: consensusMillis(tx.consensus_timestamp) });
        summary.settled.push(invoice.id);

        if (this.env.hcsTopicId) {
          summary.receipts += 1;
        }

        if (opts.attestOnChain && invoice.token === "HBAR") {
          try {
            const contract = registryContract(this.env);
            if (contract) {
              const onChain = await contract.attestHbarSettlement(
                chainIdOf(invoice.id),
                keccak256(toUtf8Bytes(tx.transaction_id))
              );
              await onChain.wait();
              await this.prisma.invoice.update({
                where: { id: invoice.id },
                data: { onChainTxHash: onChain.hash },
              });
              summary.onChainAttested.push(invoice.id);
            }
          } catch (error) {
            summary.errors.push(`attest ${invoice.id}: ${(error as Error).message}`);
          }
        }
      }
    }

    // 2. expire stale invoices
    for (const invoice of open) {
      if (invoice.status !== "OPEN") continue;
      if (invoice.expiresAt.getTime() > now.getTime()) continue;
      if (opts.dryRun) {
        summary.expired.push(`${invoice.id} [dry-run]`);
        continue;
      }
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: "EXPIRED" } });
      await this.appendReceipt(invoice, "invoice.expired", (s) => (summary.receipts += s));
      await this.enqueueWebhook(invoice, "invoice.expired");
      summary.expired.push(invoice.id);
    }

    // 3. flush pending webhooks
    const pending = await this.prisma.webhookDelivery.findMany({
      where: { delivered: false, attempts: { lt: 5 } },
      include: { invoice: true },
      orderBy: { createdAt: "asc" },
      take: 25,
    });
    for (const delivery of pending) {
      const envelope = buildEnvelope(delivery.event as any, delivery.payload as Record<string, unknown>);
      const result = await deliverWithRetry(delivery.url, this.env.webhookSecret, envelope);
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: delivery.attempts + 1,
          delivered: result.ok,
          statusCode: result.statusCode ?? null,
          lastError: result.error ?? null,
          signature: signPayload(this.env.webhookSecret, envelope.timestamp, JSON.stringify(envelope.body)),
        },
      });
      if (result.ok) summary.webhooksSent += 1;
      else summary.webhooksFailed += 1;
    }

    return summary;
  }

  /**
   * Publishes invoice terms on the InvoiceRegistry so anyone can verify them before paying.
   * Idempotent: skips invoices that are already registered on-chain.
   */
  async ensureOnChainInvoice(
    invoice: SettleableInvoice & { expiresAt: Date }
  ): Promise<{ registered: boolean; skipped?: string }> {
    const contract = registryContract(this.env);
    if (!contract) return { registered: false, skipped: "no registry address configured" };

    const chainId = chainIdOf(invoice.id);
    const current = await contract.getInvoice(chainId);
    if (Number(current.status) !== 0) return { registered: false, skipped: "already on-chain" };

    const merchantEvm = await this.mirror.evmAddressOf(invoice.merchantAccount);
    if (!merchantEvm) return { registered: false, skipped: "merchant account has no EVM alias" };

    const tokenAddress = invoice.token === "HBAR" ? ZeroAddress : ZeroAddress; // HTS path sets the token address when enabled
    const tx = await contract.createInvoice(
      chainId,
      merchantEvm,
      tokenAddress,
      asBigInt(invoice.amount),
      Math.floor(invoice.expiresAt.getTime() / 1000),
      invoice.memo
    );
    await tx.wait();
    return { registered: true };
  }

  /** Marks the invoice paid, writes the HCS receipt and queues the webhook. */
  async settle(
    invoice: SettleableInvoice,
    payment: { payer: string | null; txId: string; consensusAt: number }
  ) {
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "SETTLED",
        settledAt: new Date(payment.consensusAt),
        paidBy: payment.payer,
        paymentTxId: payment.txId,
      },
    });
    const updated = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    await this.appendReceipt(
      { ...invoice, id: invoice.id } as any,
      "invoice.paid",
      () => {},
      { paymentTxId: payment.txId, paidBy: payment.payer ?? undefined }
    );
    await this.enqueueWebhook(updated as any, "invoice.paid");
  }

  private async appendReceipt(
    invoice: SettleableInvoice,
    kind: Receipt["kind"],
    count: (n: number) => void,
    extra: { paymentTxId?: string; paidBy?: string } = {}
  ) {
    if (!this.env.hcsTopicId) return;
    const receipt: Receipt = {
      kind,
      invoiceId: invoice.id,
      merchantAccount: invoice.merchantAccount,
      amount: String(invoice.amount),
      token: invoice.token,
      memo: invoice.memo,
      at: new Date().toISOString(),
      ...extra,
    };
    try {
      const client = this.hcs();
      const sequence = await submitReceipt(client, this.env.hcsTopicId, receipt);
      client.close();
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { hcsSequence: sequence } });
      count(1);
    } catch (error) {
      // A missing receipt must not lose a settlement: the ledger row is already written.
      console.error(`[hcs] receipt failed for ${invoice.id}: ${(error as Error).message}`);
    }
  }

  private async enqueueWebhook(invoice: any, event: "invoice.paid" | "invoice.expired" | "invoice.cancelled") {
    if (!this.env.webhookUrl) return;
    const body = {
      invoiceId: invoice.id,
      status: event === "invoice.paid" ? "SETTLED" : event === "invoice.expired" ? "EXPIRED" : "CANCELLED",
      amount: String(invoice.amount),
      token: invoice.token,
      memo: invoice.memo,
      merchantAccount: invoice.merchantAccount,
      paymentTxId: invoice.paymentTxId ?? null,
      paidBy: invoice.paidBy ?? null,
      hcsSequence: invoice.hcsSequence ?? null,
      settledAt: invoice.settledAt ? new Date(invoice.settledAt).toISOString() : null,
    };
    const envelope = buildEnvelope(event, body);
    await this.prisma.webhookDelivery.create({
      data: {
        invoiceId: invoice.id,
        event,
        url: this.env.webhookUrl,
        payload: body,
        signature: signPayload(this.env.webhookSecret, envelope.timestamp, JSON.stringify(body)),
      },
    });
  }
}

/** Convenience wrapper used by the CLI and the smoke script. */
export async function createInvoice(
  prisma: PrismaClient,
  env: Env,
  input: { id: string; amount: bigint; token?: string; ttlMinutes?: number }
) {
  const record = createInvoiceRecord({
    id: input.id,
    merchantAccount: env.merchantAccountId,
    token: input.token ?? "HBAR",
    amount: input.amount,
    expiresAt: new Date(Date.now() + (input.ttlMinutes ?? 30) * 60_000),
  });

  await prisma.invoice.create({
    data: {
      id: record.id,
      chainId: Buffer.from(record.chainId.slice(2), "hex"),
      merchantId: "default",
      merchantAccount: record.merchantAccount,
      token: record.token,
      amount: record.amount.toString(),
      memo: record.memo,
      status: "OPEN",
      expiresAt: record.expiresAt,
    },
  });
  await prisma.invoice.update({ where: { id: record.id }, data: { status: "OPEN" } });
  return record;
}

export { InvoiceStatus };

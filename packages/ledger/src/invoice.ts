import { createHash } from "node:crypto";
import { buildMemo } from "./money.js";

/** Mirrors the Solidity enum order in InvoiceRegistry.Status. */
export const InvoiceStatus = {
  NONE: 0,
  OPEN: 1,
  SETTLED: 2,
  CANCELLED: 3,
  EXPIRED: 4,
} as const;

export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const statusName: Record<number, "OPEN" | "SETTLED" | "CANCELLED" | "EXPIRED"> = {
  1: "OPEN",
  2: "SETTLED",
  3: "CANCELLED",
  4: "EXPIRED",
};

export type InvoiceDraft = {
  id: string;
  merchantAccount: string; // 0.0.x that receives the money
  token: string; // "HBAR" or an HTS token id
  tokenEvmAddress?: string | null;
  amount: bigint; // base units
  expiresAt: Date;
  now?: Date;
};

export type InvoiceRecord = InvoiceDraft & {
  status: InvoiceStatus;
  memo: string;
  chainId: string; // 0x… bytes32 used on-chain
  createdAt: Date;
};

/** The on-chain invoice key: keccak-free deterministic hash of the invoice id. */
export function invoiceChainId(invoiceId: string): `0x${string}` {
  return `0x${createHash("sha3-256").update(`hmp:${invoiceId.toLowerCase()}`).digest("hex")}`;
}

export class InvoiceRuleError extends Error {}

export function createInvoiceRecord(draft: InvoiceDraft): InvoiceRecord {
  const now = draft.now ?? new Date();
  if (!/^0\.0\.\d+$/.test(draft.merchantAccount)) {
    throw new InvoiceRuleError(`Invalid merchant account id: ${draft.merchantAccount}`);
  }
  if (draft.token !== "HBAR" && !/^0\.0\.\d+$/.test(draft.token)) {
    throw new InvoiceRuleError(`Invalid token id: ${draft.token}`);
  }
  if (draft.amount <= 0n) throw new InvoiceRuleError("Amount must be greater than zero");
  if (draft.expiresAt.getTime() <= now.getTime()) throw new InvoiceRuleError("Expiry must be in the future");

  return {
    ...draft,
    status: InvoiceStatus.OPEN,
    memo: buildMemo(draft.id),
    chainId: invoiceChainId(draft.id),
    createdAt: now,
  };
}

export function isPayable(invoice: { status: InvoiceStatus; expiresAt: Date }, now = new Date()): boolean {
  return invoice.status === InvoiceStatus.OPEN && invoice.expiresAt.getTime() > now.getTime();
}

/** Only OPEN invoices may transition; every transition is one-way. */
export function markSettled(
  invoice: InvoiceRecord,
  payment: { paidBy: string; paymentTxId: string }
): InvoiceRecord {
  if (invoice.status !== InvoiceStatus.OPEN) {
    throw new InvoiceRuleError(`Cannot settle an invoice in status ${statusName[invoice.status] ?? invoice.status}`);
  }
  return { ...invoice, status: InvoiceStatus.SETTLED, ...payment } as InvoiceRecord;
}

export function markExpired(invoice: InvoiceRecord, now = new Date()): InvoiceRecord {
  if (invoice.status !== InvoiceStatus.OPEN) throw new InvoiceRuleError("Only open invoices expire");
  if (invoice.expiresAt.getTime() > now.getTime()) throw new InvoiceRuleError("Invoice has not expired yet");
  return { ...invoice, status: InvoiceStatus.EXPIRED };
}

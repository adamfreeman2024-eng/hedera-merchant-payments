import type { PrismaClient } from "@prisma/client";
import { createInvoiceRecord } from "./invoice.js";
import { toBaseUnits } from "./money.js";

/**
 * Persistence for invoices — one source of truth used by both the web app and the
 * worker, so the on-chain key, memo format and state machine stay identical.
 */

export type CreateInvoiceInput = {
  id?: string;
  merchantAccount: string;
  token?: string;
  /** Human amount, e.g. "0.5" (HBAR) or "25.00" (HTS token). */
  amount: string | number;
  /** Decimals of the currency: 8 for HBAR, token decimals for HTS. */
  decimals?: number;
  ttlMinutes?: number;
  meta?: Record<string, unknown>;
};

export function newInvoiceId(prefix = "INV"): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
}

export async function createInvoiceInDb(
  db: PrismaClient,
  input: CreateInvoiceInput
): Promise<{ id: string; memo: string; amount: bigint; expiresAt: Date; chainId: string }> {
  const token = input.token || "HBAR";
  const decimals = input.decimals ?? (token === "HBAR" ? 8 : 2);
  const id = input.id ?? newInvoiceId();
  const ttlMinutes = input.ttlMinutes ?? 30;

  const record = createInvoiceRecord({
    id,
    merchantAccount: input.merchantAccount,
    token,
    amount: toBaseUnits(input.amount, decimals),
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  });

  await db.invoice.create({
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

  return {
    id: record.id,
    memo: record.memo,
    amount: record.amount,
    expiresAt: record.expiresAt,
    chainId: record.chainId,
  };
}

export function listInvoices(db: PrismaClient, take = 50) {
  return db.invoice.findMany({ orderBy: { createdAt: "desc" }, take });
}

export function getInvoiceById(db: PrismaClient, id: string) {
  return db.invoice.findUnique({ where: { id }, include: { webhooks: { orderBy: { createdAt: "desc" }, take: 5 } } });
}

/** Marks an open invoice cancelled (merchant action; the contract also allows it on-chain). */
export async function cancelInvoiceInDb(db: PrismaClient, id: string) {
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) return { ok: false as const, reason: "not found" };
  if (invoice.status !== "OPEN") return { ok: false as const, reason: `already ${invoice.status.toLowerCase()}` };
  await db.invoice.update({ where: { id }, data: { status: "CANCELLED" } });
  return { ok: true as const };
}

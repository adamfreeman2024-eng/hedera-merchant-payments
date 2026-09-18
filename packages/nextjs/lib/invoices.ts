import { fromBaseUnits, invoiceChainId, InvoiceStatus } from "@hmp/ledger";
import { config, explorerTransaction, hasDatabase, hasHcsTopic } from "./config";
import { withDb } from "./db";
import { createInvoiceInDb } from "@hmp/ledger";
import { cancelInvoiceInDb, getInvoiceById, listInvoices } from "@hmp/ledger";

export type InvoiceView = {
  id: string;
  status: "OPEN" | "SETTLED" | "CANCELLED" | "EXPIRED";
  amount: string;
  amountDisplay: string;
  token: string;
  tokenDisplay: string;
  memo: string;
  merchantAccount: string;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
  settledAt: string | null;
  paidBy: string | null;
  paymentTxId: string | null;
  paymentLink: string | null;
  hcsSequence: number | null;
  onChainTxHash: string | null;
  checkoutPath: string;
  chainId: string;
};

const decimalsFor = (token: string, tokenDecimals?: number | null) =>
  token === "HBAR" ? 8 : (tokenDecimals ?? 2);

type Row = {
  id: string;
  status: string;
  amount: unknown;
  token: string;
  memo: string;
  merchantAccount: string;
  createdAt: Date;
  expiresAt: Date;
  settledAt: Date | null;
  paidBy: string | null;
  paymentTxId: string | null;
  hcsSequence: number | null;
  onChainTxHash: string | null;
};

export function toView(row: Row): InvoiceView {
  const token = row.token;
  const decimals = decimalsFor(token);
  const raw = BigInt(String(row.amount));
  const expiredButOpen = row.status === "OPEN" && row.expiresAt.getTime() < Date.now();
  return {
    id: row.id,
    status: (row.status === "OPEN" && expiredButOpen ? "EXPIRED" : row.status) as InvoiceView["status"],
    amount: raw.toString(),
    amountDisplay: fromBaseUnits(raw, decimals),
    token,
    tokenDisplay: token === "HBAR" ? "HBAR" : `HTS ${token}`,
    memo: row.memo,
    merchantAccount: row.merchantAccount,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    isExpired: expiredButOpen,
    settledAt: row.settledAt?.toISOString() ?? null,
    paidBy: row.paidBy,
    paymentTxId: row.paymentTxId,
    paymentLink: row.paymentTxId ? explorerTransaction(row.paymentTxId) : null,
    hcsSequence: row.hcsSequence,
    onChainTxHash: row.onChainTxHash,
    checkoutPath: `/pay/${row.id}`,
    chainId: invoiceChainId(row.id),
  };
}

export type LedgerState =
  | { ok: true; invoices: InvoiceView[] }
  | { ok: false; reason: string };

export async function loadInvoices(): Promise<LedgerState> {
  if (!hasDatabase()) {
    return { ok: false, reason: "DATABASE_URL is not set — the ledger is not configured yet (see RUNBOOK step 2)." };
  }
  const result = await withDb((db) => listInvoices(db, 50));
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, invoices: result.data.map(toView) };
}

export async function loadInvoice(id: string): Promise<InvoiceView | null> {
  const result = await withDb((db) => getInvoiceById(db, id));
  if (!result.ok || !result.data) return null;
  return toView(result.data as unknown as Row);
}

export type CreateResult =
  | { ok: true; invoice: InvoiceView }
  | { ok: false; error: string; status: number };

export async function createInvoice(input: {
  amount: string | number;
  token?: string;
  ttlMinutes?: number;
}): Promise<CreateResult> {
  if (!hasDatabase()) {
    return { ok: false, error: "Ledger not configured (DATABASE_URL missing).", status: 503 };
  }
  if (!config.merchantAccountId) {
    return { ok: false, error: "MERCHANT_ACCOUNT_ID is not set — invoices need a destination account.", status: 503 };
  }

  const token = input.token && input.token !== "HBAR" ? input.token : config.paymentTokenId || "HBAR";
  const result = await withDb((db) =>
    createInvoiceInDb(db, {
      merchantAccount: config.merchantAccountId,
      token,
      amount: input.amount,
      ttlMinutes: input.ttlMinutes ?? config.defaultInvoiceTtlMinutes,
    })
  );
  if (!result.ok) return { ok: false, error: result.reason, status: 400 };

  const invoice = await loadInvoice(result.data.id);
  if (!invoice) return { ok: false, error: "invoice created but could not be read back", status: 500 };
  return { ok: true, invoice };
}

export async function cancelInvoice(id: string) {
  return withDb((db) => cancelInvoiceInDb(db, id));
}

export const gatewayStatus = {
  database: hasDatabase(),
  merchant: Boolean(config.merchantAccountId),
  registry: Boolean(config.registryAddress),
  receipts: hasHcsTopic(),
  network: config.network,
  statuses: Object.keys(InvoiceStatus),
};

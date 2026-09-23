import type { Receipt, ReceiptKind } from "./hcs.js";

export type MirrorMessage = {
  consensus_timestamp?: string;
  message?: string;
  sequence_number?: number | string;
  topic_id?: string;
};

export type ReconstructedInvoice = {
  invoiceId: string;
  kind: ReceiptKind;
  merchantAccount: string;
  amount: string;
  token: string;
  memo: string;
  paymentTxId?: string;
  paidBy?: string;
  settlementRef?: string;
  at: string;
  hcsSequence: number;
  topicId: string;
  consensusTimestamp?: string;
};

export type ReconstructReport = {
  topicId: string;
  messagesSeen: number;
  skipped: number;
  invoices: ReconstructedInvoice[];
  /** invoiceId → last event. One-way: paid/cancelled/expired beat created. */
  latest: Record<string, ReconstructedInvoice>;
};

const KINDS: ReceiptKind[] = ["invoice.created", "invoice.paid", "invoice.expired", "invoice.cancelled"];

const RANK: Record<ReceiptKind, number> = {
  "invoice.created": 1,
  "invoice.paid": 2,
  "invoice.cancelled": 2,
  "invoice.expired": 2,
};

export function decodeMirrorMessage(raw: string): unknown {
  const buf = Buffer.from(raw, "base64");
  const text = buf.toString("utf8");
  return JSON.parse(text) as unknown;
}

export function parseReceipt(value: unknown): Receipt | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || !KINDS.includes(v.kind as ReceiptKind)) return null;
  if (typeof v.invoiceId !== "string" || !v.invoiceId) return null;
  if (typeof v.merchantAccount !== "string") return null;
  if (typeof v.amount !== "string" && typeof v.amount !== "number") return null;
  if (typeof v.token !== "string") return null;
  if (typeof v.memo !== "string") return null;
  if (typeof v.at !== "string") return null;
  return {
    kind: v.kind as ReceiptKind,
    invoiceId: v.invoiceId,
    merchantAccount: v.merchantAccount,
    amount: String(v.amount),
    token: v.token,
    memo: v.memo,
    paymentTxId: typeof v.paymentTxId === "string" ? v.paymentTxId : undefined,
    paidBy: typeof v.paidBy === "string" ? v.paidBy : undefined,
    settlementRef: typeof v.settlementRef === "string" ? v.settlementRef : undefined,
    at: v.at,
  };
}

function toRow(receipt: Receipt, msg: MirrorMessage, topicId: string): ReconstructedInvoice {
  return {
    invoiceId: receipt.invoiceId,
    kind: receipt.kind,
    merchantAccount: receipt.merchantAccount,
    amount: receipt.amount,
    token: receipt.token,
    memo: receipt.memo,
    paymentTxId: receipt.paymentTxId,
    paidBy: receipt.paidBy,
    settlementRef: receipt.settlementRef,
    at: receipt.at,
    hcsSequence: Number(msg.sequence_number ?? 0),
    topicId,
    consensusTimestamp: msg.consensus_timestamp,
  };
}

/**
 * Fold a list of Mirror topic messages into per-invoice latest state.
 * Malformed messages are counted in `skipped` and never invent a receipt.
 */
export function reconstructFromMessages(topicId: string, messages: MirrorMessage[]): ReconstructReport {
  const invoices: ReconstructedInvoice[] = [];
  let skipped = 0;
  for (const msg of messages) {
    if (!msg.message) {
      skipped += 1;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = decodeMirrorMessage(msg.message);
    } catch {
      skipped += 1;
      continue;
    }
    const receipt = parseReceipt(parsed);
    if (!receipt) {
      skipped += 1;
      continue;
    }
    invoices.push(toRow(receipt, msg, topicId));
  }

  const latest: Record<string, ReconstructedInvoice> = {};
  for (const row of invoices) {
    const prev = latest[row.invoiceId];
    if (!prev) {
      latest[row.invoiceId] = row;
      continue;
    }
    const betterRank = RANK[row.kind] > RANK[prev.kind];
    const laterSeq = row.hcsSequence > prev.hcsSequence;
    if (betterRank || (RANK[row.kind] === RANK[prev.kind] && laterSeq)) {
      latest[row.invoiceId] = row;
    }
  }

  return { topicId, messagesSeen: messages.length, skipped, invoices, latest };
}

export type FetchJson = (url: string) => Promise<{
  messages?: MirrorMessage[];
  links?: { next?: string | null };
}>;

/**
 * Walk Mirror Node `/api/v1/topics/{id}/messages` following `links.next`.
 * Caps pages so a huge topic cannot hang a judge's laptop.
 */
export async function fetchTopicMessages(
  mirrorBase: string,
  topicId: string,
  fetchJson: FetchJson,
  opts: { maxPages?: number } = {}
): Promise<MirrorMessage[]> {
  const maxPages = opts.maxPages ?? 20;
  const out: MirrorMessage[] = [];
  let url: string | null = `${mirrorBase.replace(/\/$/, "")}/api/v1/topics/${topicId}/messages?limit=100`;
  for (let page = 0; page < maxPages && url; page++) {
    const body = await fetchJson(url);
    out.push(...(body.messages ?? []));
    const next = body.links?.next;
    url = next ? (next.startsWith("http") ? next : `${mirrorBase.replace(/\/$/, "")}${next}`) : null;
  }
  return out;
}

export async function reconstructTopic(
  mirrorBase: string,
  topicId: string,
  fetchJson: FetchJson
): Promise<ReconstructReport> {
  const messages = await fetchTopicMessages(mirrorBase, topicId, fetchJson);
  return reconstructFromMessages(topicId, messages);
}

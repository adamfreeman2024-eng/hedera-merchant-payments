import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Signed webhooks.
 *
 * Every delivery carries:
 *   X-HMP-Event       invoice.paid | invoice.expired | invoice.cancelled
 *   X-HMP-Delivery    unique delivery id (idempotency key for the merchant)
 *   X-HMP-Signature   sha256=<hex hmac of `${timestamp}.${rawBody}`>
 *   X-HMP-Timestamp   unix seconds (replay window)
 */
export type WebhookEvent = "invoice.paid" | "invoice.expired" | "invoice.cancelled";

export type WebhookEnvelope = {
  event: WebhookEvent;
  deliveryId: string;
  timestamp: number;
  body: Record<string, unknown>;
};

const REPLAY_WINDOW_SECONDS = 300;

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `sha256=${mac}`;
}

export function buildEnvelope(event: WebhookEvent, body: Record<string, unknown>): WebhookEnvelope {
  return { event, deliveryId: randomUUID(), timestamp: Math.floor(Date.now() / 1000), body };
}

/** Headers a merchant needs to verify; kept separate so both sides share one source of truth. */
export function webhookHeaders(secret: string, envelope: WebhookEnvelope): Record<string, string> {
  const raw = JSON.stringify(envelope.body);
  return {
    "content-type": "application/json",
    "x-hmp-event": envelope.event,
    "x-hmp-delivery": envelope.deliveryId,
    "x-hmp-timestamp": String(envelope.timestamp),
    "x-hmp-signature": signPayload(secret, envelope.timestamp, raw),
  };
}

/** Receiver-side verification helper — exported so merchants can copy it verbatim. */
export function verifySignature(
  secret: string,
  headerSignature: string,
  timestampHeader: string,
  rawBody: string,
  now = Math.floor(Date.now() / 1000)
): boolean {
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) return false;
  const expected = signPayload(secret, timestamp, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(headerSignature ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type DeliveryResult = { ok: boolean; statusCode?: number; error?: string };

/**
 * Delivers with bounded exponential backoff. Never throws: the caller records the
 * outcome in the ledger and a later pass retries what is still undelivered.
 */
export async function deliverWithRetry(
  url: string,
  secret: string,
  envelope: WebhookEnvelope,
  opts: { attempts?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<DeliveryResult> {
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const raw = JSON.stringify(envelope.body);

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: webhookHeaders(secret, envelope),
        body: raw,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { ok: true, statusCode: res.status };
      lastError = `HTTP ${res.status}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // permanent client error
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
  }
  return { ok: false, error: lastError };
}

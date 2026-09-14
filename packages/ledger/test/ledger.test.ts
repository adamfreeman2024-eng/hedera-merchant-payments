import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildMemo,
  fromBaseUnits,
  parseMemo,
  settlementMatches,
  toBaseUnits,
  toTinybar,
} from "../src/money.js";
import {
  InvoiceRuleError,
  InvoiceStatus,
  createInvoiceRecord,
  invoiceChainId,
  isPayable,
  markExpired,
  markSettled,
} from "../src/invoice.js";
import { buildEnvelope, signPayload, verifySignature } from "../src/webhook.js";

describe("money", () => {
  it("converts HBAR to tinybar without float drift", () => {
    assert.equal(toTinybar("1"), 100_000_000n);
    assert.equal(toTinybar("0.00000001"), 1n);
    assert.equal(toTinybar("12,5"), 1_250_000_000n);
    assert.equal(toTinybar("1 000"), 100_000_000_000n);
  });

  it("rejects malformed or over-precise amounts", () => {
    assert.throws(() => toBaseUnits("1.123456789", 8), /Too many decimal places/);
    assert.throws(() => toBaseUnits("abc", 8), /Not a valid amount/);
  });

  it("round-trips base units", () => {
    assert.equal(fromBaseUnits(100_000_000n, 8), "1");
    assert.equal(fromBaseUnits(1_500_000n, 8), "0.015");
    assert.equal(fromBaseUnits(0n, 8), "0");
    assert.equal(fromBaseUnits(toBaseUnits("42.42", 2), 2), "42.42");
  });

  it("builds and parses the strict payment memo", () => {
    assert.equal(buildMemo("inv-2026-0001"), "HMP-INV20260001");
    assert.equal(parseMemo("HMP-INV20260001"), "INV20260001");
    assert.equal(parseMemo("random memo"), null);
    assert.equal(parseMemo(undefined), null);
  });

  it("only matches exact settlements by default", () => {
    assert.equal(settlementMatches(100n, 100n), true);
    assert.equal(settlementMatches(100n, 99n), false);
    assert.equal(settlementMatches(100n, 99n, 1n), true);
    assert.equal(settlementMatches(100n, 90n, 1n), false);
    assert.equal(settlementMatches(0n, 0n), false);
  });
});

describe("invoice", () => {
  const draft = () => ({
    id: "INV-2026-0001",
    merchantAccount: "0.0.123456",
    token: "HBAR" as const,
    amount: toTinybar("0.5"),
    expiresAt: new Date(Date.now() + 3600_000),
  });

  it("creates an open invoice with a memo and a deterministic chain id", () => {
    const rec = createInvoiceRecord(draft());
    assert.equal(rec.status, InvoiceStatus.OPEN);
    assert.equal(rec.memo, "HMP-INV20260001");
    assert.match(rec.chainId, /^0x[0-9a-f]{64}$/);
    assert.equal(rec.chainId, invoiceChainId("INV-2026-0001"));
    assert.equal(rec.chainId, invoiceChainId("inv-2026-0001"));
  });

  it("validates the merchant account, token and expiry", () => {
    assert.throws(() => createInvoiceRecord({ ...draft(), merchantAccount: "123" }), InvoiceRuleError);
    assert.throws(() => createInvoiceRecord({ ...draft(), amount: 0n }), /greater than zero/);
    assert.throws(
      () => createInvoiceRecord({ ...draft(), expiresAt: new Date(Date.now() - 1000) }),
      /must be in the future/
    );
  });

  it("is payable only while open and unexpired", () => {
    const rec = createInvoiceRecord(draft());
    assert.equal(isPayable(rec), true);
    assert.equal(isPayable(rec, new Date(rec.expiresAt.getTime() + 1)), false);
    assert.equal(isPayable(markSettled(rec, { paidBy: "0.0.9", paymentTxId: "0.0.9@1.1" })), false);
  });

  it("enforces one-way transitions", () => {
    const rec = createInvoiceRecord(draft());
    const settled = markSettled(rec, { paidBy: "0.0.9", paymentTxId: "0.0.9@1.1" });
    assert.equal(settled.status, InvoiceStatus.SETTLED);
    assert.throws(() => markSettled(settled, { paidBy: "0.0.9", paymentTxId: "x" }), /Cannot settle/);
    assert.throws(() => markExpired(rec), /has not expired yet/);

    const past = createInvoiceRecord({ ...draft(), expiresAt: new Date(Date.now() + 50) });
    const later = new Date(Date.now() + 5000);
    assert.equal(markExpired(past, later).status, InvoiceStatus.EXPIRED);
  });
});

describe("webhooks", () => {
  it("signs and verifies the raw body with a replay window", () => {
    const secret = "whsec_test";
    const envelope = buildEnvelope("invoice.paid", { invoiceId: "INV-1", amount: "1000" });
    const raw = JSON.stringify(envelope.body);
    const signature = signPayload(secret, envelope.timestamp, raw);

    assert.equal(verifySignature(secret, signature, String(envelope.timestamp), raw), true);
    assert.equal(verifySignature("whsec_other", signature, String(envelope.timestamp), raw), false);
    assert.equal(verifySignature(secret, signature, String(envelope.timestamp), raw + " "), false);
    assert.equal(verifySignature(secret, signature, String(envelope.timestamp - 10_000), raw), false);
  });
});

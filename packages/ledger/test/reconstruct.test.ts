import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reconstructFromMessages, reconstructTopic, parseReceipt } from "../src/reconstruct.js";

const paid = {
  kind: "invoice.paid",
  invoiceId: "INV-MU1G1FSW443",
  merchantAccount: "0.0.10068225",
  amount: "50000000",
  token: "HBAR",
  memo: "HMP-INVMU1G1FSW443",
  at: "2026-09-14T16:16:45.561Z",
  paymentTxId: "0.0.10541152-1789402480-818444585",
};

describe("parseReceipt", () => {
  it("accepts a well-formed HCS receipt and rejects junk", () => {
    assert.equal(parseReceipt(paid)?.invoiceId, "INV-MU1G1FSW443");
    assert.equal(parseReceipt({ kind: "nope", invoiceId: "x" }), null);
    assert.equal(parseReceipt("not json object"), null);
  });
});

describe("reconstructFromMessages", () => {
  it("skips malformed messages and keeps the later paid event", () => {
    const created = {
      kind: "invoice.created",
      invoiceId: "INV-MU1G1FSW443",
      merchantAccount: "0.0.10068225",
      amount: "50000000",
      token: "HBAR",
      memo: "HMP-INVMU1G1FSW443",
      at: "2026-09-14T16:00:00.000Z",
    };
    const messages = [
      { sequence_number: 1, message: Buffer.from(JSON.stringify(created)).toString("base64") },
      { sequence_number: 2, message: Buffer.from("not-json").toString("base64") },
      { sequence_number: 3, message: Buffer.from(JSON.stringify(paid)).toString("base64") },
    ];
    const report = reconstructFromMessages("0.0.10541151", messages);
    assert.equal(report.messagesSeen, 3);
    assert.equal(report.skipped, 1);
    assert.equal(report.invoices.length, 2);
    assert.equal(report.latest["INV-MU1G1FSW443"].kind, "invoice.paid");
    assert.equal(report.latest["INV-MU1G1FSW443"].hcsSequence, 3);
    assert.equal(report.latest["INV-MU1G1FSW443"].paymentTxId, paid.paymentTxId);
  });
});

describe("reconstructTopic pagination", () => {
  it("follows links.next and stops", async () => {
    const pages: Record<string, { messages: { sequence_number: number; message: string }[]; links: { next: string | null } }> = {
      "https://mirror.example/api/v1/topics/0.0.1/messages?limit=100": {
        messages: [{ sequence_number: 1, message: Buffer.from(JSON.stringify(paid)).toString("base64") }],
        links: { next: "/api/v1/topics/0.0.1/messages?limit=100&timestamp=lt:1" },
      },
      "https://mirror.example/api/v1/topics/0.0.1/messages?limit=100&timestamp=lt:1": {
        messages: [],
        links: { next: null },
      },
    };
    const report = await reconstructTopic("https://mirror.example", "0.0.1", async (url) => pages[url]);
    assert.equal(report.messagesSeen, 1);
    assert.equal(report.latest["INV-MU1G1FSW443"].kind, "invoice.paid");
  });
});

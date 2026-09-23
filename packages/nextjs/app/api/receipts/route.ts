import { NextResponse } from "next/server";
import { reconstructTopic } from "@hmp/ledger";
import { config, mirrorBase } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Public, credential-free receipt lookup.
 * Rebuilds invoice state from an HCS topic via the Mirror Node — no database.
 *
 *   GET /api/receipts?topic=0.0.10541151
 *   GET /api/receipts?topic=0.0.10541151&id=INV-MU1G1FSW443
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const topic = (url.searchParams.get("topic") || config.hcsTopicId || "").trim();
  const id = (url.searchParams.get("id") || "").trim();
  if (!topic) {
    return NextResponse.json(
      { ok: false, error: "Pass ?topic=0.0.x (or set HCS_RECEIPT_TOPIC_ID). No database is used." },
      { status: 400 }
    );
  }

  try {
    const report = await reconstructTopic(mirrorBase(), topic, async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`Mirror HTTP ${res.status}`);
      return res.json();
    });
    if (id) {
      const row = report.latest[id];
      if (!row) return NextResponse.json({ ok: false, error: `Invoice ${id} is not on topic ${topic}`, topic, messagesSeen: report.messagesSeen }, { status: 404 });
      return NextResponse.json({ ok: true, topic, messagesSeen: report.messagesSeen, skipped: report.skipped, receipt: row });
    }
    return NextResponse.json({
      ok: true,
      topic,
      messagesSeen: report.messagesSeen,
      skipped: report.skipped,
      invoices: Object.keys(report.latest).length,
      latest: report.latest,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "reconstruct failed" }, { status: 502 });
  }
}

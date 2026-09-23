import Link from "next/link";
import { reconstructTopic } from "@hmp/ledger";
import { explorerTopic, explorerTransaction, mirrorBase, publicConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ topic?: string; id?: string }> };

export default async function ReceiptPage({ searchParams }: Props) {
  const q = await searchParams;
  const topic = (q.topic || publicConfig.hcsTopicId || "").trim();
  const id = (q.id || "").trim();

  if (!topic) {
    return (
      <div className="card space-y-3">
        <h1 className="text-xl font-semibold">Verify a receipt</h1>
        <p className="text-sm text-zinc-300">
          This page talks only to the public Mirror Node. It does not use the gateway database, so a judge (or a
          merchant&apos;s auditor) can rebuild the ledger from the HCS topic alone.
        </p>
        <form className="grid gap-3 md:grid-cols-2" action="/receipt" method="get">
          <label className="text-xs text-zinc-400">
            HCS topic
            <input name="topic" placeholder="0.0.10541151" className="mt-1 w-full rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm" />
          </label>
          <label className="text-xs text-zinc-400">
            Invoice id (optional)
            <input name="id" placeholder="INV-…" className="mt-1 w-full rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm" />
          </label>
          <button type="submit" className="rounded-md bg-acc px-4 py-2 text-sm font-medium text-ink md:col-span-2">
            Reconstruct from HCS
          </button>
        </form>
        <p className="text-xs text-zinc-500">
          CLI equivalent: <code className="mono">yarn reconstruct --topic 0.0.x [--invoice INV-…]</code>
        </p>
      </div>
    );
  }

  let error: string | null = null;
  let report: Awaited<ReturnType<typeof reconstructTopic>> | null = null;
  try {
    report = await reconstructTopic(mirrorBase(), topic, async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`Mirror HTTP ${res.status}`);
      return res.json();
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "reconstruct failed";
  }

  const row = id && report ? report.latest[id] : null;
  const rows = report ? (id ? (row ? [row] : []) : Object.values(report.latest)) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Receipts from HCS</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Topic{" "}
          <a href={explorerTopic(topic)} className="mono text-acc hover:underline" target="_blank" rel="noreferrer">
            {topic} ↗
          </a>
          {report ? ` · ${report.messagesSeen} messages · ${report.skipped} skipped · ${Object.keys(report.latest).length} invoices` : null}
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {error}
        </p>
      ) : null}

      {id && report && !row ? (
        <p className="text-sm text-zinc-300">
          Invoice <code className="mono">{id}</code> is not on this topic. The topic exists; this id was never appended.
        </p>
      ) : null}

      {rows.map((r) => (
        <div key={`${r.invoiceId}-${r.hcsSequence}`} className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{r.invoiceId}</h2>
            <span className="text-xs uppercase tracking-wider text-zinc-400">{r.kind}</span>
          </div>
          <dl className="mt-3 grid gap-1 text-sm">
            <div>
              <span className="text-zinc-400">amount · token: </span>
              <span className="mono">
                {r.amount} {r.token}
              </span>
            </div>
            <div>
              <span className="text-zinc-400">merchant: </span>
              <span className="mono">{r.merchantAccount}</span>
            </div>
            <div>
              <span className="text-zinc-400">memo: </span>
              <span className="mono">{r.memo}</span>
            </div>
            <div>
              <span className="text-zinc-400">HCS sequence: </span>#{r.hcsSequence}
              {r.consensusTimestamp ? <span className="text-zinc-500"> · consensus {r.consensusTimestamp}</span> : null}
            </div>
            {r.paymentTxId ? (
              <div>
                <span className="text-zinc-400">settlement: </span>
                <a href={explorerTransaction(r.paymentTxId)} className="mono text-acc hover:underline" target="_blank" rel="noreferrer">
                  {r.paymentTxId} ↗
                </a>
              </div>
            ) : null}
            {r.paidBy ? (
              <div>
                <span className="text-zinc-400">payer: </span>
                <span className="mono">{r.paidBy}</span>
              </div>
            ) : null}
          </dl>
        </div>
      ))}

      <p className="text-xs text-zinc-500">
        Source of truth is the HCS topic, not this page. Re-run:{" "}
        <code className="mono">yarn reconstruct --topic {topic}{id ? ` --invoice ${id}` : ""}</code>
      </p>
      <Link href="/" className="inline-block text-sm text-acc hover:underline">
        ← Back
      </Link>
    </div>
  );
}

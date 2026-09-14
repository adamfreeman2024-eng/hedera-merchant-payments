import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import { explorerAccount, explorerContract, explorerTopic, publicConfig } from "@/lib/config";
import { gatewayStatus, loadInvoices } from "@/lib/invoices";

export const dynamic = "force-dynamic";

function GatewayStrip() {
  const items: { label: string; ok: boolean; hint?: string }[] = [
    { label: "ledger (Postgres)", ok: gatewayStatus.database },
    { label: "merchant account", ok: gatewayStatus.merchant },
    { label: "InvoiceRegistry", ok: gatewayStatus.registry },
    { label: "HCS receipts", ok: gatewayStatus.receipts },
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-2 text-xs">
      {items.map((item) => (
        <span
          key={item.label}
          className={`rounded-md border px-2 py-1 ${item.ok ? "border-acc/40 text-acc" : "border-warn/40 text-warn"}`}
          title={item.hint}
        >
          {item.ok ? "● " : "○ "}
          {item.label}
          {item.ok ? "" : " — not configured"}
        </span>
      ))}
      {publicConfig.registryAddress ? (
        <a
          href={explorerContract(publicConfig.registryAddress)}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-edge px-2 py-1 text-zinc-400 hover:text-acc"
        >
          registry on HashScan ↗
        </a>
      ) : null}
      {publicConfig.hcsTopicId ? (
        <a
          href={explorerTopic(publicConfig.hcsTopicId)}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-edge px-2 py-1 text-zinc-400 hover:text-acc"
        >
          receipt topic ↗
        </a>
      ) : null}
    </div>
  );
}

export default async function DashboardPage() {
  const state = await loadInvoices();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Customers pay these invoices directly to {publicConfig.merchantAccountId || "the merchant account"} — the
            gateway only verifies, receipts and notifies.
          </p>
        </div>
        {publicConfig.merchantAccountId ? (
          <a
            href={explorerAccount(publicConfig.merchantAccountId)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-zinc-400 hover:text-acc"
          >
            merchant account on HashScan ↗
          </a>
        ) : null}
      </div>

      <GatewayStrip />

      {!state.ok ? (
        <div className="card border-warn/40">
          <h2 className="font-semibold text-warn">Ledger not configured yet</h2>
          <p className="mt-2 text-sm text-zinc-300">
            This dashboard renders without any credentials on purpose. To store and reconcile invoices, set up the
            ledger:
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
            <li>
              <code className="mono">cp .env.example .env</code> and set <code className="mono">DATABASE_URL</code> +{" "}
              <code className="mono">MERCHANT_ACCOUNT_ID</code>
            </li>
            <li>
              <code className="mono">yarn ledger:up &amp;&amp; yarn db:migrate</code>
            </li>
            <li>
              <code className="mono">yarn hardhat:deploy --network hederaTestnet</code> then start the worker with{" "}
              <code className="mono">yarn reconciler:dev</code>
            </li>
          </ol>
          <p className="mt-3 text-xs text-zinc-500">Reason reported by the ledger layer: {state.reason}</p>
        </div>
      ) : state.invoices.length === 0 ? (
        <div className="card">
          <h2 className="font-semibold">No invoices yet</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Create the first one — the checkout link is payable from any Hedera wallet.
          </p>
          <Link
            href="/new"
            className="mt-4 inline-block rounded-md bg-acc px-4 py-2 text-sm font-medium text-ink hover:opacity-90"
          >
            New invoice
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="py-2 pr-4">Invoice</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Memo</th>
                <th className="py-2 pr-4">Expires</th>
                <th className="py-2 pr-4">Settlement</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {state.invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b border-edge/60 align-top">
                  <td className="py-3 pr-4 font-medium">{invoice.id}</td>
                  <td className="py-3 pr-4">
                    {invoice.amountDisplay} <span className="text-zinc-400">{invoice.tokenDisplay}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={invoice.status} />
                  </td>
                  <td className="py-3 pr-4">
                    <code className="mono text-xs">{invoice.memo}</code>
                  </td>
                  <td className="py-3 pr-4 text-xs text-zinc-400">{new Date(invoice.expiresAt).toLocaleString()}</td>
                  <td className="py-3 pr-4 text-xs">
                    {invoice.status === "SETTLED" ? (
                      <div className="space-y-1">
                        {invoice.paymentLink ? (
                          <a
                            href={invoice.paymentLink}
                            target="_blank"
                            rel="noreferrer"
                            className="block text-acc hover:underline"
                          >
                            tx {invoice.paymentTxId?.slice(0, 18)}… ↗
                          </a>
                        ) : (
                          <span className="text-zinc-300">{invoice.paymentTxId}</span>
                        )}
                        <span className="block text-zinc-400">
                          HCS receipt: {invoice.hcsSequence != null ? `#${invoice.hcsSequence}` : "pending"}
                        </span>
                      </div>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <Link href={invoice.checkoutPath} className="text-acc hover:underline">
                      checkout ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

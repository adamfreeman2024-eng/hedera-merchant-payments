import Link from "next/link";
import QRCode from "qrcode";
import CopyField from "@/components/CopyField";
import PayPanel from "@/components/PayPanel";
import StatusBadge from "@/components/StatusBadge";
import { explorerAccount, explorerTopic, explorerTransaction, publicConfig } from "@/lib/config";
import { loadInvoice } from "@/lib/invoices";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ invoiceId: string }> };

export default async function CheckoutPage({ params }: Props) {
  const { invoiceId } = await params;
  const invoice = await loadInvoice(invoiceId);

  if (!invoice) {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold">Invoice not found</h1>
        <p className="mt-2 text-sm text-zinc-300">
          <code className="mono">{invoiceId}</code> is not in this gateway&apos;s ledger. Check the link, or create a new
          invoice.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-acc hover:underline">
          ← Back to invoices
        </Link>
      </div>
    );
  }

  const qrSvg = await QRCode.toString(`/pay/${invoice.id}`, {
    type: "svg",
    margin: 1,
    width: 200,
    color: { dark: "#e5e7eb", light: "#00000000" },
  }).catch(() => "");

  const settled = invoice.status === "SETTLED";
  const payable = invoice.status === "OPEN";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Invoice {invoice.id}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {invoice.amountDisplay} {invoice.tokenDisplay} · created {new Date(invoice.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      {settled ? (
        <div className="card border-sky-400/40">
          <h2 className="font-semibold text-sky-300">Paid</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <div>
              <span className="text-zinc-400">settled: </span>
              {invoice.settledAt ? new Date(invoice.settledAt).toLocaleString() : "—"}
            </div>
            <div>
              <span className="text-zinc-400">payer: </span>
              <span className="mono">{invoice.paidBy ?? "observed on-chain"}</span>
            </div>
            <div>
              <span className="text-zinc-400">payment: </span>
              {invoice.paymentLink ? (
                <a href={invoice.paymentLink} target="_blank" rel="noreferrer" className="mono text-acc hover:underline">
                  {invoice.paymentTxId} ↗
                </a>
              ) : (
                <span className="mono">{invoice.paymentTxId ?? "—"}</span>
              )}
            </div>
            <div>
              <span className="text-zinc-400">HCS receipt: </span>
              {invoice.hcsSequence != null ? (
                publicConfig.hcsTopicId ? (
                  <a href={explorerTopic(publicConfig.hcsTopicId)} target="_blank" rel="noreferrer" className="text-acc hover:underline">
                    sequence #{invoice.hcsSequence} ↗
                  </a>
                ) : (
                  <span className="mono">#{invoice.hcsSequence}</span>
                )
              ) : (
                <span className="text-zinc-500">pending (no receipt topic configured)</span>
              )}
            </div>
          </dl>
        </div>
      ) : payable ? (
        <>
          <div className="card">
            <div className="label mb-1">Amount to pay</div>
            <div className="text-4xl font-semibold tracking-tight">
              {invoice.amountDisplay} <span className="text-xl text-zinc-400">{invoice.tokenDisplay}</span>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Expires {new Date(invoice.expiresAt).toLocaleString()} — an unpaid invoice is reported as EXPIRED after
              that.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <CopyField
              label="Merchant account (destination)"
              value={invoice.merchantAccount}
              hint="Funds go here directly — the gateway never holds them."
            />
            <CopyField
              label="Payment memo (required)"
              value={invoice.memo}
              emphasis
              hint="A transfer without this exact memo cannot be reconciled automatically."
            />
          </div>
        </>
      ) : (
        <div className="card border-warn/40">
          <h2 className="font-semibold text-warn">
            {invoice.status === "EXPIRED" ? "This invoice expired" : "This invoice was cancelled"}
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            No payment is expected. Ask the merchant for a fresh invoice.
          </p>
        </div>
      )}

      {payable ? (
        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          <div className="card flex flex-col items-center justify-center gap-2">
            {qrSvg ? (
              <div
                className="h-[200px] w-[200px]"
                aria-label="Checkout link QR code"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : null}
            <p className="text-center text-[11px] text-zinc-500">
              Scan to reopen this checkout page on the payer&apos;s phone
            </p>
          </div>
          <PayPanel
            hasInjectedWalletHint={false}
            tokenConfigured={Boolean(publicConfig.paymentTokenId)}
            registryConfigured={Boolean(publicConfig.registryAddress)}
            network={publicConfig.network}
          />
        </div>
      ) : null}

      <div className="text-xs text-zinc-500">
        Verify independently:{" "}
        <a
          href={explorerAccount(invoice.merchantAccount)}
          target="_blank"
          rel="noreferrer"
          className="text-acc hover:underline"
        >
          merchant account on HashScan ↗
        </a>{" "}
        · mirror node API:{" "}
        <code className="mono">/api/v1/accounts/{invoice.merchantAccount}/transactions</code>
        {invoice.settledAt && invoice.paymentTxId ? (
          <>
            {" "}
            ·{" "}
            <a href={explorerTransaction(invoice.paymentTxId)} target="_blank" rel="noreferrer" className="text-acc hover:underline">
              settlement tx ↗
            </a>
          </>
        ) : null}
      </div>

      <Link href="/" className="inline-block text-sm text-acc hover:underline">
        ← Back to invoices
      </Link>
    </div>
  );
}

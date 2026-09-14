import NewInvoiceForm from "@/components/NewInvoiceForm";
import { publicConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function NewInvoicePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New invoice</h1>
        <p className="mt-1 text-sm text-zinc-400">
          The customer pays this invoice directly to{" "}
          <code className="mono">{publicConfig.merchantAccountId || "the merchant account (not configured yet)"}</code>.
          Nothing is routed through the gateway.
        </p>
      </div>
      <NewInvoiceForm defaultToken={publicConfig.paymentTokenId} />
    </div>
  );
}

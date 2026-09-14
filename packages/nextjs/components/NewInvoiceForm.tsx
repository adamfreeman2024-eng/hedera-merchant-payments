"use client";

import { useState } from "react";
import Link from "next/link";
import CopyField from "@/components/CopyField";

type CreatedInvoice = {
  id: string;
  amountDisplay: string;
  tokenDisplay: string;
  memo: string;
  expiresAt: string;
  checkoutPath: string;
  merchantAccount: string;
};

export default function NewInvoiceForm({ defaultToken }: { defaultToken: string }) {
  const [amount, setAmount] = useState("0.5");
  const [token, setToken] = useState(defaultToken || "HBAR");
  const [ttlMinutes, setTtlMinutes] = useState(30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvoice | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, token, ttlMinutes: Number(ttlMinutes) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        // 400 = validation (e.g. "abc" as an amount); 503 = ledger not configured.
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      setCreated(data.invoice as CreatedInvoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-4">
        <div className="card border-acc/40">
          <h2 className="font-semibold text-acc">Invoice {created.id} is open</h2>
          <p className="mt-1 text-sm text-zinc-300">
            {created.amountDisplay} {created.tokenDisplay} · expires {new Date(created.expiresAt).toLocaleString()}
          </p>
          <p className="mt-3 text-sm text-zinc-300">
            Send the customer the checkout link — it shows the exact amount and the memo they must include.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={created.checkoutPath}
              className="rounded-md bg-acc px-4 py-2 text-sm font-medium text-ink hover:opacity-90"
            >
              Open checkout page
            </Link>
            <Link href="/" className="rounded-md border border-edge px-4 py-2 text-sm hover:border-acc/60 hover:text-acc">
              Back to invoices
            </Link>
          </div>
        </div>
        <CopyField
          label="Payment memo (must match exactly)"
          value={created.memo}
          emphasis
          hint="The reconciliation worker only settles an invoice when a transfer carries this memo to the merchant account."
        />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-5">
      <div>
        <label className="label mb-1 block" htmlFor="amount">
          Amount
        </label>
        <input
          id="amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="mono w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-acc/60"
          placeholder="0.5"
        />
        <p className="mt-1 text-xs text-zinc-500">
          HBAR: up to 8 decimals (tinybar). For an HTS token the token&apos;s decimals apply.
        </p>
      </div>

      <div>
        <label className="label mb-1 block" htmlFor="token">
          Currency
        </label>
        <select
          id="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="mono w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-acc/60"
        >
          <option value="HBAR">HBAR</option>
          {defaultToken && defaultToken !== "HBAR" ? <option value={defaultToken}>HTS {defaultToken}</option> : null}
        </select>
      </div>

      <div>
        <label className="label mb-1 block" htmlFor="ttl">
          Expires in (minutes)
        </label>
        <input
          id="ttl"
          type="number"
          min={1}
          max={43200}
          value={ttlMinutes}
          onChange={(e) => setTtlMinutes(Number(e.target.value))}
          className="mono w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-acc/60"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-acc px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create invoice"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard field used for the payment memo and account id — the two values a
 * customer must reproduce exactly for the HBAR path to reconcile.
 */
export default function CopyField({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="card">
      <div className="label mb-1">{label}</div>
      <div className="flex items-center gap-3">
        <code className={`mono flex-1 break-all ${emphasis ? "text-lg font-semibold text-acc" : "text-sm"}`}>
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-edge px-2.5 py-1 text-xs hover:border-acc/60 hover:text-acc"
          aria-label={`Copy ${label}`}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      {hint ? <p className="mt-2 text-xs text-zinc-400">{hint}</p> : null}
    </div>
  );
}

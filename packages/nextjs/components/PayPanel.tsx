"use client";

import { useState } from "react";

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/**
 * Wallet affordance for the checkout page.
 *
 * HBAR path: a native Hedera transfer carrying the memo — done from a Hedera wallet
 * (HashPack/Hashgraph portal). Note honestly that EVM wallets cannot attach a Hedera memo,
 * which is why the EVM flow is the HTS token path: approve (HIP-336) + the registry's
 * atomic transferFrom.
 */
export default function PayPanel({
  hasInjectedWalletHint,
  tokenConfigured,
  registryConfigured,
  network,
}: {
  hasInjectedWalletHint: boolean;
  tokenConfigured: boolean;
  registryConfigured: boolean;
  network: string;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const provider = typeof window !== "undefined" ? window.ethereum : undefined;
      if (!provider) {
        setError(
          "No browser wallet detected. Install HashPack (or another Hedera wallet) and reload — or pay with a native transfer using the account and memo above."
        );
        return;
      }
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts?.[0] ?? null);
      if (!accounts?.length) setError("Wallet returned no accounts.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "wallet connection was rejected");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="card">
      <h2 className="font-semibold">Pay from a wallet</h2>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={connect}
          disabled={connecting}
          className="rounded-md bg-acc px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
        >
          {connecting ? "Connecting…" : address ? "Wallet connected" : "Connect wallet"}
        </button>
        {address ? (
          <code className="mono text-xs text-acc">{address.slice(0, 10)}…{address.slice(-6)}</code>
        ) : null}
        {!hasInjectedWalletHint ? (
          <span className="text-xs text-zinc-500">No injected wallet detected in this browser yet.</span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      <div className="mt-5 space-y-4 text-sm">
        <div>
          <div className="label mb-1">Path A — HBAR (native transfer, memo required)</div>
          <p className="text-zinc-300">
            Send the exact amount to the merchant account from a Hedera wallet and paste the memo. The worker matches
            memo + amount + destination on the Mirror Node, then marks the invoice settled and writes the HCS receipt.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            EVM wallets (MetaMask-style) cannot attach a Hedera memo — an EVM HBAR transfer will not reconcile.
          </p>
        </div>

        <div>
          <div className="label mb-1">Path B — HTS token (atomic, EVM-friendly)</div>
          {tokenConfigured ? (
            <p className="text-zinc-300">
              Approve the registry for the invoice amount (HIP-336), then call{" "}
              <code className="mono">payInvoiceWithHts</code>. Tokens move payer → merchant inside the same transaction
              as the status change, so the invoice cannot be marked paid without the transfer succeeding.
            </p>
          ) : (
            <p className="text-zinc-400">
              Not enabled for this deployment: set <code className="mono">PAYMENT_TOKEN_ID</code> to accept an HTS token
              (e.g. testnet USDC) alongside HBAR.
            </p>
          )}
          {!registryConfigured ? (
            <p className="mt-1 text-xs text-warn">
              InvoiceRegistry address is not configured, so the token path is unavailable (deploy with{" "}
              <code className="mono">yarn hardhat:deploy --network hedera{network === "mainnet" ? "Mainnet" : "Testnet"}</code>
              ).
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

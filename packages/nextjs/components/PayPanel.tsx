"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData } from "viem";

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const ERC20_APPROVE = [
  {
    type: "function" as const,
    name: "approve",
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

const REGISTRY_PAY_HTS = [
  {
    type: "function" as const,
    name: "payInvoiceWithHts",
    stateMutability: "nonpayable" as const,
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ type: "int64" }],
  },
];

const REGISTRY_PAY_SWAP = [
  {
    type: "function" as const,
    name: "payInvoiceWithSwap",
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "amountInMax", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

function hederaEntityToEvm(id: string): `0x${string}` {
  const match = /^0\.0\.(\d+)$/.exec(id.trim());
  if (!match) throw new Error(`Not a Hedera entity id: ${id}`);
  return `0x${BigInt(match[1]).toString(16).padStart(40, "0")}`;
}

/**
 * Wallet affordance for the checkout page.
 *
 * HBAR path: native Hedera transfer with memo (HashPack). EVM wallets cannot
 * attach a Hedera memo, so the one-click EVM flow is HTS: approve + payInvoiceWithHts,
 * or any-token via SaucerSwap (payInvoiceWithSwap).
 */
export default function PayPanel({
  hasInjectedWalletHint,
  tokenConfigured,
  registryConfigured,
  network,
  registryAddress,
  invoiceChainId,
  amount,
  tokenHederaId,
  saucerRouter,
}: {
  hasInjectedWalletHint: boolean;
  tokenConfigured: boolean;
  registryConfigured: boolean;
  network: string;
  registryAddress: string;
  invoiceChainId: string;
  amount: string;
  tokenHederaId: string;
  saucerRouter: string;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [tokenIn, setTokenIn] = useState("");
  const [quote, setQuote] = useState<null | { ok: true; amountIn: string; amountInMax: string; hop: string; path: string[]; pathEvm: `0x${string}`[]; slippageBps: string; tokenIn?: { symbol: string; decimals: number } | null } | { ok: false; error: string }>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    const id = tokenIn.trim();
    if (!id || !tokenHederaId || tokenHederaId === "HBAR") {
      setQuote(null);
      return;
    }
    setQuoting(true);
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ tokenIn: id, tokenOut: tokenHederaId, amountOut: amount });
      fetch(`/api/quote?${params}`)
        .then(async (r) => (await r.json()) as typeof quote)
        .then((body) => setQuote(body))
        .catch((err) => setQuote({ ok: false, error: err instanceof Error ? err.message : "quote failed" }))
        .finally(() => setQuoting(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [tokenIn, tokenHederaId, amount]);

  const expectedChainHex = network === "mainnet" ? "0x127" : "0x128";

  async function provider(): Promise<Eip1193Provider> {
    const p = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!p) throw new Error("No browser wallet detected.");
    return p;
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const p = await provider();
      const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts?.[0] ?? null);
      if (!accounts?.length) setError("Wallet returned no accounts.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "wallet connection was rejected");
    } finally {
      setConnecting(false);
    }
  }

  async function send(p: Eip1193Provider, from: string, to: string, data: `0x${string}`) {
    return p.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data }],
    }) as Promise<string>;
  }

  async function assertChain(p: Eip1193Provider) {
    const chainId = String(await p.request({ method: "eth_chainId" })).toLowerCase();
    if (chainId !== expectedChainHex) {
      throw new Error(
        `Wallet is on chain ${chainId}. Switch to Hedera ${network} (${expectedChainHex}, ${network === "mainnet" ? "295" : "296"}).`
      );
    }
  }

  async function paySameToken() {
    setPaying(true);
    setError(null);
    setStatus(null);
    try {
      if (!address) throw new Error("Connect a wallet first.");
      if (!registryConfigured || !tokenConfigured) throw new Error("Token path is not configured.");
      const p = await provider();
      await assertChain(p);
      const token = hederaEntityToEvm(tokenHederaId);
      const amountWei = BigInt(amount);
      setStatus("Approve the registry (HIP-336)…");
      await send(
        p,
        address,
        token,
        encodeFunctionData({
          abi: ERC20_APPROVE,
          functionName: "approve",
          args: [registryAddress as `0x${string}`, amountWei],
        })
      );
      setStatus("Paying invoice…");
      const hash = await send(
        p,
        address,
        registryAddress,
        encodeFunctionData({
          abi: REGISTRY_PAY_HTS,
          functionName: "payInvoiceWithHts",
          args: [invoiceChainId as `0x${string}`],
        })
      );
      setStatus(`Submitted ${hash.slice(0, 10)}… reload after confirmation.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "payment failed");
    } finally {
      setPaying(false);
    }
  }

  async function payViaSwap() {
    setPaying(true);
    setError(null);
    setStatus(null);
    try {
      if (!address) throw new Error("Connect a wallet first.");
      if (!registryConfigured || !tokenConfigured) throw new Error("Token path is not configured.");
      if (!saucerRouter) throw new Error("SaucerSwap router is not configured.");
      if (!quote || !quote.ok) throw new Error(quote && !quote.ok ? quote.error : "Wait for a live quote before paying.");
      const p = await provider();
      await assertChain(p);
      const tokenOut = hederaEntityToEvm(tokenHederaId);
      const tokenInEvm = hederaEntityToEvm(tokenIn);
      if (tokenInEvm.toLowerCase() === tokenOut.toLowerCase()) {
        throw new Error("Swap path needs a different token than the invoice. Use Pay with invoice token.");
      }
      const amountInMax = BigInt(quote.amountInMax);
      const path = quote.pathEvm;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const router = saucerRouter.startsWith("0x") ? saucerRouter : hederaEntityToEvm(saucerRouter);
      setStatus(`Approve the registry for ${quote.amountInMax} base units of tokenIn…`);
      await send(
        p,
        address,
        tokenInEvm,
        encodeFunctionData({
          abi: ERC20_APPROVE,
          functionName: "approve",
          args: [registryAddress as `0x${string}`, amountInMax],
        })
      );
      setStatus("Swapping via SaucerSwap and paying the merchant…");
      const hash = await send(
        p,
        address,
        registryAddress,
        encodeFunctionData({
          abi: REGISTRY_PAY_SWAP,
          functionName: "payInvoiceWithSwap",
          args: [invoiceChainId as `0x${string}`, amountInMax, path, deadline],
        })
      );
      setStatus(`Submitted ${hash.slice(0, 10)}… (router ${router.slice(0, 10)}…). Reload after confirmation.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "swap payment failed");
    } finally {
      setPaying(false);
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
          <code className="mono text-xs text-acc">
            {address.slice(0, 10)}…{address.slice(-6)}
          </code>
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
      {status ? <p className="mt-3 text-xs text-zinc-300">{status}</p> : null}

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
          <div className="label mb-1">Path B — HTS invoice token (one-click)</div>
          {tokenConfigured && registryConfigured ? (
            <>
              <p className="text-zinc-300">
                Approve the registry (HIP-336), then <code className="mono">payInvoiceWithHts</code>. Tokens move payer →
                merchant in the same transaction.
              </p>
              <button
                type="button"
                onClick={paySameToken}
                disabled={paying || !address}
                className="mt-2 rounded-md bg-acc px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
              >
                {paying ? "Paying…" : "Pay with invoice token"}
              </button>
            </>
          ) : (
            <p className="text-zinc-400">
              Not enabled: set <code className="mono">PAYMENT_TOKEN_ID</code> and{" "}
              <code className="mono">INVOICE_REGISTRY_ADDRESS</code>.
            </p>
          )}
        </div>

        <div>
          <div className="label mb-1">Path C — any HTS token via SaucerSwap</div>
          {tokenConfigured && registryConfigured && saucerRouter ? (
            <>
              <p className="text-zinc-300">
                Pay with a different HTS token. The page asks SaucerSwap V1 for a live quote (direct pair, or one hop
                through WHBAR). The registry then swaps to the invoice token in the same transaction. Without a pool
                this path refuses to send a transaction.
              </p>
              <label className="mt-2 block text-xs text-zinc-400">
                Token you hold (Hedera id)
                <input
                  value={tokenIn}
                  onChange={(e) => setTokenIn(e.target.value)}
                  placeholder="0.0.1183558"
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm text-zinc-100"
                />
              </label>
              {quoting ? <p className="mt-2 text-xs text-zinc-500">Quoting SaucerSwap…</p> : null}
              {quote && quote.ok ? (
                <p className="mt-2 text-xs text-zinc-300">
                  Path: <code className="mono">{quote.path.join(" → ")}</code> ({quote.hop}). You pay at most{" "}
                  <code className="mono">{quote.amountInMax}</code> base units ({quote.slippageBps} bps slippage). The
                  merchant still receives the invoice amount exactly.
                </p>
              ) : null}
              {quote && !quote.ok ? (
                <p role="alert" className="mt-2 text-xs text-warn">
                  {quote.error}
                </p>
              ) : null}
              <button
                type="button"
                onClick={payViaSwap}
                disabled={paying || !address || !tokenIn.trim() || !quote || !quote.ok}
                className="mt-2 rounded-md bg-acc px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
              >
                {paying ? "Swapping…" : "Pay via SaucerSwap"}
              </button>
            </>
          ) : (
            <p className="text-zinc-400">
              Set <code className="mono">SAUCERSWAP_ROUTER</code> (testnet <code className="mono">0.0.19264</code>) to
              enable any-token checkout.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

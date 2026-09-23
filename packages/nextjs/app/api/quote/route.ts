import { NextResponse } from "next/server";
import {
  amountsInReader,
  ethCall,
  hederaEntityToEvm,
  pairReader,
  quoteExactOutAsync,
  SAUCER_TESTNET,
} from "@hmp/ledger";
import { config, mirrorBase } from "@/lib/config";

export const dynamic = "force-dynamic";

function rpcUrl(): string {
  return process.env.HEDERA_RPC_URL || (config.network === "mainnet" ? "https://mainnet.hashio.io/api" : "https://testnet.hashio.io/api");
}

function factoryId(): string {
  return process.env.SAUCERSWAP_FACTORY || (config.network === "testnet" ? SAUCER_TESTNET.factory : "");
}

function routerId(): string {
  if (config.saucerRouter) return config.saucerRouter;
  return config.network === "testnet" ? SAUCER_TESTNET.router : "";
}

function whbarId(): string {
  return process.env.SAUCERSWAP_WHBAR || (config.network === "testnet" ? SAUCER_TESTNET.whbar : "");
}

function toEvm(id: string): `0x${string}` {
  return id.startsWith("0x") ? (id as `0x${string}`) : hederaEntityToEvm(id);
}

async function tokenMeta(id: string): Promise<{ id: string; symbol: string; decimals: number; name: string } | null> {
  if (!/^0\.0\.\d+$/.test(id)) return null;
  const res = await fetch(`${mirrorBase()}/api/v1/tokens/${id}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { symbol?: string; decimals?: string; name?: string };
  return {
    id,
    symbol: body.symbol || id,
    decimals: Number(body.decimals ?? 0),
    name: body.name || body.symbol || id,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenIn = (url.searchParams.get("tokenIn") || "").trim();
  const tokenOut = (url.searchParams.get("tokenOut") || config.paymentTokenId || "").trim();
  const amountOutRaw = (url.searchParams.get("amountOut") || "").trim();
  const slippageRaw = (url.searchParams.get("slippageBps") || "100").trim();

  if (!tokenIn || !tokenOut) {
    return NextResponse.json({ ok: false, error: "tokenIn and tokenOut (Hedera 0.0.x ids) are required" }, { status: 400 });
  }
  if (tokenOut === "HBAR") {
    return NextResponse.json(
      { ok: false, error: "HBAR invoices cannot use the SaucerSwap path — Path A is a native transfer with memo." },
      { status: 400 }
    );
  }
  let amountOut: bigint;
  try {
    amountOut = BigInt(amountOutRaw);
  } catch {
    return NextResponse.json({ ok: false, error: "amountOut must be a base-unit integer string" }, { status: 400 });
  }

  const factory = factoryId();
  const router = routerId();
  const hop = whbarId();
  if (!factory || !router) {
    return NextResponse.json(
      { ok: false, error: "SaucerSwap factory/router not configured (set SAUCERSWAP_FACTORY + SAUCERSWAP_ROUTER, or use testnet defaults)." },
      { status: 503 }
    );
  }

  const rpc = rpcUrl();
  const call = (to: `0x${string}`, data: `0x${string}`) => ethCall(rpc, to, data);
  const quoted = await quoteExactOutAsync({
    tokenIn,
    tokenOut,
    amountOut,
    hopToken: hop || undefined,
    slippageBps: BigInt(slippageRaw),
    getPair: pairReader(call, toEvm(factory)),
    getAmountsIn: amountsInReader(call, toEvm(router)),
  });

  if (!quoted.ok) return NextResponse.json(quoted, { status: 404 });

  const [inMeta, outMeta] = await Promise.all([tokenMeta(tokenIn), tokenMeta(tokenOut)]);
  return NextResponse.json({
    ok: true,
    network: config.network,
    hop: quoted.path.hop,
    path: quoted.path.hedera,
    pathEvm: quoted.path.evm,
    amountOut: quoted.amountOut.toString(),
    amountIn: quoted.amountIn.toString(),
    amountInMax: quoted.amountInMax.toString(),
    slippageBps: quoted.slippageBps.toString(),
    tokenIn: inMeta,
    tokenOut: outMeta,
    factory,
    router,
    rpc,
  });
}

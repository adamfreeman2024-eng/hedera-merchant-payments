import { hederaEntityToEvm } from "./money.js";
import {
  decodeAddress,
  decodeUint256Array,
  encodeGetAmountsIn,
  encodeGetPair,
  isZeroAddress,
} from "./abiHex.js";

/** Well-known SaucerSwap V1 testnet ids. Mainnet must be supplied via env — do not guess. */
export const SAUCER_TESTNET = {
  factory: "0.0.9959",
  router: "0.0.19264",
  whbar: "0.0.15058",
} as const;

export type QuoteHop = "direct" | "via-whbar";

export type SwapPath = {
  hop: QuoteHop;
  /** Hedera entity ids, path[0] = token the payer holds, path[last] = invoice token. */
  hedera: string[];
  /** Long-zero EVM aliases, same order. */
  evm: `0x${string}`[];
};

export type QuoteOk = {
  ok: true;
  path: SwapPath;
  amountOut: bigint;
  amountIn: bigint;
  amountInMax: bigint;
  slippageBps: bigint;
};

export type QuoteErr = { ok: false; error: string };

export type QuoteResult = QuoteOk | QuoteErr;

export const DEFAULT_SLIPPAGE_BPS = 100n; // 1%

const ZERO = "0x0000000000000000000000000000000000000000";

export function applySlippage(amountIn: bigint, bps: bigint = DEFAULT_SLIPPAGE_BPS): bigint {
  if (amountIn <= 0n) throw new Error("amountIn must be positive");
  if (bps < 0n || bps > 5_000n) throw new Error("slippage bps out of range (0–5000)");
  return amountIn + (amountIn * bps) / 10_000n;
}

/**
 * Pick a SaucerSwap V1 path. Direct pair first; otherwise one hop through WHBAR.
 * `getPair` is injected so unit tests never talk to RPC.
 */
export function chooseSwapPath(
  tokenIn: string,
  tokenOut: string,
  getPair: (a: `0x${string}`, b: `0x${string}`) => string,
  hopToken?: string
): SwapPath | null {
  const inId = tokenIn.trim();
  const outId = tokenOut.trim();
  if (inId === outId) return null;
  const inEvm = /^0x/i.test(inId) ? (inId.toLowerCase() as `0x${string}`) : hederaEntityToEvm(inId);
  const outEvm = /^0x/i.test(outId) ? (outId.toLowerCase() as `0x${string}`) : hederaEntityToEvm(outId);
  if (inEvm === outEvm) return null;

  const direct = getPair(inEvm, outEvm);
  if (direct && !isZeroAddress(direct)) {
    return { hop: "direct", hedera: [inId, outId], evm: [inEvm, outEvm] };
  }

  if (!hopToken) return null;
  const hopId = hopToken.trim();
  const hopEvm = /^0x/i.test(hopId) ? (hopId.toLowerCase() as `0x${string}`) : hederaEntityToEvm(hopId);
  if (hopEvm === inEvm || hopEvm === outEvm) return null;

  const legA = getPair(inEvm, hopEvm);
  const legB = getPair(hopEvm, outEvm);
  if (!legA || isZeroAddress(legA) || !legB || isZeroAddress(legB)) return null;
  return { hop: "via-whbar", hedera: [inId, hopId, outId], evm: [inEvm, hopEvm, outEvm] };
}

export async function chooseSwapPathAsync(
  tokenIn: string,
  tokenOut: string,
  getPair: (a: `0x${string}`, b: `0x${string}`) => Promise<string>,
  hopToken?: string
): Promise<SwapPath | null> {
  const cache = new Map<string, string>();
  const cached = async (a: `0x${string}`, b: `0x${string}`) => {
    const k = `${a}:${b}`;
    if (!cache.has(k)) cache.set(k, await getPair(a, b));
    return cache.get(k)!;
  };
  const inId = tokenIn.trim();
  const outId = tokenOut.trim();
  if (inId === outId) return null;
  const inEvm = /^0x/i.test(inId) ? (inId.toLowerCase() as `0x${string}`) : hederaEntityToEvm(inId);
  const outEvm = /^0x/i.test(outId) ? (outId.toLowerCase() as `0x${string}`) : hederaEntityToEvm(outId);
  if (inEvm === outEvm) return null;

  const direct = await cached(inEvm, outEvm);
  if (direct && !isZeroAddress(direct)) {
    return { hop: "direct", hedera: [inId, outId], evm: [inEvm, outEvm] };
  }

  if (!hopToken) return null;
  const hopId = hopToken.trim();
  const hopEvm = /^0x/i.test(hopId) ? (hopId.toLowerCase() as `0x${string}`) : hederaEntityToEvm(hopId);
  if (hopEvm === inEvm || hopEvm === outEvm) return null;

  const [legA, legB] = await Promise.all([cached(inEvm, hopEvm), cached(hopEvm, outEvm)]);
  if (!legA || isZeroAddress(legA) || !legB || isZeroAddress(legB)) return null;
  return { hop: "via-whbar", hedera: [inId, hopId, outId], evm: [inEvm, hopEvm, outEvm] };
}

export async function quoteExactOutAsync(input: {
  tokenIn: string;
  tokenOut: string;
  amountOut: bigint;
  getPair: (a: `0x${string}`, b: `0x${string}`) => Promise<string>;
  getAmountsIn: (amountOut: bigint, path: `0x${string}`[]) => Promise<bigint[]>;
  hopToken?: string;
  slippageBps?: bigint;
}): Promise<QuoteResult> {
  if (input.amountOut <= 0n) return { ok: false, error: "amountOut must be positive" };
  const path = await chooseSwapPathAsync(input.tokenIn, input.tokenOut, input.getPair, input.hopToken);
  if (!path) {
    return {
      ok: false,
      error: `No SaucerSwap V1 pool between ${input.tokenIn} and ${input.tokenOut} (direct or via WHBAR). The merchant still receives the invoice token — this payer token cannot be used.`,
    };
  }
  let amounts: bigint[];
  try {
    amounts = await input.getAmountsIn(input.amountOut, path.evm);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SaucerSwap getAmountsIn failed (empty pool or revert)",
    };
  }
  if (amounts.length !== path.evm.length) {
    return { ok: false, error: `getAmountsIn returned ${amounts.length} amounts for a ${path.evm.length}-hop path` };
  }
  const amountIn = amounts[0];
  if (amountIn <= 0n) return { ok: false, error: "quoted amountIn is zero" };
  const bps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  return {
    ok: true,
    path,
    amountOut: input.amountOut,
    amountIn,
    amountInMax: applySlippage(amountIn, bps),
    slippageBps: bps,
  };
}

export function quoteExactOut(input: {
  tokenIn: string;
  tokenOut: string;
  amountOut: bigint;
  getPair: (a: `0x${string}`, b: `0x${string}`) => string;
  getAmountsIn: (amountOut: bigint, path: `0x${string}`[]) => bigint[];
  hopToken?: string;
  slippageBps?: bigint;
}): QuoteResult {
  if (input.amountOut <= 0n) return { ok: false, error: "amountOut must be positive" };
  const path = chooseSwapPath(input.tokenIn, input.tokenOut, input.getPair, input.hopToken);
  if (!path) {
    return {
      ok: false,
      error: `No SaucerSwap V1 pool between ${input.tokenIn} and ${input.tokenOut} (direct or via WHBAR). The merchant still receives the invoice token — this payer token cannot be used.`,
    };
  }
  let amounts: bigint[];
  try {
    amounts = input.getAmountsIn(input.amountOut, path.evm);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SaucerSwap getAmountsIn failed (empty pool or revert)",
    };
  }
  if (amounts.length !== path.evm.length) {
    return { ok: false, error: `getAmountsIn returned ${amounts.length} amounts for a ${path.evm.length}-hop path` };
  }
  const amountIn = amounts[0];
  if (amountIn <= 0n) return { ok: false, error: "quoted amountIn is zero" };
  const bps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  return {
    ok: true,
    path,
    amountOut: input.amountOut,
    amountIn,
    amountInMax: applySlippage(amountIn, bps),
    slippageBps: bps,
  };
}

export type RpcCall = (to: `0x${string}`, data: `0x${string}`) => Promise<string>;

export function pairReader(rpc: RpcCall, factory: `0x${string}`) {
  return async (a: `0x${string}`, b: `0x${string}`): Promise<string> => {
    const raw = await rpc(factory, encodeGetPair(a, b));
    if (!raw || raw === "0x") return ZERO;
    return decodeAddress(raw);
  };
}

export function amountsInReader(rpc: RpcCall, router: `0x${string}`) {
  return async (amountOut: bigint, path: `0x${string}`[]): Promise<bigint[]> => {
    const raw = await rpc(router, encodeGetAmountsIn(amountOut, path));
    if (!raw || raw === "0x") throw new Error("SaucerSwap getAmountsIn returned empty data");
    return decodeUint256Array(raw);
  };
}

/** JSON-RPC `eth_call` against Hashio (or any Hedera JSON-RPC). */
export async function ethCall(
  rpcUrl: string,
  to: `0x${string}`,
  data: `0x${string}`,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} from ${rpcUrl}`);
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (body.error?.message) throw new Error(`RPC error: ${body.error.message}`);
  if (typeof body.result !== "string") throw new Error("RPC returned no result");
  return body.result;
}

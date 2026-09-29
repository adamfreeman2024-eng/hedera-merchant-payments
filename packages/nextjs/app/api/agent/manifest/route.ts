import { jsonCors, corsPreflight } from "@/lib/cors";

export const dynamic = "force-dynamic";

/**
 * Machine-readable card for coding agents. Describes THIS template's custody
 * model so a clone does not confuse it with escrow-and-withdraw checkouts.
 */
export async function GET() {
  return jsonCors({
    name: "hedera-merchant-payments",
    version: "1.0.0",
    custody: "non-custodial",
    summary:
      "Invoice gateway on Hedera. Customer funds move payer → merchant in the same transaction. The registry never holds a balance.",
    not: "Not an escrow. The merchant does not withdraw from the contract.",
    hedera: ["HTS", "HCS", "HSS", "Mirror Node", "SaucerSwap V1"],
    routes: {
      health: "GET /api/health",
      quote: "GET /api/quote?tokenIn=0.0.x&tokenOut=0.0.x&amountOut=<base units>",
      receipts: "GET /api/receipts?topic=0.0.x&id=INV-…",
      reconstructUi: "/receipt?topic=0.0.x&id=INV-…",
      checkout: "/pay/[invoiceId]",
    },
    quoteRule: "If SaucerSwap has no pool, quote.ok is false and checkout will not send a swap transaction.",
  });
}

export function OPTIONS() {
  return corsPreflight();
}

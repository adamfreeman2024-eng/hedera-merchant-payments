import { config, hasDatabase, hasHcsTopic, hasMerchant, hasRegistry } from "@/lib/config";
import { corsPreflight, jsonCors } from "@/lib/cors";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Health/readiness for operators and the harness. Never throws: reports `ok: false`
 * with the missing pieces instead, so a cold clone can still be probed.
 */
export async function GET() {
  const checks = {
    database: hasDatabase(),
    merchantAccount: hasMerchant(),
    registry: hasRegistry(),
    hcsReceipts: hasHcsTopic(),
  };
  const ready = Object.values(checks).every(Boolean);
  return jsonCors({
    ok: true,
    ready,
    network: config.network,
    checks,
    missing: Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name),
    custody: "non-custodial: customer funds are never held by this service",
  });
}

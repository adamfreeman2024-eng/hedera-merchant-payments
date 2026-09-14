import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Loads .env files (root first, then the service file) without extra dependencies. */
function loadEnvFile(path: string, override = false) {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

export function loadEnv(): Env {
  const root = resolve(__dirname, "../../..");
  loadEnvFile(resolve(root, ".env"));
  loadEnvFile(resolve(root, ".env.local"), true);

  const network = process.env.HEDERA_NETWORK || "testnet";
  const env: Env = {
    network,
    operatorId: process.env.HEDERA_OPERATOR_ID || "",
    operatorKey: process.env.HEDERA_OPERATOR_KEY || "",
    merchantAccountId: process.env.MERCHANT_ACCOUNT_ID || "",
    paymentTokenId: process.env.PAYMENT_TOKEN_ID || "",
    registryAddress: process.env.INVOICE_REGISTRY_ADDRESS || "",
    hcsTopicId: process.env.HCS_RECEIPT_TOPIC_ID || "",
    databaseUrl: process.env.DATABASE_URL || "",
    webhookSecret: process.env.WEBHOOK_SIGNING_SECRET || "",
    webhookUrl: process.env.MERCHANT_WEBHOOK_URL || "",
    pollMs: Number(process.env.RECONCILE_POLL_MS || 5000),
    lookbackSeconds: Number(process.env.RECONCILE_LOOKBACK_SECONDS || 3600),
  };
  return env;
}

export type Env = {
  network: string;
  operatorId: string;
  operatorKey: string;
  merchantAccountId: string;
  paymentTokenId: string;
  registryAddress: string;
  hcsTopicId: string;
  databaseUrl: string;
  webhookSecret: string;
  webhookUrl: string;
  pollMs: number;
  lookbackSeconds: number;
};

/** Fails fast with an actionable message instead of a stack trace mid-run. */
export function requireEnv(env: Env, keys: Array<keyof Env>): void {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required env: ${missing.join(", ")}. Copy .env.example → .env and fill it in (see RUNBOOK.md step 2).`
    );
  }
}

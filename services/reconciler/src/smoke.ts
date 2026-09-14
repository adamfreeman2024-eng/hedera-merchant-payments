import { JsonRpcProvider } from "ethers";
import { PrismaClient } from "@hmp/ledger";
import { MirrorNodeClient } from "./mirror.js";
import { loadEnv } from "./env.js";

/**
 * Environment smoke test — read-only, spends nothing.
 *
 *   yarn smoke:testnet
 *
 * Verifies the four things that actually break deployments: the ledger database,
 * the merchant account on the Mirror Node, the HCS receipt topic, and the registry
 * bytecode at the configured address. Exits non-zero on the first hard failure so it
 * can gate CI or a release.
 */
type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const env = loadEnv();
  const checks: Check[] = [];

  const push = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(18)} ${detail}`);
  };

  // 1. configuration
  push("config", true, `network=${env.network} merchant=${env.merchantAccountId}`);

  // 2. ledger database
  const prisma = new PrismaClient();
  try {
    const [open, settled, expired] = await Promise.all([
      prisma.invoice.count({ where: { status: "OPEN" } }),
      prisma.invoice.count({ where: { status: "SETTLED" } }),
      prisma.invoice.count({ where: { status: "EXPIRED" } }),
    ]);
    push("database", true, `invoices: open=${open} settled=${settled} expired=${expired}`);
  } catch (error) {
    push("database", false, (error as Error).message.split("\n")[0]);
  }

  // 3. Mirror Node / merchant account
  const mirror = new MirrorNodeClient(env.network);
  try {
    const url = `${env.network === "mainnet" ? "https://mainnet-public.mirrornode.hedera.com" : "https://testnet.mirrornode.hedera.com"}/api/v1/accounts/${env.merchantAccountId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const data = (await res.json()) as { balance?: { balance?: number }; evm_address?: string };
    push(
      "mirror node",
      res.ok,
      res.ok ? `merchant balance ${((data.balance?.balance ?? 0) / 1e8).toFixed(4)} HBAR, evm ${data.evm_address?.slice(0, 10)}…` : `HTTP ${res.status}`
    );
  } catch (error) {
    push("mirror node", false, (error as Error).message);
  }

  // 4. HCS receipt topic
  if (!env.hcsTopicId) {
    push("hcs topic", false, "HCS_RECEIPT_TOPIC_ID not set — receipts will be skipped");
  } else {
    try {
      const base = env.network === "mainnet" ? "https://mainnet-public.mirrornode.hedera.com" : "https://testnet.mirrornode.hedera.com";
      const res = await fetch(`${base}/api/v1/topics/${env.hcsTopicId}/messages?limit=1`, {
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as { messages?: { sequence_number: number }[] };
      push("hcs topic", res.ok, `${env.hcsTopicId} reachable, last sequence ${data.messages?.[0]?.sequence_number ?? "(none yet)"}`);
    } catch (error) {
      push("hcs topic", false, (error as Error).message);
    }
  }

  // 5. registry bytecode
  if (!env.registryAddress) {
    push("registry", false, "INVOICE_REGISTRY_ADDRESS not set — on-chain attestation disabled");
  } else {
    try {
      const rpc = env.network === "mainnet" ? "https://mainnet.hashio.io/api" : "https://testnet.hashio.io/api";
      const provider = new JsonRpcProvider(rpc);
      const code = await provider.getCode(env.registryAddress);
      const size = code === "0x" ? 0 : (code.length - 2) / 2;
      push("registry", size > 0, `${env.registryAddress} → ${size} bytes of bytecode`);
    } catch (error) {
      push("registry", false, (error as Error).message);
    }
  }

  await prisma.$disconnect().catch(() => undefined);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log("failed:", failed.map((f) => f.name).join(", "));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

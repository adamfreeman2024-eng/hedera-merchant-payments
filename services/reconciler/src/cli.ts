#!/usr/bin/env node
/**
 * Reconciler CLI — the gateway's worker.
 *
 *   tsx src/cli.ts --init-topic             create the HCS receipt topic
 *   tsx src/cli.ts --once                   run one reconciliation pass
 *   tsx src/cli.ts --once --dry-run         report matches without writing anything
 *   tsx src/cli.ts --once --attest          also attest HBAR settlements on-chain
 *   tsx src/cli.ts --new-invoice 0.5 --ttl 30   open an invoice from the terminal
 *   tsx src/cli.ts --show <invoiceId>       print one invoice as JSON
 *   tsx src/cli.ts                          daemon: reconcile every RECONCILE_POLL_MS
 */
import { PrismaClient } from "@prisma/client";
import { hederaClient, createReceiptTopic, toTinybar, fromTinybar } from "@hmp/ledger";
import { loadEnv, requireEnv } from "./env.js";
import { Reconciler, createInvoice } from "./reconcile.js";

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function value(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function usage() {
  console.log(`Hedera Merchant Payments — reconciliation worker

  --init-topic                  create the HCS settlement-receipt topic
  --once                        run a single reconciliation pass
  --dry-run                     with --once: match and report without writing
  --attest                      with --once: attest HBAR settlements in InvoiceRegistry
  --new-invoice <amount>        open an invoice (amount in HBAR, e.g. 0.5)
  --token <tokenId>             invoice currency (default: HBAR)
  --ttl <minutes>               invoice lifetime in minutes (default 30)
  --show <invoiceId>            print an invoice as JSON
  --help                        this text

Without flags it runs as a daemon, reconciling every RECONCILE_POLL_MS.
`);
}

async function main() {
  const env = loadEnv();
  if (flag("--help") || flag("-h")) return usage();

  const prisma = new PrismaClient();

  if (flag("--show")) {
    const id = value("--show");
    const invoice = await prisma.invoice.findUnique({ where: { id: id! } });
    console.log(JSON.stringify(invoice, null, 2));
    return;
  }

  if (flag("--new-invoice")) {
    requireEnv(env, ["merchantAccountId", "databaseUrl"]);
    const amount = value("--new-invoice")!;
    const token = value("--token") || (env.paymentTokenId ? env.paymentTokenId : "HBAR");
    const ttlMinutes = Number(value("--ttl", "30"));
    const id = `INV-${Date.now().toString(36).toUpperCase()}`;
    const record = await createInvoice(prisma, env, {
      id,
      amount: toTinybar(amount),
      token,
      ttlMinutes,
    });
    console.log(`invoice   : ${record.id}`);
    console.log(`amount    : ${fromTinybar(record.amount)} HBAR`);
    console.log(`pay to    : ${record.merchantAccount}`);
    console.log(`memo      : ${record.memo}   <- customer MUST include this memo`);
    console.log(`expires   : ${record.expiresAt.toISOString()}`);
    console.log(`checkout  : http://localhost:3000/pay/${record.id}`);
    return;
  }

  if (flag("--init-topic")) {
    requireEnv(env, ["operatorId", "operatorKey"]);
    const client = hederaClient(env.network, env.operatorId, env.operatorKey);
    const topicId = await createReceiptTopic(client);
    client.close();
    console.log(`HCS_RECEIPT_TOPIC_ID=${topicId}`);
    console.log("Add this to .env, then settle an invoice to write the first receipt.");
    return;
  }

  requireEnv(env, ["merchantAccountId", "databaseUrl"]);
  const reconciler = new Reconciler(env, prisma);

  if (flag("--once")) {
    const summary = await reconciler.once({
      dryRun: flag("--dry-run"),
      attestOnChain: flag("--attest"),
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // daemon
  console.log(`reconciler: polling every ${env.pollMs}ms (merchant ${env.merchantAccountId})`);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (!stopping) {
    try {
      const summary = await reconciler.once({ attestOnChain: true });
      if (summary.settled.length || summary.expired.length || summary.errors.length) {
        console.log(JSON.stringify(summary));
      }
    } catch (error) {
      console.error(`pass failed: ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, env.pollMs));
  }
  console.log("stopped");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Prisma keeps handles open; let the process exit cleanly.
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });

#!/usr/bin/env node
/**
 * Rebuild the invoice ledger from an HCS receipt topic via the public Mirror Node.
 * No database, no operator key, no .env — a judge can run this against our live topic.
 *
 *   yarn reconstruct --topic 0.0.10541151
 *   yarn reconstruct --topic 0.0.10541151 --invoice INV-MU1G1FSW443
 */
import { reconstructTopic } from "./reconstruct.js";
import { mirrorNodeUrl } from "./hcs.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const topic = arg("--topic") ?? process.env.HCS_RECEIPT_TOPIC_ID;
const invoice = arg("--invoice");
const network = arg("--network") ?? process.env.HEDERA_NETWORK ?? "testnet";

if (!topic) {
  console.error("usage: yarn reconstruct --topic 0.0.x [--invoice INV-…] [--network testnet|mainnet]");
  process.exit(2);
}

const mirror = mirrorNodeUrl(network);

const fetchJson = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mirror HTTP ${res.status} for ${url}`);
  return res.json() as Promise<{ messages?: []; links?: { next?: string | null } }>;
};

reconstructTopic(mirror, topic, fetchJson)
  .then((report) => {
    const rows = invoice ? (report.latest[invoice] ? [report.latest[invoice]] : []) : Object.values(report.latest);
    console.log(
      JSON.stringify(
        {
          topicId: report.topicId,
          mirror,
          messagesSeen: report.messagesSeen,
          skipped: report.skipped,
          invoices: rows.length,
          latest: invoice ? report.latest[invoice] ?? null : report.latest,
        },
        null,
        2
      )
    );
    if (invoice && !report.latest[invoice]) process.exit(1);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

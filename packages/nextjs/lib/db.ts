import { PrismaClient } from "@hmp/ledger";
import { config } from "./config";

/**
 * Ledger access with a soft failure mode.
 *
 * The read path must render without DATABASE_URL (acceptance rule: no credentials
 * required to browse). Instead of crashing, callers get `null` and render an
 * explanatory state — and the health endpoint reports it.
 */
let client: PrismaClient | null = null;
let failed = false;

export function getDb(): PrismaClient | null {
  if (failed || !config.databaseUrl) return null;
  if (client) return client;
  try {
    client = new PrismaClient();
    return client;
  } catch {
    failed = true;
    return null;
  }
}

export type DbResult<T> = { ok: true; data: T } | { ok: false; reason: string };

/** Runs a query, turning "database not configured/unreachable" into a typed failure. */
export async function withDb<T>(run: (db: PrismaClient) => Promise<T>): Promise<DbResult<T>> {
  const db = getDb();
  if (!db) {
    return { ok: false, reason: config.databaseUrl ? "database unavailable" : "DATABASE_URL is not set" };
  }
  try {
    return { ok: true, data: await run(db) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.split("\n")[0] : "database error" };
  }
}

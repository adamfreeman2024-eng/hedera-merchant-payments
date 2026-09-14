#!/usr/bin/env node
/**
 * Post-install step: generate the Prisma client for @hmp/ledger.
 *
 * Why a script instead of a one-liner: npm hoists `prisma` to the root
 * node_modules, while Yarn (nmHoistingLimits: workspaces) keeps it inside
 * packages/ledger/node_modules — so the binary has to be located, not assumed.
 * This keeps `npm install` and `yarn install` both working out of the box.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const schema = resolve("packages/ledger/prisma/schema.prisma");
const ledgerDir = resolve("packages/ledger");
const candidates = [
  resolve("node_modules/prisma/build/index.js"), // npm (hoisted to the root)
  resolve("packages/ledger/node_modules/prisma/build/index.js"), // yarn workspaces
];

if (!existsSync(schema)) {
  console.warn("[postinstall] no ledger schema found — skipping Prisma client generation");
  process.exit(0);
}

const cli = candidates.find(existsSync);
if (!cli) {
  console.warn("[postinstall] prisma CLI not found — run `yarn db:generate` manually");
  process.exit(0);
}

try {
  // Run from the ledger package so Prisma writes `.prisma/client` where that
  // package's @prisma/client expects to find it.
  execFileSync(process.execPath, [cli, "generate"], { cwd: ledgerDir, stdio: "inherit" });
} catch (error) {
  console.warn("[postinstall] prisma generate failed:", error.message);
  console.warn("[postinstall] run `yarn db:generate` after fixing the schema");
}

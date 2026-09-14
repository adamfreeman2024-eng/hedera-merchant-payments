/**
 * Money + memo rules for the gateway. Pure functions, unit-tested (test/money.test.ts).
 *
 * Units follow Hedera conventions:
 *  - HBAR is measured in tinybar (1 HBAR = 100_000_000 tinybar)
 *  - HTS tokens are measured in base units (decimals come from the token itself)
 * Amounts are handled as bigint end-to-end; floats never touch settlement math.
 */

export const TINYBAR_PER_HBAR = 100_000_000n;

export type Currency = { kind: "HBAR" } | { kind: "HTS"; tokenId: string; decimals: number };

export class AmountError extends Error {}

/** Parses a human amount ("12.5", "0,5", "1 000") into base units. */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  const raw = String(amount).trim().replace(/\s|_/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new AmountError(`Not a valid amount: ${amount}`);
  const [whole, frac = ""] = raw.split(".");
  if (frac.length > decimals) {
    throw new AmountError(`Too many decimal places for ${decimals}-decimal currency: ${amount}`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Formats base units back for display ("1.00000000" -> "1", "1.5" -> "1.5"). */
export function fromBaseUnits(units: bigint, decimals: number): string {
  if (units === 0n) return "0";
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export const toTinybar = (hbar: string | number) => toBaseUnits(hbar, 8);
export const fromTinybar = (tinybar: bigint) => fromBaseUnits(tinybar, 8);

/**
 * Payment memo attached to every customer transfer. The reconciler matches a
 * Mirror Node transfer to an invoice ONLY when the memo matches exactly, so the
 * format is intentionally strict and short (Hedera memos are capped at 100 bytes).
 */
export const MEMO_PREFIX = "HMP";
export const MEMO_PATTERN = /^HMP-([A-Z0-9]{6,32})$/;

export function buildMemo(invoiceId: string): string {
  const normalised = invoiceId.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalised.length < 6 || normalised.length > 32) {
    throw new AmountError("Invoice id must be 6-32 alphanumeric characters");
  }
  const memo = `${MEMO_PREFIX}-${normalised}`;
  if (Buffer.byteLength(memo, "utf8") > 100) throw new AmountError("Memo exceeds the 100-byte limit");
  return memo;
}

export function parseMemo(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const match = MEMO_PATTERN.exec(memo.trim());
  return match ? match[1] : null;
}

/** Tolerance for under/overpayment, in base units. Zero by default (exact match). */
export function settlementMatches(expected: bigint, received: bigint, tolerance = 0n): boolean {
  if (expected <= 0n) return false;
  const diff = received > expected ? received - expected : expected - received;
  return diff <= tolerance;
}

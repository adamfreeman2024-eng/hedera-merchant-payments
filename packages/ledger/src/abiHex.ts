/**
 * Tiny ABI helpers for the two UniswapV2-style view calls we issue against
 * SaucerSwap V1. Kept in-repo so `@hmp/ledger` does not depend on ethers/viem.
 *
 * Selectors (keccak256 of the canonical signature, first 4 bytes):
 *   getPair(address,address)           0xe6a43905
 *   getAmountsIn(uint256,address[])    0x1f00ca74
 *   getAmountsOut(uint256,address[])   0xd06ca61f
 */

export const SELECTOR = {
  getPair: "0xe6a43905",
  getAmountsIn: "0x1f00ca74",
  getAmountsOut: "0xd06ca61f",
} as const;

export function strip0x(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

export function encodeAddress(addr: string): string {
  const hex = strip0x(addr).toLowerCase().padStart(40, "0");
  if (hex.length !== 40 || !/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error(`Not a 20-byte address: ${addr}`);
  }
  return hex.padStart(64, "0");
}

export function encodeUint256(value: bigint): string {
  if (value < 0n) throw new Error("uint256 cannot be negative");
  const hex = value.toString(16);
  if (hex.length > 64) throw new Error("uint256 overflow");
  return hex.padStart(64, "0");
}

export function decodeAddress(word: string): `0x${string}` {
  const hex = strip0x(word).padStart(64, "0").slice(-40);
  return `0x${hex}`;
}

export function decodeUint256(word: string): bigint {
  const hex = strip0x(word).padStart(64, "0");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`Not a 32-byte word: ${word}`);
  return BigInt("0x" + hex);
}

export function encodeGetPair(tokenA: string, tokenB: string): `0x${string}` {
  return `${SELECTOR.getPair}${encodeAddress(tokenA)}${encodeAddress(tokenB)}` as `0x${string}`;
}

/** ABI-encode `getAmountsIn(uint256,address[])` / `getAmountsOut(uint256,address[])`. */
export function encodeGetAmounts(selector: string, amount: bigint, path: string[]): `0x${string}` {
  if (path.length < 2) throw new Error("swap path needs at least two tokens");
  const head = encodeUint256(amount) + encodeUint256(64n); // offset of the dynamic array
  const tail = encodeUint256(BigInt(path.length)) + path.map(encodeAddress).join("");
  return `${selector}${head}${tail}` as `0x${string}`;
}

export function encodeGetAmountsIn(amountOut: bigint, path: string[]): `0x${string}` {
  return encodeGetAmounts(SELECTOR.getAmountsIn, amountOut, path);
}

export function encodeGetAmountsOut(amountIn: bigint, path: string[]): `0x${string}` {
  return encodeGetAmounts(SELECTOR.getAmountsOut, amountIn, path);
}

/** Decode a `uint256[]` ABI return (offset + length + words). Also accepts a bare packed list. */
export function decodeUint256Array(data: string): bigint[] {
  const hex = strip0x(data);
  if (hex.length < 64) throw new Error("empty ABI return");
  // Standard encoding: offset (32) + length (32) + items
  const offset = Number(BigInt("0x" + hex.slice(0, 64)));
  const start = offset * 2; // offset is in bytes
  if (start + 64 > hex.length) {
    // Some nodes return the array packed without an offset word.
    const length = Number(BigInt("0x" + hex.slice(0, 64)));
    const out: bigint[] = [];
    for (let i = 0; i < length; i++) out.push(decodeUint256(hex.slice(64 + i * 64, 128 + i * 64)));
    return out;
  }
  const length = Number(BigInt("0x" + hex.slice(start, start + 64)));
  const out: bigint[] = [];
  for (let i = 0; i < length; i++) {
    const o = start + 64 + i * 64;
    out.push(decodeUint256(hex.slice(o, o + 64)));
  }
  return out;
}

export function isZeroAddress(addr: string): boolean {
  return /^0x0{40}$/i.test(addr);
}

export function assertEvenHex(data: string): `0x${string}` {
  const hex = data.startsWith("0x") ? data : `0x${data}`;
  if (hex.length % 2 !== 1 && hex.length % 2 !== 0) {
    /* length includes 0x; total chars must be even */
  }
  if ((hex.length - 2) % 2 !== 0) throw new Error(`hex data has odd length: ${hex}`);
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) throw new Error(`not hex: ${hex}`);
  return hex as `0x${string}`;
}

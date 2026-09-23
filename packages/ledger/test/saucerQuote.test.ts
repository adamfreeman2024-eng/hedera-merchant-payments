import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hederaEntityToEvm } from "../src/money.js";
import { decodeAddress, decodeUint256Array, encodeGetPair, encodeGetAmountsIn, isZeroAddress } from "../src/abiHex.js";
import { applySlippage, chooseSwapPath, quoteExactOut } from "../src/saucerQuote.js";

const WHBAR = "0.0.15058";
const SAUCE = "0.0.1183558";
const OTHER = "0.0.999";
const ZERO = "0x0000000000000000000000000000000000000000";
const PAIR = "0x00000000000000000000000000000000fe7cc3ce";

describe("abiHex", () => {
  it("encodes getPair with even-length hex (Hashio rejects odd length)", () => {
    const data = encodeGetPair(hederaEntityToEvm(WHBAR), hederaEntityToEvm(SAUCE));
    assert.equal(data.startsWith("0xe6a43905"), true);
    assert.equal((data.length - 2) % 2, 0);
    assert.equal(data.length, 2 + 8 + 64 + 64); // 0x + selector + 2 words
  });

  it("round-trips a uint256[] ABI blob", () => {
    // offset 0x20, length 2, values 100 and 50
    const blob =
      "0x" +
      "0000000000000000000000000000000000000000000000000000000000000020" +
      "0000000000000000000000000000000000000000000000000000000000000002" +
      "0000000000000000000000000000000000000000000000000000000000000064" +
      "0000000000000000000000000000000000000000000000000000000000000032";
    assert.deepEqual(decodeUint256Array(blob), [100n, 50n]);
  });

  it("encodes getAmountsIn with a two-token path", () => {
    const data = encodeGetAmountsIn(1_000_000n, [hederaEntityToEvm(SAUCE), hederaEntityToEvm(WHBAR)]);
    assert.equal(data.startsWith("0x1f00ca74"), true);
    assert.equal((data.length - 2) % 2, 0);
  });

  it("decodes a 32-byte address word", () => {
    assert.equal(isZeroAddress(ZERO), true);
    assert.equal(decodeAddress("0x" + "0".repeat(24) + "0000000000000000000000000000000000004b40".slice(-40)), hederaEntityToEvm("0.0.19264"));
  });
});

describe("chooseSwapPath", () => {
  it("prefers a direct pair", () => {
    const getPair = (a: `0x${string}`, b: `0x${string}`) =>
      a === hederaEntityToEvm(SAUCE) || b === hederaEntityToEvm(SAUCE) ? PAIR : ZERO;
    const path = chooseSwapPath(SAUCE, WHBAR, getPair, WHBAR);
    assert.ok(path);
    assert.equal(path!.hop, "direct");
    assert.deepEqual(path!.hedera, [SAUCE, WHBAR]);
  });

  it("falls back to WHBAR hop when the direct pair is missing", () => {
    const sauce = hederaEntityToEvm(SAUCE);
    const other = hederaEntityToEvm(OTHER);
    const hop = hederaEntityToEvm(WHBAR);
    const getPair = (a: `0x${string}`, b: `0x${string}`) => {
      const set = new Set([a, b]);
      if (set.has(sauce) && set.has(hop)) return PAIR;
      if (set.has(other) && set.has(hop)) return PAIR;
      return ZERO;
    };
    const path = chooseSwapPath(OTHER, SAUCE, getPair, WHBAR);
    assert.ok(path);
    assert.equal(path!.hop, "via-whbar");
    assert.deepEqual(path!.hedera, [OTHER, WHBAR, SAUCE]);
  });

  it("returns null when no pool exists", () => {
    assert.equal(chooseSwapPath(OTHER, SAUCE, () => ZERO, WHBAR), null);
    assert.equal(chooseSwapPath(SAUCE, SAUCE, () => PAIR), null);
  });
});

describe("quoteExactOut", () => {
  it("applies integer slippage, never floats", () => {
    assert.equal(applySlippage(100n, 100n), 101n);
    assert.equal(applySlippage(1n, 100n), 1n); // 1 * 100 / 10000 = 0, so 1+0
    assert.throws(() => applySlippage(0n), /positive/);
  });

  it("returns amountInMax = quoted in + 1% and refuses a missing pool", () => {
    const getPair = () => PAIR;
    const quoted = quoteExactOut({
      tokenIn: SAUCE,
      tokenOut: WHBAR,
      amountOut: 1_000_000n,
      getPair,
      getAmountsIn: () => [50_000_000n, 1_000_000n],
    });
    assert.equal(quoted.ok, true);
    if (quoted.ok) {
      assert.equal(quoted.amountIn, 50_000_000n);
      assert.equal(quoted.amountInMax, 50_500_000n);
      assert.equal(quoted.slippageBps, 100n);
    }

    const missing = quoteExactOut({
      tokenIn: OTHER,
      tokenOut: SAUCE,
      amountOut: 1n,
      getPair: () => ZERO,
      getAmountsIn: () => {
        throw new Error("should not be called");
      },
      hopToken: WHBAR,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.error, /No SaucerSwap V1 pool/);
  });
});

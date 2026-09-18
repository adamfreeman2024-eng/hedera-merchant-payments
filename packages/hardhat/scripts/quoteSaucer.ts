import { ethers } from "hardhat";

/**
 * Live read of SaucerSwap V1 on Hedera testnet.
 * WHBAR is NOT wrapped here (SaucerSwap: do not touch WHBAR directly).
 *
 * Testnet:
 *   factory 0.0.9959  router 0.0.19264
 *   WHBAR token 0.0.15058  SAUCE 0.0.1183558
 */
async function main() {
  const factoryAddr = "0x00000000000000000000000000000000000026e7";
  const routerAddr = "0x0000000000000000000000000000000000004b40";
  const whbar = "0x0000000000000000000000000000000000003ad2";
  const sauce = "0x0000000000000000000000000000000000120f46";

  const factory = await ethers.getContractAt(
    ["function getPair(address,address) view returns (address)", "function allPairsLength() view returns (uint256)"],
    factoryAddr
  );
  const router = await ethers.getContractAt(
    ["function getAmountsOut(uint256,address[]) view returns (uint256[])"],
    routerAddr
  );

  const len = await factory.allPairsLength();
  const pair = await factory.getPair(whbar, sauce);
  const amountIn = 10n ** 8n; // 1 WHBAR (8 decimals)
  const amounts = await router.getAmountsOut(amountIn, [whbar, sauce]);
  console.log("factoryPairs", len.toString());
  console.log("SAUCE_WHBAR_pair", pair);
  console.log("quote_1_WHBAR_in_SAUCE", amounts[1].toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

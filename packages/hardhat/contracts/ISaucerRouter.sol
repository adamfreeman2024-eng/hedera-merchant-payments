// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * UniswapV2-style router surface used by SaucerSwap V1
 * (testnet RouterV3 0.0.19264, mainnet 0.0.3045981).
 * Declared locally so the template does not pin a DEX SDK.
 */
interface ISaucerRouterV1 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

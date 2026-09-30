// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals = 8;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allow");
        allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev UniswapV2-style mock. Exact-out spends less than amountInMax so leftover refund can be tested.
contract MockSaucerRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, "path");
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(path[path.length - 1]).mint(to, amountOutMin);
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOutMin;
    }

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, "path");
        require(amountInMax >= amountOut, "in");
        // Spend less than max when we can, so the registry leftover-refund path runs.
        uint256 used = amountInMax > 10 ? amountInMax - 10 : amountInMax;
        MockERC20(path[0]).transferFrom(msg.sender, address(this), used);
        MockERC20(path[path.length - 1]).mint(to, amountOut);
        amounts = new uint256[](path.length);
        amounts[0] = used;
        amounts[path.length - 1] = amountOut;
    }
}

/// @dev HIP-1215 scheduleCall mock. Returns SUCCESS (22) and a deterministic address.
contract MockHSS {
    event Scheduled(address to, uint256 expirySecond, bytes callData);

    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256,
        uint64,
        bytes calldata callData
    ) external returns (int64 responseCode, address scheduleAddress) {
        scheduleAddress = address(uint160(uint256(keccak256(abi.encode(to, expirySecond, callData)))));
        emit Scheduled(to, expirySecond, callData);
        return (22, scheduleAddress);
    }
}

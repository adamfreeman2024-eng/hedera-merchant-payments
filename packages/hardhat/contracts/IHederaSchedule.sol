// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * HIP-1215 surface of the Hedera Schedule Service at 0x16b.
 * Declared locally so the template does not pin a third-party system-contract package.
 * scheduleCall does NOT revert — callers must check the int64 response code (22 = SUCCESS).
 */
interface IHederaScheduleService {
    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes calldata callData
    ) external returns (int64 responseCode, address scheduleAddress);
}

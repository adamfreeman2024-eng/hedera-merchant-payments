// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISaucerRouterV1, IERC20Minimal} from "./ISaucerRouter.sol";

/**
 * Minimal view of the Hedera Token Service (HTS) system contract at 0x167.
 * Declared locally on purpose: the template must not depend on a pinned
 * third-party interface package to stay forkable.
 *
 * Only the HIP-336 allowance surface we actually use is declared.
 */
interface IHederaTokenService {
    /// @dev Moves `amount` of `token` from `from` to `to`, spending an allowance
    /// the owner granted this contract. Returns 22 (SUCCESS) on success.
    function transferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) external returns (int64 responseCode);

    function allowance(
        address token,
        address owner,
        address spender
    ) external returns (int responseCode, uint256 allowance);
}

/**
 * @title InvoiceRegistry
 * @notice On-chain invoice ledger for a NON-CUSTODIAL merchant payment gateway.
 *
 * Design rules (deliberate, see README "Custody model"):
 *  - This contract NEVER holds customer funds. HTS payments move straight from the
 *    payer to the merchant account inside the same transaction.
 *  - HBAR payments are native transfers made by the customer wallet; this contract
 *    only records the settlement reference the gateway observed on the Mirror Node.
 *  - The `operator` is the gateway's ECDSA account. It can create/expire invoices and
 *    attest observed HBAR settlements. It cannot move funds and cannot mark an invoice
 *    settled for a token payment (that path is atomic on-chain).
 */
contract InvoiceRegistry is Ownable {
    /// @dev HTS system contract (precompile) address.
    IHederaTokenService private constant HTS = IHederaTokenService(address(0x167));
    /// @dev Hedera response code for SUCCESS.
    int64 private constant SUCCESS = 22;

    enum Status {
        None,
        Open,
        Settled,
        Cancelled,
        Expired
    }

    struct Invoice {
        bytes32 id;
        address merchant;
        address token; // address(0) => HBAR
        uint256 amount; // HBAR: tinybar; HTS: base units
        uint64 expiresAt;
        Status status;
        address payer;
        bytes32 settlementRef; // hedera tx id hash (HBAR path) or msg.sender ref
        string memo;
    }

    address public operator;
    /// @dev SaucerSwap V1 router. address(0) disables the any-token swap path.
    address public saucerRouter;

    mapping(bytes32 => Invoice) private _invoices;
    bytes32[] private _invoiceIds;

    event IssuerChanged(address indexed previousOperator, address indexed newOperator);
    event InvoiceCreated(
        bytes32 indexed id,
        address indexed merchant,
        address token,
        uint256 amount,
        uint64 expiresAt,
        string memo
    );
    event InvoiceSettled(
        bytes32 indexed id,
        address indexed payer,
        address token,
        uint256 amount,
        bytes32 settlementRef,
        bool viaContract
    );
    event InvoiceCancelled(bytes32 indexed id, address by);
    event InvoiceExpired(bytes32 indexed id);

    error NotOperator();
    error InvalidInvoice();
    error InvoiceExists();
    error InvoiceNotOpen();
    error NotYetExpired();
    error TokenTransferFailed(int256 responseCode);
    error ZeroAmount();
    error RouterNotSet();
    error BadSwapPath();

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(address operator_, address owner_) Ownable(owner_) {
        operator = operator_;
        emit IssuerChanged(address(0), operator_);
    }

    // ---------------------------------------------------------------- admin

    function setOperator(address newOperator) external onlyOwner {
        emit IssuerChanged(operator, newOperator);
        operator = newOperator;
    }

    function setSaucerRouter(address router) external onlyOwner {
        saucerRouter = router;
    }

    // ------------------------------------------------------------- invoices

    /**
     * @notice Opens an invoice. Called by the gateway backend (operator) right after
     * the invoice is created off-chain, so the terms are publicly verifiable.
     */
    function createInvoice(
        bytes32 id,
        address merchant,
        address token,
        uint256 amount,
        uint64 expiresAt,
        string calldata memo
    ) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        if (_invoices[id].status != Status.None) revert InvoiceExists();
        if (expiresAt <= block.timestamp) revert InvalidInvoice();

        _invoices[id] = Invoice({
            id: id,
            merchant: merchant,
            token: token,
            amount: amount,
            expiresAt: expiresAt,
            status: Status.Open,
            payer: address(0),
            settlementRef: bytes32(0),
            memo: memo
        });
        _invoiceIds.push(id);

        emit InvoiceCreated(id, merchant, token, amount, expiresAt, memo);
    }

    /**
     * @notice Pays an HTS-token invoice atomically.
     *
     * The payer must first grant this contract an allowance:
     *   HederaTokenService.approve(tokenId, registryEvmAddress, amount)
     *
     * Funds move payer -> merchant directly (HIP-336), so the contract is never
     * a custodian and the invoice can only settle if the transfer succeeded.
     */
    function payInvoiceWithHts(bytes32 id) external returns (int64 responseCode) {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Open) revert InvoiceNotOpen();
        if (inv.token == address(0)) revert InvalidInvoice(); // HBAR invoice: use the native path
        if (block.timestamp > inv.expiresAt) revert InvalidInvoice();

        (int rcAllowance, uint256 allowed) = HTS.allowance(inv.token, msg.sender, address(this));
        if (rcAllowance != SUCCESS || allowed < inv.amount) revert TokenTransferFailed(rcAllowance);

        responseCode = HTS.transferFrom(inv.token, msg.sender, inv.merchant, inv.amount);
        if (responseCode != SUCCESS) revert TokenTransferFailed(responseCode);

        inv.status = Status.Settled;
        inv.payer = msg.sender;
        inv.settlementRef = bytes32(uint256(uint160(msg.sender)));

        emit InvoiceSettled(id, msg.sender, inv.token, inv.amount, inv.settlementRef, true);
    }

    /**
     * @notice Pays an invoice in ANY HTS token, swapping to the invoice token
     * via SaucerSwap V1 in the SAME transaction.
     *
     * Load-bearing integration: without the DEX the merchant cannot quote one
     * asset and accept another. Atomic hop: tokenIn is pulled from the payer,
     * swapped, and tokenOut is sent to `inv.merchant`. The registry must hold
     * a zero balance of both tokens after the call (no lingering custody).
     *
     * `path[0]` is the token the payer holds. `path[last]` MUST be `inv.token`.
     * `amountInMax` is the most the payer will spend; `amountOutMin` is the
     * invoice amount.
     */
    function payInvoiceWithSwap(
        bytes32 id,
        uint256 amountInMax,
        address[] calldata path,
        uint256 deadline
    ) external returns (uint256 amountInUsed) {
        if (saucerRouter == address(0)) revert RouterNotSet();
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Open) revert InvoiceNotOpen();
        if (inv.token == address(0)) revert InvalidInvoice();
        if (block.timestamp > inv.expiresAt) revert InvalidInvoice();
        if (path.length < 2 || path[path.length - 1] != inv.token) revert BadSwapPath();
        if (amountInMax == 0) revert ZeroAmount();
        if (deadline < block.timestamp) revert InvalidInvoice();

        address tokenIn = path[0];
        if (tokenIn == inv.token) revert BadSwapPath();

        bool pulled = IERC20Minimal(tokenIn).transferFrom(msg.sender, address(this), amountInMax);
        if (!pulled) revert TokenTransferFailed(0);

        bool ok = IERC20Minimal(tokenIn).approve(saucerRouter, amountInMax);
        if (!ok) revert TokenTransferFailed(0);

        uint256[] memory amounts = ISaucerRouterV1(saucerRouter).swapExactTokensForTokens(
            amountInMax,
            inv.amount,
            path,
            inv.merchant,
            deadline
        );
        amountInUsed = amounts[0];

        // Dust of tokenIn (if the router left any) goes back to the payer.
        uint256 leftover = IERC20Minimal(tokenIn).balanceOf(address(this));
        if (leftover > 0) {
            IERC20Minimal(tokenIn).transfer(msg.sender, leftover);
        }

        inv.status = Status.Settled;
        inv.payer = msg.sender;
        inv.settlementRef = bytes32(uint256(uint160(msg.sender)));
        emit InvoiceSettled(id, msg.sender, inv.token, inv.amount, inv.settlementRef, true);
    }

    /**
     * @notice Records an HBAR settlement the gateway verified on the Mirror Node.
     *
     * The customer paid with a native CryptoTransfer carrying the invoice memo; the
     * reconciler matched it and the operator attests the transaction id here, which
     * makes the settlement auditable on-chain. The invoice amount is never trusted
     * from the caller — it is read from storage.
     */
    function attestHbarSettlement(bytes32 id, bytes32 hederaTxRef, address payer) external onlyOperator {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Open) revert InvoiceNotOpen();
        if (inv.token != address(0)) revert InvalidInvoice();
        if (payer == address(0)) revert InvalidInvoice();

        inv.status = Status.Settled;
        inv.payer = payer;
        inv.settlementRef = hederaTxRef;

        emit InvoiceSettled(id, payer, address(0), inv.amount, hederaTxRef, false);
    }

    function cancelInvoice(bytes32 id) external {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Open) revert InvoiceNotOpen();
        if (msg.sender != inv.merchant && msg.sender != operator && msg.sender != owner()) {
            revert NotOperator();
        }
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id, msg.sender);
    }

    /// @notice Flips an unpaid invoice past its expiry. Callable by anyone (also schedulable).
    function expireInvoice(bytes32 id) external {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Open) revert InvoiceNotOpen();
        if (block.timestamp <= inv.expiresAt) revert NotYetExpired();
        inv.status = Status.Expired;
        emit InvoiceExpired(id);
    }

    // ---------------------------------------------------------------- views

    function getInvoice(bytes32 id) external view returns (Invoice memory) {
        return _invoices[id];
    }

    function isOpen(bytes32 id) external view returns (bool) {
        Invoice storage inv = _invoices[id];
        return inv.status == Status.Open && block.timestamp <= inv.expiresAt;
    }

    function invoiceCount() external view returns (uint256) {
        return _invoiceIds.length;
    }

    function invoiceIdAt(uint256 index) external view returns (bytes32) {
        return _invoiceIds[index];
    }
}

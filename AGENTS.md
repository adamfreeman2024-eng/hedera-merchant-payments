# AGENTS.md — working in this repository

This repo is written to be worked on by AI coding agents as well as humans. If you are an
agent, read this file before editing.

## Layout

| Path | What lives there |
|---|---|
| `packages/hardhat/contracts/` | `InvoiceRegistry.sol` (invoice ledger, HTS settlement) |
| `packages/hardhat/test/` | contract tests (hardhat) |
| `packages/ledger/src/` | **all money logic**: units, memo, invoice state machine, HCS receipts, webhook signing |
| `packages/ledger/test/` | unit tests for the above (`yarn workspace @hmp/ledger test`) |
| `packages/nextjs/` | merchant dashboard + hosted checkout (App Router) |
| `services/reconciler/` | worker: Mirror Node → ledger → HCS → webhooks |

## Non-negotiable rules

1. **Never make the gateway a lingering custodian.** Direct HTS/HBAR paths move payer → merchant with no hop. The SaucerSwap path may pull `tokenIn` into the registry **inside the same transaction**, swap, and send `tokenOut` to the merchant; leftover `tokenIn` returns to the payer. End-of-transaction balances on the registry must be zero. No code path may hold a customer balance across transactions or send funds to the operator.
2. **Amounts are `bigint` base units** end-to-end. Never use floats or `Number` for money.
   Use `toBaseUnits` / `fromBaseUnits` from `@hmp/ledger`.
3. **The invoice state machine is one-way** (`OPEN → SETTLED | CANCELLED | EXPIRED`).
   Transitions live in `packages/ledger/src/invoice.ts` — add rules, do not bypass them.
4. **Settlement is only ever proven by chain data**: a Mirror Node record (HBAR path) or the
   atomic HTS transfer (token path). Never mark an invoice paid from a client-supplied value.
5. **No secrets in code, tests, fixtures or commits.** Read them from env; `.env*` is gitignored.
6. TypeScript strict everywhere; Solidity compiles at 0.8.28 with the optimizer on.

## Definition of done for any change

```bash
yarn typecheck                 # every workspace
yarn test                      # contract tests
yarn workspace @hmp/ledger test  # money/state-machine/webhook unit tests
yarn hardhat:compile
```

All four must pass. New money or state logic requires a test in `packages/ledger/test/`.

## Common tasks

- **Add a currency** → extend `Currency` in `packages/ledger/src/money.ts`, keep decimals exact,
  add a test.
- **Add an event** (e.g. `invoice.refunded`) → add to `WebhookEvent`, sign it, record a
  `WebhookDelivery` row, emit an HCS receipt.
- **Change contract behaviour** → update `InvoiceRegistry.sol`, its tests, and the
  `createInvoiceRecord` / `markSettled` mirror in `packages/ledger/src/invoice.ts`.

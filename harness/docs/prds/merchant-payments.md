# PRD — Hedera Merchant Payments (non-custodial payment gateway)

## Product goal

Give any merchant on Hedera a working payment rail in one command: issue an invoice,
let the customer pay it on-chain, and get verification, a tamper-evident receipt and a
webhook — **without the gateway ever holding the money**.

Today a merchant has three bad options: a custodial processor (funds held, T+1 settlement,
freeze risk), raw wallet transfers (nothing ties a transfer to an order), or a bespoke script
(no audit trail, no receipts, no retries). This template is the fourth option: a forkable
reference implementation that keeps custody with the merchant and makes reconciliation
automatic.

## Users

| Actor | Needs |
|---|---|
| Merchant (shop owner) | Issue invoices, see what was paid, export for accounting, rotate the gateway key |
| Customer (payer) | A link that says exactly how much, to which account, with which memo — payable from any wallet |
| Merchant's back office | A signed webhook that fires once per settled invoice, retried until delivered |
| Auditor / accountant | A receipt trail that can be checked independently (HCS + Mirror Node) |

## User journeys

**J1 — Read path, no wallet, no credentials (must work on a cold boot).**
Browse the dashboard → see the invoice list and their statuses → open an invoice detail →
see amount, memo, expiry, settlement evidence. No `.env` needed for this path.

**J2 — Issue an invoice.**
Dashboard → *New invoice* → amount + currency (HBAR or HTS token id) + expiry → submit →
invoice appears as OPEN with an id and memo `HMP-<ID>`; the invoice terms are also written
to the on-chain `InvoiceRegistry` so they are publicly verifiable.

**J3 — Pay (HBAR path, wallet-gated).**
Checkout page → shows amount, merchant account, memo, expiry, QR/deep-link → customer sends a
native transfer carrying the memo → the reconciler matches memo + amount + destination from the
Mirror Node → invoice becomes SETTLED with the transaction id.

**J4 — Pay (HTS token path, wallet-gated, atomic).**
Checkout page → *Pay with token* → the wallet first grants the registry a HIP-336 allowance →
the registry calls `HTS.transferFrom(payer → merchant)` in the same transaction as the status
change, so an invoice can never be marked paid without the tokens moving.

**J5 — Receipts and notification.**
On settlement (or expiry/cancellation) the worker appends an HCS receipt and POSTs a signed
webhook (`sha256=<hmac of timestamp.body>`) to the merchant. Failed deliveries are retried and
recorded.

**J6 — Expire.**
An unpaid invoice past its deadline is reported as EXPIRED; `expireInvoice()` on-chain is
callable by anyone after the deadline (and is the hook for a scheduled transaction).

## Hedera services involved

- **Hedera Token Service (HTS, `0x167`)** — token checkout via HIP-336 allowances
  (`approve` / `allowance` / `transferFrom`); funds move payer → merchant inside one transaction.
- **Consensus Service (HCS)** — settlement/expiry/cancel receipts; sequence number stored with
  the invoice so the DB can be cross-checked against public consensus order.
- **Smart Contracts** — `InvoiceRegistry` (invoice terms, status, settlement reference; OpenZeppelin
  `Ownable` so the merchant can rotate the gateway operator).
- **Mirror Node REST** — source of truth for HBAR settlement (memo + amount + destination).
- **Scheduled Transactions (HSS, `0x16b`)** — the planned replacement for the expiry sweep
  (HIP-1215 `scheduleCall` to `expireInvoice`), so expiry needs no worker.

## Non-goals

- **No custody, ever.** No code path may route customer funds through the gateway, the operator
  account or a contract balance. The gateway holds only metadata and its own fee-paying key.
- No fiat rails, no card processing, no KYC/AML workflow — those belong to the merchant's PSP.
- No multi-merchant SaaS control plane in v1 (one deployment serves one merchant; the schema is
  already merchant-scoped).
- No mainnet deployment automation; the walkthrough targets testnet.
- No private keys or funded accounts required to browse or grade the read path.

## Deliverables expected in the workspace

- `template.json` (scaffold manifest: nextjs-app + hardhat, yarn, env vars, outro steps)
- `README.md` (problem, custody model, services, quickstart) and `RUNBOOK.md` (click-by-click)
- `AGENTS.md` (rules for AI agents: no custody, bigint money, one-way state machine)
- `packages/hardhat` — `InvoiceRegistry.sol` + tests + deploy script
- `packages/ledger` — money units, memo, invoice state machine, HCS receipts, webhook signing + tests
- `packages/nextjs` — invoice dashboard, `/new`, hosted checkout `/pay/[invoiceId]`, `/api/invoices`
- `services/reconciler` — worker CLI (`--init-topic`, `--once`, `--new-invoice`, daemon)
- `docker-compose.yml` (Postgres), `.env.example`, CI workflow
- `harness/` — this spec, validators, Playwright smoke gate and acceptance contract

## Success signal

A developer scaffolds the template, funds one testnet account, and settles a real invoice on
testnet within the documented steps — with the settlement verifiable on the Mirror Node, in the
registry and in the HCS topic, and the merchant notified by a signed webhook.

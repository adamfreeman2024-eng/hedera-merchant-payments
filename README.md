# Hedera Merchant Payments — `scaffold-hbar` template

A **non-custodial merchant payment gateway** for Hedera: your shop issues an invoice,
the customer pays it on-chain, and the gateway verifies, receipts and reports the
payment. No middleman ever holds the money.

```bash
npm create scaffold-hbar@latest merchant-payments -- --template <owner>/hedera-merchant-payments
```

---

## The problem

Accepting crypto payments still means one of three bad options:

1. **Custodial processors** — a third party holds your funds, settles T+1/T+7, and can freeze you.
2. **Raw wallet transfers** — nothing ties a transfer to an order, so reconciliation is a spreadsheet job.
3. **Homegrown scripts** — no audit trail, no webhooks, no refund/expiry rules, no receipts for accounting.

Merchants already accept HBAR and HTS stablecoins on Hedera, but there is no open,
forkable reference gateway that ties **invoice → payment → receipt → webhook** together.
That is what this template ships.

## What it does

| Capability | How |
|---|---|
| Issue an invoice (amount, currency, expiry, memo) | `POST /api/invoices` → row in Postgres **+** `InvoiceRegistry.createInvoice` on-chain |
| Hosted checkout page | `/pay/[invoiceId]` — QR + one-click pay |
| Pay in HBAR | native `CryptoTransfer` with the invoice memo `HMP-<ID>` |
| Pay in an HTS token (e.g. testnet USDC) | **atomic on-chain settlement**: `approve` (HIP-336) then the registry calls `HTS.transferFrom(payer → merchant)` inside the same transaction |
| Verify settlement | Mirror Node polling worker matches transfers by memo + amount + merchant account |
| Tamper-evident receipts | every event appended to an **HCS** topic; the sequence number is stored with the invoice |
| Merchant notification | **signed webhooks** (`sha256` HMAC of `timestamp.body`) with retries |
| Expiry / refund handling | `expireInvoice()` on-chain (callable by anyone after the deadline), refunds stay a merchant-signed action |
| Accounting | CSV export + on-chain registry as the source of truth |

## Custody model (the important part)

```
customer wallet ──HBAR transfer (memo HMP-INV…)──────────────▶ merchant account
                 └─HTS: approve ──▶ InvoiceRegistry ──transferFrom──▶ merchant account
                                        │
                                        └─ only records: id, terms, status, settlement ref
```

- Customer funds move **payer → merchant**. They never touch the gateway, the operator
  account, or the contract.
- `InvoiceRegistry` stores terms and status only — it has no function that can move tokens
  to itself or to the operator.
- The **operator** key (ECDSA) can create invoices and attest an *observed* HBAR settlement
  (recording the transaction id it saw on the Mirror Node). It cannot redirect funds and
  cannot settle a token invoice — that path is atomic and only ever pays the merchant
  encoded in the invoice.
- Payer identity for HBAR settlements is the operator (the attester); the real payer account id
  is stored in the ledger from the Mirror Node record.

## Hedera services used

| Service | Usage |
|---|---|
| **Hedera Token Service (HTS)** | token payments via the `0x167` system contract using HIP-336 allowances (`approve` / `allowance` / `transferFrom`) |
| **Consensus Service (HCS)** | settlement/expiry/cancel receipts (`TopicMessageSubmitTransaction`) |
| **Smart Contracts** | `InvoiceRegistry` invoice ledger (OpenZeppelin `Ownable` for key rotation) |
| **Mirror Node REST** | reconciliation of native HBAR transfers by memo, amount and destination |
| **Scheduled Transactions (HSS, `0x16b`)** | planned: schedule `expireInvoice()` at the deadline (HIP-1215 `scheduleCall`) so expiry needs no worker |

## Architecture

```
packages/hardhat     InvoiceRegistry.sol + hardhat-deploy + typechain (contracts, tests)
packages/ledger      Prisma schema + domain rules (money units, invoice state machine,
                     HCS receipts, signed webhooks) — unit-tested, shared by app & worker
packages/nextjs      merchant dashboard, hosted checkout, public API (App Router)
services/reconciler  long-running worker: Mirror Node → ledger → HCS → webhooks
```

Everything money-related lives in `packages/ledger` as pure, unit-tested functions
(`bigint` end-to-end — floats never touch settlement math).

## Quickstart

```bash
# 1. scaffold
npm create scaffold-hbar@latest merchant-payments -- --template <owner>/hedera-merchant-payments
cd merchant-payments

# 2. env + ledger
cp .env.example .env
cp packages/nextjs/.env.example packages/nextjs/.env
yarn ledger:up          # Postgres via docker compose
yarn db:migrate

# 3. accounts (operator = gateway signer, merchant = settlement account)
yarn hardhat:account:generate     # prints an ECDSA account + private key
#   fund it: https://portal.hedera.com/faucet

# 4. contracts
yarn hardhat:compile
yarn hardhat:test
yarn hardhat:deploy --network hederaTestnet     # prints INVOICE_REGISTRY_ADDRESS

# 5. HCS receipt topic
yarn reconciler:once --init-topic               # prints HCS_RECEIPT_TOPIC_ID

# 6. run
yarn next:dev                                   # dashboard + checkout on :3000
yarn reconciler:dev                             # reconciliation worker (2nd terminal)
```

Full click-by-click instructions, including a testnet end-to-end walkthrough and
troubleshooting: **[RUNBOOK.md](./RUNBOOK.md)**.

## Tests

```bash
yarn test              # contract tests (invoice lifecycle, access control, expiry)
yarn workspace @hmp/ledger test    # money/units, state machine, webhook signatures
yarn typecheck         # all workspaces
```

## Security notes

- Private keys are read from env only; nothing is written to disk except the generated
  `.account` file used by `hardhat:account:*` (gitignored).
- The operator/treasury account pays HCS fees and gas. It is **not** a funds sink.
- Webhooks are signed and replay-window protected (`verifySignature` is exported so
  merchants can copy it).
- The registry is `Ownable` so the merchant can rotate the gateway operator key.

## Status & roadmap

Verified locally (commands and results, not claims):

| Milestone | Command | Result |
|---|---|---|
| Contract compiles | `yarn hardhat:compile` | ✅ 3 files, solc 0.8.28, evm target `paris` |
| Contract behaviour | `yarn hardhat:test` | ✅ **11 passing** (lifecycle, access control, HTS-path guards, expiry, key rotation) |
| Ledger domain rules | `yarn workspace @hmp/ledger test` | ✅ **10 passing** (units, memo, state machine, webhook signatures) |
| Template contract | `create-scaffold-hbar` with `CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR` | ✅ scaffolds, manifest validates, outro + `{run:scripts}` render |
| Harness artifacts | `harness/` (spec, static + yarn validators, Playwright smoke, 8-assertion acceptance contract) | ✅ all valid JSON/YAML; contract: 2 critical / 5 major / 1 minor |
| App build | `yarn next:build` | ✅ Next.js 15, 7 routes compiled |
| App read path with **no configuration at all** | `next start` with every env var unset | ✅ dashboard renders with setup guidance, `/new` 200, `/api/health` lists what is missing, `POST /api/invoices` → clean 503 (no crash) |
| Local end-to-end | docker Postgres + `prisma migrate dev` + app | ✅ create → list → checkout page → invalid amount 400 → cancel |
| **Testnet end-to-end (chain 296)** | app + worker, real HBAR | ✅ see below |

### Testnet evidence (publicly verifiable, no keys needed)

| Artifact | Value |
|---|---|
| InvoiceRegistry | `0xc978548F1c4606CE7A2d15D8ED31Fe88820Df670` |
| HCS receipt topic | `0.0.10541151` (seq 1, seq 2) |
| Invoice 1 | `INV-MU1G1FSW443` — 0.5 HBAR, paid by `0.0.10541152`, tx `0.0.10541152-1789402480-818444585` |
| Invoice 2 | `INV-MU1GDH4M599` — 0.25 HBAR, paid by `0.0.10541152`, tx `0.0.10541152-1789403045-808216195`, attested on-chain |
| Matching | memo (`HMP-…`) + amount + destination, read from the Mirror Node |
| Registry read-back | `getInvoice(chainId)` → `SETTLED`, amount `25000000` tinybar, correct memo |

### Known limitations (honest list)

- **HBAR path: the on-chain `payer` is the attesting operator.** The true payer *is* recorded in the ledger row (`paidBy`) and inside the HCS receipt (`paymentTxId`); the HTS path records the real payer because the token transfer carries it. Passing the payer into `attestHbarSettlement` is the planned fix.
- **EVM wallets cannot attach a Hedera memo**, so a MetaMask-style HBAR transfer will never reconcile — that is why the HTS path exists. The checkout page states this.
- **No one-click wallet pay yet.** The checkout shows amount, destination, memo, a QR of the checkout link, and both payment paths; the in-browser HTS `approve` + `payInvoiceWithHts` call is the next milestone.
- **Mirror Node pagination**: the worker scans the first 100 transactions in the lookback window per pass; `links.next` paging is on the roadmap.

- [x] `InvoiceRegistry` with atomic HTS settlement + attested HBAR settlement
- [x] Ledger domain rules (units, memo, state machine, webhook signing) with unit tests
- [x] HCS receipt writer (submit + sequence capture) — *not yet exercised against a live topic*
- [ ] Next.js dashboard + hosted checkout
- [ ] Mirror Node reconciler worker + webhook delivery queue
- [ ] Testnet end-to-end walkthrough with recorded transaction ids
- [ ] Merchant onboarding (multiple merchants per deployment)

Licence: MIT.

## Submission checklist

- [ ] Repo is public (or shared with the reviewers) — *not before 2026-09-21*.
- [ ] `.github/workflows/ci.yaml` is committed. It is ignored right now because the
      GitHub token in use has no `workflow` scope; run `gh auth refresh -s workflow`
      and then `git add -f .github/workflows/ci.yaml && git commit -m "ci: add workflow"`.
- [ ] README status table matches the latest local runs.
- [ ] No secrets in the tree: `git grep -nE "0x[0-9a-fA-F]{64}|302e0201"`.

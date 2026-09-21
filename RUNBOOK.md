# RUNBOOK — Hedera Merchant Payments

Click-by-click, from an empty machine to a paid invoice on Hedera testnet.
Everything below is copy-paste; nothing is assumed.

---

## 0. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 20.18.3 | `node -v` |
| Yarn | any launcher (the repo ships Yarn 3.2.3 itself) | `yarn -v` |
| Docker (for Postgres) | any recent | `docker compose version` |

The repo vendors its package manager at `.yarn/releases/yarn-3.2.3.cjs`, so you and CI run
the exact same Yarn. Without a global `yarn`: `node .yarn/releases/yarn-3.2.3.cjs install`.
npm works too (`npm install`).

Hedera testnet accounts are free: https://portal.hedera.com/faucet (and a funded testnet
account is required for the operator).

---

## 1. Scaffold and install

```bash
npm create scaffold-hbar@latest merchant-payments -- --template adamfreeman2024-eng/hedera-merchant-payments
cd merchant-payments
yarn install        # or: npm install      (~2 min)
yarn verify         # typecheck + contract tests + ledger tests — green out of the box
```

`yarn verify` needs no `.env`, no database and no Hedera account: the contract and the
domain rules are exercised in isolation. If it is green, your toolchain is fine.

## 2. Environment

```bash
cp .env.example .env
cp packages/nextjs/.env.example packages/nextjs/.env
cp packages/hardhat/.env.example packages/hardhat/.env
```

Edit `.env` (root) — the gateway reads the Hedera settings from the root file:

```
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=0.0.XXXXXX          # gateway signer (pays HCS fees + gas)
HEDERA_OPERATOR_KEY=0x...              # ECDSA key
MERCHANT_ACCOUNT_ID=0.0.YYYYYY         # where the money lands
PAYMENT_TOKEN_ID=                      # empty = HBAR only
DATABASE_URL=postgresql://merchant:merchant@localhost:5432/merchant_payments
WEBHOOK_SIGNING_SECRET=whsec_dev_local_change_me
```

> Never commit `.env`. Any key pasted into a chat/ticket should be rotated.

## 3. Database

```bash
yarn ledger:up        # starts Postgres 16 in docker (bound to 127.0.0.1 only)
yarn db:migrate       # applies the committed migration + generates the Prisma client
```

Verify:

```bash
docker compose exec postgres psql -U merchant -d merchant_payments -c '\dt'
yarn smoke:testnet    # read-only readiness probe: ledger, merchant account, HCS topic, registry
```

`yarn smoke:testnet` spends nothing and exits non-zero, listing exactly what is missing.

## 4. Gateway + merchant accounts

```bash
yarn hardhat:account:generate
```

It prints `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` — put them in `.env`, then fund the
account at https://portal.hedera.com/faucet (100 testnet HBAR is plenty).

Set `MERCHANT_ACCOUNT_ID` to a **different** account you control (that is the whole point of
the template). For a smoke test the same account is acceptable.

## 5. Deploy the invoice registry

```bash
yarn hardhat:compile
yarn hardhat:test                 # 11 contract tests should pass
yarn hardhat:deploy --network hederaTestnet
```

Copy the printed `INVOICE_REGISTRY_ADDRESS` into `.env`.

Confirm on HashScan: `https://hashscan.io/testnet/contract/<address>`.

## 6. HCS receipt topic

```bash
yarn reconciler:once --init-topic
```

Copy the printed topic id into `HCS_RECEIPT_TOPIC_ID`. Trigger a message by settling an
invoice; verify on `https://hashscan.io/testnet/topic/<topicId>`.

## 7. Run the gateway

Terminal A — dashboard + hosted checkout:

```bash
yarn next:dev     # http://localhost:3000  (/new to create an invoice)
```

Terminal B — reconciliation worker:

```bash
yarn reconciler:dev       # polls the Mirror Node every 5s
```

## 8. End-to-end: get paid

1. Open `http://localhost:3000/new`, create an invoice for e.g. `0.5` HBAR, expiry 15 min.
2. Open the checkout link `/pay/<invoiceId>`.
3. **HBAR path** — send the shown amount to the merchant account with the memo
   `HMP-<ID>` (the page offers a QR / HashPack link; a manual transfer from the Hedera
   portal works too).
4. **HTS path** — click *Pay with token*: the page first submits a HIP-336 `approve`
   for the registry, then calls `payInvoiceWithHts`. The transfer to the merchant and the
   status change happen in one transaction.
5. Watch the worker: `invoice.paid` → HCS receipt written → signed webhook delivered.
6. Verify independently:
   - Mirror Node: `curl "https://testnet.mirrornode.hedera.com/api/v1/accounts/<merchant>/transactions?limit=5"`
   - Registry: `getInvoice(<chainId>)` on HashScan
   - HCS topic messages
   - `yarn reconciler:once --reconcile` prints what it matched

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `INSUFFICIENT_TX_FEE` on deploy | operator has no HBAR | fund via the faucet |
| Invoice never settles (HBAR path) | memo missing/typo, amount mismatch, wrong destination | the memo must be exactly `HMP-<ID>`; the reconciler matches memo + amount + merchant |
| `TokenTransferFailed(194)` on the HTS path | allowance missing or too small | re-approve for at least the invoice amount (HIP-336) |
| `InvoiceNotOpen` | already settled/cancelled/expired | create a new invoice |
| Webhook not delivered | endpoint down / wrong secret | check `WebhookDelivery.lastError`, replays run automatically |
| `HCS_RECEIPT_TOPIC_ID` empty | topic not created yet | `yarn reconciler:once --init-topic` |

## 10. Mainnet checklist (before real money)

- [ ] `HEDERA_NETWORK=mainnet`, funded mainnet operator (ECDSA)
- [ ] `MERCHANT_ACCOUNT_ID` = the real merchant account, keys held outside this repo
- [ ] `WEBHOOK_SIGNING_SECRET` = a 32-byte random value from a secret manager
- [ ] Postgres backups enabled; `prisma migrate deploy` in CI
- [ ] Alerting on: worker heartbeat, undelivered webhooks, unsettled invoices older than expiry
- [ ] Merchant rotates the gateway operator key (`setOperator`) on staff changes

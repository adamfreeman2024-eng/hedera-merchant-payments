# Submission checklist — Scaffold-HBAR Template Bounty

Source of truth for the gate: <https://hedera.com/blog/scaffold-hbar-template-bounty/>
(blog post 23226, Jake Hall, published 16.09.2026). Deadlines in that post:
**build/submit 21.09 – 04.10.2026 23:59 ET** (Yerevan ≈ 05.10 07:59), AMA 29.09
10:00 ET, winners 19.10.

## Things only the owner can do — do not lose these

- [ ] **`gh auth refresh -s workflow`** — the current token's scopes are
      `gist, read:org, repo`, with **no `workflow`**, so GitHub rejects a push that
      contains `.github/workflows/`. Interactive device flow; the repo operator must
      approve it. After that:
      ```bash
      git add -f .github/workflows/ci.yaml
      git commit -m "ci: add workflow"
      git push
      ```
- [ ] **Flip the repository to public** (21.09.2026 at the earliest — the build
      window opens that day; the repo was deliberately private until then).
      ```bash
      gh repo edit adamfreeman2024-eng/hedera-merchant-payments \
        --visibility public --accept-visibility-change-consequences
      ```
- [ ] **Submit the entry** through the form Hedera sends / links in the brief.
- [ ] **Run the self-check script** Hedera said would arrive at the start of the
      build week, and paste its output here.
- [ ] **Paste the one-click install command** from the brief into this file once the
      repo is public, then verify it end-to-end:
      ```bash
      npm create scaffold-hbar@latest -- --template adamfreeman2024-eng/hedera-merchant-payments
      ```

## Gate items and their evidence

| Gate requirement | Status | Evidence |
|---|---|---|
| Public GitHub repo | ⛔ pending window | currently PRIVATE by design |
| `template.json` at root | ✅ | validated by `create-scaffold-hbar` local-dir seam |
| README + `AGENTS.md` | ✅ | both at root |
| MIT licence | ✅ | `LICENSE` (renamed from `LICENCE` for canonical detection) |
| No secrets / `.env` committed | ✅ | `git ls-files` clean; `.env*` gitignored |
| Fresh install works | ✅ | clean clone + vendored Yarn 3.2.3, `install` 1m43s |
| Build passes | ✅ | `yarn verify` exit 0 on a fresh clone |
| Tests pass | ✅ | **16** hardhat + **11** ledger |
| ≥1 Hedera service | ✅ | HTS `0x167` (HIP-336), HCS receipts, HSS `0x16b` (HIP-1215) |
| **Real testnet transaction / HashScan** | ✅ | `payInvoiceWithSwap` SETTLED `0.0.7314364-1789748240-167185116` |
| Original code | ✅ | clean-room; no other submission's code |
| No clone of the 8 official templates | ✅ | official set: `blank`, `hedera-demo`, `oracles`, `payments-scheduler`, `bridge`, `cross-chain-dca`, `tokenize-subscriptions`, `x402-pay-per-use` |
| CI workflow | ⚠️ on disk only | blocked by the `workflow` scope above — a scoring item, do not forget |

## Testnet evidence (publicly verifiable, no keys needed)

- InvoiceRegistry `0.0.10600857` — <https://hashscan.io/testnet/contract/0.0.10600857>
- Live `payInvoiceWithSwap` (SAUCE → WHBAR, invoice SETTLED):
  `0.0.7314364-1789748240-167185116`
- HIP-1215 `scheduleExpire`: `0.0.7314364-1789727671-967513663`
- SaucerSwap V1 testnet factory `0.0.9959`, SAUCE/WHBAR pair
  `0xfE7CC3cEb7b1128bfC3889184E2d5561BF74bfb3`

## One question a judge may ask: the key in `hardhat.config.ts`

`packages/hardhat/hardhat.config.ts` contains `0xac09…ff80`. That is Hardhat's
**documented development account #0**, published in every Hardhat tutorial and
funded only on the in-process `hardhat` network. It is not a secret and is
deliberately present so `yarn test` and a fresh clone run with no `.env`. The
resolution order is `__RUNTIME_DEPLOYER_PRIVATE_KEY` → `HEDERA_OPERATOR_KEY` →
that dev key, and the comment in the file says so.

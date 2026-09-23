# Harness artifacts

This folder makes the template gradable by **[Hedera Harness](https://github.com/hedera-dev/hedera-harness)**
(the agentic build/validate loop that the Scaffold-HBAR Template Bounty recommends) and readable by
any reviewer as a machine-checkable product contract.

| File | Purpose | Tier |
|---|---|---|
| `spec.yaml` | harness spec: seed repo, generator/validator agents, constraints, required/forbidden files, secret scan | — |
| `validators/merchant-payments-static.json` | static invariants (manifest identity, layout, no secrets, README claims that must match real scripts) | 1 |
| `validators/merchant-payments-yarn.json` | the commands that must pass: install, ledger tests, contract compile+test, production build | 1 |
| `playwright/merchant-payments-smoke.yaml` | boots the app and checks the critical routes render | 2 |
| `contracts/merchant-payments-acceptance.json` | the graded product contract: 10 numbered assertions (C1–C10) including live quote and HCS reconstruct | 3 |
| `docs/prds/merchant-payments.md` | the PRD the contract is derived from | — |

## Running it

From a [harness](https://github.com/hedera-dev/hedera-harness) checkout (`npm install`, `agent` on PATH):

```bash
# cheap config validation against a workspace
npm run harness -- validate          <repo>/harness/spec.yaml --workspace runs/<id>/workspace

# semantic (Tier 3) validation — grades contracts/merchant-payments-acceptance.json
npm run harness -- validate-semantic <repo>/harness/spec.yaml --workspace runs/<id>/workspace

# full agentic run
npm run harness -- run               <repo>/harness/spec.yaml --max-attempts 3
```

Tier 3.5 (real on-chain settlement with an ephemeral ECDSA test signer) is **disabled** in
`spec.yaml` until the hosted checkout ships the burner connector described in the harness
authoring guide (`enableBurnerWallet`, burner in `wagmiConnectors`, `expose.browserLocalStorageKey`).
Enabling it turns `C6` into an end-to-end assertion verified against the testnet Mirror Node.

## Design notes

- The contract is written from the PRD journeys, not from the file list — and it is what a
  semantic validator grades.
- Read-path assertions (`C1`–`C4`, `C7`–`C10`) must pass **without credentials**; wallet-gated
  ones (`C5`, `C6`) are affordance-only unless a test signer is provided.
- Severity is deliberately conservative: only `C1` and `C6` are `critical` (app loads / money moves).

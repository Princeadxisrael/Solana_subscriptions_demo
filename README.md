# Solana Subscriptions — Developer Demo

A minimal, dependency-light TypeScript prototype that demonstrates all three
delegation models from `solana-foundation/subscriptions` running on a local
validator.

**No RPC services. No devnet. Everything runs on `localhost:8899`.**

---

## What it shows

| Demo | Model | What you see |
|------|-------|-------------|
| `01-fixed.ts` | Fixed delegation | Alice grants Bob a 200 USDC one-time allowance. Bob pulls in two transactions. Delegation exhausted. |
| `02-recurring.ts` | Recurring delegation | Alice grants Bob 300 USDC/hour. Bob hits the per-period cap. Third pull rejected on-chain. |
| `03-plan.ts` | Plan + subscription | Merchant publishes plan. Alice subscribes. Merchant bills. Alice cancels, resumes, gets billed again. |

---

## Prerequisites

### 1. Clone and build the subscriptions program

```bash
git clone https://github.com/solana-foundation/subscriptions.git
cd subscriptions

# Install toolchain (Rust, Solana CLI, pnpm, just, Surfpool)
just setup

# Compile program + generate IDL + generate TS/Rust clients
just build
```

### 2. Start the local validator with the program deployed

```bash
# This starts solana-test-validator, deploys the program, and inits test state
just webapp-run
```

Leave this terminal running. The validator serves on `http://localhost:8899`.

---

## Run the demo

In a **new terminal**, from this directory:

```bash
npm install
npm run demo
```

To run individual demos:

```bash
npm run demo:fixed      # fixed delegation only
npm run demo:recurring  # recurring delegation only
npm run demo:plan       # plan/subscription only
```

---

## Project layout

```
src/
├── index.ts         Main entry — runs all three demos sequentially
├── constants.ts     Program ID, discriminators, colour helpers
├── pdas.ts          PDA derivation for all 5 account types
├── instructions.ts  Transaction builders for all 14 on-chain instructions
├── setup.ts         Shared setup: connection, wallets, mint, ATAs
├── 01-fixed.ts      Demo 1: fixed delegation
├── 02-recurring.ts  Demo 2: recurring delegation with period enforcement
└── 03-plan.ts       Demo 3: plan creation, subscribe, billing, cancel, resume
```

---

## How the program works (quick reference)

### Core concept: Subscription Authority (SA)

The program solves SPL Token's **one-delegate-per-ATA** limitation.

Instead of approving Bob directly (which would block approving anyone else),
Alice creates a **Subscription Authority PDA** and approves it for `u64::MAX`.
The SA is a passive intermediary — it cannot spend on its own.

Individual **Delegation PDAs** then control *when* and *how much* the SA can move.

```
Alice's ATA  ──approve u64::MAX──▶  SA PDA
                                       │
                         ┌─────────────┼─────────────────┐
                         ▼             ▼                   ▼
                   FixedDelegation  RecurringDelegation  SubscriptionDelegation
                    (Bob, 200 USDC)  (Bob, 300/hr)        (Plan #1001)
```

### Account types

| PDA | Seeds | Size |
|-----|-------|------|
| Subscription Authority | `["SubscriptionAuthority", user, mint]` | 74 bytes |
| FixedDelegation | `["delegation", SA, delegator, delegatee, nonce]` | 123 bytes |
| RecurringDelegation | `["delegation", SA, delegator, delegatee, nonce]` | 147 bytes |
| Plan | `["plan", owner, plan_id]` | 491 bytes |
| SubscriptionDelegation | `["subscription", plan_pda, subscriber]` | 155 bytes |

### Instruction discriminators

The program uses a **single-byte** discriminator (not Anchor's 8-byte hash).

| Disc | Instruction |
|------|-------------|
| 0 | `initialize_subscription_authority` |
| 1 | `create_fixed_delegation` |
| 2 | `create_recurring_delegation` |
| 3 | `revoke_delegation` |
| 4 | `transfer_fixed` |
| 5 | `transfer_recurring` |
| 6 | `close_subscription_authority` |
| 7 | `create_plan` |
| 8 | `update_plan` |
| 9 | `delete_plan` |
| 10 | `transfer_subscription` |
| 11 | `subscribe` |
| 12 | `cancel_subscription` |
| 13 | `resume_subscription` |

---

## Key security properties to observe

**Period enforcement (Demo 2)**
The third pull in Demo 2 is rejected by the runtime — the program's period
tracking makes it physically impossible to overdraw within a period.

**Ghost-account protection (Demo 3)**
When Alice subscribes, the plan's `terms.created_at` (set by the on-chain clock,
not the client) is snapshotted into her `SubscriptionDelegation`. If a merchant
deletes and recreates a plan at the same PDA with different terms, the program's
`check_plan_terms()` comparison will detect the mismatch and block transfers.

**SA as a single revocation point**
Close Alice's SA → all three delegation types immediately become non-transferable.
One instruction cuts off every delegation from a wallet.

---

## Dependencies

```json
"@solana/web3.js": "^1.95.3"   — connection, keypairs, transactions
"@solana/spl-token": "^0.4.9"  — mint creation, ATAs, token queries
"tsx": "^4.19.2"               — run TypeScript directly (dev only)
```

No Anchor, no SDK wrappers, no external RPC — just raw instruction encoding
against the program's documented byte layout.

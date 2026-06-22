/**
 * Solana Subscriptions — Developer Demo
 * ═════════════════════════════════════
 *
 * This script demonstrates all three delegation models provided by the
 * solana-foundation/subscriptions program running on localhost:8899.
 *
 * Prerequisites:
 *   1. cd ../subscriptions && just build
 *   2. just webapp-run          (starts validator + deploys program)
 *   3. (new terminal) npm run demo
 *
 * Program ID: De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44
 */

import { c, log } from "./constants";
import { setup } from "./setup";
import { demoFixedDelegation } from "./01-fixed";
import { demoRecurringDelegation } from "./02-recurring";
import { demoPlanSubscription } from "./03-plan";

async function main(): Promise<void> {
  console.clear();
  console.log();
  console.log(`  ${c.bold}${c.purple}Solana Subscriptions — Developer Demo${c.reset}`);
  console.log(`  ${c.dim}Program: De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44${c.reset}`);
  console.log(`  ${c.dim}Network: http://localhost:8899${c.reset}`);

  // ── Shared setup: wallets, mint, ATAs ────────────────────────────────────────
  const ctx = await setup();

  // ── Demo 1: Fixed Delegation ──────────────────────────────────────────────────
  log.section("Demo 1 — Fixed Delegation");
  console.log(`  ${c.dim}Alice grants Bob a one-time 200 USDC allowance.${c.reset}`);
  console.log(`  ${c.dim}Bob can pull in multiple transfers until the cap is exhausted.${c.reset}`);
  await demoFixedDelegation(ctx);

  // ── Demo 2: Recurring Delegation ─────────────────────────────────────────────
  log.section("Demo 2 — Recurring Delegation");
  console.log(`  ${c.dim}Alice grants Bob 300 USDC per hour (perpetual).${c.reset}`);
  console.log(`  ${c.dim}The program enforces the per-period cap — overdraws are rejected.${c.reset}`);
  await demoRecurringDelegation(ctx);

  // ── Demo 3: Plan-Based Subscription (ADR-002) ─────────────────────────────────
  log.section("Demo 3 — Plan-Based Subscription");
  console.log(`  ${c.dim}Merchant publishes a plan (10 USDC/hour). Alice subscribes.${c.reset}`);
  console.log(`  ${c.dim}Demonstrates billing, cancellation, grace period, and resume.${c.reset}`);
  await demoPlanSubscription(ctx);

  // ── Summary ──────────────────────────────────────────────────────────────────
  log.section("Summary");
  console.log(`
  ${c.bold}Three delegation models, one Subscription Authority:${c.reset}

  ${c.green}Fixed${c.reset}       One-time cap. Use for: gifts, budgets, single payments.
              Delegatee (Bob) signs the transfer.

  ${c.cyan}Recurring${c.reset}   Per-period cap with automatic rollover. Use for:
              salary, rate-limited agents, periodic allowances.
              Delegatee (Bob) signs each transfer.

  ${c.purple}Plan/Sub${c.reset}    Merchant publishes immutable terms. Many subscribers.
              Merchant (or whitelisted puller) signs the transfer —
              the subscriber never needs to be online again.

  ${c.dim}All three reuse Alice's single Subscription Authority PDA.
  Alice's wallet only needs one u64::MAX approval — ever.
  Revoking the SA instantly kills all active delegations.${c.reset}
`);
}

main().catch((err) => {
  console.error(`\n${c.red}${c.bold}Fatal error:${c.reset}`, err.message ?? err);
  process.exit(1);
});

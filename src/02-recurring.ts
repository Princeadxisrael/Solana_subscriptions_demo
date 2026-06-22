/**
 * Demo 2 — Recurring Delegation
 * ──────────────────────────────
 * Alice grants Bob a recurring allowance: 300 USDC per hour, no hard expiry.
 * The program tracks how much Bob has pulled in the current period and rejects
 * any pull that would exceed the per-period cap.
 *
 * This models salary-style flows, rate-limited agent spending, or any situation
 * where you want to cap how fast funds leave a wallet over time.
 *
 * Flow:
 *   1. Alice creates a RecurringDelegation → Bob, 300 USDC/hour, no expiry
 *   2. Bob transfers 100 USDC  (200 remaining in current period)
 *   3. Bob transfers 150 USDC  ( 50 remaining in current period)
 *   4. Bob tries to pull 100 USDC → REJECTED (only 50 remaining this period)
 *   5. Alice revokes the delegation
 */

import { log, ONE_TOKEN } from "./constants";
import { getSubscriptionAuthorityPDA, getDelegationPDA } from "./pdas";
import {
  createRecurringDelegation,
  transferRecurring,
  revokeDelegation,
} from "./instructions";
import { DemoContext, sendTx, printBalances } from "./setup";

export async function demoRecurringDelegation(ctx: DemoContext): Promise<void> {
  const { connection, alice, bob, mint, aliceAta, bobAta } = ctx;

  // ── Derive addresses ─────────────────────────────────────────────────────────
  // Nonce = 2 to avoid collision with the fixed delegation from demo 1
  const [saPDA]  = getSubscriptionAuthorityPDA(alice.publicKey, mint);
  const NONCE    = 2n;
  const [delPDA] = getDelegationPDA(saPDA, alice.publicKey, bob.publicKey, NONCE);

  const AMOUNT_PER_PERIOD = 300n * ONE_TOKEN; // 300 USDC per period
  const PERIOD_SECONDS    = 3600n;            // 1 hour in seconds
  const startTs           = BigInt(Math.floor(Date.now() / 1000));
  const expiryTs          = 0n;              // 0 = never expires

  log.key("SA PDA",           saPDA.toBase58());
  log.key("Delegation PDA",   delPDA.toBase58());
  log.key("Allowance/period", "300.000000 USDC / hour");
  log.key("Expiry",           "none (perpetual)");

  // ── Step 1: Create RecurringDelegation ───────────────────────────────────────
  log.step("Alice creates a RecurringDelegation → Bob  (300 USDC/hour, no expiry)");
  log.info("PDA seeds: [\"delegation\", SA, alice, bob, nonce=2]");
  log.info("Stores:    amount_per_period  |  period_length_s  |  current_period_start_ts");
  log.info("           amount_pulled_in_period (starts at 0)");

  const createSig = await sendTx(
    connection,
    createRecurringDelegation(
      alice.publicKey,
      bob.publicKey,
      mint,
      NONCE,
      AMOUNT_PER_PERIOD,
      PERIOD_SECONDS,
      startTs,
      expiryTs
    ),
    [alice]
  );
  log.ok(`Delegation created  →  ${createSig.slice(0, 20)}…`);

  // ── Step 2: Bob pulls 100 USDC ───────────────────────────────────────────────
  log.step("Bob pulls 100 USDC  (100 / 300 used this period)");
  log.info("Checks: not expired ✓  |  100 ≤ 300 period limit ✓");
  log.info("Updates: amount_pulled_in_period → 100");

  const pull1Sig = await sendTx(
    connection,
    transferRecurring(
      delPDA, saPDA,
      aliceAta, bobAta,
      bob.publicKey, alice.publicKey, mint,
      100n * ONE_TOKEN
    ),
    [bob]
  );
  log.ok(`Transfer 1 (100 USDC)  →  ${pull1Sig.slice(0, 20)}…`);
  await printBalances(connection, ctx);

  // ── Step 3: Bob pulls 150 USDC ───────────────────────────────────────────────
  log.step("Bob pulls 150 USDC  (250 / 300 used this period)");
  log.info("Checks: 100 + 150 = 250  ≤  300 limit ✓");
  log.info("Updates: amount_pulled_in_period → 250");

  const pull2Sig = await sendTx(
    connection,
    transferRecurring(
      delPDA, saPDA,
      aliceAta, bobAta,
      bob.publicKey, alice.publicKey, mint,
      150n * ONE_TOKEN
    ),
    [bob]
  );
  log.ok(`Transfer 2 (150 USDC)  →  ${pull2Sig.slice(0, 20)}…`);
  await printBalances(connection, ctx);

  // ── Step 4: Bob tries to pull 100 USDC — should be rejected ─────────────────
  log.step("Bob attempts to pull 100 USDC  (would exceed 300 USDC period cap)");
  log.info("250 already pulled  +  100 requested  =  350  >  300  ✖");
  log.info("The program rejects this — period limit is enforced on-chain.");
  log.info("Bob must wait for the period to roll over before pulling more.");

  try {
    await sendTx(
      connection,
      transferRecurring(
        delPDA, saPDA,
        aliceAta, bobAta,
        bob.publicKey, alice.publicKey, mint,
        100n * ONE_TOKEN
      ),
      [bob]
    );
    log.warn("Expected rejection but transaction succeeded — check period timing");
  } catch (e: any) {
    log.ok("Transaction correctly rejected by the program  ✓");
    log.info(`Program error: ${e.message?.split("custom program error")[1]?.split('"')[0]?.trim() ?? "period limit exceeded"}`);
    log.info("This is the core safety guarantee: the on-chain program enforces");
    log.info("the per-period cap regardless of what the caller tries to do.");
  }

  // ── Step 5: Alice revokes ────────────────────────────────────────────────────
  log.step("Alice revokes the delegation (cleanup)");
  const revokeSig = await sendTx(
    connection,
    revokeDelegation(alice.publicKey, delPDA, alice.publicKey),
    [alice]
  );
  log.ok(`Delegation revoked  →  ${revokeSig.slice(0, 20)}…`);
  log.ok("Demo 2 complete — recurring delegation and period enforcement demonstrated.");

  // ── Key concept callout ──────────────────────────────────────────────────────
  log.info("");
  log.info("Period rollover: when current time > current_period_start_ts + period_length_s,");
  log.info("the program auto-resets amount_pulled_in_period = 0 on the next transfer.");
  log.info("No cron job or off-chain service needed — purely on-chain state machine.");
}

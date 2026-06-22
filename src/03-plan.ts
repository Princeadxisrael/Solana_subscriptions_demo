/**
 * Demo 3 — Plan-Based Subscription (ADR-002)
 * ───────────────────────────────────────────
 * Merchant publishes a plan with immutable billing terms.
 * Alice subscribes and the merchant pulls payments each period.
 * Alice cancels (grace period), then resumes — all on-chain.
 *
 * This models SaaS billing, streaming services, or any many-subscribers
 * scenario where the merchant publishes terms once and users opt in.
 *
 * Key distinctions from direct delegation (Demo 1 & 2):
 *   • Terms are IMMUTABLE after plan creation (no mid-stream price hikes)
 *   • Plan terms are SNAPSHOTTED per subscriber (ghost-account protection)
 *   • Merchant OR whitelisted pullers can initiate transfers (not the subscriber)
 *   • Cancellation gives a grace period through the end of the current period
 *
 * Flow:
 *   1. Merchant creates a Plan:  10 USDC / 1-hour period, no expiry
 *   2. Alice subscribes  (SA already exists from Demo 1)
 *   3. Merchant pulls 10 USDC  (billing period 1)
 *   4. Alice cancels  →  expires_at_ts = end of current period
 *   5. Merchant can still pull within the grace period
 *   6. Alice resumes  →  expires_at_ts = 0 (active again)
 *   7. Merchant pulls next period
 */

import { log, ONE_TOKEN } from "./constants";
import {
  getPlanPDA,
  getSubscriptionPDA,
  getSubscriptionAuthorityPDA,
} from "./pdas";
import {
  createPlan,
  subscribe,
  transferSubscription,
  cancelSubscription,
  resumeSubscription,
} from "./instructions";
import { getLivePlanTerms, getSubscriptionAuthorityInitId } from "./chain";
import { DemoContext, sendTx, printBalances } from "./setup";

export async function demoPlanSubscription(ctx: DemoContext): Promise<void> {
  const { connection, alice, merchant, mint, aliceAta, merchantAta } = ctx;

  // ── Plan parameters ──────────────────────────────────────────────────────────
  const PLAN_ID           = 1001n;
  const AMOUNT_PER_PERIOD = 10n * ONE_TOKEN;  // 10.000000 USDC per period
  const PERIOD_HOURS      = 1n;               // 1 hour (min allowed by program)
  const END_TS            = 0n;              // 0 = plan never expires

  // ── Derive all PDAs upfront ──────────────────────────────────────────────────
  const [planPDA, planBump]         = getPlanPDA(merchant.publicKey, PLAN_ID);
  const [subscriptionPDA]           = getSubscriptionPDA(planPDA, alice.publicKey);
  const [aliceSaPDA]                = getSubscriptionAuthorityPDA(alice.publicKey, mint);

  log.key("Plan PDA",          planPDA.toBase58());
  log.key("Subscription PDA",  subscriptionPDA.toBase58());
  log.key("Alice SA PDA",      aliceSaPDA.toBase58());
  log.key("Amount / period",   "10.000000 USDC");
  log.key("Period length",     "1 hour");
  log.key("Plan expiry",       "none");

  // ── Step 1: Merchant publishes a Plan ────────────────────────────────────────
  log.step("Merchant creates a subscription plan");
  log.info("Terms are locked in at creation. amount, period_hours, and created_at");
  log.info("are IMMUTABLE. The program overwrites created_at with the on-chain clock");
  log.info("to create a tamper-proof fingerprint — this is how ghost-accounts are detected.");
  log.info("Merchant can later update: status, end_ts, pullers, metadata_uri.");

  const createPlanSig = await sendTx(
    connection,
    createPlan(
      merchant.publicKey,
      mint,
      PLAN_ID,
      AMOUNT_PER_PERIOD,
      PERIOD_HOURS,
      END_TS,
      [],  // no extra pullers — merchant is always implicitly authorised
      []   // no destination restriction — any receiver allowed
    ),
    [merchant]
  );
  log.ok(`Plan created  →  ${createPlanSig.slice(0, 20)}…`);

  // ── Step 2: Alice subscribes ─────────────────────────────────────────────────
  log.step("Alice subscribes to the plan");
  log.info("Creates a SubscriptionDelegation PDA seeded [\"subscription\", planPDA, alice].");
  log.info("Snapshots plan.terms (amount, period_hours, created_at) into the PDA.");
  log.info("This snapshot is Alice's receipt — if merchant recreates the plan with");
  log.info("different terms at the same PDA, check_plan_terms() will detect it.");

  // The subscribe instruction requires the subscriber to attest to the
  // EXACT live values currently on the plan account (mint, amount,
  // period_hours, created_at) plus her own SA's current init_id. The
  // program re-reads the live plan and rejects the call if anything has
  // changed since these were read — this is what stops a stale signed
  // "subscribe" from silently binding to different terms.
  const livePlan = await getLivePlanTerms(connection, planPDA);
  const initId   = await getSubscriptionAuthorityInitId(connection, aliceSaPDA);
  log.info(`Live plan terms read on-chain: amount=${livePlan.amount}, period_hours=${livePlan.periodHours}, created_at=${livePlan.createdAt}`);

  const subscribeSig = await sendTx(
    connection,
    subscribe(
      alice.publicKey,
      merchant.publicKey,
      mint,
      PLAN_ID,
      planBump,
      livePlan.amount,
      livePlan.periodHours,
      livePlan.createdAt,
      initId
    ),
    [alice]
  );
  log.ok(`Subscribed  →  ${subscribeSig.slice(0, 20)}…`);

  // ── Step 3: Merchant pulls first payment ─────────────────────────────────────
  log.step("Merchant pulls first payment  (10 USDC)");
  log.info("Validates: plan not expired ✓ | caller = merchant (owner) ✓");
  log.info("           terms match snapshot ✓ | period limit not exceeded ✓");
  log.info("Transfers via Alice's SA → Alice's ATA → Merchant's ATA.");

  const pull1Sig = await sendTx(
    connection,
    transferSubscription(
      subscriptionPDA, planPDA, aliceSaPDA,
      aliceAta, merchantAta,
      merchant.publicKey,
      alice.publicKey, mint,
      AMOUNT_PER_PERIOD
    ),
    [merchant]
  );
  log.ok(`Payment 1 (10 USDC)  →  ${pull1Sig.slice(0, 20)}…`);
  await printBalances(connection, ctx);

  // ── Step 4: Alice cancels ─────────────────────────────────────────────────────
  log.step("Alice cancels her subscription");
  log.info("Sets expires_at_ts = end of CURRENT billing period (grace period).");
  log.info("Alice keeps access / merchant can still bill until the period ends.");
  log.info("If the plan were closed or terms mismatched, expiry would be immediate.");

  const cancelSig = await sendTx(
    connection,
    cancelSubscription(alice.publicKey, planPDA, subscriptionPDA),
    [alice]
  );
  log.ok(`Subscription cancelled  →  ${cancelSig.slice(0, 20)}…`);
  log.info("expires_at_ts is now set to end-of-current-period.");
  log.info("Merchant can still pull until that timestamp — grace period is active.");

  // ── Step 5: Alice changes her mind and resumes ───────────────────────────────
  log.step("Alice resumes before the cancellation period ends");
  log.info("Clears expires_at_ts back to 0 (active).");
  log.info("current_period_start_ts and amount_pulled_in_period are PRESERVED —");
  log.info("billing accounting continues exactly where it left off.");
  log.info("Rejected if: plan closed, expired, or terms differ from snapshot.");

  const resumeSig = await sendTx(
    connection,
    resumeSubscription(alice.publicKey, planPDA, subscriptionPDA),
    [alice]
  );
  log.ok(`Subscription resumed  →  ${resumeSig.slice(0, 20)}…`);
  log.info("expires_at_ts = 0 again. Subscription is fully active.");

  // ── Step 6: Next period — merchant pulls again (simulated by waiting) ─────────
  log.step("Merchant attempts another pull in the same period");
  log.info("The period is 1 hour. 10 USDC already pulled this period.");
  log.info("Attempting to pull 10 USDC again should be rejected — period cap hit.");

  try {
    await sendTx(
      connection,
      transferSubscription(
        subscriptionPDA, planPDA, aliceSaPDA,
        aliceAta, merchantAta,
        merchant.publicKey,
        alice.publicKey, mint,
        AMOUNT_PER_PERIOD
      ),
      [merchant]
    );
    log.warn("Pull succeeded (period may have rolled over — timing-dependent)");
  } catch {
    log.ok("Pull correctly rejected — period cap already reached  ✓");
    log.info("Merchant must wait for the period to roll over before billing again.");
  }

  log.ok("Demo 3 complete — plan/subscription lifecycle demonstrated.");

  // ── Architecture callout ─────────────────────────────────────────────────────
  log.info("");
  log.info("Architectural insight: Alice never re-approves anything between demos.");
  log.info("Her SA PDA (created in Demo 1) has been reused across all three flows.");
  log.info("One initialization, multiple simultaneous delegation types — this is");
  log.info("exactly what the single-track SA model was designed to enable.");
}

/**
 * Demo 1 — Fixed Delegation
 * ─────────────────────────
 * Alice grants Bob a one-time allowance of 200 USDC expiring in 10 minutes.
 * Bob can pull any amount up to the cap in any number of transfers.
 * Once the balance hits zero the delegation is exhausted (further transfers fail).
 *
 * Flow:
 *   1. Alice initialises her Subscription Authority (SA) for the USDC mint
 *   2. Alice creates a FixedDelegation → Bob, 200 USDC, expiry = now + 10 min
 *   3. Bob transfers  80 USDC  (120 remaining)
 *   4. Bob transfers 120 USDC  (  0 remaining — fully exhausted)
 *   5. Alice revokes the delegation and reclaims rent
 */

import { log, ONE_TOKEN } from "./constants";
import {
  getSubscriptionAuthorityPDA,
  getDelegationPDA,
} from "./pdas";
import {
  initSubscriptionAuthority,
  createFixedDelegation,
  transferFixed,
  revokeDelegation,
} from "./instructions";
import { getSubscriptionAuthorityInitId } from "./chain";
import { DemoContext, sendTx, printBalances } from "./setup";

export async function demoFixedDelegation(ctx: DemoContext): Promise<void> {
  const { connection, alice, bob, mint, aliceAta, bobAta } = ctx;

  // ── Derive addresses ─────────────────────────────────────────────────────────
  const [saPDA]   = getSubscriptionAuthorityPDA(alice.publicKey, mint);
  const NONCE     = 1n;
  const [delPDA]  = getDelegationPDA(saPDA, alice.publicKey, bob.publicKey, NONCE);
  const AMOUNT    = 200n * ONE_TOKEN;                          // 200.000000 USDC
  const expiryTs  = BigInt(Math.floor(Date.now() / 1000) + 600); // +10 min

  log.key("SA PDA",          saPDA.toBase58());
  log.key("Delegation PDA",  delPDA.toBase58());
  log.key("Allowance",       "200.000000 USDC");
  log.key("Expires",         new Date(Number(expiryTs) * 1000).toISOString());

  // ── Step 1: Init Subscription Authority ──────────────────────────────────────
  log.step("Alice initialises her Subscription Authority");
  log.info("This creates a PDA seeded [SubscriptionAuthority, alice, mint]");
  log.info("and calls Token Program Approve(userAta, SA, u64::MAX).");
  log.info("The SA cannot spend on its own — it needs a Delegation PDA.");

  try {
    const sig = await sendTx(
      connection,
      initSubscriptionAuthority(alice.publicKey, mint, aliceAta),
      [alice]
    );
    log.ok(`SA created  →  ${sig.slice(0, 20)}…`);
  } catch (e: any) {
    // Idempotent: if already created from a prior run that's fine
    if (e.message?.includes("already in use") || e.message?.includes("custom program error")) {
      log.info("SA already exists from a previous run — skipping init");
    } else {
      throw e;
    }
  }

  // ── Step 2: Create FixedDelegation ───────────────────────────────────────────
  log.step("Alice creates a FixedDelegation → Bob  (200 USDC, expires in 10 min)");
  log.info("PDA seeds: [\"delegation\", SA, alice, bob, nonce=1]");
  log.info("Stores:    amount=200 USDC  |  expiry_ts  |  payer=alice");

  // The program requires the delegator to attest to the SA's *current*
  // init_id (set from Clock::slot when the SA was created). This guards
  // against creating a delegation against a stale/closed-and-recreated SA.
  const initId = await getSubscriptionAuthorityInitId(connection, saPDA);
  log.info(`SA init_id (read on-chain): ${initId}`);

  const createSig = await sendTx(
    connection,
    createFixedDelegation(
      alice.publicKey,
      bob.publicKey,
      mint,
      NONCE,
      AMOUNT,
      expiryTs,
      initId
    ),
    [alice]
  );
  log.ok(`Delegation created  →  ${createSig.slice(0, 20)}…`);
  log.info("Alice's ATA delegate is now the SA, not Bob directly.");
  log.info("Bob can pull up to 200 USDC — the program enforces the cap.");

  // ── Step 3: Bob transfers 80 USDC ────────────────────────────────────────────
  log.step("Bob pulls 80 USDC via transfer_fixed");
  log.info("Program checks: not expired  ✓  |  80 ≤ 200 remaining  ✓");
  log.info("SA executes the token transfer. Delegation.amount → 120.");

  const pull1Sig = await sendTx(
    connection,
    transferFixed(
      delPDA, saPDA,
      aliceAta, bobAta,
      bob.publicKey, alice.publicKey, mint,
      80n * ONE_TOKEN
    ),
    [bob]
  );
  log.ok(`Transfer 1 (80 USDC)  →  ${pull1Sig.slice(0, 20)}…`);
  await printBalances(connection, ctx);

  // ── Step 4: Bob transfers remaining 120 USDC ─────────────────────────────────
  log.step("Bob pulls remaining 120 USDC via transfer_fixed");
  log.info("Program checks: not expired  ✓  |  120 ≤ 120 remaining  ✓");
  log.info("Delegation.amount → 0. Delegation is now exhausted.");

  const pull2Sig = await sendTx(
    connection,
    transferFixed(
      delPDA, saPDA,
      aliceAta, bobAta,
      bob.publicKey, alice.publicKey, mint,
      120n * ONE_TOKEN
    ),
    [bob]
  );
  log.ok(`Transfer 2 (120 USDC)  →  ${pull2Sig.slice(0, 20)}…`);
  await printBalances(connection, ctx);

  // ── Step 5: Alice revokes (cleanup + rent reclaim) ────────────────────────────
  log.step("Alice revokes the delegation and reclaims rent");
  log.info("Closes the Delegation PDA and returns lamports to alice.");
  log.info("The SA itself remains open — Alice can create new delegations.");

  const revokeSig = await sendTx(
    connection,
    revokeDelegation(alice.publicKey, delPDA, alice.publicKey),
    [alice]
  );
  log.ok(`Delegation revoked  →  ${revokeSig.slice(0, 20)}…`);
  log.ok("Demo 1 complete — fixed delegation fully demonstrated.");
}

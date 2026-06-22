import {
  PublicKey,
  TransactionInstruction,
  AccountMeta,
} from "@solana/web3.js";
import {
  PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Disc,
} from "./constants";
import {
  getSubscriptionAuthorityPDA,
  getDelegationPDA,
  getPlanPDA,
  getSubscriptionPDA,
  getEventAuthorityPDA,
} from "./pdas";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function acc(
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean
): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

/** Write a u64 (little-endian) into a buffer at offset, return new offset */
function writeU64(buf: Buffer, offset: number, value: bigint): number {
  buf.writeBigUInt64LE(value, offset);
  return offset + 8;
}

/** Write an i64 (little-endian) into a buffer at offset, return new offset */
function writeI64(buf: Buffer, offset: number, value: bigint): number {
  buf.writeBigInt64LE(value, offset);
  return offset + 8;
}

/** Write a pubkey (32 bytes) into a buffer at offset, return new offset */
function writePubkey(buf: Buffer, offset: number, key: PublicKey): number {
  key.toBuffer().copy(buf, offset);
  return offset + 32;
}

/** Write a fixed-length byte array, zero-padded to `length` bytes */
function writeBytes(buf: Buffer, offset: number, data: Buffer, length: number): number {
  const slice = data.slice(0, length);
  slice.copy(buf, offset);
  return offset + length;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADR-001  —  Core Delegation Instructions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * initialize_subscription_authority (disc: 0)
 *
 * Creates the SA PDA and grants it u64::MAX delegated approval over the
 * user's ATA. One-time per (user, mint) pair. Must be called before any
 * delegation can be created.
 *
 * Accounts:
 *   0  user            signer, writable  — delegator
 *   1  SA PDA          writable          — created by this instruction
 *   2  mint                              — token mint this SA controls
 *   3  user ATA        writable          — the ATA that gets approved
 *   4  system_program
 *   5  token_program
 */
export function initSubscriptionAuthority(
  user: PublicKey,
  mint: PublicKey,
  userAta: PublicKey
): TransactionInstruction {
  const [saPDA] = getSubscriptionAuthorityPDA(user, mint);
  const data = Buffer.from([Disc.InitSubscriptionAuthority]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(user,              true,  true),
      acc(saPDA,             false, true),
      acc(mint,              false, false),
      acc(userAta,           false, true),
      acc(SYSTEM_PROGRAM_ID, false, false),
      acc(TOKEN_PROGRAM_ID,  false, false),
    ],
    data,
  });
}

/**
 * create_fixed_delegation (disc: 1)
 *
 * Creates a FixedDelegation PDA granting `delegatee` the right to spend
 * up to `amount` tokens. Optionally expires at `expiryTs` (0 = no expiry).
 *
 * Data layout — CreateFixedDelegationData (#[repr(C, packed)], 32 bytes):
 *   nonce:    u64                                    @0
 *   amount:   u64                                    @8
 *   expiry_ts: i64                                   @16
 *   expected_subscription_authority_init_id: i64      @24
 *
 * IMPORTANT: `expected_subscription_authority_init_id` must equal the live
 * SA's current init_id (read via getSubscriptionAuthorityInitId). The
 * program rejects the call with StaleSubscriptionAuthority otherwise.
 *
 * Accounts:
 *   0  delegator       signer, writable
 *   1  SA PDA
 *   2  delegation PDA  writable          — created by this instruction
 *   3  delegatee
 *   4  system_program
 *   5  payer           signer, writable  — defaults to delegator
 */
export function createFixedDelegation(
  delegator: PublicKey,
  delegatee: PublicKey,
  mint: PublicKey,
  nonce: bigint,
  amount: bigint,
  expiryTs: bigint,
  expectedInitId: bigint
): TransactionInstruction {
  const [saPDA]         = getSubscriptionAuthorityPDA(delegator, mint);
  const [delegationPDA] = getDelegationPDA(saPDA, delegator, delegatee, nonce);

  // data layout: disc(1) | nonce(8) | amount(8) | expiry_ts(8) | expected_init_id(8)
  const data = Buffer.alloc(33);
  let off = 0;
  data.writeUInt8(Disc.CreateFixedDelegation, off++);
  off = writeU64(data, off, nonce);
  off = writeU64(data, off, amount);
  off = writeI64(data, off, expiryTs);
  off = writeI64(data, off, expectedInitId);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(delegator,         true,  true),
      acc(saPDA,             false, false),
      acc(delegationPDA,     false, true),
      acc(delegatee,         false, false),
      acc(SYSTEM_PROGRAM_ID, false, false),
      acc(delegator,         true,  true), // payer = delegator
    ],
    data,
  });
}

/**
 * create_recurring_delegation (disc: 2)
 *
 * Creates a RecurringDelegation PDA allowing `delegatee` to pull up to
 * `amountPerPeriod` tokens per `periodLengthS` seconds, starting at
 * `startTs` and optionally expiring at `expiryTs`.
 *
 * Data layout — CreateRecurringDelegationData (#[repr(C, packed)], 48 bytes):
 *   nonce:            u64  @0
 *   amount_per_period: u64  @8
 *   period_length_s:  u64  @16
 *   start_ts:         i64  @24
 *   expiry_ts:        i64  @32
 *   expected_subscription_authority_init_id: i64  @40
 *
 * Accounts: same layout as create_fixed_delegation
 */
export function createRecurringDelegation(
  delegator: PublicKey,
  delegatee: PublicKey,
  mint: PublicKey,
  nonce: bigint,
  amountPerPeriod: bigint,
  periodLengthS: bigint,
  startTs: bigint,
  expiryTs: bigint,
  expectedInitId: bigint
): TransactionInstruction {
  const [saPDA]         = getSubscriptionAuthorityPDA(delegator, mint);
  const [delegationPDA] = getDelegationPDA(saPDA, delegator, delegatee, nonce);

  // data layout: disc(1) | nonce(8) | amt_per_period(8) | period_length_s(8) | start_ts(8) | expiry_ts(8) | expected_init_id(8)
  const data = Buffer.alloc(49);
  let off = 0;
  data.writeUInt8(Disc.CreateRecurringDelegation, off++);
  off = writeU64(data, off, nonce);
  off = writeU64(data, off, amountPerPeriod);
  off = writeU64(data, off, periodLengthS);
  off = writeI64(data, off, startTs);
  off = writeI64(data, off, expiryTs);
  off = writeI64(data, off, expectedInitId);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(delegator,         true,  true),
      acc(saPDA,             false, false),
      acc(delegationPDA,     false, true),
      acc(delegatee,         false, false),
      acc(SYSTEM_PROGRAM_ID, false, false),
      acc(delegator,         true,  true), // payer = delegator
    ],
    data,
  });
}

/**
 * revoke_delegation (disc: 3)
 *
 * Closes any delegation PDA and returns rent to the original payer.
 * - Delegator: can revoke at any time
 * - Sponsor: can only revoke after expiry_ts has passed
 *
 * Accounts:
 *   0  revoker         signer, writable
 *   1  delegation PDA  writable
 *   2  rent receiver   writable  (delegator's address if self-funded)
 */
export function revokeDelegation(
  revoker: PublicKey,
  delegationPDA: PublicKey,
  rentReceiver: PublicKey
): TransactionInstruction {
  const data = Buffer.from([Disc.RevokeDelegation]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(revoker,       true,  true),
      acc(delegationPDA, false, true),
      acc(rentReceiver,  false, true),
    ],
    data,
  });
}

/**
 * transfer_fixed (disc: 4)
 *
 * Delegatee initiates a transfer against a FixedDelegation.
 * Program validates: not expired, amount ≤ remaining balance.
 * Deducts from delegation.amount, then SA transfers tokens.
 * Emits FixedTransferEvent via self-CPI.
 *
 * Accounts (source: DelegationTransferAccounts in transfer_utils.rs):
 *   0  delegation PDA      writable
 *   1  SA PDA
 *   2  delegator ATA       writable  (source)
 *   3  receiver ATA        writable  (destination)
 *   4  token_mint                    <-- easy to miss; sits before token_program
 *   5  token_program
 *   6  delegatee           signer
 *   7  event authority
 *   8  program ID          (for self-CPI event emission)
 */
export function transferFixed(
  delegationPDA: PublicKey,
  saPDA: PublicKey,
  delegatorAta: PublicKey,
  receiverAta: PublicKey,
  delegatee: PublicKey,
  delegator: PublicKey,
  mint: PublicKey,
  amount: bigint
): TransactionInstruction {
  const [eventAuthority] = getEventAuthorityPDA();

  // data layout: disc(1) | amount(8) | delegator(32) | mint(32)
  const data = Buffer.alloc(73);
  let off = 0;
  data.writeUInt8(Disc.TransferFixed, off++);
  off = writeU64(data, off, amount);
  off = writePubkey(data, off, delegator);
  off = writePubkey(data, off, mint);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(delegationPDA,   false, true),
      acc(saPDA,           false, false),
      acc(delegatorAta,    false, true),
      acc(receiverAta,     false, true),
      acc(mint,            false, false),
      acc(TOKEN_PROGRAM_ID,false, false),
      acc(delegatee,       true,  false),
      acc(eventAuthority,  false, false),
      acc(PROGRAM_ID,      false, false),
    ],
    data,
  });
}

/**
 * transfer_recurring (disc: 5)
 *
 * Delegatee initiates a transfer against a RecurringDelegation.
 * Program validates: not expired, amount ≤ (amountPerPeriod - amountPulledInPeriod).
 * Handles period rollover automatically (if current time > period end, resets counter).
 * Emits RecurringTransferEvent via self-CPI.
 *
 * Accounts: identical to transfer_fixed (note the token_mint account
 * between receiver_ata and token_program — easy to miss).
 */
export function transferRecurring(
  delegationPDA: PublicKey,
  saPDA: PublicKey,
  delegatorAta: PublicKey,
  receiverAta: PublicKey,
  delegatee: PublicKey,
  delegator: PublicKey,
  mint: PublicKey,
  amount: bigint
): TransactionInstruction {
  const [eventAuthority] = getEventAuthorityPDA();

  // data layout: disc(1) | amount(8) | delegator(32) | mint(32)
  const data = Buffer.alloc(73);
  let off = 0;
  data.writeUInt8(Disc.TransferRecurring, off++);
  off = writeU64(data, off, amount);
  off = writePubkey(data, off, delegator);
  off = writePubkey(data, off, mint);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(delegationPDA,   false, true),
      acc(saPDA,           false, false),
      acc(delegatorAta,    false, true),
      acc(receiverAta,     false, true),
      acc(mint,            false, false),
      acc(TOKEN_PROGRAM_ID,false, false),
      acc(delegatee,       true,  false),
      acc(eventAuthority,  false, false),
      acc(PROGRAM_ID,      false, false),
    ],
    data,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ADR-002  —  Plan / Subscription Instructions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * create_plan (disc: 7)
 *
 * Merchant publishes a subscription plan with immutable billing terms.
 * The program overwrites terms.created_at with the current on-chain clock,
 * making it a tamper-proof fingerprint for ghost-account detection.
 *
 * Constraints:
 *   - terms.amount > 0
 *   - 0 < terms.period_hours ≤ 8760 (up to 1 year)
 *   - end_ts == 0 OR end_ts ≥ now + period_hours * 3600
 *
 * Accounts:
 *   0  merchant  signer, writable
 *   1  plan PDA  writable
 *   2  mint
 *   3  system_program
 *   4  token_program
 */
export function createPlan(
  merchant: PublicKey,
  mint: PublicKey,
  planId: bigint,
  amountPerPeriod: bigint,
  periodHours: bigint,
  endTs: bigint,
  pullers: PublicKey[],      // up to 4; merchant is always implicitly authorised
  destinations: PublicKey[]  // up to 4; all-zero = any destination allowed
): TransactionInstruction {
  const [planPDA] = getPlanPDA(merchant, planId);

  // PlanData layout (456 bytes after the discriminator byte):
  //   plan_id(8) | mint(32) | terms.amount(8) | terms.period_hours(8) | terms.created_at(8)
  //   | end_ts(8) | destinations[4×32=128] | pullers[4×32=128] | metadata_uri[128]
  const data = Buffer.alloc(457);
  let off = 0;
  data.writeUInt8(Disc.CreatePlan, off++);
  off = writeU64(data, off, planId);
  off = writePubkey(data, off, mint);
  off = writeU64(data, off, amountPerPeriod);   // terms.amount
  off = writeU64(data, off, periodHours);        // terms.period_hours
  off = writeI64(data, off, 0n);                 // terms.created_at — overwritten on-chain
  off = writeI64(data, off, endTs);              // end_ts

  // destinations[4] — fill provided, zero-pad remainder
  for (let i = 0; i < 4; i++) {
    const key = destinations[i] ?? PublicKey.default;
    off = writePubkey(data, off, key);
  }
  // pullers[4] — fill provided, zero-pad remainder
  for (let i = 0; i < 4; i++) {
    const key = pullers[i] ?? PublicKey.default;
    off = writePubkey(data, off, key);
  }
  // metadata_uri[128] — leave zeroed for this demo

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(merchant,          true,  true),
      acc(planPDA,           false, true),
      acc(mint,              false, false),
      acc(SYSTEM_PROGRAM_ID, false, false),
      acc(TOKEN_PROGRAM_ID,  false, false),
    ],
    data,
  });
}

/**
 * subscribe (disc: 11)
 *
 * Subscriber creates a SubscriptionDelegation PDA linked to an active Plan.
 * Snapshots the Plan's billing terms (amount, period_hours, created_at) into
 * the SubscriptionDelegation at this point — this is the ghost-account protection.
 * Emits SubscriptionCreatedEvent via self-CPI.
 *
 * Data layout — SubscribeData (#[repr(C, packed)], 73 bytes):
 *   plan_id:                 u64       @0
 *   plan_bump:                u8        @8
 *   expected_mint:            [u8;32]   @9
 *   expected_amount:          u64       @41
 *   expected_period_hours:    u64       @49
 *   expected_created_at:      i64       @57
 *   expected_subscription_authority_init_id: i64  @65
 *
 * IMPORTANT: the four `expected_*` fields are the subscriber's attestation
 * to the plan's CURRENT on-chain state. The program reads the live Plan
 * account and rejects the call (PlanTermsMismatch) if any value differs.
 * Fetch these with getLivePlanTerms() and getSubscriptionAuthorityInitId()
 * immediately before building this instruction.
 *
 * Accounts:
 *   0  subscriber           signer, writable
 *   1  merchant             (plan owner)
 *   2  plan PDA
 *   3  subscription PDA     writable
 *   4  subscriber's SA PDA
 *   5  system_program
 *   6  event authority
 *   7  program ID
 */
export function subscribe(
  subscriber: PublicKey,
  merchant: PublicKey,
  mint: PublicKey,
  planId: bigint,
  planBump: number,
  expectedAmount: bigint,
  expectedPeriodHours: bigint,
  expectedCreatedAt: bigint,
  expectedInitId: bigint
): TransactionInstruction {
  const [planPDA]          = getPlanPDA(merchant, planId);
  const [subscriptionPDA]  = getSubscriptionPDA(planPDA, subscriber);
  const [saPDA]            = getSubscriptionAuthorityPDA(subscriber, mint);
  const [eventAuthority]   = getEventAuthorityPDA();

  // data layout: disc(1) | plan_id(8) | plan_bump(1) | expected_mint(32)
  //            | expected_amount(8) | expected_period_hours(8)
  //            | expected_created_at(8) | expected_init_id(8)
  const data = Buffer.alloc(74);
  let off = 0;
  data.writeUInt8(Disc.Subscribe, off++);
  off = writeU64(data, off, planId);
  data.writeUInt8(planBump, off); off += 1;
  off = writePubkey(data, off, mint);
  off = writeU64(data, off, expectedAmount);
  off = writeU64(data, off, expectedPeriodHours);
  off = writeI64(data, off, expectedCreatedAt);
  off = writeI64(data, off, expectedInitId);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(subscriber,      true,  true),
      acc(merchant,        false, false),
      acc(planPDA,         false, false),
      acc(subscriptionPDA, false, true),
      acc(saPDA,           false, false),
      acc(SYSTEM_PROGRAM_ID, false, false),
      acc(eventAuthority,  false, false),
      acc(PROGRAM_ID,      false, false),
    ],
    data,
  });
}

/**
 * transfer_subscription (disc: 10)
 *
 * Plan owner OR a whitelisted puller pulls tokens from a subscriber.
 * Validates: plan live, caller authorised, destination whitelisted,
 * terms match the subscription's snapshot (ghost-account check), period limit.
 * Emits SubscriptionTransferEvent via self-CPI.
 *
 * Accounts (source: TransferSubscriptionAccounts in transfer_subscription.rs):
 *   0  subscription PDA  writable
 *   1  plan PDA
 *   2  SA PDA
 *   3  subscriber ATA    writable  (source)
 *   4  receiver ATA      writable  (destination)
 *   5  caller            signer
 *   6  token_mint                  <-- easy to miss; sits before token_program
 *   7  token_program
 *   8  event authority
 *   9  program ID
 */
export function transferSubscription(
  subscriptionPDA: PublicKey,
  planPDA: PublicKey,
  saPDA: PublicKey,
  subscriberAta: PublicKey,
  receiverAta: PublicKey,
  caller: PublicKey,
  subscriber: PublicKey,
  mint: PublicKey,
  amount: bigint
): TransactionInstruction {
  const [eventAuthority] = getEventAuthorityPDA();

  // data layout: disc(1) | amount(8) | delegator(32) | mint(32)
  const data = Buffer.alloc(73);
  let off = 0;
  data.writeUInt8(Disc.TransferSubscription, off++);
  off = writeU64(data, off, amount);
  off = writePubkey(data, off, subscriber);
  off = writePubkey(data, off, mint);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(subscriptionPDA,  false, true),
      acc(planPDA,          false, false),
      acc(saPDA,            false, false),
      acc(subscriberAta,    false, true),
      acc(receiverAta,      false, true),
      acc(caller,           true,  false),
      acc(mint,             false, false),
      acc(TOKEN_PROGRAM_ID, false, false),
      acc(eventAuthority,   false, false),
      acc(PROGRAM_ID,       false, false),
    ],
    data,
  });
}

/**
 * cancel_subscription (disc: 12)
 *
 * Sets expires_at_ts to the end of the current billing period (grace period).
 * If the plan is closed or terms mismatch (ghost plan), expires immediately.
 * Emits SubscriptionCancelledEvent via self-CPI.
 *
 * Accounts:
 *   0  subscriber (delegator)   signer
 *   1  plan PDA
 *   2  subscription PDA         writable
 *   3  event authority
 *   4  program ID
 */
export function cancelSubscription(
  subscriber: PublicKey,
  planPDA: PublicKey,
  subscriptionPDA: PublicKey
): TransactionInstruction {
  const [eventAuthority] = getEventAuthorityPDA();
  const data = Buffer.from([Disc.CancelSubscription]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(subscriber,     true,  false),
      acc(planPDA,        false, false),
      acc(subscriptionPDA,false, true),
      acc(eventAuthority, false, false),
      acc(PROGRAM_ID,     false, false),
    ],
    data,
  });
}

/**
 * resume_subscription (disc: 13)
 *
 * Clears expires_at_ts, reactivating a pending cancellation.
 * Billing state (period start and amount pulled) is preserved unchanged.
 * Rejected if plan is closed, expired, or terms differ from snapshot.
 * Emits SubscriptionResumedEvent via self-CPI.
 *
 * Accounts: identical to cancel_subscription
 */
export function resumeSubscription(
  subscriber: PublicKey,
  planPDA: PublicKey,
  subscriptionPDA: PublicKey
): TransactionInstruction {
  const [eventAuthority] = getEventAuthorityPDA();
  const data = Buffer.from([Disc.ResumeSubscription]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      acc(subscriber,     true,  false),
      acc(planPDA,        false, false),
      acc(subscriptionPDA,false, true),
      acc(eventAuthority, false, false),
      acc(PROGRAM_ID,     false, false),
    ],
    data,
  });
}

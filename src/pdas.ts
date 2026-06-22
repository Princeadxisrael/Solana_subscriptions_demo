import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

/**
 * PDA: ["SubscriptionAuthority", user, mint]
 *
 * One per (user, mint) pair. This is the single delegate that receives
 * u64::MAX approval on the user's ATA, enabling multiple downstream delegations.
 */
export function getSubscriptionAuthorityPDA(
  user: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("SubscriptionAuthority"), user.toBuffer(), mint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * PDA: ["delegation", subscriptionAuthority, delegator, delegatee, nonce_le_u64]
 *
 * Shared by both FixedDelegation and RecurringDelegation.
 * The nonce allows multiple distinct delegations between the same pair.
 */
export function getDelegationPDA(
  subscriptionAuthority: PublicKey,
  delegator: PublicKey,
  delegatee: PublicKey,
  nonce: bigint
): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("delegation"),
      subscriptionAuthority.toBuffer(),
      delegator.toBuffer(),
      delegatee.toBuffer(),
      nonceBuf,
    ],
    PROGRAM_ID
  );
}

/**
 * PDA: ["plan", owner, plan_id_le_u64]
 *
 * Merchant-published subscription plan. Immutable billing terms once created.
 */
export function getPlanPDA(
  owner: PublicKey,
  planId: bigint
): [PublicKey, number] {
  const planIdBuf = Buffer.alloc(8);
  planIdBuf.writeBigUInt64LE(planId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("plan"), owner.toBuffer(), planIdBuf],
    PROGRAM_ID
  );
}

/**
 * PDA: ["subscription", plan_pda, subscriber]
 *
 * Per-subscriber billing state. Stores a snapshot of the plan terms taken at
 * subscribe time (ghost-account protection) + period tracking state.
 */
export function getSubscriptionPDA(
  planPDA: PublicKey,
  subscriber: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("subscription"), planPDA.toBuffer(), subscriber.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * PDA: ["event_authority"]
 *
 * Required by every instruction that emits an on-chain event via self-CPI.
 * The program invokes itself with discriminator 228 to log structured events
 * that off-chain indexers can consume.
 */
export function getEventAuthorityPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("event_authority")],
    PROGRAM_ID
  );
}

/**
 * Associated Token Account address (deterministic, no RPC call needed).
 */
export function getATA(owner: PublicKey, mint: PublicKey): PublicKey {
  const {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
  } = require("./constants");
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

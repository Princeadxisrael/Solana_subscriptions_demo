import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Reads the on-chain SubscriptionAuthority account and extracts its `init_id`.
 *
 * Layout (#[repr(C, packed)], 106 bytes total):
 *   discriminator: u8       @0
 *   user:          [u8;32]  @1
 *   token_mint:    [u8;32]  @33
 *   payer:         [u8;32]  @65
 *   bump:          u8       @97
 *   init_id:       i64      @98   <-- what we need
 *
 * Every create_fixed_delegation / create_recurring_delegation / subscribe
 * instruction must echo back the SA's current init_id so the program can
 * detect a stale (closed + recreated) Subscription Authority.
 */
export async function getSubscriptionAuthorityInitId(
  connection: Connection,
  saPDA: PublicKey
): Promise<bigint> {
  const info = await connection.getAccountInfo(saPDA, "confirmed");
  if (!info) {
    throw new Error(
      `SubscriptionAuthority not found at ${saPDA.toBase58()}. ` +
        `Call initSubscriptionAuthority first.`
    );
  }
  // init_id is an i64 at byte offset 98
  return info.data.readBigInt64LE(98);
}

/** Live billing terms read directly from a Plan account. */
export interface LivePlanTerms {
  mint: PublicKey;
  amount: bigint;
  periodHours: bigint;
  createdAt: bigint;
  endTs: bigint;
}

/**
 * Reads the on-chain Plan account and extracts its mint + immutable terms.
 *
 * Layout (#[repr(C, packed)], 491 bytes total):
 *   discriminator: u8        @0
 *   owner:         [u8;32]   @1
 *   bump:          u8        @33
 *   status:        u8        @34
 *   data (PlanData)          @35
 *     plan_id:       u64      @35
 *     mint:          [u8;32]  @43   <-- what we need
 *     terms (PlanTerms)       @75
 *       amount:        u64     @75   <-- what we need
 *       period_hours:  u64     @83   <-- what we need
 *       created_at:    i64     @91   <-- what we need
 *     end_ts:        i64      @99   <-- what we need
 *     destinations:  [..]     @107
 *     pullers:       [..]     @235
 *     metadata_uri:  [..]     @363
 *
 * The subscriber must echo these exact live values back in `subscribe`'s
 * instruction data — the program rejects the call if they don't match,
 * preventing a stale signed transaction from binding to different terms.
 */
export async function getLivePlanTerms(
  connection: Connection,
  planPDA: PublicKey
): Promise<LivePlanTerms> {
  const info = await connection.getAccountInfo(planPDA, "confirmed");
  if (!info) {
    throw new Error(`Plan not found at ${planPDA.toBase58()}.`);
  }
  const data = info.data;
  return {
    mint: new PublicKey(data.subarray(43, 75)),
    amount: data.readBigUInt64LE(75),
    periodHours: data.readBigUInt64LE(83),
    createdAt: data.readBigInt64LE(91),
    endTs: data.readBigInt64LE(99),
  };
}

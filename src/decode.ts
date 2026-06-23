import { PublicKey } from "@solana/web3.js";

/**
 * Every decoder here mirrors a #[repr(C, packed)] Rust struct byte-for-byte.
 * Offsets are taken directly from program/src/state/*.rs — see the comments
 * on each function for the exact source file they correspond to.
 */


export interface DecodedSubscriptionAuthority {
  discriminator: number;
  user: PublicKey;
  tokenMint: PublicKey;
  payer: PublicKey;
  bump: number;
  initId: bigint;
}

export function decodeSubscriptionAuthority(data: Buffer): DecodedSubscriptionAuthority {
  return {
    discriminator: data.readUInt8(0),
    user:          new PublicKey(data.subarray(1, 33)),
    tokenMint:     new PublicKey(data.subarray(33, 65)),
    payer:         new PublicKey(data.subarray(65, 97)),
    bump:          data.readUInt8(97),
    initId:        data.readBigInt64LE(98),
  };
}


export interface DecodedHeader {
  discriminator: number;
  version: number;
  bump: number;
  delegator: PublicKey;
  delegatee: PublicKey;
  payer: PublicKey;
  initId: bigint;
}

function decodeHeader(data: Buffer): DecodedHeader {
  return {
    discriminator: data.readUInt8(0),
    version:       data.readUInt8(1),
    bump:          data.readUInt8(2),
    delegator:     new PublicKey(data.subarray(3, 35)),
    delegatee:     new PublicKey(data.subarray(35, 67)),
    payer:         new PublicKey(data.subarray(67, 99)),
    initId:        data.readBigInt64LE(99),
  };
}


export interface DecodedFixedDelegation {
  header: DecodedHeader;
  subscriptionAuthority: PublicKey;
  mint: PublicKey;
  amount: bigint;
  expiryTs: bigint;
}

export function decodeFixedDelegation(data: Buffer): DecodedFixedDelegation {
  return {
    header:                 decodeHeader(data),
    subscriptionAuthority:  new PublicKey(data.subarray(107, 139)),
    mint:                   new PublicKey(data.subarray(139, 171)),
    amount:                 data.readBigUInt64LE(171),
    expiryTs:               data.readBigInt64LE(179),
  };
}


export interface DecodedRecurringDelegation {
  header: DecodedHeader;
  subscriptionAuthority: PublicKey;
  mint: PublicKey;
  currentPeriodStartTs: bigint;
  periodLengthS: bigint;
  expiryTs: bigint;
  amountPerPeriod: bigint;
  amountPulledInPeriod: bigint;
}

export function decodeRecurringDelegation(data: Buffer): DecodedRecurringDelegation {
  return {
    header:                 decodeHeader(data),
    subscriptionAuthority:  new PublicKey(data.subarray(107, 139)),
    mint:                   new PublicKey(data.subarray(139, 171)),
    currentPeriodStartTs:   data.readBigInt64LE(171),
    periodLengthS:          data.readBigUInt64LE(179),
    expiryTs:               data.readBigInt64LE(187),
    amountPerPeriod:        data.readBigUInt64LE(195),
    amountPulledInPeriod:   data.readBigUInt64LE(203),
  };
}

export interface DecodedPlan {
  discriminator: number;
  owner: PublicKey;
  bump: number;
  status: "Sunset" | "Active";
  planId: bigint;
  mint: PublicKey;
  amount: bigint;
  periodHours: bigint;
  createdAt: bigint;
  endTs: bigint;
  destinations: PublicKey[];
  pullers: PublicKey[];
  metadataUri: string;
}

export function decodePlan(data: Buffer): DecodedPlan {
  const destinations: PublicKey[] = [];
  for (let i = 0; i < 4; i++) {
    destinations.push(new PublicKey(data.subarray(107 + i * 32, 139 + i * 32)));
  }
  const pullers: PublicKey[] = [];
  for (let i = 0; i < 4; i++) {
    pullers.push(new PublicKey(data.subarray(235 + i * 32, 267 + i * 32)));
  }
  const metadataUriRaw = data.subarray(363, 491);
  const nullIdx = metadataUriRaw.indexOf(0);
  const metadataUri = metadataUriRaw
    .subarray(0, nullIdx === -1 ? metadataUriRaw.length : nullIdx)
    .toString("utf8");

  return {
    discriminator: data.readUInt8(0),
    owner:         new PublicKey(data.subarray(1, 33)),
    bump:          data.readUInt8(33),
    status:        data.readUInt8(34) === 1 ? "Active" : "Sunset",
    planId:        data.readBigUInt64LE(35),
    mint:          new PublicKey(data.subarray(43, 75)),
    amount:        data.readBigUInt64LE(75),
    periodHours:   data.readBigUInt64LE(83),
    createdAt:     data.readBigInt64LE(91),
    endTs:         data.readBigInt64LE(99),
    destinations,
    pullers,
    metadataUri,
  };
}


export interface DecodedSubscriptionDelegation {
  header: DecodedHeader;
  termsAmount: bigint;
  termsPeriodHours: bigint;
  termsCreatedAt: bigint;
  amountPulledInPeriod: bigint;
  currentPeriodStartTs: bigint;
  expiresAtTs: bigint;
}

export function decodeSubscriptionDelegation(data: Buffer): DecodedSubscriptionDelegation {
  return {
    header:                decodeHeader(data),
    termsAmount:           data.readBigUInt64LE(107),
    termsPeriodHours:      data.readBigUInt64LE(115),
    termsCreatedAt:        data.readBigInt64LE(123),
    amountPulledInPeriod:  data.readBigUInt64LE(131),
    currentPeriodStartTs:  data.readBigInt64LE(139),
    expiresAtTs:           data.readBigInt64LE(147),
  };
}

/** Account discriminator byte -> human label (state/common.rs::AccountDiscriminator) */
export const ACCOUNT_DISCRIMINATOR_LABELS: Record<number, string> = {
  0: "SubscriptionAuthority",
  1: "Plan",
  2: "FixedDelegation",
  3: "RecurringDelegation",
  4: "SubscriptionDelegation",
};